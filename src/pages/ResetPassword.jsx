import { useState } from "react";
import { supabase } from "../lib/supabase";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [ok, setOk] = useState("");

  const cambiar = async (e) => {
    e.preventDefault();

    const { error } = await supabase.auth.updateUser({ password });

    if (error) setOk("Error: " + error.message);
    else setOk("Contraseña actualizada. Ahora puedes iniciar sesión.");
  };

  return (
    <div className="max-w-md mx-auto mt-20 card animate-fade-in">
      <h1 className="text-2xl font-bold mb-4">Restablecer contraseña</h1>

      <form onSubmit={cambiar} className="space-y-4">
        <div>
          <label className="text-sm font-medium">Nueva contraseña</label>
          <input
            className="input"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <button className="btn-primary cursor-pointer w-full">
          Cambiar contraseña
        </button>
      </form>

      {ok && <p className="text-center mt-4 text-brand-600">{ok}</p>}
    </div>
  );
}
