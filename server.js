'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const { openDatabase, HttpError } = require('./db');

function createApp({ dbFile, adminPin = '1234', log = console.log } = {}) {
  const db = openDatabase(dbFile);
  const created = db.ensureAdmin(adminPin);
  if (created) log(`Usuario inicial creado → usuario: "admin", PIN: "${adminPin}" (cámbialo al entrar)`);

  const app = express();
  const server = http.createServer(app);
  const io = new Server(server);

  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ---------- Autenticación ----------

  function tokenFrom(req) {
    const header = req.get('authorization') || '';
    if (header.startsWith('Bearer ')) return header.slice(7);
    return req.query.token || null;
  }

  function auth(req, res, next) {
    const user = db.userFromToken(tokenFrom(req));
    if (!user) return res.status(401).json({ error: 'Sesión no válida, vuelve a entrar' });
    req.user = user;
    next();
  }

  function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Solo un administrador puede hacer esto' });
    next();
  }

  const wrap = (fn) => (req, res, next) => {
    try {
      const out = fn(req, res);
      if (out !== undefined) res.json(out);
    } catch (err) {
      next(err);
    }
  };

  // ---------- Presencia (quién está conectado) ----------

  const online = new Map(); // userId -> { user, sockets }

  function presence() {
    return [...online.values()].map((o) => ({ id: o.user.id, name: o.user.name, role: o.user.role }));
  }

  io.use((socket, next) => {
    const user = db.userFromToken(socket.handshake.auth?.token);
    if (!user) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const { user } = socket.data;
    const entry = online.get(user.id) || { user, sockets: 0 };
    entry.sockets += 1;
    online.set(user.id, entry);
    io.emit('presence', presence());

    socket.on('disconnect', () => {
      const e = online.get(user.id);
      if (e && --e.sockets <= 0) online.delete(user.id);
      io.emit('presence', presence());
    });
  });

  function broadcast(event, payload, req) {
    io.emit(event, { ...payload, by: { id: req.user.id, name: req.user.name } });
  }

  // ---------- API ----------

  app.post('/api/login', wrap((req) => db.login(req.body.username, req.body.pin)));

  app.post('/api/logout', auth, wrap((req) => {
    db.logout(tokenFrom(req));
    return { ok: true };
  }));

  app.get('/api/me', auth, wrap((req) => req.user));

  app.get('/api/products', auth, wrap(() => db.listProducts()));

  app.get('/api/categories', auth, wrap(() => db.categories()));

  app.post('/api/products', auth, adminOnly, wrap((req) => {
    const { product, movement } = db.createProduct(req.body, req.user.id);
    broadcast('product:updated', { product }, req);
    if (movement) broadcast('movement:created', { movement }, req);
    return product;
  }));

  app.put('/api/products/:id', auth, adminOnly, wrap((req) => {
    const product = db.updateProduct(Number(req.params.id), req.body, req.user.id);
    broadcast('product:updated', { product }, req);
    return product;
  }));

  app.delete('/api/products/:id', auth, adminOnly, wrap((req) => {
    const id = Number(req.params.id);
    const product = db.getProduct(id);
    db.deleteProduct(id);
    broadcast('product:deleted', { product }, req);
    return { ok: true };
  }));

  app.post('/api/products/:id/movements', auth, wrap((req) => {
    const { type, quantity, note } = req.body;
    if (type === 'ajuste' && req.user.role !== 'admin') {
      throw new HttpError(403, 'Solo un administrador puede ajustar el stock directamente');
    }
    const result = db.recordMovement(Number(req.params.id), req.user.id, type, quantity, note);
    broadcast('product:updated', { product: result.product }, req);
    broadcast('movement:created', { movement: result.movement }, req);
    return result;
  }));

  app.get('/api/movements', auth, wrap((req) => db.listMovements({
    productId: req.query.product_id,
    userId: req.query.user_id,
    type: req.query.type,
    from: req.query.from,
    to: req.query.to,
    limit: req.query.limit,
  })));

  app.get('/api/export/products.csv', auth, (req, res) => {
    const rows = db.listProducts().map((p) => [
      p.name, p.category, p.quantity, p.unit, p.min_stock,
      p.quantity <= p.min_stock ? 'BAJO' : 'OK', p.updated_at, p.updated_by_name || '',
    ]);
    sendCsv(res, 'inventario.csv',
      ['Producto', 'Categoría', 'Cantidad', 'Unidad', 'Stock mínimo', 'Estado', 'Actualizado', 'Por'], rows);
  });

  app.get('/api/export/movements.csv', auth, (req, res) => {
    const rows = db.listMovements({ from: req.query.from, to: req.query.to, limit: 1000 }).map((m) => [
      m.created_at, m.product_name, m.type, m.quantity, m.unit, m.before_qty, m.after_qty, m.user_name, m.note,
    ]);
    sendCsv(res, 'movimientos.csv',
      ['Fecha', 'Producto', 'Tipo', 'Cantidad', 'Unidad', 'Antes', 'Después', 'Usuario', 'Nota'], rows);
  });

  app.get('/api/users', auth, adminOnly, wrap(() => db.listUsers()));

  app.post('/api/users', auth, adminOnly, wrap((req) => db.createUser(req.body)));

  app.put('/api/users/:id', auth, adminOnly, wrap((req) => {
    const user = db.updateUser(Number(req.params.id), req.body);
    if (!user.active) {
      for (const s of io.sockets.sockets.values()) {
        if (s.data.user.id === user.id) s.disconnect(true);
      }
    }
    return user;
  }));

  // Cualquier usuario puede cambiar su propio PIN.
  app.put('/api/me/pin', auth, wrap((req) => {
    db.login(req.user.username, req.body.current_pin); // valida el PIN actual
    db.updateUser(req.user.id, { pin: req.body.new_pin });
    return db.login(req.user.username, req.body.new_pin);
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  return { app, server, io, db };
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sendCsv(res, filename, header, rows) {
  const body = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body); // BOM para que Excel reconozca los acentos
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp({
    dbFile: process.env.DB_FILE || path.join(__dirname, 'data', 'inventario.db'),
    adminPin: process.env.ADMIN_PIN || '1234',
  });
  server.listen(port, () => {
    console.log(`Inventario en marcha → http://localhost:${port}`);
    const nets = require('node:os').networkInterfaces();
    for (const addrs of Object.values(nets)) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) console.log(`  En la red del restaurante → http://${a.address}:${port}`);
      }
    }
  });
}

module.exports = { createApp };
