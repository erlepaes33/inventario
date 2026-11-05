'use strict';

// Módulos del CRM (inmobiliaria / constructora): proyectos y unidades, clientes,
// oportunidades de venta, actividades, campañas de marketing, finanzas,
// comisiones por hitos y tareas entre áreas.

const AREAS = ['gerencia', 'comercial', 'marketing', 'finanzas', 'operaciones', 'rrhh'];
const STAGES = ['prospecto', 'visita', 'cotizacion', 'reserva', 'promesa', 'escritura', 'entregado', 'perdido'];
const SOLD_STAGES = ['promesa', 'escritura', 'entregado'];
const MILESTONES = ['promesa', 'escritura', 'entregado'];
const BENEFICIARIES = ['asesor', 'gerente', 'bono', 'reserva'];
const CHANNELS = ['digital', 'portales', 'vallas', 'eventos', 'referidos', 'sala_ventas', 'otro'];
const PHASES = ['prelanzamiento', 'lanzamiento', 'mantenimiento', 'cierre'];

const DEFAULT_SETTINGS = {
  default_commission_pct: 2,
  milestones: { promesa: 30, escritura: 40, entregado: 30 },
  split: { asesor: 60, gerente: 20, bono: 10, reserva: 10 },
};

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const COMMON = `
    active      INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT NOT NULL DEFAULT (${NOW}),
    updated_at  TEXT NOT NULL DEFAULT (${NOW})`;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS projects (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    location       TEXT NOT NULL DEFAULT '',
    status         TEXT NOT NULL DEFAULT 'preventa',
    commission_pct REAL NOT NULL DEFAULT 2,
    marketing_pct  REAL NOT NULL DEFAULT 1.5,
    fixed_pct      REAL NOT NULL DEFAULT 1.5,
    notes          TEXT NOT NULL DEFAULT '',${COMMON}
  );

  CREATE TABLE IF NOT EXISTS units (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  INTEGER NOT NULL REFERENCES projects(id),
    code        TEXT NOT NULL,
    kind        TEXT NOT NULL DEFAULT 'casa',
    area_m2     REAL NOT NULL DEFAULT 0,
    bedrooms    REAL NOT NULL DEFAULT 0,
    price       REAL NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'disponible',${COMMON}
  );

  CREATE TABLE IF NOT EXISTS campaigns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    project_id  INTEGER REFERENCES projects(id),
    channel     TEXT NOT NULL DEFAULT 'digital',
    phase       TEXT NOT NULL DEFAULT 'lanzamiento',
    budget      REAL NOT NULL DEFAULT 0,
    start_date  TEXT,
    end_date    TEXT,
    notes       TEXT NOT NULL DEFAULT '',${COMMON}
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    phone       TEXT NOT NULL DEFAULT '',
    email       TEXT NOT NULL DEFAULT '',
    document    TEXT NOT NULL DEFAULT '',
    source      TEXT NOT NULL DEFAULT 'otro',
    campaign_id INTEGER REFERENCES campaigns(id),
    owner_id    INTEGER REFERENCES users(id),
    status      TEXT NOT NULL DEFAULT 'nuevo',
    notes       TEXT NOT NULL DEFAULT '',${COMMON}
  );

  CREATE TABLE IF NOT EXISTS deals (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id  INTEGER NOT NULL REFERENCES contacts(id),
    project_id  INTEGER REFERENCES projects(id),
    unit_id     INTEGER REFERENCES units(id),
    owner_id    INTEGER REFERENCES users(id),
    stage       TEXT NOT NULL DEFAULT 'prospecto',
    amount      REAL NOT NULL DEFAULT 0,
    lost_reason TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    closed_at   TEXT,${COMMON}
  );

  CREATE TABLE IF NOT EXISTS activities (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    contact_id  INTEGER REFERENCES contacts(id),
    deal_id     INTEGER REFERENCES deals(id),
    user_id     INTEGER NOT NULL REFERENCES users(id),
    kind        TEXT NOT NULL DEFAULT 'nota',
    note        TEXT NOT NULL DEFAULT '',${COMMON}
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    title       TEXT NOT NULL,
    area        TEXT NOT NULL DEFAULT 'operaciones',
    assignee_id INTEGER REFERENCES users(id),
    due_date    TEXT,
    status      TEXT NOT NULL DEFAULT 'pendiente',
    priority    TEXT NOT NULL DEFAULT 'media',
    contact_id  INTEGER REFERENCES contacts(id),
    notes       TEXT NOT NULL DEFAULT '',
    created_by  INTEGER REFERENCES users(id),${COMMON}
  );

  CREATE TABLE IF NOT EXISTS commissions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    deal_id     INTEGER NOT NULL REFERENCES deals(id),
    milestone   TEXT NOT NULL,
    beneficiary TEXT NOT NULL,
    user_id     INTEGER REFERENCES users(id),
    kind        TEXT NOT NULL DEFAULT 'comision' CHECK (kind IN ('comision', 'recuperacion')),
    amount      REAL NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagada', 'anulada')),
    paid_at     TEXT,
    created_at  TEXT NOT NULL DEFAULT (${NOW})
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    kind          TEXT NOT NULL CHECK (kind IN ('ingreso', 'gasto')),
    area          TEXT NOT NULL DEFAULT 'gerencia',
    category      TEXT NOT NULL DEFAULT 'General',
    amount        REAL NOT NULL,
    date          TEXT NOT NULL,
    description   TEXT NOT NULL DEFAULT '',
    project_id    INTEGER REFERENCES projects(id),
    campaign_id   INTEGER REFERENCES campaigns(id),
    deal_id       INTEGER REFERENCES deals(id),
    commission_id INTEGER REFERENCES commissions(id),
    user_id       INTEGER REFERENCES users(id),${COMMON}
  );

  CREATE INDEX IF NOT EXISTS idx_units_project ON units(project_id);
  CREATE INDEX IF NOT EXISTS idx_deals_stage ON deals(stage);
  CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id, id DESC);
  CREATE INDEX IF NOT EXISTS idx_commissions_deal ON commissions(deal_id);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
`;

const text = (label, extra = {}) => ({ type: 'text', label, max: 200, ...extra });
const ref = (label, table, extra = {}) => ({ type: 'ref', label, table, ...extra });
const num = (label, extra = {}) => ({ type: 'number', label, min: 0, ...extra });
const choice = (label, values, extra = {}) => ({ type: 'enum', label, values, default: values[0], ...extra });

// Cada entidad declara sus campos (con validación), quién puede escribir
// (áreas; gerencia y administradores siempre pueden) y cómo se lista.
const ENTITIES = {
  projects: {
    label: 'Proyecto',
    write: [],
    fields: {
      name: text('Nombre', { required: true, max: 120 }),
      location: text('Ubicación'),
      status: choice('Estado', ['planificacion', 'preventa', 'construccion', 'entregado'], { default: 'preventa' }),
      commission_pct: num('% comisiones', { max: 100, default: 2 }),
      marketing_pct: num('% marketing', { max: 100, default: 1.5 }),
      fixed_pct: num('% estructura comercial fija', { max: 100, default: 1.5 }),
      notes: text('Notas', { max: 1000, long: true }),
    },
    select: `
      SELECT t.*,
        (SELECT COUNT(*) FROM units u WHERE u.project_id = t.id AND u.active = 1) AS units_total,
        (SELECT COUNT(*) FROM units u WHERE u.project_id = t.id AND u.active = 1 AND u.status = 'disponible') AS units_available,
        (SELECT COALESCE(SUM(u.price), 0) FROM units u WHERE u.project_id = t.id AND u.active = 1) AS projected_sales
      FROM projects t`,
    filters: { status: 't.status' },
    order: 't.name COLLATE NOCASE',
  },

  units: {
    label: 'Unidad',
    write: [],
    fields: {
      project_id: ref('Proyecto', 'projects', { required: true }),
      code: text('Código (ej.: Casa 12, Torre A-301)', { required: true, max: 30 }),
      kind: choice('Tipo', ['casa', 'departamento', 'lote', 'local', 'oficina']),
      area_m2: num('Superficie (m²)'),
      bedrooms: num('Dormitorios', { max: 50 }),
      price: num('Precio de lista', { required: true }),
      status: choice('Estado', ['disponible', 'reservada', 'vendida', 'entregada']),
    },
    select: 'SELECT t.*, p.name AS project_name FROM units t JOIN projects p ON p.id = t.project_id',
    filters: { project_id: 't.project_id', status: 't.status' },
    search: ['t.code'],
    order: 'p.name COLLATE NOCASE, t.code COLLATE NOCASE',
  },

  campaigns: {
    label: 'Campaña',
    write: ['marketing'],
    fields: {
      name: text('Nombre', { required: true, max: 120 }),
      project_id: ref('Proyecto', 'projects'),
      channel: choice('Canal', CHANNELS),
      phase: choice('Fase', PHASES, { default: 'lanzamiento' }),
      budget: num('Presupuesto'),
      start_date: { type: 'date', label: 'Inicio' },
      end_date: { type: 'date', label: 'Fin' },
      notes: text('Notas', { max: 1000, long: true }),
    },
    select: `
      SELECT t.*, p.name AS project_name,
        (SELECT COALESCE(SUM(x.amount), 0) FROM transactions x
           WHERE x.campaign_id = t.id AND x.active = 1 AND x.kind = 'gasto') AS spent,
        (SELECT COUNT(*) FROM contacts c WHERE c.campaign_id = t.id AND c.active = 1) AS leads,
        (SELECT COUNT(*) FROM deals d JOIN contacts c ON c.id = d.contact_id
           WHERE c.campaign_id = t.id AND d.active = 1 AND d.stage IN ('promesa', 'escritura', 'entregado')) AS sales
      FROM campaigns t LEFT JOIN projects p ON p.id = t.project_id`,
    filters: { project_id: 't.project_id', phase: 't.phase', channel: 't.channel' },
    search: ['t.name'],
    order: 't.id DESC',
  },

  contacts: {
    label: 'Cliente',
    write: ['comercial', 'marketing'],
    owner: 'owner_id',
    fields: {
      name: text('Nombre', { required: true, max: 120 }),
      phone: text('Teléfono', { max: 40 }),
      email: text('Correo', { max: 120 }),
      document: text('Documento de identidad', { max: 40 }),
      source: choice('Origen', CHANNELS, { default: 'otro' }),
      campaign_id: ref('Campaña', 'campaigns'),
      owner_id: ref('Asesor', 'users'),
      status: choice('Estado', ['nuevo', 'contactado', 'calificado', 'cliente', 'descartado']),
      notes: text('Notas', { max: 1000, long: true }),
    },
    select: `
      SELECT t.*, u.name AS owner_name, c.name AS campaign_name,
        (SELECT COUNT(*) FROM deals d WHERE d.contact_id = t.id AND d.active = 1) AS deals_count
      FROM contacts t
      LEFT JOIN users u ON u.id = t.owner_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id`,
    filters: { status: 't.status', owner_id: 't.owner_id', campaign_id: 't.campaign_id', source: 't.source' },
    search: ['t.name', 't.phone', 't.email', 't.document'],
    order: 't.updated_at DESC',
  },

  deals: {
    label: 'Oportunidad',
    write: ['comercial'],
    owner: 'owner_id',
    fields: {
      contact_id: ref('Cliente', 'contacts', { required: true }),
      project_id: ref('Proyecto', 'projects'),
      unit_id: ref('Unidad', 'units'),
      owner_id: ref('Asesor', 'users'),
      stage: choice('Etapa', STAGES),
      amount: num('Monto de la venta (sin impuestos)'),
      lost_reason: text('Motivo de pérdida'),
      notes: text('Notas', { max: 1000, long: true }),
    },
    select: `
      SELECT t.*, c.name AS contact_name, c.phone AS contact_phone, p.name AS project_name,
        un.code AS unit_code, u.name AS owner_name
      FROM deals t
      JOIN contacts c ON c.id = t.contact_id
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN units un ON un.id = t.unit_id
      LEFT JOIN users u ON u.id = t.owner_id`,
    filters: { stage: 't.stage', owner_id: 't.owner_id', project_id: 't.project_id', contact_id: 't.contact_id' },
    search: ['c.name'],
    order: 't.updated_at DESC',
  },

  activities: {
    label: 'Actividad',
    write: 'all',
    creator: 'user_id',
    fields: {
      contact_id: ref('Cliente', 'contacts'),
      deal_id: ref('Oportunidad', 'deals'),
      kind: choice('Tipo', ['nota', 'llamada', 'whatsapp', 'email', 'visita', 'reunion']),
      note: text('Detalle', { required: true, max: 1000, long: true }),
    },
    select: `
      SELECT t.*, u.name AS user_name, c.name AS contact_name
      FROM activities t
      JOIN users u ON u.id = t.user_id
      LEFT JOIN contacts c ON c.id = t.contact_id`,
    filters: { contact_id: 't.contact_id', deal_id: 't.deal_id', user_id: 't.user_id' },
    order: 't.id DESC',
  },

  tasks: {
    label: 'Tarea',
    write: 'all',
    creator: 'created_by',
    fields: {
      title: text('Tarea', { required: true }),
      area: choice('Área', AREAS, { default: 'operaciones' }),
      assignee_id: ref('Responsable', 'users'),
      due_date: { type: 'date', label: 'Fecha límite' },
      priority: choice('Prioridad', ['media', 'alta', 'baja']),
      status: choice('Estado', ['pendiente', 'en_curso', 'hecha']),
      contact_id: ref('Cliente relacionado', 'contacts'),
      notes: text('Notas', { max: 1000, long: true }),
    },
    select: `
      SELECT t.*, a.name AS assignee_name, cb.name AS created_by_name, c.name AS contact_name
      FROM tasks t
      LEFT JOIN users a ON a.id = t.assignee_id
      LEFT JOIN users cb ON cb.id = t.created_by
      LEFT JOIN contacts c ON c.id = t.contact_id`,
    filters: { area: 't.area', status: 't.status', assignee_id: 't.assignee_id' },
    search: ['t.title'],
    order: "CASE t.status WHEN 'hecha' THEN 1 ELSE 0 END, t.due_date IS NULL, t.due_date, t.id DESC",
  },

  transactions: {
    label: 'Movimiento financiero',
    write: ['finanzas'],
    read: ['finanzas'],
    creator: 'user_id',
    fields: {
      kind: choice('Tipo', ['ingreso', 'gasto'], { required: true }),
      date: { type: 'date', label: 'Fecha', required: true },
      amount: num('Monto', { required: true, positive: true }),
      area: choice('Área', AREAS, { default: 'gerencia' }),
      category: text('Categoría', { max: 60, default: 'General' }),
      description: text('Descripción'),
      project_id: ref('Proyecto', 'projects'),
      campaign_id: ref('Campaña de marketing', 'campaigns'),
      deal_id: ref('Venta relacionada', 'deals'),
    },
    select: `
      SELECT t.*, p.name AS project_name, c.name AS campaign_name, u.name AS user_name
      FROM transactions t
      LEFT JOIN projects p ON p.id = t.project_id
      LEFT JOIN campaigns c ON c.id = t.campaign_id
      LEFT JOIN users u ON u.id = t.user_id`,
    filters: {
      kind: 't.kind', area: 't.area', project_id: 't.project_id', campaign_id: 't.campaign_id',
      from: 't.date >= ?', to: 't.date <= ?',
    },
    search: ['t.description', 't.category'],
    order: 't.date DESC, t.id DESC',
  },
};

function extendCrm(db, { tx, HttpError, round }) {
  const money = (n) => Math.round(n * 100) / 100;
  db.exec(SCHEMA);

  const privileged = (user) => user.role === 'admin' || user.area === 'gerencia';
  const canWrite = (user, spec) => spec.write === 'all' || privileged(user) || spec.write.includes(user.area);
  const canRead = (user, spec) => !spec.read || privileged(user) || spec.read.includes(user.area);
  const canFinance = (user) => canWrite(user, ENTITIES.transactions);

  function specOf(name) {
    const spec = ENTITIES[name];
    if (!spec) throw new HttpError(404, 'Módulo no encontrado');
    return spec;
  }

  function requireWrite(user, spec) {
    if (!canWrite(user, spec)) throw new HttpError(403, 'Tu área no tiene permiso para modificar esto');
  }

  function cleanValue(key, f, v) {
    const empty = v === undefined || v === null || v === '';
    if (empty) {
      if (f.required) throw new HttpError(400, `Falta el campo “${f.label}”`);
      if (f.default !== undefined) return f.default;
      if (f.type === 'ref' || f.type === 'date') return null;
      if (f.type === 'number') return 0;
      return '';
    }
    switch (f.type) {
      case 'text': {
        const s = String(v).trim().slice(0, f.max);
        if (!s && f.required) throw new HttpError(400, `Falta el campo “${f.label}”`);
        return s || (f.default ?? '');
      }
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n) || n < f.min || (f.max !== undefined && n > f.max) || (f.positive && n <= 0)) {
          throw new HttpError(400, `“${f.label}” no es válido`);
        }
        return round(n);
      }
      case 'enum':
        if (!f.values.includes(v)) throw new HttpError(400, `“${f.label}” no es válido`);
        return v;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw new HttpError(400, `“${f.label}” debe ser una fecha (AAAA-MM-DD)`);
        return String(v);
      case 'ref': {
        const id = Number(v);
        const row = Number.isInteger(id) && db.prepare(`SELECT id FROM ${f.table} WHERE id = ? AND active = 1`).get(id);
        if (!row) throw new HttpError(400, `“${f.label}” no existe`);
        return id;
      }
      default:
        throw new Error(`Tipo desconocido en ${key}`);
    }
  }

  function cleanInput(spec, input, partial) {
    const out = {};
    for (const [key, f] of Object.entries(spec.fields)) {
      if (partial && input[key] === undefined) continue;
      out[key] = cleanValue(key, f, input[key]);
    }
    return out;
  }

  function getRow(name, id) {
    const spec = specOf(name);
    const row = db.prepare(`${spec.select} WHERE t.id = ? AND t.active = 1`).get(Number(id));
    if (!row) throw new HttpError(404, `${spec.label} no encontrado`);
    return row;
  }

  // ---------- Reglas de negocio: oportunidades, unidades y comisiones ----------

  const stageIdx = (s) => STAGES.indexOf(s);
  const isTaken = (s) => s !== 'perdido' && stageIdx(s) >= stageIdx('reserva');
  const UNIT_STATUS_FOR = { reserva: 'reservada', promesa: 'vendida', escritura: 'vendida', entregado: 'entregada' };

  const liveCommissions = (dealId) =>
    db.prepare("SELECT COUNT(*) AS n FROM commissions WHERE deal_id = ? AND status != 'anulada'").get(dealId).n;

  function setUnitStatus(unitId, status) {
    if (unitId) db.prepare(`UPDATE units SET status = ?, updated_at = ${NOW} WHERE id = ?`).run(status, unitId);
  }

  function dealBeforeSave(data, prev) {
    if (data.unit_id) {
      const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(data.unit_id);
      if (!data.project_id) data.project_id = unit.project_id;
      if (unit.project_id !== data.project_id) throw new HttpError(400, 'La unidad no pertenece a ese proyecto');
      if (!data.amount && (!prev || prev.unit_id !== data.unit_id)) data.amount = unit.price;
    }
    if (data.stage === 'perdido' && !data.lost_reason) throw new HttpError(400, 'Indica el motivo de pérdida');
    if (SOLD_STAGES.includes(data.stage) && !(data.amount > 0)) {
      throw new HttpError(400, 'Indica el monto de la venta antes de pasar a promesa');
    }
    if (prev && liveCommissions(prev.id)) {
      if (prev.stage === 'perdido' && data.stage !== 'perdido') throw new HttpError(409, 'Esta venta ya se dio por perdida y sus comisiones se anularon; crea una oportunidad nueva');
      if (data.stage !== 'perdido' && stageIdx(data.stage) < stageIdx(prev.stage)) {
        throw new HttpError(409, 'No se puede retroceder una venta con comisiones generadas; márcala como perdida si se cayó');
      }
      if (data.amount !== prev.amount || data.project_id !== prev.project_id || data.unit_id !== prev.unit_id || data.owner_id !== prev.owner_id) {
        throw new HttpError(409, 'No se puede cambiar monto, unidad, proyecto ni asesor de una venta con comisiones generadas');
      }
    }
    if (data.unit_id && isTaken(data.stage)) {
      const other = db.prepare(`
        SELECT d.id, c.name FROM deals d JOIN contacts c ON c.id = d.contact_id
        WHERE d.unit_id = ? AND d.active = 1 AND d.id != ? AND d.stage IN ('reserva', 'promesa', 'escritura', 'entregado')`)
        .get(data.unit_id, prev?.id ?? 0);
      if (other) throw new HttpError(409, `La unidad ya está reservada o vendida a ${other.name}`);
    }
    data.closed_at = ['entregado', 'perdido'].includes(data.stage) ? (prev?.closed_at || new Date().toISOString()) : null;
  }

  function dealAfterSave(deal, prev) {
    // Libera la unidad anterior si la venta cambió de unidad o se cayó.
    if (prev && prev.unit_id && isTaken(prev.stage) && (prev.unit_id !== deal.unit_id || !isTaken(deal.stage))) {
      setUnitStatus(prev.unit_id, 'disponible');
    }
    if (deal.unit_id && UNIT_STATUS_FOR[deal.stage]) setUnitStatus(deal.unit_id, UNIT_STATUS_FOR[deal.stage]);
    if (isTaken(deal.stage)) {
      db.prepare(`UPDATE contacts SET status = 'cliente', updated_at = ${NOW} WHERE id = ?`).run(deal.contact_id);
    }
    if (deal.stage === 'perdido') annulCommissions(deal.id);
    else generateCommissions(deal);
  }

  function generateCommissions(deal) {
    const settings = api.getSettings();
    const project = deal.project_id && db.prepare('SELECT commission_pct FROM projects WHERE id = ?').get(deal.project_id);
    const pct = project ? project.commission_pct : settings.default_commission_pct;
    const total = (deal.amount * pct) / 100;
    const insert = db.prepare(
      'INSERT INTO commissions (deal_id, milestone, beneficiary, user_id, amount) VALUES (?, ?, ?, ?, ?)');
    for (const m of MILESTONES) {
      if (stageIdx(m) > stageIdx(deal.stage)) break;
      const done = db.prepare("SELECT 1 FROM commissions WHERE deal_id = ? AND milestone = ? AND kind = 'comision' AND status != 'anulada'")
        .get(deal.id, m);
      if (done) continue;
      const base = (total * settings.milestones[m]) / 100;
      for (const b of BENEFICIARIES) {
        const amount = money((base * settings.split[b]) / 100);
        if (amount > 0) insert.run(deal.id, m, b, b === 'asesor' ? deal.owner_id : null, amount);
      }
    }
  }

  // Venta caída: se anula lo pendiente y lo ya pagado a personas se descuenta
  // (cláusula de recuperación) como un importe negativo pendiente.
  function annulCommissions(dealId) {
    db.prepare("UPDATE commissions SET status = 'anulada' WHERE deal_id = ? AND status = 'pendiente'").run(dealId);
    const paid = db.prepare(`
      SELECT * FROM commissions c
      WHERE c.deal_id = ? AND c.kind = 'comision' AND c.status = 'pagada' AND c.beneficiary IN ('asesor', 'gerente')
        AND NOT EXISTS (SELECT 1 FROM commissions r WHERE r.deal_id = c.deal_id AND r.kind = 'recuperacion'
                        AND r.milestone = c.milestone AND r.beneficiary = c.beneficiary)`).all(dealId);
    for (const c of paid) {
      db.prepare("INSERT INTO commissions (deal_id, milestone, beneficiary, user_id, kind, amount) VALUES (?, ?, ?, ?, 'recuperacion', ?)")
        .run(dealId, c.milestone, c.beneficiary, c.user_id, -c.amount);
    }
  }

  const HOOKS = {
    deals: {
      beforeSave: dealBeforeSave,
      afterSave: dealAfterSave,
      beforeDelete(deal) {
        if (liveCommissions(deal.id)) throw new HttpError(409, 'Esta venta tiene comisiones; márcala como perdida en lugar de eliminarla');
        if (deal.unit_id && isTaken(deal.stage)) setUnitStatus(deal.unit_id, 'disponible');
      },
    },
    transactions: {
      beforeSave(data) {
        if (data.campaign_id) {
          const campaign = db.prepare('SELECT project_id FROM campaigns WHERE id = ?').get(data.campaign_id);
          data.area = 'marketing';
          if (!data.project_id) data.project_id = campaign.project_id;
        }
      },
    },
    units: {
      beforeDelete(unit) {
        const taken = db.prepare("SELECT 1 FROM deals WHERE unit_id = ? AND active = 1 AND stage != 'perdido'").get(unit.id);
        if (taken) throw new HttpError(409, 'La unidad tiene oportunidades abiertas');
      },
    },
    projects: {
      beforeDelete(project) {
        const used = db.prepare("SELECT 1 FROM deals WHERE project_id = ? AND active = 1 AND stage != 'perdido'").get(project.id);
        if (used) throw new HttpError(409, 'El proyecto tiene oportunidades abiertas');
      },
    },
  };

  const api = {
    ENTITIES,
    canRead,
    canWrite,
    canFinance,

    meta(user) {
      const entities = {};
      for (const [name, spec] of Object.entries(ENTITIES)) {
        entities[name] = { label: spec.label, fields: spec.fields, read: canRead(user, spec), write: canWrite(user, spec) };
      }
      return {
        areas: AREAS, stages: STAGES, milestones: MILESTONES, beneficiaries: BENEFICIARIES,
        entities, finance: canFinance(user), settings: api.getSettings(),
      };
    },

    list(name, user, query = {}) {
      const spec = specOf(name);
      if (!canRead(user, spec)) throw new HttpError(403, 'Tu área no tiene acceso a esto');
      const where = ['t.active = 1'];
      const params = [];
      for (const [key, col] of Object.entries(spec.filters || {})) {
        const v = query[key];
        if (v === undefined || v === '') continue;
        where.push(col.includes('?') ? col : `${col} = ?`);
        params.push(String(v));
      }
      if (query.q && spec.search) {
        where.push(`(${spec.search.map((c) => `${c} LIKE ?`).join(' OR ')})`);
        params.push(...spec.search.map(() => `%${String(query.q).trim()}%`));
      }
      const lim = Math.min(Math.max(Number(query.limit) || 500, 1), 2000);
      return db.prepare(`${spec.select} WHERE ${where.join(' AND ')} ORDER BY ${spec.order} LIMIT ${lim}`).all(...params);
    },

    get(name, id, user) {
      const spec = specOf(name);
      if (!canRead(user, spec)) throw new HttpError(403, 'Tu área no tiene acceso a esto');
      return getRow(name, id);
    },

    create(name, input, user) {
      const spec = specOf(name);
      requireWrite(user, spec);
      return tx(() => {
        const data = cleanInput(spec, input || {}, false);
        if (spec.creator) data[spec.creator] = user.id;
        if (spec.owner && !data[spec.owner]) data[spec.owner] = user.id;
        HOOKS[name]?.beforeSave?.(data, null, user);
        const cols = Object.keys(data);
        const { lastInsertRowid } = db
          .prepare(`INSERT INTO ${name} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
          .run(...cols.map((c) => data[c]));
        HOOKS[name]?.afterSave?.(getRow(name, lastInsertRowid), null, user);
        return getRow(name, lastInsertRowid);
      });
    },

    update(name, id, input, user) {
      const spec = specOf(name);
      requireWrite(user, spec);
      return tx(() => {
        const prev = getRow(name, id);
        const changes = cleanInput(spec, input || {}, true);
        const data = { ...Object.fromEntries(Object.keys(spec.fields).map((k) => [k, prev[k]])), ...changes };
        if ('closed_at' in prev) data.closed_at = prev.closed_at;
        HOOKS[name]?.beforeSave?.(data, prev, user);
        const cols = Object.keys(data);
        db.prepare(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ${NOW} WHERE id = ?`)
          .run(...cols.map((c) => data[c]), prev.id);
        HOOKS[name]?.afterSave?.(getRow(name, prev.id), prev, user);
        return getRow(name, prev.id);
      });
    },

    remove(name, id, user) {
      const spec = specOf(name);
      requireWrite(user, spec);
      return tx(() => {
        const row = getRow(name, id);
        HOOKS[name]?.beforeDelete?.(row, user);
        db.prepare(`UPDATE ${name} SET active = 0, updated_at = ${NOW} WHERE id = ?`).run(row.id);
        return row;
      });
    },

    // ---------- Configuración de comisiones ----------

    getSettings() {
      const row = db.prepare("SELECT value FROM settings WHERE key = 'crm'").get();
      return row ? { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) } : structuredClone(DEFAULT_SETTINGS);
    },

    updateSettings(input) {
      const pct = Number(input.default_commission_pct);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, 'El % de comisión no es válido');
      const pick = (obj, keys, label) => {
        const out = {};
        for (const k of keys) {
          const n = Number(obj?.[k]);
          if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${label}: valor no válido`);
          out[k] = round(n);
        }
        if (Math.abs(Object.values(out).reduce((a, b) => a + b, 0) - 100) > 0.001) {
          throw new HttpError(400, `${label}: los porcentajes deben sumar 100`);
        }
        return out;
      };
      const settings = {
        default_commission_pct: round(pct),
        milestones: pick(input.milestones, MILESTONES, 'Hitos de pago'),
        split: pick(input.split, BENEFICIARIES, 'Reparto de la comisión'),
      };
      db.prepare("INSERT INTO settings (key, value) VALUES ('crm', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(JSON.stringify(settings));
      return settings;
    },

    // ---------- Comisiones ----------

    listCommissions(user, { status, deal_id, user_id } = {}) {
      const where = ['1 = 1'];
      const params = [];
      if (!canFinance(user)) { where.push('k.user_id = ?'); params.push(user.id); }
      else if (user_id) { where.push('k.user_id = ?'); params.push(Number(user_id)); }
      if (status) { where.push('k.status = ?'); params.push(String(status)); }
      if (deal_id) { where.push('k.deal_id = ?'); params.push(Number(deal_id)); }
      return db.prepare(`
        SELECT k.*, c.name AS contact_name, p.name AS project_name, un.code AS unit_code, u.name AS user_name, d.stage
        FROM commissions k
        JOIN deals d ON d.id = k.deal_id
        JOIN contacts c ON c.id = d.contact_id
        LEFT JOIN projects p ON p.id = d.project_id
        LEFT JOIN units un ON un.id = d.unit_id
        LEFT JOIN users u ON u.id = k.user_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE k.status WHEN 'pendiente' THEN 0 ELSE 1 END, k.id DESC
        LIMIT 1000`).all(...params);
    },

    // Pagar una comisión la registra también en finanzas (gasto del área comercial);
    // cobrar una recuperación la registra como ingreso.
    payCommission(id, user) {
      if (!canFinance(user)) throw new HttpError(403, 'Solo finanzas puede pagar comisiones');
      return tx(() => {
        const k = db.prepare(`
          SELECT k.*, d.project_id, c.name AS contact_name FROM commissions k
          JOIN deals d ON d.id = k.deal_id JOIN contacts c ON c.id = d.contact_id WHERE k.id = ?`).get(Number(id));
        if (!k) throw new HttpError(404, 'Comisión no encontrada');
        if (k.status !== 'pendiente') throw new HttpError(409, `Esta comisión ya está ${k.status}`);
        db.prepare(`UPDATE commissions SET status = 'pagada', paid_at = ${NOW} WHERE id = ?`).run(k.id);
        const refund = k.amount < 0;
        db.prepare(`
          INSERT INTO transactions (kind, area, category, amount, date, description, project_id, deal_id, commission_id, user_id)
          VALUES (?, 'comercial', ?, ?, date('now'), ?, ?, ?, ?, ?)`).run(
          refund ? 'ingreso' : 'gasto',
          refund ? 'Recuperación de comisiones' : 'Comisiones',
          Math.abs(k.amount),
          `${refund ? 'Recuperación' : 'Comisión'} ${k.milestone} · ${k.beneficiary} · ${k.contact_name}`,
          k.project_id, k.deal_id, k.id, user.id);
        return db.prepare('SELECT * FROM commissions WHERE id = ?').get(k.id);
      });
    },

    // ---------- Panel de resumen ----------

    summary(user) {
      const month = new Date().toISOString().slice(0, 7);
      const one = (sql, ...p) => db.prepare(sql).get(...p);
      const all = (sql, ...p) => db.prepare(sql).all(...p);

      const contacts = one(`
        SELECT COUNT(*) AS total, SUM(CASE WHEN substr(created_at, 1, 7) = ? THEN 1 ELSE 0 END) AS this_month
        FROM contacts WHERE active = 1`, month);
      const pipeline = all(`
        SELECT stage, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
        FROM deals WHERE active = 1 GROUP BY stage`);
      const sold = one(`
        SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM deals
        WHERE active = 1 AND stage IN ('promesa', 'escritura', 'entregado')`);
      const units = all('SELECT status, COUNT(*) AS count FROM units WHERE active = 1 GROUP BY status');
      const sources = all(`
        SELECT source, COUNT(*) AS count FROM contacts WHERE active = 1 GROUP BY source ORDER BY count DESC`);
      const marketing = one(`
        SELECT COALESCE(SUM(budget), 0) AS budget,
          (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE active = 1 AND kind = 'gasto' AND area = 'marketing') AS spent,
          (SELECT COUNT(*) FROM contacts WHERE active = 1 AND campaign_id IS NOT NULL) AS leads
        FROM campaigns WHERE active = 1`);
      const tasks = one(`
        SELECT SUM(CASE WHEN status != 'hecha' THEN 1 ELSE 0 END) AS open,
          SUM(CASE WHEN status != 'hecha' AND due_date < date('now') THEN 1 ELSE 0 END) AS overdue,
          SUM(CASE WHEN status != 'hecha' AND assignee_id = ? THEN 1 ELSE 0 END) AS mine
        FROM tasks WHERE active = 1`, user.id);
      const myCommissions = one(`
        SELECT COALESCE(SUM(CASE WHEN status = 'pendiente' THEN amount END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'pagada' THEN amount END), 0) AS paid
        FROM commissions WHERE user_id = ?`, user.id);
      const activities = api.list('activities', user, { limit: 6 });

      const projects = all(`
        SELECT p.id, p.name, p.status, p.commission_pct, p.marketing_pct, p.fixed_pct,
          (SELECT COALESCE(SUM(price), 0) FROM units WHERE project_id = p.id AND active = 1) AS projected_sales,
          (SELECT COUNT(*) FROM units WHERE project_id = p.id AND active = 1) AS units_total,
          (SELECT COUNT(*) FROM units WHERE project_id = p.id AND active = 1 AND status != 'disponible') AS units_taken,
          (SELECT COALESCE(SUM(amount), 0) FROM deals WHERE project_id = p.id AND active = 1
             AND stage IN ('promesa', 'escritura', 'entregado')) AS sold_amount,
          (SELECT COALESCE(SUM(k.amount), 0) FROM commissions k JOIN deals d ON d.id = k.deal_id
             WHERE d.project_id = p.id AND k.status != 'anulada') AS commission_spent,
          (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE project_id = p.id AND active = 1
             AND kind = 'gasto' AND area = 'marketing') AS marketing_spent,
          (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE project_id = p.id AND active = 1
             AND kind = 'gasto' AND area = 'comercial' AND commission_id IS NULL) AS fixed_spent
        FROM projects p WHERE p.active = 1 ORDER BY p.name COLLATE NOCASE`);
      for (const p of projects) {
        p.commission_budget = money((p.projected_sales * p.commission_pct) / 100);
        p.marketing_budget = money((p.projected_sales * p.marketing_pct) / 100);
        p.fixed_budget = money((p.projected_sales * p.fixed_pct) / 100);
      }

      const out = { month, contacts, pipeline, sold, units, sources, marketing, tasks, myCommissions, activities, projects };
      if (canFinance(user)) {
        out.finance = one(`
          SELECT
            COALESCE(SUM(CASE WHEN kind = 'ingreso' THEN amount END), 0) AS income,
            COALESCE(SUM(CASE WHEN kind = 'gasto' THEN amount END), 0) AS expense,
            COALESCE(SUM(CASE WHEN kind = 'ingreso' AND substr(date, 1, 7) = ? THEN amount END), 0) AS income_month,
            COALESCE(SUM(CASE WHEN kind = 'gasto' AND substr(date, 1, 7) = ? THEN amount END), 0) AS expense_month
          FROM transactions WHERE active = 1`, month, month);
        out.finance.by_area = all(`
          SELECT area, COALESCE(SUM(amount), 0) AS amount FROM transactions
          WHERE active = 1 AND kind = 'gasto' GROUP BY area ORDER BY amount DESC`);
        out.commissions = one(`
          SELECT COALESCE(SUM(CASE WHEN status = 'pendiente' THEN amount END), 0) AS pending,
            COALESCE(SUM(CASE WHEN status = 'pagada' THEN amount END), 0) AS paid
          FROM commissions`);
      }
      return out;
    },
  };

  return api;
}

module.exports = { extendCrm, AREAS, ENTITIES };
