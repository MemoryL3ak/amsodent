import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/* ============================================================================
   Inventario (pedido 2026-08-27)
   ----------------------------------------------------------------------------
   El stock vigente vive en productos.stock y cada cambio queda en
   inventario_movimientos (entrada / salida / ajuste) con el stock resultante
   estampado. Este servicio es el ÚNICO que escribe stock: lee el valor actual,
   calcula el delta, actualiza el producto y anota el movimiento.

   Requiere la migración 20260827_inventario.sql. Si no está aplicada, los
   errores de columna/tabla se traducen a un mensaje que lo dice.
============================================================================ */

const TIPOS = new Set(['entrada', 'salida', 'ajuste']);

function sinMigracion(mensaje: string) {
  return /does not exist|schema cache/i.test(mensaje)
    ? 'Falta aplicar la migración 20260827_inventario.sql en Supabase.'
    : mensaje;
}

@Injectable()
export class InventarioService {
  constructor(private supabase: SupabaseService) {}

  /* Resumen para la grilla: catálogo con stock, umbral y datos de valorización.
     Se pagina server-side contra Supabase (tope 20.000, igual que productos). */
  async resumen() {
    const { data, error } = await this.supabase
      .getClient()
      .from('productos')
      .select('id, sku, nombre, marca, categoria, formato, estado, costo, stock, stock_minimo')
      .range(0, 20000)
      .order('id', { ascending: true });
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return data;
  }

  /* Movimientos, del más nuevo al más viejo. productoId acota a un producto
     (historial de su ficha); sin él devuelve el libro completo acotado. */
  async movimientos(productoId?: number, limit = 300) {
    let query = this.supabase
      .getClient()
      .from('inventario_movimientos')
      .select('*')
      .order('created_at', { ascending: false })
      .range(0, Math.max(0, Math.min(Number(limit) || 300, 2000) - 1));
    if (productoId) query = query.eq('producto_id', productoId);
    const { data, error } = await query;
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return data;
  }

  /* Registra UN movimiento y deja el stock del producto consistente.
     entrada: suma `cantidad` (positiva). salida: resta (no deja stock
     negativo: mejor rechazar y que se corrija con un ajuste consciente).
     ajuste: `nuevoStock` es el conteo físico y el delta se calcula aquí. */
  async registrarMovimiento(
    body: {
      productoId?: number;
      tipo?: string;
      cantidad?: number;
      nuevoStock?: number;
      motivo?: string;
      referencia?: string;
      costoUnitario?: number;
    },
    email: string,
  ) {
    const client = this.supabase.getClient();
    const productoId = Number(body?.productoId);
    const tipo = String(body?.tipo || '').trim().toLowerCase();
    if (!productoId) throw new BadRequestException('Falta el producto del movimiento.');
    if (!TIPOS.has(tipo)) throw new BadRequestException('Tipo de movimiento inválido (entrada, salida o ajuste).');

    const { data: prod, error: errProd } = await client
      .from('productos')
      .select('id, sku, nombre, stock')
      .eq('id', productoId)
      .single();
    if (errProd) throw new BadRequestException(sinMigracion(errProd.message));
    if (!prod) throw new NotFoundException('Producto no encontrado.');

    const stockActual = Number(prod.stock) || 0;
    let delta: number;
    if (tipo === 'ajuste') {
      const nuevo = Number(body?.nuevoStock);
      if (!Number.isFinite(nuevo) || nuevo < 0) {
        throw new BadRequestException('El ajuste necesita el stock contado (número mayor o igual a 0).');
      }
      delta = nuevo - stockActual;
      if (delta === 0) throw new BadRequestException('El stock contado es igual al vigente: no hay nada que ajustar.');
    } else {
      const cantidad = Number(body?.cantidad);
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        throw new BadRequestException('La cantidad debe ser un número mayor a 0.');
      }
      delta = tipo === 'entrada' ? cantidad : -cantidad;
      if (tipo === 'salida' && stockActual + delta < 0) {
        throw new BadRequestException(
          `La salida (${cantidad}) supera el stock vigente (${stockActual}). Si el conteo real es otro, registra un ajuste.`,
        );
      }
    }

    const stockResultante = stockActual + delta;
    const costoUnitario =
      tipo === 'entrada' && Number(body?.costoUnitario) > 0 ? Number(body.costoUnitario) : null;

    /* Primero el movimiento y después el stock: si el segundo update fallara,
       queda un movimiento con stock_resultante distinto al del producto y la
       inconsistencia es VISIBLE en el historial (al revés, un stock cambiado
       sin movimiento sería invisible e inauditable). */
    const { data: mov, error: errMov } = await client
      .from('inventario_movimientos')
      .insert([
        {
          producto_id: productoId,
          sku: prod.sku || null,
          tipo,
          cantidad: tipo === 'ajuste' ? delta : Math.abs(delta),
          stock_resultante: stockResultante,
          motivo: String(body?.motivo || '').trim() || null,
          referencia: String(body?.referencia || '').trim() || null,
          costo_unitario: costoUnitario,
          usuario_email: email || null,
        },
      ])
      .select()
      .single();
    if (errMov) throw new BadRequestException(sinMigracion(errMov.message));

    const { error: errStock } = await client
      .from('productos')
      .update({ stock: stockResultante })
      .eq('id', productoId);
    if (errStock) throw new BadRequestException(sinMigracion(errStock.message));

    return { movimiento: mov, stock: stockResultante };
  }

  async actualizarStockMinimo(productoId: number, stockMinimo: number) {
    const valor = Number(stockMinimo);
    if (!Number.isFinite(valor) || valor < 0) {
      throw new BadRequestException('El stock mínimo debe ser un número mayor o igual a 0.');
    }
    const { error } = await this.supabase
      .getClient()
      .from('productos')
      .update({ stock_minimo: valor })
      .eq('id', productoId);
    if (error) throw new BadRequestException(sinMigracion(error.message));
    return { ok: true, stock_minimo: valor };
  }

  /* Carga masiva (conteo inicial o re-conteo): filas {sku, stock, stock_minimo?}.
     Cada fila con stock distinto al vigente genera un AJUSTE con el motivo
     indicado, así la carga completa queda auditable en el libro. Los SKUs que
     no existen en el catálogo se devuelven sin aplicar. */
  async cargaMasiva(rows: Array<Record<string, any>>, email: string, motivo?: string) {
    if (!Array.isArray(rows) || !rows.length) throw new BadRequestException('No llegaron filas.');
    if (rows.length > 10000) throw new BadRequestException('Máximo 10.000 filas por carga.');
    const client = this.supabase.getClient();

    const skus = [
      ...new Set(rows.map((r) => String(r?.sku || '').trim().toUpperCase()).filter(Boolean)),
    ];
    const porSku = new Map<string, any>();
    for (let i = 0; i < skus.length; i += 200) {
      const { data, error } = await client
        .from('productos')
        .select('id, sku, stock')
        .in('sku', skus.slice(i, i + 200));
      if (error) throw new BadRequestException(sinMigracion(error.message));
      for (const p of data || []) porSku.set(String(p.sku || '').trim().toUpperCase(), p);
    }

    const motivoFinal = String(motivo || '').trim() || 'Carga masiva de inventario';
    let aplicadas = 0;
    let sinCambio = 0;
    const noEncontrados: string[] = [];
    const errores: string[] = [];

    for (const row of rows) {
      const sku = String(row?.sku || '').trim().toUpperCase();
      const stockNuevo = Number(row?.stock);
      if (!sku) continue;
      const prod = porSku.get(sku);
      if (!prod) {
        noEncontrados.push(sku);
        continue;
      }
      try {
        // Stock (solo si viene y difiere): ajuste auditado.
        if (Number.isFinite(stockNuevo) && stockNuevo >= 0) {
          if ((Number(prod.stock) || 0) !== stockNuevo) {
            await this.registrarMovimiento(
              { productoId: prod.id, tipo: 'ajuste', nuevoStock: stockNuevo, motivo: motivoFinal },
              email,
            );
            prod.stock = stockNuevo; // por si el mismo SKU viene repetido
            aplicadas++;
          } else {
            sinCambio++;
          }
        }
        // Stock mínimo (opcional en la misma planilla).
        const minimo = Number(row?.stock_minimo);
        if (Number.isFinite(minimo) && minimo >= 0) {
          await this.actualizarStockMinimo(prod.id, minimo);
        }
      } catch (e: any) {
        errores.push(`${sku}: ${String(e?.message || e).slice(0, 120)}`);
      }
    }

    return {
      aplicadas,
      sin_cambio: sinCambio,
      no_encontrados: noEncontrados,
      errores,
    };
  }
}
