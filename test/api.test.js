'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server');

let ctx;
let base;

before(async () => {
  ctx = createApp({ dbFile: ':memory:', adminPin: '9999', log: () => {} });
  await new Promise((r) => ctx.server.listen(0, r));
  base = `http://localhost:${ctx.server.address().port}`;
});

after(() => {
  ctx.io.close();
  ctx.server.close();
  ctx.db.close();
});

async function call(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function login(username, pin) {
  const r = await call('POST', '/api/login', { username, pin });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

test('login rechaza PIN incorrecto y acepta el correcto', async () => {
  assert.equal((await call('POST', '/api/login', { username: 'admin', pin: '0000' })).status, 401);
  const token = await login('admin', '9999');
  const me = await call('GET', '/api/me', null, token);
  assert.equal(me.body.role, 'admin');
});

test('flujo completo: productos, movimientos, permisos y tiempo real', async () => {
  const admin = await login('admin', '9999');

  const u = await call('POST', '/api/users', { username: 'ana', name: 'Ana', role: 'personal', pin: '1111' }, admin);
  assert.equal(u.status, 200);
  const ana = await login('ana', '1111');

  // El personal no puede crear productos
  assert.equal((await call('POST', '/api/products', { name: 'X' }, ana)).status, 403);

  const created = await call('POST', '/api/products',
    { name: 'Tomate', category: 'Verduras', unit: 'kg', min_stock: 5, quantity: 10 }, admin);
  assert.equal(created.status, 200);
  assert.equal(created.body.quantity, 10);
  const id = created.body.id;

  // Un segundo cliente (Ana) escucha los cambios en tiempo real
  const socket = connect(base, { auth: { token: ana }, transports: ['websocket'] });
  await new Promise((r, j) => { socket.on('connect', r); socket.on('connect_error', j); });
  const updated = new Promise((r) => socket.once('product:updated', r));

  const out = await call('POST', `/api/products/${id}/movements`, { type: 'salida', quantity: 2.5, note: 'Ensalada' }, admin);
  assert.equal(out.status, 200);
  assert.equal(out.body.product.quantity, 7.5);

  const event = await updated;
  assert.equal(event.product.quantity, 7.5);
  assert.equal(event.by.name, 'Administrador');
  socket.close();

  // No se puede sacar más de lo que hay
  const tooMuch = await call('POST', `/api/products/${id}/movements`, { type: 'salida', quantity: 100 }, ana);
  assert.equal(tooMuch.status, 409);

  // Solo admin puede ajustar
  assert.equal((await call('POST', `/api/products/${id}/movements`, { type: 'ajuste', quantity: 3 }, ana)).status, 403);
  const adj = await call('POST', `/api/products/${id}/movements`, { type: 'ajuste', quantity: 3 }, admin);
  assert.equal(adj.body.product.quantity, 3);

  // Historial
  const hist = await call('GET', `/api/movements?product_id=${id}`, null, ana);
  assert.deepEqual(hist.body.map((m) => m.type), ['ajuste', 'salida', 'entrada']);
  assert.equal(hist.body[1].note, 'Ensalada');
});

test('movimientos simultáneos no pierden actualizaciones', async () => {
  const admin = await login('admin', '9999');
  const { body: p } = await call('POST', '/api/products', { name: 'Cerveza', unit: 'botella' }, admin);
  await Promise.all(Array.from({ length: 50 }, () =>
    call('POST', `/api/products/${p.id}/movements`, { type: 'entrada', quantity: 1 }, admin)));
  const list = await call('GET', '/api/products', null, admin);
  assert.equal(list.body.find((x) => x.id === p.id).quantity, 50);
});

test('desactivar usuario invalida su sesión y no se puede quitar el último admin', async () => {
  const admin = await login('admin', '9999');
  const { body: u } = await call('POST', '/api/users', { username: 'luis', name: 'Luis', role: 'personal', pin: '2222' }, admin);
  const luis = await login('luis', '2222');
  await call('PUT', `/api/users/${u.id}`, { active: false }, admin);
  assert.equal((await call('GET', '/api/me', null, luis)).status, 401);

  const me = await call('GET', '/api/me', null, admin);
  const r = await call('PUT', `/api/users/${me.body.id}`, { role: 'personal' }, admin);
  assert.equal(r.status, 400);
});

test('exporta CSV', async () => {
  const admin = await login('admin', '9999');
  const res = await fetch(`${base}/api/export/products.csv?token=${admin}`);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Producto,Categoría/);
  assert.match(text, /Tomate/);
});
