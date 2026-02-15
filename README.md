# Amsodent Frontend

Base frontend separada para profesionalizar la UI del sistema, alineada a la identidad visual de Amsodent:

- Paleta y tokens del sitio Amsodent:
  - primario `#28AEB1`
  - hover `#25A0A3`
  - radios base `5px`
- Tipografía `Jost`.
- Iconografía consistente con `lucide-react`.
- Componentes base (`Button`, `Input`, `Card`, `Badge`) y layout (`Sidebar`, `Topbar`).

## Ejecutar

```bash
npm install
npm run dev
```

## Estructura

```text
src/
  components/
    layout/
      Sidebar.jsx
      Topbar.jsx
    ui/
      Badge.jsx
      Button.jsx
      Card.jsx
      Input.jsx
  App.jsx
  main.jsx
  styles.css
```

## Conectar con GitHub

```bash
cd amsodent
git init
git add .
git commit -m "chore: scaffold amsodent frontend base"
git branch -M main
git remote add origin https://github.com/MemoryL3ak/amsodent.git
git push -u origin main
```
