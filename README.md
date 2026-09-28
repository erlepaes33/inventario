# 🍽️ Inventario del Restaurante — en tiempo real

Aplicación web para llevar el inventario de un restaurante entre **varias personas a la vez**
(cocina, barra, almacén, encargados…). Cuando alguien registra una entrada o salida, todos los
demás lo ven al instante en su móvil, tablet u ordenador, sin recargar la página.

## Funciones

- **Tiempo real**: los cambios se sincronizan al momento (WebSockets). Aviso emergente tipo
  “Ana: Salida −8 kg de Tomate” y resaltado del producto que cambió.
- **Quién está conectado**: en la barra superior se ve qué personas están en línea.
- **Movimientos**: entradas (compras, proveedores), salidas (consumo), mermas (roturas,
  caducados) y ajustes (recuento físico). Cada uno guarda quién, cuándo, cantidad antes/después y
  una nota opcional.
- **Sin conflictos**: si dos personas tocan el mismo producto a la vez no se pierde ningún
  cambio, y no se permite sacar más stock del que hay.
- **Alertas de stock bajo** por producto (stock mínimo configurable) y filtro “solo stock bajo”.
- **Categorías, unidades** (kg, litros, botellas…) y buscador.
- **Historial** por producto y listado general filtrable por tipo y día.
- **Exportar a CSV** (se abre en Excel) el inventario y los movimientos.
- **Usuarios con PIN y roles**:
  - *Personal*: registra entradas, salidas y mermas.
  - *Administrador*: además crea/edita/elimina productos, hace ajustes y gestiona al personal.
- Diseño pensado para el móvil y con modo oscuro automático.

## Requisitos

- [Node.js](https://nodejs.org) **22.13 o superior** (usa la base de datos SQLite integrada en
  Node, no hace falta instalar nada más).

## Puesta en marcha

```bash
npm install
npm start
```

Abre `http://localhost:3000`. Al arrancar, la consola muestra también la dirección para
entrar desde otros dispositivos conectados al mismo wifi del restaurante
(p. ej. `http://192.168.1.20:3000`).

La primera vez se crea el usuario **`admin`** con PIN **`1234`**. Entra, cámbialo desde el menú
con tu nombre (arriba a la derecha) y da de alta al personal en la pestaña **Personal**.

### Configuración (variables de entorno)

| Variable    | Por defecto          | Descripción                                 |
|-------------|----------------------|---------------------------------------------|
| `PORT`      | `3000`               | Puerto del servidor                         |
| `DB_FILE`   | `data/inventario.db` | Archivo de la base de datos                 |
| `ADMIN_PIN` | `1234`               | PIN del administrador inicial (solo 1ª vez) |

Ejemplo: `PORT=8080 ADMIN_PIN=4827 npm start`

### Copias de seguridad

Todos los datos están en `data/inventario.db`. Basta con copiar la carpeta `data/`.

## Uso en el día a día

1. Cada persona entra desde su móvil con su usuario y PIN.
2. Al recibir mercancía → **+ Entrada** en el producto (nota: proveedor, albarán…).
3. Al usar producto → **− Salida**. Si se rompe o caduca → **Merma**.
4. Al hacer el recuento (administrador) → **Ajuste** con la cantidad real contada.
5. Revisa la tarjeta amarilla de **stock bajo** para saber qué pedir.

## Desarrollo

```bash
npm run dev   # reinicia al guardar cambios
npm test      # pruebas de la API, permisos, concurrencia y tiempo real
```

Estructura:

- `server.js` — servidor Express + Socket.IO (API REST y eventos en tiempo real).
- `db.js` — base de datos SQLite, usuarios, productos y movimientos.
- `public/` — interfaz web (HTML, CSS y JavaScript sin frameworks).
- `test/` — pruebas automáticas.
