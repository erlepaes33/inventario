'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { extendCrm, AREAS } = require('./crm-db');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name        TEXT NOT NULL,
    role        TEXT NOT NULL CHECK (role IN ('admin', 'personal')),
    pin_hash    TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'General',
    unit        TEXT NOT NULL DEFAULT 'unidad',
    quantity    REAL NOT NULL DEFAULT 0,
    min_stock   REAL NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1,
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_by  INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS movements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL REFERENCES products(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL CHECK (type IN ('entrada', 'salida', 'ajuste', 'merma')),
    quantity    REAL NOT NULL,
    before_qty  REAL NOT NULL,
    after_qty   REAL NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_movements_product ON movements(product_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_movements_created ON movements(created_at);
`;

const MOVEMENT_TYPES = ['entrada', 'salida', 'ajuste', 'merma'];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPin(pin, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = crypto.scryptSync(String(pin), salt, 32);
  return crypto.timingSafeEqual(candidate, Buffer.from(hash, 'hex'));
}

// Evita errores de coma flotante al sumar cantidades (p. ej. 0.1 + 0.2).
function round(n) {
  return Math.round(n * 1000) / 1000;
}

function publicUser(u) {
  return u && {
    id: u.id, username: u.username, name: u.name, role: u.role, active: !!u.active,
    area: u.area, position: u.position,
  };
}

function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);

  // Migración: área de la empresa y cargo de cada persona.
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('area')) {
    db.exec("ALTER TABLE users ADD COLUMN area TEXT NOT NULL DEFAULT 'operaciones'");
    db.exec("UPDATE users SET area = 'gerencia' WHERE role = 'admin'");
  }
  if (!userCols.includes('position')) db.exec("ALTER TABLE users ADD COLUMN position TEXT NOT NULL DEFAULT ''");

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  const q = {
    userByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByToken: db.prepare(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND u.active = 1'
    ),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1"),
    productById: db.prepare(`
      SELECT p.*, u.name AS updated_by_name
      FROM products p LEFT JOIN users u ON u.id = p.updated_by
      WHERE p.id = ?`),
    movementById: db.prepare(`
      SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
      FROM movements m
      JOIN products p ON p.id = m.product_id
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ?`),
  };

  function cleanProductInput(input, partial = false) {
    const out = {};
    if (!partial || input.name !== undefined) {
      const name = String(input.name ?? '').trim();
      if (!name) throw new HttpError(400, 'El nombre del producto es obligatorio');
      out.name = name.slice(0, 120);
    }
    if (!partial || input.category !== undefined) {
      out.category = String(input.category ?? '').trim().slice(0, 60) || 'General';
    }
    if (!partial || input.unit !== undefined) {
      out.unit = String(input.unit ?? '').trim().slice(0, 20) || 'unidad';
    }
    if (!partial || input.min_stock !== undefined) {
      const min = Number(input.min_stock ?? 0);
      if (!Number.isFinite(min) || min < 0) throw new HttpError(400, 'El stock mínimo no es válido');
      out.min_stock = round(min);
    }
    return out;
  }

  const api = {
    HttpError,
    MOVEMENT_TYPES,
    close: () => db.close(),

    // ---------- Usuarios y sesiones ----------

    ensureAdmin(pin) {
      if (q.countAdmins.get().n > 0) return null;
      const existing = q.userByUsername.get('admin');
      if (existing) {
        db.prepare("UPDATE users SET role = 'admin', active = 1, pin_hash = ? WHERE id = ?")
          .run(hashPin(pin), existing.id);
      } else {
        db.prepare("INSERT INTO users (username, name, role, pin_hash, area) VALUES ('admin', 'Administrador', 'admin', ?, 'gerencia')")
          .run(hashPin(pin));
      }
      return 'admin';
    },

    login(username, pin) {
      const user = q.userByUsername.get(String(username ?? '').trim());
      if (!user || !user.active || !verifyPin(pin ?? '', user.pin_hash)) {
        throw new HttpError(401, 'Usuario o PIN incorrecto');
      }
      const token = crypto.randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
      return { token, user: publicUser(user) };
    },

    logout(token) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    },

    userFromToken(token) {
      if (!token) return null;
      return publicUser(q.userByToken.get(token));
    },

    listUsers() {
      return db.prepare('SELECT * FROM users ORDER BY active DESC, name').all().map(publicUser);
    },

    listPeople() {
      return db.prepare('SELECT id, name, area, position FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE').all();
    },

    createUser({ username, name, role, pin, area = 'operaciones', position = '' }) {
      username = String(username ?? '').trim().toLowerCase();
      name = String(name ?? '').trim();
      if (!/^[a-z0-9._-]{2,30}$/.test(username)) {
        throw new HttpError(400, 'El usuario debe tener 2-30 caracteres (letras, números, . _ -)');
      }
      if (!name) throw new HttpError(400, 'El nombre es obligatorio');
      if (!['admin', 'personal'].includes(role)) throw new HttpError(400, 'Rol no válido');
      if (!/^\d{4,8}$/.test(String(pin ?? ''))) throw new HttpError(400, 'El PIN debe tener entre 4 y 8 dígitos');
      if (!AREAS.includes(area)) throw new HttpError(400, 'Área no válida');
      if (q.userByUsername.get(username)) throw new HttpError(409, 'Ese nombre de usuario ya existe');
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (username, name, role, pin_hash, area, position) VALUES (?, ?, ?, ?, ?, ?)')
        .run(username, name.slice(0, 60), role, hashPin(pin), area, String(position ?? '').trim().slice(0, 60));
      return publicUser(q.userById.get(lastInsertRowid));
    },

    updateUser(id, { name, role, pin, active, area, position }) {
      return tx(() => {
        const user = q.userById.get(id);
        if (!user) throw new HttpError(404, 'Usuario no encontrado');
        const next = {
          name: name !== undefined ? String(name).trim().slice(0, 60) : user.name,
          role: role !== undefined ? role : user.role,
          active: active !== undefined ? (active ? 1 : 0) : user.active,
          pin_hash: user.pin_hash,
          area: area !== undefined ? area : user.area,
          position: position !== undefined ? String(position ?? '').trim().slice(0, 60) : user.position,
        };
        if (!AREAS.includes(next.area)) throw new HttpError(400, 'Área no válida');
        if (!next.name) throw new HttpError(400, 'El nombre es obligatorio');
        if (!['admin', 'personal'].includes(next.role)) throw new HttpError(400, 'Rol no válido');
        if (pin !== undefined && pin !== '') {
          if (!/^\d{4,8}$/.test(String(pin))) throw new HttpError(400, 'El PIN debe tener entre 4 y 8 dígitos');
          next.pin_hash = hashPin(pin);
        }
        const losesAdmin = user.role === 'admin' && user.active && (next.role !== 'admin' || !next.active);
        if (losesAdmin && q.countAdmins.get().n <= 1) {
          throw new HttpError(400, 'Debe quedar al menos un administrador activo');
        }
        db.prepare('UPDATE users SET name = ?, role = ?, active = ?, pin_hash = ?, area = ?, position = ? WHERE id = ?')
          .run(next.name, next.role, next.active, next.pin_hash, next.area, next.position, id);
        if (!next.active || next.pin_hash !== user.pin_hash) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
        }
        return publicUser(q.userById.get(id));
      });
    },

    // ---------- Productos ----------

    listProducts() {
      return db.prepare(`
        SELECT p.*, u.name AS updated_by_name
        FROM products p LEFT JOIN users u ON u.id = p.updated_by
        WHERE p.active = 1
        ORDER BY p.category COLLATE NOCASE, p.name COLLATE NOCASE`).all();
    },

    getProduct(id) {
      const p = q.productById.get(id);
      if (!p || !p.active) throw new HttpError(404, 'Producto no encontrado');
      return p;
    },

    createProduct(input, userId) {
      const data = cleanProductInput(input);
      const initial = Number(input.quantity ?? 0);
      if (!Number.isFinite(initial) || initial < 0) throw new HttpError(400, 'La cantidad inicial no es válida');
      return tx(() => {
        const { lastInsertRowid: id } = db
          .prepare('INSERT INTO products (name, category, unit, min_stock, quantity, updated_by) VALUES (?, ?, ?, ?, 0, ?)')
          .run(data.name, data.category, data.unit, data.min_stock, userId);
        let movement = null;
        if (initial > 0) {
          movement = api._applyMovement(id, userId, 'entrada', initial, 'Stock inicial');
        }
        return { product: q.productById.get(id), movement };
      });
    },

    updateProduct(id, input, userId) {
      api.getProduct(id);
      const data = cleanProductInput(input, true);
      const fields = Object.keys(data);
      if (fields.length === 0) return q.productById.get(id);
      const sets = fields.map((f) => `${f} = ?`).join(', ');
      db.prepare(`UPDATE products SET ${sets}, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?`)
        .run(...fields.map((f) => data[f]), userId, id);
      return q.productById.get(id);
    },

    deleteProduct(id) {
      api.getProduct(id);
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
    },

    categories() {
      return db.prepare('SELECT DISTINCT category FROM products WHERE active = 1 ORDER BY category COLLATE NOCASE')
        .all().map((r) => r.category);
    },

    // ---------- Movimientos ----------

    // Registra un movimiento de forma atómica. Cada escritura va dentro de una
    // transacción IMMEDIATE, así dos personas modificando el mismo producto a la
    // vez nunca pierden actualizaciones.
    recordMovement(productId, userId, type, quantity, note) {
      return tx(() => {
        const movement = api._applyMovement(productId, userId, type, quantity, note);
        return { product: q.productById.get(productId), movement };
      });
    },

    _applyMovement(productId, userId, type, quantity, note = '') {
      if (!MOVEMENT_TYPES.includes(type)) throw new HttpError(400, 'Tipo de movimiento no válido');
      const qty = round(Number(quantity));
      if (!Number.isFinite(qty) || qty < 0 || (type !== 'ajuste' && qty === 0)) {
        throw new HttpError(400, 'La cantidad no es válida');
      }
      const product = q.productById.get(productId);
      if (!product || !product.active) throw new HttpError(404, 'Producto no encontrado');

      const before = product.quantity;
      let after;
      if (type === 'entrada') after = before + qty;
      else if (type === 'ajuste') after = qty;
      else after = before - qty;
      after = round(after);
      if (after < 0) {
        throw new HttpError(409, `Stock insuficiente: solo quedan ${before} ${product.unit} de ${product.name}`);
      }

      db.prepare("UPDATE products SET quantity = ?, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
        .run(after, userId, productId);
      const { lastInsertRowid } = db
        .prepare('INSERT INTO movements (product_id, user_id, type, quantity, before_qty, after_qty, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(productId, userId, type, qty, before, after, String(note ?? '').trim().slice(0, 200));
      return q.movementById.get(lastInsertRowid);
    },

    listMovements({ productId, userId, type, from, to, limit = 100 } = {}) {
      const where = [];
      const params = [];
      if (productId) { where.push('m.product_id = ?'); params.push(Number(productId)); }
      if (userId) { where.push('m.user_id = ?'); params.push(Number(userId)); }
      if (type) { where.push('m.type = ?'); params.push(String(type)); }
      if (from) { where.push('m.created_at >= ?'); params.push(String(from)); }
      if (to) { where.push('m.created_at < ?'); params.push(String(to)); }
      const lim = Math.min(Math.max(Number(limit) || 100, 1), 1000);
      return db.prepare(`
        SELECT m.*, p.name AS product_name, p.unit, u.name AS user_name
        FROM movements m
        JOIN products p ON p.id = m.product_id
        JOIN users u ON u.id = m.user_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY m.id DESC
        LIMIT ${lim}`).all(...params);
    },
  };

  api.crm = extendCrm(db, { tx, HttpError, round });
  return api;
}

module.exports = { openDatabase, HttpError, MOVEMENT_TYPES };
