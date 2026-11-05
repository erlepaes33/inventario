'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { createApp } = require('../server');

let ctx;
let base;
let admin;
const tokens = {};

before(async () => {
  ctx = createApp({ dbFile: ':memory:', adminPin: '9999', log: () => {} });
  await new Promise((r) => ctx.server.listen(0, r));
  base = `http://localhost:${ctx.server.address().port}`;
  admin = (await call('POST', '/api/login', { username: 'admin', pin: '9999' })).body.token;
  for (const [username, area] of [['vende', 'comercial'], ['mkt', 'marketing'], ['conta', 'finanzas'], ['obra', 'operaciones']]) {
    const r = await call('POST', '/api/users', { username, name: username.toUpperCase(), role: 'personal', pin: '1111', area }, admin);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    tokens[username] = (await call('POST', '/api/login', { username, pin: '1111' })).body.token;
  }
});

after(() => {
  ctx.io.close();
  ctx.server.close();
  ctx.db.close();
});

async function call(method, path, body, token = admin) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function ok(method, path, body, token = admin) {
  const r = await call(method, path, body, token);
  assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(r.body)}`);
  return r.body;
}

test('cada área solo modifica sus módulos', async () => {
  const { vende, mkt, conta, obra } = tokens;
  assert.equal((await call('POST', '/api/crm/projects', { name: 'X' }, vende)).status, 403);
  assert.equal((await call('POST', '/api/crm/campaigns', { name: 'X' }, vende)).status, 403);
  assert.equal((await call('POST', '/api/crm/contacts', { name: 'Lead' }, obra)).status, 403);
  assert.equal((await call('GET', '/api/crm/transactions', null, vende)).status, 403);
  assert.equal((await call('POST', '/api/crm/transactions', { kind: 'gasto', amount: 5, date: '2026-01-01' }, mkt)).status, 403);

  await ok('POST', '/api/crm/campaigns', { name: 'Facebook', channel: 'digital', budget: 1000 }, mkt);
  await ok('POST', '/api/crm/contacts', { name: 'Lead de marketing' }, mkt);
  await ok('POST', '/api/crm/transactions', { kind: 'gasto', amount: 50, date: '2026-01-01' }, conta);
  await ok('POST', '/api/crm/tasks', { title: 'Revisar obra', area: 'operaciones' }, obra);

  const meta = await ok('GET', '/api/crm/meta', null, vende);
  assert.equal(meta.entities.deals.write, true);
  assert.equal(meta.entities.projects.write, false);
  assert.equal(meta.entities.transactions.read, false);
});

test('validación de campos', async () => {
  assert.equal((await call('POST', '/api/crm/contacts', { name: '  ' })).status, 400);
  assert.equal((await call('POST', '/api/crm/contacts', { name: 'A', status: 'raro' })).status, 400);
  assert.equal((await call('POST', '/api/crm/deals', { contact_id: 99999 })).status, 400);
  assert.equal((await call('POST', '/api/crm/transactions', { kind: 'gasto', amount: 0, date: '2026-01-01' })).status, 400);
  assert.equal((await call('POST', '/api/crm/transactions', { kind: 'gasto', amount: 5, date: '01/01/2026' })).status, 400);
  assert.equal((await call('GET', '/api/crm/inexistente')).status, 404);
});

test('venta completa: unidad, comisiones por hitos, pago y caída de la venta', async () => {
  const { vende, conta } = tokens;
  const project = await ok('POST', '/api/crm/projects', { name: 'Los Pinos', commission_pct: 2, marketing_pct: 1.5, fixed_pct: 1.5 });
  const unit = await ok('POST', '/api/crm/units', { project_id: project.id, code: 'Casa 1', price: 150000 });
  const contact = await ok('POST', '/api/crm/contacts', { name: 'Juan Pérez', phone: '+51 999 111 222' }, vende);

  // Toma el precio y el proyecto de la unidad; el asesor es quien la crea.
  const deal = await ok('POST', '/api/crm/deals', { contact_id: contact.id, unit_id: unit.id }, vende);
  assert.equal(deal.amount, 150000);
  assert.equal(deal.project_id, project.id);
  assert.equal(deal.owner_name, 'VENDE');

  // Escuchar en tiempo real
  const socket = connect(base, { auth: { token: conta }, transports: ['websocket'] });
  await new Promise((r, j) => { socket.on('connect', r); socket.on('connect_error', j); });
  const event = new Promise((r) => socket.once('crm:changed', r));

  await ok('PUT', `/api/crm/deals/${deal.id}`, { stage: 'reserva' }, vende);
  assert.equal((await event).entity, 'deals');
  socket.close();
  assert.equal((await ok('GET', `/api/crm/units/${unit.id}`)).status, 'reservada');
  assert.equal((await ok('GET', `/api/crm/contacts/${contact.id}`)).status, 'cliente');
  assert.equal((await ok('GET', '/api/commissions')).length, 0, 'antes de promesa no hay comisiones');

  // Otra persona no puede reservar la misma unidad
  const other = await ok('POST', '/api/crm/contacts', { name: 'Otra' }, vende);
  const dup = await call('POST', '/api/crm/deals', { contact_id: other.id, unit_id: unit.id, stage: 'reserva' }, vende);
  assert.equal(dup.status, 409);

  // Promesa + escritura → 30% + 40% de 3.000 (2% de 150.000), repartido 60/20/10/10
  await ok('PUT', `/api/crm/deals/${deal.id}`, { stage: 'escritura' }, vende);
  const ks = await ok('GET', `/api/commissions?deal_id=${deal.id}`);
  assert.equal(ks.length, 8);
  assert.equal(ks.reduce((a, k) => a + k.amount, 0), 2100);
  const asesorEscritura = ks.find((k) => k.milestone === 'escritura' && k.beneficiary === 'asesor');
  assert.equal(asesorEscritura.amount, 720);
  assert.equal((await ok('GET', `/api/crm/units/${unit.id}`)).status, 'vendida');

  // El asesor ve solo sus comisiones; no puede pagarlas
  const mine = await ok('GET', '/api/commissions', null, vende);
  assert.ok(mine.length === 2 && mine.every((k) => k.beneficiary === 'asesor'));
  assert.equal((await call('POST', `/api/commissions/${asesorEscritura.id}/pay`, null, vende)).status, 403);

  // No se puede retroceder ni cambiar el monto con comisiones generadas
  assert.equal((await call('PUT', `/api/crm/deals/${deal.id}`, { stage: 'reserva' }, vende)).status, 409);
  assert.equal((await call('PUT', `/api/crm/deals/${deal.id}`, { amount: 1 }, vende)).status, 409);
  assert.equal((await call('DELETE', `/api/crm/deals/${deal.id}`, null, vende)).status, 409);

  // Finanzas paga → se registra el gasto del área comercial
  await ok('POST', `/api/commissions/${asesorEscritura.id}/pay`, null, conta);
  assert.equal((await call('POST', `/api/commissions/${asesorEscritura.id}/pay`, null, conta)).status, 409);
  const tx = (await ok('GET', '/api/crm/transactions?area=comercial', null, conta)).find((t) => t.category === 'Comisiones');
  assert.equal(tx.amount, 720);
  assert.equal(tx.kind, 'gasto');

  // La venta se cae: lo pendiente se anula y lo pagado se recupera
  assert.equal((await call('PUT', `/api/crm/deals/${deal.id}`, { stage: 'perdido' }, vende)).status, 400, 'exige motivo');
  await ok('PUT', `/api/crm/deals/${deal.id}`, { stage: 'perdido', lost_reason: 'Crédito rechazado' }, vende);
  const after = await ok('GET', `/api/commissions?deal_id=${deal.id}`);
  assert.equal(after.filter((k) => k.status === 'pendiente' && k.kind === 'comision').length, 0);
  const refund = after.find((k) => k.kind === 'recuperacion');
  assert.equal(refund.amount, -720);
  assert.equal((await ok('GET', `/api/crm/units/${unit.id}`)).status, 'disponible');

  // Cobrar la recuperación genera un ingreso
  await ok('POST', `/api/commissions/${refund.id}/pay`, null, conta);
  const income = (await ok('GET', '/api/crm/transactions?kind=ingreso', null, conta)).find((t) => t.commission_id === refund.id);
  assert.equal(income.amount, 720);

  // La unidad liberada se puede vender a otra persona
  await ok('POST', '/api/crm/deals', { contact_id: other.id, unit_id: unit.id, stage: 'reserva' }, vende);
});

test('presupuesto por proyecto y marketing en el resumen', async () => {
  const { mkt, conta } = tokens;
  const project = await ok('POST', '/api/crm/projects', { name: 'Altos del Sol', commission_pct: 2, marketing_pct: 1.5, fixed_pct: 1.5 });
  for (let i = 1; i <= 20; i++) await ok('POST', '/api/crm/units', { project_id: project.id, code: `Casa ${i}`, price: 150000 });
  const campaign = await ok('POST', '/api/crm/campaigns', { name: 'Lanzamiento', project_id: project.id, budget: 18000 }, mkt);
  await ok('POST', '/api/crm/contacts', { name: 'Lead 1', campaign_id: campaign.id, source: 'digital' }, mkt);
  await ok('POST', '/api/crm/contacts', { name: 'Lead 2', campaign_id: campaign.id, source: 'digital' }, mkt);

  // Un gasto vinculado a la campaña cuenta como marketing del proyecto
  const spend = await ok('POST', '/api/crm/transactions', { kind: 'gasto', amount: 3000, date: '2026-11-01', campaign_id: campaign.id }, conta);
  assert.equal(spend.area, 'marketing');
  assert.equal(spend.project_id, project.id);
  await ok('POST', '/api/crm/transactions', { kind: 'gasto', amount: 15000, date: '2026-11-01', area: 'comercial', category: 'Sala de ventas', project_id: project.id }, conta);

  const c = (await ok('GET', '/api/crm/campaigns', null, mkt)).find((x) => x.id === campaign.id);
  assert.equal(c.spent, 3000);
  assert.equal(c.leads, 2);

  const s = await ok('GET', '/api/crm/summary', null, conta);
  const p = s.projects.find((x) => x.id === project.id);
  assert.equal(p.projected_sales, 3000000);
  assert.equal(p.commission_budget, 60000);
  assert.equal(p.marketing_budget, 45000);
  assert.equal(p.fixed_budget, 45000);
  assert.equal(p.marketing_spent, 3000);
  assert.equal(p.fixed_spent, 15000);
  assert.ok(s.finance);

  const s2 = await ok('GET', '/api/crm/summary', null, mkt);
  assert.equal(s2.finance, undefined, 'marketing no ve las finanzas');
});

test('reglas de comisión configurables', async () => {
  assert.equal((await call('PUT', '/api/crm/settings', {
    default_commission_pct: 3, milestones: { promesa: 50, escritura: 50, entregado: 10 }, split: { asesor: 60, gerente: 20, bono: 10, reserva: 10 },
  })).status, 400);
  assert.equal((await call('PUT', '/api/crm/settings', {
    default_commission_pct: 3, milestones: { promesa: 50, escritura: 50, entregado: 0 }, split: { asesor: 70, gerente: 20, bono: 10, reserva: 0 },
  }, tokens.vende)).status, 403);
  const s = await ok('PUT', '/api/crm/settings', {
    default_commission_pct: 3, milestones: { promesa: 50, escritura: 50, entregado: 0 }, split: { asesor: 70, gerente: 20, bono: 10, reserva: 0 },
  });
  assert.equal(s.split.asesor, 70);

  // Venta sin proyecto: usa el % por defecto (3% de 100.000 = 3.000; 50% en promesa; 70% asesor)
  const contact = await ok('POST', '/api/crm/contacts', { name: 'Sin proyecto' });
  const deal = await ok('POST', '/api/crm/deals', { contact_id: contact.id, amount: 100000, stage: 'promesa' });
  const ks = await ok('GET', `/api/commissions?deal_id=${deal.id}`);
  assert.equal(ks.find((k) => k.beneficiary === 'asesor').amount, 1050);
  assert.equal(ks.find((k) => k.beneficiary === 'reserva'), undefined);
});

test('exporta CSV de los módulos y respeta permisos', async () => {
  const res = await fetch(`${base}/api/export/contacts.csv?token=${admin}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Juan Pérez/);
  const denied = await fetch(`${base}/api/export/transactions.csv?token=${tokens.vende}`);
  assert.equal(denied.status, 403);
});
