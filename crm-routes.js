'use strict';

// Rutas de la API del CRM. Cada cambio se emite como "crm:changed" para que
// todas las pantallas abiertas se actualicen al instante.
function mountCrm(app, { db, auth, adminOnly, wrap, broadcast, sendCsv }) {
  const crm = db.crm;
  const changed = (req, entity, action, row) => broadcast('crm:changed', { entity, action, id: row?.id }, req);

  app.get('/api/crm/meta', auth, wrap((req) => crm.meta(req.user)));
  app.get('/api/crm/summary', auth, wrap((req) => crm.summary(req.user)));
  app.get('/api/people', auth, wrap(() => db.listPeople()));

  app.put('/api/crm/settings', auth, adminOnly, wrap((req) => {
    const settings = crm.updateSettings(req.body || {});
    changed(req, 'settings', 'updated');
    return settings;
  }));

  app.get('/api/commissions', auth, wrap((req) => crm.listCommissions(req.user, req.query)));

  app.post('/api/commissions/:id/pay', auth, wrap((req) => {
    const commission = crm.payCommission(req.params.id, req.user);
    changed(req, 'commissions', 'paid', commission);
    return commission;
  }));

  app.get('/api/export/commissions.csv', auth, (req, res) => {
    const rows = crm.listCommissions(req.user, req.query);
    sendCsv(res, 'comisiones.csv', Object.keys(rows[0] || { id: '' }), rows.map(Object.values));
  });

  app.get('/api/export/:entity.csv', auth, (req, res, next) => {
    try {
      const rows = crm.list(req.params.entity, req.user, { ...req.query, limit: 2000 });
      const header = Object.keys(rows[0] || { id: '' }).filter((k) => k !== 'active');
      sendCsv(res, `${req.params.entity}.csv`, header, rows.map((r) => header.map((k) => r[k])));
    } catch (err) { next(err); }
  });

  // CRUD genérico: /api/crm/contacts, /api/crm/deals, /api/crm/projects…
  app.get('/api/crm/:entity', auth, wrap((req) => crm.list(req.params.entity, req.user, req.query)));
  app.get('/api/crm/:entity/:id', auth, wrap((req) => crm.get(req.params.entity, req.params.id, req.user)));

  app.post('/api/crm/:entity', auth, wrap((req) => {
    const row = crm.create(req.params.entity, req.body, req.user);
    changed(req, req.params.entity, 'created', row);
    return row;
  }));

  app.put('/api/crm/:entity/:id', auth, wrap((req) => {
    const row = crm.update(req.params.entity, req.params.id, req.body, req.user);
    changed(req, req.params.entity, 'updated', row);
    return row;
  }));

  app.delete('/api/crm/:entity/:id', auth, wrap((req) => {
    const row = crm.remove(req.params.entity, req.params.id, req.user);
    changed(req, req.params.entity, 'deleted', row);
    return { ok: true };
  }));
}

module.exports = { mountCrm };
