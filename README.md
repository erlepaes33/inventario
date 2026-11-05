# 🏘️ CRM Inmobiliario — todas las áreas de la empresa, en tiempo real

CRM para inmobiliarias y constructoras que reúne en una sola aplicación las áreas **comercial,
marketing, finanzas, operaciones y RR. HH.**, además del inventario de materiales. Varias personas
trabajan a la vez y todos ven los cambios al instante, sin recargar la página.

## Módulos

| Pestaña | Área | Qué hace |
|---|---|---|
| **Resumen** | Gerencia | Indicadores clave: clientes, embudo, ventas, conversión, unidades disponibles, tareas vencidas, marketing (CPL, costo por venta), finanzas del mes y **presupuesto comercial por proyecto** (comisiones, marketing y estructura fija como % de las ventas proyectadas, frente a lo gastado). |
| **Clientes** | Comercial / Marketing | Ficha de cada cliente o lead: datos, origen y campaña, asesor, estado, oportunidades e historial de llamadas, visitas, WhatsApp… |
| **Ventas** | Comercial | Embudo (kanban) por etapas: prospecto → visita → cotización → reserva → promesa → escritura → entregado (o perdido, con motivo). |
| **Proyectos** | Gerencia | Proyectos y sus unidades (casas, departamentos, lotes…) con precio y estado (disponible, reservada, vendida, entregada). |
| **Marketing** | Marketing | Campañas por canal y fase con presupuesto, gasto, clientes captados, costo por cliente y costo por venta. |
| **Finanzas** | Finanzas | Ingresos y gastos por área y proyecto, y **comisiones**: pendientes, pagadas y recuperaciones. |
| **Tareas** | Todas | Tareas entre áreas con responsable, prioridad y fecha límite (resalta las vencidas). |
| **Inventario / Movimientos** | Operaciones | Stock de materiales y suministros con entradas, salidas, mermas y ajustes. |
| **Personal** | RR. HH. (administrador) | Personas, su área, su cargo y su rol. |

### Reglas automáticas del área comercial

- Al reservar una unidad, queda **reservada**; con la promesa o la escritura pasa a **vendida**, y al
  entregar, a **entregada**. Una unidad no se puede reservar dos veces.
- Las **comisiones se generan solas por hitos de cobro** (por defecto: 30 % en la promesa, 40 % en
  la escritura y 30 % en la entrega) sobre el % de comisión del proyecto, y se reparten así: asesor
  60 %, gerencia comercial 20 %, bono de equipo 10 % y fondo de reserva 10 %. El administrador puede
  cambiar estos porcentajes en **Finanzas → ⚙️ Reglas de comisión**.
- Si una venta se cae, lo pendiente se **anula** y lo ya pagado se registra como **recuperación**
  para descontarlo.
- Al pagar una comisión, se anota automáticamente como gasto del área comercial en Finanzas.
- Un gasto vinculado a una campaña cuenta como gasto de marketing de su proyecto.

### Permisos por área

Cada persona pertenece a un área. Todas pueden consultar los módulos y crear tareas, pero solo
modifican lo de su área:

- **Comercial**: clientes y oportunidades.
- **Marketing**: campañas y clientes (leads).
- **Finanzas**: ingresos, gastos y pago de comisiones. Es la única área que ve las finanzas.
- **Gerencia** y los **administradores**: todo, incluidos los proyectos y las unidades.

Cada asesor ve sus propias comisiones en **Finanzas**.

## Funciones generales

- **Tiempo real** (WebSockets): avisos emergentes y pantallas que se actualizan solas.
- **Quién está conectado**, en la barra superior.
- **Exportar a CSV** (se abre en Excel) los clientes, las oportunidades, las campañas, los
  movimientos financieros, las comisiones, las unidades y el inventario.
- **Usuarios con PIN**, área y rol (*personal* o *administrador*).
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
entrar desde otros dispositivos conectados al mismo wifi de la oficina
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
Las bases de datos existentes se actualizan solas al arrancar: los usuarios que ya había quedan en
el área *Operaciones* y los administradores, en *Gerencia*.

## Uso en el día a día

1. El administrador crea los **proyectos** y sus **unidades**, y da de alta al personal con su área.
2. Marketing crea las **campañas**. Los clientes que llegan se registran indicando su origen y campaña.
3. El asesor anota cada contacto en el **historial** del cliente y mueve la oportunidad por el
   **embudo** con «Pasar a…».
4. Desde la promesa se generan las comisiones; Finanzas las paga en **Finanzas → Comisiones**.
5. Finanzas registra ingresos (cuotas, pagos) y gastos (pauta, sala de ventas, planilla…) por área y proyecto.
6. La gerencia sigue todo en **Resumen**, sobre todo el presupuesto comercial y de marketing de cada proyecto.

## Desarrollo

```bash
npm run dev   # reinicia al guardar cambios
npm test      # pruebas de la API, permisos por área, comisiones, concurrencia y tiempo real
```

Estructura:

- `server.js` — servidor Express + Socket.IO (API REST y eventos en tiempo real).
- `db.js` — base de datos SQLite: usuarios, productos y movimientos de inventario.
- `crm-db.js` — módulos del CRM: definición de campos, permisos por área y reglas de negocio
  (unidades, comisiones, presupuesto).
- `crm-routes.js` — API del CRM (`/api/crm/<módulo>`, comisiones, resumen y exportación).
- `public/` — interfaz web (HTML, CSS y JavaScript sin frameworks); `public/crm.js` dibuja los módulos del CRM.
- `test/` — pruebas automáticas.
