'use strict';

// Interfaz del CRM. Usa las utilidades globales de app.js (api, esc, toast,
// openDialog, closeDialog, state, $, fmtTime), que ya existen cuando se llaman.

const LABELS = {
  gerencia: 'Gerencia', comercial: 'Comercial', marketing: 'Marketing', finanzas: 'Finanzas',
  operaciones: 'Operaciones', rrhh: 'RR. HH.',
  prospecto: 'Prospecto', visita: 'Visita', cotizacion: 'Cotización', reserva: 'Reserva',
  promesa: 'Promesa', escritura: 'Escritura', entregado: 'Entregado', perdido: 'Perdido',
  planificacion: 'Planificación', preventa: 'Preventa', construccion: 'Construcción',
  disponible: 'Disponible', reservada: 'Reservada', vendida: 'Vendida', entregada: 'Entregada',
  departamento: 'Departamento', oficina: 'Oficina',
  digital: 'Digital', portales: 'Portales', vallas: 'Vallas e impresos', eventos: 'Eventos',
  referidos: 'Referidos', sala_ventas: 'Sala de ventas', otro: 'Otro',
  prelanzamiento: 'Prelanzamiento', lanzamiento: 'Lanzamiento', mantenimiento: 'Mantenimiento', cierre: 'Cierre',
  nuevo: 'Nuevo', contactado: 'Contactado', calificado: 'Calificado', cliente: 'Cliente', descartado: 'Descartado',
  nota: 'Nota', llamada: 'Llamada', whatsapp: 'WhatsApp', email: 'Correo', reunion: 'Reunión',
  pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha', baja: 'Baja', media: 'Media', alta: 'Alta',
  ingreso: 'Ingreso', gasto: 'Gasto', pagada: 'Pagada', anulada: 'Anulada',
  asesor: 'Asesor', gerente: 'Gerencia comercial', bono: 'Bono de equipo', reserva_fondo: 'Fondo de reserva',
  comision: 'Comisión', recuperacion: 'Recuperación',
};
const lab = (v) => LABELS[v] ?? (v ? String(v).charAt(0).toUpperCase() + String(v).slice(1).replace(/_/g, ' ') : '');
const benLab = (b) => (b === 'reserva' ? LABELS.reserva_fondo : lab(b));
const money = (n) => `$ ${Number(n || 0).toLocaleString('es', { maximumFractionDigits: 0 })}`;
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

function bar(value, max, warnAt = 100) {
  const p = pct(value, max);
  return `<div class="bar ${p > warnAt ? 'over' : ''}"><span style="width:${Math.min(p, 100)}%"></span></div>`;
}

const crm = {
  meta: null,
  refs: { projects: [], units: [], campaigns: [], contacts: [], people: [], deals: [] },
  data: {},
  financeTab: 'transactions',
  selectedProject: null,
  timer: null,

  async init() {
    this.meta = await api('GET', '/api/crm/meta');
    await this.loadRefs();
  },

  can(entity) { return !!this.meta?.entities[entity]?.write; },

  async loadRefs() {
    const [projects, units, campaigns, contacts, people, deals] = await Promise.all([
      api('GET', '/api/crm/projects'), api('GET', '/api/crm/units'), api('GET', '/api/crm/campaigns'),
      api('GET', '/api/crm/contacts?limit=2000'), api('GET', '/api/people'), api('GET', '/api/crm/deals?limit=2000'),
    ]);
    Object.assign(this.refs, { projects, units, campaigns, contacts, people, deals });
  },

  onTab(tab) {
    if (!this.meta) return;
    const view = VIEWS[tab];
    if (view) view().catch((err) => toast(err.message, 'error'));
  },

  // Otro usuario cambió algo: recargamos referencias y la vista actual.
  onChange({ entity, action, by }) {
    if (by.id !== state.user.id && action === 'created' && ['contacts', 'deals', 'tasks'].includes(entity)) {
      toast(`${by.name} creó: ${this.meta.entities[entity].label}`);
    }
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (entity === 'settings') this.meta = await api('GET', '/api/crm/meta');
      await this.loadRefs();
      this.onTab(state.tab);
    }, 250);
  },
};

// ---------- Formularios genéricos (a partir de los campos del servidor) ----------

function refOptions(table, current) {
  const r = crm.refs;
  let items;
  if (table === 'projects') items = r.projects.map((p) => [p.id, p.name]);
  else if (table === 'units') items = r.units.map((u) => [u.id, `${u.project_name} · ${u.code} (${lab(u.status)})`, u.project_id]);
  else if (table === 'campaigns') items = r.campaigns.map((c) => [c.id, c.name]);
  else if (table === 'contacts') items = r.contacts.map((c) => [c.id, c.phone ? `${c.name} · ${c.phone}` : c.name]);
  else if (table === 'users') items = r.people.map((p) => [p.id, `${p.name} (${lab(p.area)})`]);
  else if (table === 'deals') items = r.deals.map((d) => [d.id, `${d.contact_name} · ${d.project_name || ''} ${d.unit_code || ''}`]);
  else items = [];
  return '<option value="">—</option>' + items.map(([id, name, project]) =>
    `<option value="${id}" ${project ? `data-project="${project}"` : ''} ${Number(current) === id ? 'selected' : ''}>${esc(name)}</option>`).join('');
}

function fieldHtml(key, f, value) {
  const v = value ?? f.default ?? '';
  const req = f.required ? 'required' : '';
  let control;
  if (f.type === 'enum') {
    control = `<select name="${key}" ${req}>${f.values.map((x) => `<option value="${x}" ${x === v ? 'selected' : ''}>${esc(lab(x))}</option>`).join('')}</select>`;
  } else if (f.type === 'ref') {
    control = `<select name="${key}" ${req}>${refOptions(f.table, v)}</select>`;
  } else if (f.type === 'date') {
    control = `<input name="${key}" type="date" value="${esc(v)}" ${req}>`;
  } else if (f.type === 'number') {
    control = `<input name="${key}" type="number" step="any" min="${f.min ?? ''}" ${f.max !== undefined ? `max="${f.max}"` : ''} inputmode="decimal" value="${esc(v)}" ${req}>`;
  } else if (f.long) {
    control = `<textarea name="${key}" rows="3" maxlength="${f.max}" ${req}>${esc(v)}</textarea>`;
  } else {
    control = `<input name="${key}" maxlength="${f.max}" value="${esc(v)}" ${req}>`;
  }
  return `<label class="${f.long ? 'span2' : ''}" data-field="${key}">${esc(f.label)}${f.required ? ' *' : ''}${control}</label>`;
}

function readForm(entity, form) {
  const out = {};
  for (const key of Object.keys(crm.meta.entities[entity].fields)) {
    if (form.elements[key]) out[key] = form.elements[key].value;
  }
  return out;
}

// Al elegir proyecto solo se ofrecen sus unidades; al elegir unidad se fija su proyecto.
function linkProjectUnit(form) {
  const p = form.elements.project_id;
  const u = form.elements.unit_id;
  if (!p || !u) return;
  const filter = () => {
    for (const o of u.options) o.hidden = !!(p.value && o.dataset.project && o.dataset.project !== p.value);
    if (u.selectedOptions[0]?.hidden) u.value = '';
  };
  p.addEventListener('change', filter);
  u.addEventListener('change', () => { const o = u.selectedOptions[0]; if (o?.dataset.project) p.value = o.dataset.project; });
  filter();
}

function editDialog(entity, row, { defaults = {}, hide = [], title, onSaved } = {}) {
  const meta = crm.meta.entities[entity];
  const values = { ...defaults, ...(row || {}) };
  const fields = Object.entries(meta.fields).filter(([k]) => !hide.includes(k));
  const canWrite = crm.can(entity);
  openDialog({
    title: title || (row ? `Editar ${meta.label.toLowerCase()}` : `Nuevo: ${meta.label.toLowerCase()}`),
    wide: true,
    ok: canWrite ? 'Guardar' : null,
    body: `<div class="form-grid">${fields.map(([k, f]) => fieldHtml(k, f, values[k])).join('')}</div>
      ${row && canWrite ? '<button type="button" class="btn danger small" id="crm-delete">Eliminar</button>' : ''}`,
    onOpen: (body, form) => {
      if (!canWrite) form.querySelectorAll('input, select, textarea').forEach((el) => { el.disabled = true; });
      linkProjectUnit(form);
      body.querySelector('#crm-delete')?.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar este registro (${meta.label.toLowerCase()})?`)) return;
        try {
          await api('DELETE', `/api/crm/${entity}/${row.id}`);
          closeDialog();
          toast('Eliminado');
        } catch (err) { toast(err.message, 'error'); }
      });
    },
    onSubmit: async (form) => {
      const data = { ...defaults, ...readForm(entity, form) };
      const saved = row ? await api('PUT', `/api/crm/${entity}/${row.id}`, data) : await api('POST', `/api/crm/${entity}`, data);
      toast(row ? 'Cambios guardados' : `${meta.label} creado`);
      onSaved?.(saved);
    },
  });
}

function toolbarSelect(id, options, current, placeholder) {
  return `<select id="${id}"><option value="">${placeholder}</option>${options.map(([v, l]) =>
    `<option value="${esc(v)}" ${String(v) === String(current ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
}

const peopleOptions = () => crm.refs.people.map((p) => [p.id, p.name]);
const projectOptions = () => crm.refs.projects.map((p) => [p.id, p.name]);
const enumOptions = (entity, field) => crm.meta.entities[entity].fields[field].values.map((v) => [v, lab(v)]);

function exportLink(path) {
  return `<a class="btn ghost" href="${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(state.token)}">Exportar CSV</a>`;
}

function panel(id) { return document.getElementById(`tab-${id}`); }

// Recuerda los filtros de cada vista mientras se navega.
const filters = { contacts: { status: '', mine: false, q: '' }, deals: { project_id: '', owner_id: '', lost: false }, tasks: { area: '', status: 'abiertas', mine: false }, finance: { kind: '', area: '', month: '' }, commissions: { status: 'pendiente' }, marketing: { phase: '' } };

function bindFilters(root, group, map, rerender) {
  for (const [id, key] of Object.entries(map)) {
    const el = root.querySelector(`#${id}`);
    if (!el) continue;
    el.addEventListener(el.type === 'search' ? 'input' : 'change', () => {
      filters[group][key] = el.type === 'checkbox' ? el.checked : el.value;
      rerender();
    });
  }
}

// ---------- Resumen ----------

async function viewDashboard() {
  const s = await api('GET', '/api/crm/summary');
  const open = s.pipeline.filter((p) => !['entregado', 'perdido'].includes(p.stage));
  const openCount = open.reduce((a, p) => a + p.count, 0);
  const openAmount = open.reduce((a, p) => a + p.amount, 0);
  const unitsBy = Object.fromEntries(s.units.map((u) => [u.status, u.count]));
  const unitsTotal = s.units.reduce((a, u) => a + u.count, 0);
  const maxStage = Math.max(1, ...s.pipeline.map((p) => p.amount));
  const byStage = Object.fromEntries(s.pipeline.map((p) => [p.stage, p]));

  panel('dashboard').innerHTML = `
    <div class="summary">
      <div class="stat"><b>${s.contacts.total}</b><span>Clientes · +${s.contacts.this_month || 0} este mes</span></div>
      <div class="stat"><b>${openCount}</b><span>Oportunidades abiertas · ${money(openAmount)}</span></div>
      <div class="stat good"><b>${s.sold.count}</b><span>Ventas · ${money(s.sold.amount)}</span></div>
      <div class="stat"><b>${pct(s.sold.count, s.contacts.total)}%</b><span>Conversión cliente → venta</span></div>
      <div class="stat"><b>${unitsBy.disponible || 0}/${unitsTotal}</b><span>Unidades disponibles</span></div>
      <div class="stat ${s.tasks.overdue ? 'warn' : ''}"><b>${s.tasks.open || 0}</b><span>Tareas abiertas · ${s.tasks.overdue || 0} vencidas</span></div>
      <div class="stat"><b>${money(s.myCommissions.pending)}</b><span>Mis comisiones pendientes</span></div>
    </div>

    <div class="grid-2">
      <section class="card">
        <h3>Embudo de ventas</h3>
        ${crm.meta.stages.map((st) => {
          const p = byStage[st] || { count: 0, amount: 0 };
          return `<div class="funnel-row"><span>${lab(st)}</span>${bar(p.amount, maxStage)}<b>${p.count}</b><small>${money(p.amount)}</small></div>`;
        }).join('')}
      </section>

      <section class="card">
        <h3>Marketing</h3>
        <div class="kv"><span>Presupuesto en campañas</span><b>${money(s.marketing.budget)}</b></div>
        <div class="kv"><span>Gastado</span><b>${money(s.marketing.spent)}</b></div>
        ${bar(s.marketing.spent, s.marketing.budget)}
        <div class="kv"><span>Clientes de campañas</span><b>${s.marketing.leads}</b></div>
        <div class="kv"><span>Costo por cliente (CPL)</span><b>${s.marketing.leads ? money(s.marketing.spent / s.marketing.leads) : '—'}</b></div>
        <div class="kv"><span>Costo de marketing por venta</span><b>${s.sold.count ? money(s.marketing.spent / s.sold.count) : '—'}</b></div>
        <h4>Origen de los clientes</h4>
        ${s.sources.map((x) => `<div class="kv"><span>${lab(x.source)}</span><b>${x.count}</b></div>`).join('') || '<p class="muted">Sin datos.</p>'}
      </section>

      ${s.finance ? `
      <section class="card">
        <h3>Finanzas</h3>
        <div class="kv"><span>Ingresos del mes</span><b class="pos">${money(s.finance.income_month)}</b></div>
        <div class="kv"><span>Gastos del mes</span><b class="neg">${money(s.finance.expense_month)}</b></div>
        <div class="kv"><span>Saldo acumulado</span><b>${money(s.finance.income - s.finance.expense)}</b></div>
        <div class="kv"><span>Comisiones por pagar</span><b>${money(s.commissions.pending)}</b></div>
        <h4>Gasto por área</h4>
        ${s.finance.by_area.map((a) => `<div class="funnel-row"><span>${lab(a.area)}</span>${bar(a.amount, s.finance.by_area[0].amount)}<b></b><small>${money(a.amount)}</small></div>`).join('') || '<p class="muted">Sin gastos registrados.</p>'}
      </section>` : ''}

      <section class="card">
        <h3>Actividad reciente</h3>
        <ul class="feed">${s.activities.map((a) => `
          <li><b>${esc(a.user_name)}</b> · ${lab(a.kind)}${a.contact_name ? ` con <b>${esc(a.contact_name)}</b>` : ''}
            <div class="muted">${esc(a.note)}</div><div class="meta">${fmtTime(a.created_at)}</div></li>`).join('') || '<li class="muted">Aún no hay actividad.</li>'}
        </ul>
      </section>
    </div>

    <section class="card">
      <h3>Presupuesto comercial y de marketing por proyecto</h3>
      <p class="muted small">Cada bolsa es un % de las ventas proyectadas (suma de precios de las unidades). Lo gastado incluye comisiones generadas, gastos de marketing y gastos fijos del área comercial.</p>
      ${s.projects.length ? `<div class="table-wrap"><table class="dtable">
        <thead><tr><th>Proyecto</th><th>Ventas proyectadas</th><th>Vendido</th><th>Comisiones</th><th>Marketing</th><th>Estructura fija</th></tr></thead>
        <tbody>${s.projects.map((p) => `<tr>
          <td data-l="Proyecto"><b>${esc(p.name)}</b><div class="meta">${lab(p.status)} · ${p.units_taken}/${p.units_total} unidades colocadas</div></td>
          <td data-l="Proyectadas">${money(p.projected_sales)}</td>
          <td data-l="Vendido">${money(p.sold_amount)} ${bar(p.sold_amount, p.projected_sales)}</td>
          ${[['commission', p.commission_pct], ['marketing', p.marketing_pct], ['fixed', p.fixed_pct]].map(([k, rate]) => `
            <td data-l="${k === 'commission' ? 'Comisiones' : k === 'marketing' ? 'Marketing' : 'Fija'}">${money(p[`${k}_spent`])} / ${money(p[`${k}_budget`])}
              <span class="meta">(${rate}%)</span>${bar(p[`${k}_spent`], p[`${k}_budget`])}</td>`).join('')}
        </tr>`).join('')}</tbody></table></div>` : '<p class="muted">Crea un proyecto en la pestaña Proyectos para ver su presupuesto.</p>'}
    </section>`;
}

// ---------- Clientes ----------

async function viewContacts() {
  const f = filters.contacts;
  const params = new URLSearchParams({ limit: 1000 });
  if (f.status) params.set('status', f.status);
  if (f.mine) params.set('owner_id', state.user.id);
  if (f.q) params.set('q', f.q);
  const list = await api('GET', `/api/crm/contacts?${params}`);
  crm.data.contacts = list;
  const root = panel('contacts');
  const keepFocus = document.activeElement?.id === 'c-q';
  root.innerHTML = `
    <div class="toolbar">
      <input id="c-q" type="search" placeholder="Buscar por nombre, teléfono, correo o documento…" value="${esc(f.q)}">
      ${toolbarSelect('c-status', enumOptions('contacts', 'status'), f.status, 'Todos los estados')}
      <label class="check"><input id="c-mine" type="checkbox" ${f.mine ? 'checked' : ''}> Solo mis clientes</label>
      ${crm.can('contacts') ? '<button class="btn primary" id="c-add">+ Cliente</button>' : ''}
      ${exportLink('/api/export/contacts.csv')}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="dtable clickable">
      <thead><tr><th>Cliente</th><th>Estado</th><th>Origen</th><th>Asesor</th><th>Oport.</th><th>Actualizado</th></tr></thead>
      <tbody>${list.map((c) => `<tr data-id="${c.id}">
        <td data-l="Cliente"><b>${esc(c.name)}</b><div class="meta">${esc([c.phone, c.email].filter(Boolean).join(' · '))}</div></td>
        <td data-l="Estado"><span class="pill s-${c.status}">${lab(c.status)}</span></td>
        <td data-l="Origen">${lab(c.source)}${c.campaign_name ? `<div class="meta">${esc(c.campaign_name)}</div>` : ''}</td>
        <td data-l="Asesor">${esc(c.owner_name || '—')}</td>
        <td data-l="Oport.">${c.deals_count}</td>
        <td data-l="Actualizado" class="meta">${fmtTime(c.updated_at)}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No hay clientes que coincidan.</p>'}`;
  if (keepFocus) { const q = root.querySelector('#c-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  bindFilters(root, 'contacts', { 'c-q': 'q', 'c-status': 'status', 'c-mine': 'mine' }, viewContacts);
  root.querySelector('#c-add')?.addEventListener('click', () => editDialog('contacts', null, { defaults: { owner_id: state.user.id } }));
  root.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) contactDetail(list.find((c) => c.id === Number(tr.dataset.id)));
  });
}

async function contactDetail(c) {
  openDialog({
    title: c.name,
    wide: true,
    ok: null,
    body: '<p class="muted">Cargando…</p>',
    onOpen: async (body) => {
      const [deals, acts] = await Promise.all([
        api('GET', `/api/crm/deals?contact_id=${c.id}`),
        api('GET', `/api/crm/activities?contact_id=${c.id}&limit=50`),
      ]);
      body.innerHTML = `
        <div class="detail-head">
          <span class="pill s-${c.status}">${lab(c.status)}</span>
          <span>${esc([c.phone, c.email, c.document].filter(Boolean).join(' · ') || 'Sin datos de contacto')}</span>
          <span class="muted">Asesor: ${esc(c.owner_name || '—')} · Origen: ${lab(c.source)}</span>
          ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
        </div>
        <div class="row-actions">
          ${crm.can('contacts') ? '<button type="button" class="btn small" id="cd-edit">Editar</button>' : ''}
          ${crm.can('deals') ? '<button type="button" class="btn small" id="cd-deal">+ Oportunidad</button>' : ''}
          <button type="button" class="btn small" id="cd-task">+ Tarea</button>
          ${c.phone ? `<a class="btn small" target="_blank" rel="noopener" href="https://wa.me/${encodeURIComponent(c.phone.replace(/\D/g, ''))}">WhatsApp</a>` : ''}
        </div>
        <h4>Oportunidades</h4>
        ${deals.length ? deals.map((d) => `<button type="button" class="deal-line" data-deal="${d.id}">
          <span class="pill st-${d.stage}">${lab(d.stage)}</span>
          <span>${esc(d.project_name || 'Sin proyecto')} ${esc(d.unit_code || '')}</span><b>${money(d.amount)}</b></button>`).join('')
          : '<p class="muted">Sin oportunidades.</p>'}
        <h4>Historial</h4>
        <div class="activity-form">
          <select id="cd-kind">${crm.meta.entities.activities.fields.kind.values.map((k) => `<option value="${k}">${lab(k)}</option>`).join('')}</select>
          <input id="cd-note" maxlength="1000" placeholder="¿Qué pasó? (llamada, visita, acuerdo…)">
          <button type="button" class="btn primary small" id="cd-log">Registrar</button>
        </div>
        <ul class="feed">${acts.map((a) => `<li><b>${lab(a.kind)}</b> · ${esc(a.user_name)} · <span class="meta">${fmtTime(a.created_at)}</span>
          <div>${esc(a.note)}</div></li>`).join('') || '<li class="muted">Sin actividad registrada.</li>'}</ul>`;
      body.querySelector('#cd-edit')?.addEventListener('click', () => editDialog('contacts', c));
      body.querySelector('#cd-deal')?.addEventListener('click', () =>
        editDialog('deals', null, { defaults: { contact_id: c.id, owner_id: c.owner_id || state.user.id } }));
      body.querySelector('#cd-task').addEventListener('click', () =>
        editDialog('tasks', null, { defaults: { contact_id: c.id, assignee_id: state.user.id, area: 'comercial' } }));
      body.querySelectorAll('[data-deal]').forEach((b) => b.addEventListener('click', () =>
        editDialog('deals', deals.find((d) => d.id === Number(b.dataset.deal)))));
      body.querySelector('#cd-note').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); body.querySelector('#cd-log').click(); }
      });
      body.querySelector('#cd-log').addEventListener('click', async () => {
        const note = body.querySelector('#cd-note').value.trim();
        if (!note) return body.querySelector('#cd-note').focus();
        try {
          await api('POST', '/api/crm/activities', { contact_id: c.id, kind: body.querySelector('#cd-kind').value, note });
          toast('Actividad registrada');
          contactDetail(c);
        } catch (err) { toast(err.message, 'error'); }
      });
    },
  });
}

// ---------- Ventas (embudo) ----------

async function viewDeals() {
  const f = filters.deals;
  const params = new URLSearchParams({ limit: 2000 });
  if (f.project_id) params.set('project_id', f.project_id);
  if (f.owner_id) params.set('owner_id', f.owner_id);
  const list = await api('GET', `/api/crm/deals?${params}`);
  crm.data.deals = list;
  const stages = crm.meta.stages.filter((s) => f.lost || s !== 'perdido');
  const write = crm.can('deals');
  const root = panel('deals');
  root.innerHTML = `
    <div class="toolbar">
      ${toolbarSelect('d-project', projectOptions(), f.project_id, 'Todos los proyectos')}
      ${toolbarSelect('d-owner', peopleOptions(), f.owner_id, 'Todos los asesores')}
      <label class="check"><input id="d-lost" type="checkbox" ${f.lost ? 'checked' : ''}> Ver perdidas</label>
      ${write ? '<button class="btn primary" id="d-add">+ Oportunidad</button>' : ''}
      ${exportLink('/api/export/deals.csv')}
    </div>
    <div class="kanban">${stages.map((st) => {
      const items = list.filter((d) => d.stage === st);
      return `<div class="column">
        <div class="column-head"><b>${lab(st)}</b><span>${items.length} · ${money(items.reduce((a, d) => a + d.amount, 0))}</span></div>
        ${items.map((d) => {
          const next = crm.meta.stages[crm.meta.stages.indexOf(st) + 1];
          return `<article class="deal st-${st}" data-id="${d.id}">
            <b>${esc(d.contact_name)}</b>
            <div class="meta">${esc(d.project_name || 'Sin proyecto')} ${esc(d.unit_code || '')}</div>
            <div class="deal-foot"><span>${money(d.amount)}</span><span class="meta">${esc(d.owner_name || '')}</span></div>
            ${st === 'perdido' ? `<div class="meta">“${esc(d.lost_reason)}”</div>` : ''}
            ${write && next && next !== 'perdido' ? `<button class="btn small ghost advance" data-next="${next}">Pasar a ${lab(next)} ▶</button>` : ''}
          </article>`;
        }).join('') || '<p class="muted small">—</p>'}
      </div>`;
    }).join('')}</div>`;
  bindFilters(root, 'deals', { 'd-project': 'project_id', 'd-owner': 'owner_id', 'd-lost': 'lost' }, viewDeals);
  root.querySelector('#d-add')?.addEventListener('click', () =>
    editDialog('deals', null, { defaults: { owner_id: state.user.id, project_id: f.project_id } }));
  root.querySelector('.kanban').addEventListener('click', async (e) => {
    const card = e.target.closest('.deal');
    if (!card) return;
    const deal = list.find((d) => d.id === Number(card.dataset.id));
    const adv = e.target.closest('.advance');
    if (!adv) return editDialog('deals', deal);
    try {
      await api('PUT', `/api/crm/deals/${deal.id}`, { stage: adv.dataset.next });
      toast(`${deal.contact_name} → ${lab(adv.dataset.next)}`);
    } catch (err) {
      toast(err.message, 'error');
      if (/monto/.test(err.message)) editDialog('deals', { ...deal, stage: adv.dataset.next });
    }
  });
}

// ---------- Proyectos y unidades ----------

async function viewProjects() {
  const projects = crm.refs.projects;
  if (!projects.some((p) => p.id === crm.selectedProject)) crm.selectedProject = projects[0]?.id ?? null;
  const sel = projects.find((p) => p.id === crm.selectedProject);
  const units = crm.refs.units.filter((u) => u.project_id === crm.selectedProject);
  const write = crm.can('projects');
  const root = panel('projects');
  root.innerHTML = `
    <div class="toolbar">
      ${write ? '<button class="btn primary" id="p-add">+ Proyecto</button>' : ''}
      ${exportLink('/api/export/units.csv')}
    </div>
    <div class="cards">${projects.map((p) => `
      <article class="card project ${p.id === crm.selectedProject ? 'selected' : ''}" data-id="${p.id}">
        <div class="product-head"><b>${esc(p.name)}</b><span class="pill">${lab(p.status)}</span></div>
        <div class="meta">${esc(p.location)}</div>
        <div class="kv"><span>Unidades disponibles</span><b>${p.units_available}/${p.units_total}</b></div>
        <div class="kv"><span>Ventas proyectadas</span><b>${money(p.projected_sales)}</b></div>
        <div class="kv small"><span>Comisiones ${p.commission_pct}% · Marketing ${p.marketing_pct}% · Fija ${p.fixed_pct}%</span>
          <b>${money((p.projected_sales * (p.commission_pct + p.marketing_pct + p.fixed_pct)) / 100)}</b></div>
        ${write ? '<button class="btn small ghost" data-edit>Editar</button>' : ''}
      </article>`).join('') || '<p class="empty">Aún no hay proyectos.</p>'}
    </div>
    ${sel ? `
      <div class="toolbar section-title">
        <h3>Unidades · ${esc(sel.name)}</h3>
        ${write ? '<button class="btn" id="u-add">+ Unidad</button>' : ''}
        <span class="legend">${['disponible', 'reservada', 'vendida', 'entregada'].map((s) => `<span class="pill u-${s}">${lab(s)} ${units.filter((u) => u.status === s).length}</span>`).join('')}</span>
      </div>
      <div class="units">${units.map((u) => `
        <button class="unit u-${u.status}" data-unit="${u.id}">
          <b>${esc(u.code)}</b><span>${lab(u.kind)}${u.area_m2 ? ` · ${u.area_m2} m²` : ''}${u.bedrooms ? ` · ${u.bedrooms} dorm.` : ''}</span>
          <span>${money(u.price)}</span><small>${lab(u.status)}</small>
        </button>`).join('') || '<p class="muted">Este proyecto aún no tiene unidades.</p>'}</div>` : ''}`;
  root.querySelector('#p-add')?.addEventListener('click', () => editDialog('projects'));
  root.querySelector('#u-add')?.addEventListener('click', () => editDialog('units', null, { defaults: { project_id: sel.id } }));
  root.querySelectorAll('.project').forEach((card) => card.addEventListener('click', (e) => {
    const p = projects.find((x) => x.id === Number(card.dataset.id));
    if (e.target.closest('[data-edit]')) return editDialog('projects', p);
    crm.selectedProject = p.id;
    viewProjects();
  }));
  root.querySelectorAll('[data-unit]').forEach((b) => b.addEventListener('click', () =>
    editDialog('units', units.find((u) => u.id === Number(b.dataset.unit)))));
}

// ---------- Marketing ----------

async function viewMarketing() {
  const f = filters.marketing;
  const list = (await api('GET', `/api/crm/campaigns${f.phase ? `?phase=${f.phase}` : ''}`));
  const tot = list.reduce((a, c) => ({ budget: a.budget + c.budget, spent: a.spent + c.spent, leads: a.leads + c.leads, sales: a.sales + c.sales }),
    { budget: 0, spent: 0, leads: 0, sales: 0 });
  const root = panel('marketing');
  root.innerHTML = `
    <div class="summary">
      <div class="stat"><b>${money(tot.budget)}</b><span>Presupuesto</span></div>
      <div class="stat ${tot.spent > tot.budget ? 'warn' : ''}"><b>${money(tot.spent)}</b><span>Gastado (${pct(tot.spent, tot.budget)}%)</span></div>
      <div class="stat"><b>${tot.leads}</b><span>Clientes captados</span></div>
      <div class="stat"><b>${tot.leads ? money(tot.spent / tot.leads) : '—'}</b><span>Costo por cliente</span></div>
      <div class="stat"><b>${tot.sales ? money(tot.spent / tot.sales) : '—'}</b><span>Costo por venta</span></div>
    </div>
    <div class="toolbar">
      ${toolbarSelect('m-phase', enumOptions('campaigns', 'phase'), f.phase, 'Todas las fases')}
      ${crm.can('campaigns') ? '<button class="btn primary" id="m-add">+ Campaña</button>' : ''}
      ${exportLink('/api/export/campaigns.csv')}
    </div>
    <p class="muted small">El gasto de cada campaña se registra en Finanzas como gasto vinculado a la campaña. Los clientes se asocian a una campaña desde su ficha.</p>
    ${list.length ? `<div class="table-wrap"><table class="dtable clickable">
      <thead><tr><th>Campaña</th><th>Canal / fase</th><th>Presupuesto</th><th>Gastado</th><th>Clientes</th><th>CPL</th><th>Ventas</th><th>Costo/venta</th></tr></thead>
      <tbody>${list.map((c) => `<tr data-id="${c.id}">
        <td data-l="Campaña"><b>${esc(c.name)}</b><div class="meta">${esc(c.project_name || 'General')}${c.start_date ? ` · ${fmtDate(c.start_date)} → ${fmtDate(c.end_date)}` : ''}</div></td>
        <td data-l="Canal">${lab(c.channel)}<div class="meta">${lab(c.phase)}</div></td>
        <td data-l="Presupuesto">${money(c.budget)}</td>
        <td data-l="Gastado">${money(c.spent)}${bar(c.spent, c.budget)}</td>
        <td data-l="Clientes">${c.leads}</td>
        <td data-l="CPL">${c.leads ? money(c.spent / c.leads) : '—'}</td>
        <td data-l="Ventas">${c.sales}</td>
        <td data-l="Costo/venta">${c.sales ? money(c.spent / c.sales) : '—'}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aún no hay campañas.</p>'}`;
  bindFilters(root, 'marketing', { 'm-phase': 'phase' }, viewMarketing);
  root.querySelector('#m-add')?.addEventListener('click', () => editDialog('campaigns', null, { defaults: { start_date: today() } }));
  root.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) editDialog('campaigns', list.find((c) => c.id === Number(tr.dataset.id)));
  });
}

// ---------- Finanzas y comisiones ----------

async function viewFinance() {
  const root = panel('finance');
  const finance = crm.meta.finance;
  if (!finance) crm.financeTab = 'commissions';
  root.innerHTML = `
    <div class="toolbar">
      ${finance ? `<div class="segmented compact">
        <label><input type="radio" name="fin-tab" value="transactions" ${crm.financeTab === 'transactions' ? 'checked' : ''}>Ingresos y gastos</label>
        <label><input type="radio" name="fin-tab" value="commissions" ${crm.financeTab === 'commissions' ? 'checked' : ''}>Comisiones</label>
      </div>` : '<h3>Mis comisiones</h3>'}
      ${state.user.role === 'admin' ? '<button class="btn ghost" id="f-settings">⚙️ Reglas de comisión</button>' : ''}
    </div>
    <div id="fin-body"></div>`;
  root.querySelectorAll('[name=fin-tab]').forEach((r) => r.addEventListener('change', () => { crm.financeTab = r.value; viewFinance(); }));
  root.querySelector('#f-settings')?.addEventListener('click', settingsDialog);
  if (crm.financeTab === 'transactions') await viewTransactions(root.querySelector('#fin-body'));
  else await viewCommissions(root.querySelector('#fin-body'));
}

async function viewTransactions(el) {
  const f = filters.finance;
  const params = new URLSearchParams({ limit: 2000 });
  if (f.kind) params.set('kind', f.kind);
  if (f.area) params.set('area', f.area);
  if (f.month) {
    const [y, m] = f.month.split('-').map(Number);
    params.set('from', `${f.month}-01`);
    params.set('to', `${f.month}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`);
  }
  const list = await api('GET', `/api/crm/transactions?${params}`);
  const income = list.filter((t) => t.kind === 'ingreso').reduce((a, t) => a + t.amount, 0);
  const expense = list.filter((t) => t.kind === 'gasto').reduce((a, t) => a + t.amount, 0);
  el.innerHTML = `
    <div class="summary">
      <div class="stat good"><b>${money(income)}</b><span>Ingresos</span></div>
      <div class="stat"><b>${money(expense)}</b><span>Gastos</span></div>
      <div class="stat ${income - expense < 0 ? 'warn' : ''}"><b>${money(income - expense)}</b><span>Saldo</span></div>
    </div>
    <div class="toolbar">
      ${toolbarSelect('t-kind', [['ingreso', 'Ingresos'], ['gasto', 'Gastos']], f.kind, 'Ingresos y gastos')}
      ${toolbarSelect('t-area', crm.meta.areas.map((a) => [a, lab(a)]), f.area, 'Todas las áreas')}
      <input id="t-month" type="month" value="${esc(f.month)}" title="Filtrar por mes">
      <button class="btn primary" data-new="ingreso">+ Ingreso</button>
      <button class="btn primary" data-new="gasto">+ Gasto</button>
      ${exportLink(`/api/export/transactions.csv?${params}`)}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="dtable clickable">
      <thead><tr><th>Fecha</th><th>Concepto</th><th>Área</th><th>Proyecto</th><th class="num">Monto</th></tr></thead>
      <tbody>${list.map((t) => `<tr data-id="${t.id}">
        <td data-l="Fecha">${fmtDate(t.date)}</td>
        <td data-l="Concepto"><b>${esc(t.category)}</b><div class="meta">${esc(t.description)}${t.campaign_name ? ` · ${esc(t.campaign_name)}` : ''}</div></td>
        <td data-l="Área">${lab(t.area)}</td>
        <td data-l="Proyecto">${esc(t.project_name || '—')}</td>
        <td data-l="Monto" class="num ${t.kind === 'ingreso' ? 'pos' : 'neg'}">${t.kind === 'ingreso' ? '+' : '−'}${money(t.amount)}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No hay movimientos en este filtro.</p>'}`;
  bindFilters(el, 'finance', { 't-kind': 'kind', 't-area': 'area', 't-month': 'month' }, () => viewTransactions(el));
  el.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () =>
    editDialog('transactions', null, {
      title: b.dataset.new === 'ingreso' ? 'Nuevo ingreso' : 'Nuevo gasto',
      defaults: { kind: b.dataset.new, date: today(), area: b.dataset.new === 'ingreso' ? 'comercial' : undefined },
      hide: ['kind'],
    })));
  el.querySelector('tbody')?.addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-id]');
    if (tr) editDialog('transactions', list.find((t) => t.id === Number(tr.dataset.id)));
  });
}

async function viewCommissions(el) {
  const f = filters.commissions;
  const list = await api('GET', `/api/commissions${f.status ? `?status=${f.status}` : ''}`);
  const sum = list.reduce((a, k) => a + (k.status === 'anulada' ? 0 : k.amount), 0);
  const finance = crm.meta.finance;
  const s = crm.meta.settings;
  el.innerHTML = `
    <p class="muted small">Reglas actuales: comisión por defecto ${s.default_commission_pct}% (o la del proyecto) ·
      pago por hitos ${crm.meta.milestones.map((m) => `${lab(m)} ${s.milestones[m]}%`).join(', ')} ·
      reparto ${crm.meta.beneficiaries.map((b) => `${benLab(b)} ${s.split[b]}%`).join(', ')}.
      Si una venta se cae, lo pendiente se anula y lo ya pagado se recupera.</p>
    <div class="toolbar">
      ${toolbarSelect('k-status', [['pendiente', 'Pendientes'], ['pagada', 'Pagadas'], ['anulada', 'Anuladas']], f.status, 'Todas')}
      <span class="muted">Total: <b>${money(sum)}</b></span>
      ${exportLink(`/api/export/commissions.csv${f.status ? `?status=${f.status}` : ''}`)}
    </div>
    ${list.length ? `<div class="table-wrap"><table class="dtable">
      <thead><tr><th>Venta</th><th>Hito</th><th>Beneficiario</th><th class="num">Monto</th><th>Estado</th><th></th></tr></thead>
      <tbody>${list.map((k) => `<tr>
        <td data-l="Venta"><b>${esc(k.contact_name)}</b><div class="meta">${esc(k.project_name || '')} ${esc(k.unit_code || '')} · ${lab(k.stage)}</div></td>
        <td data-l="Hito">${lab(k.milestone)}${k.kind === 'recuperacion' ? ' <span class="pill s-descartado">Recuperación</span>' : ''}</td>
        <td data-l="Beneficiario">${benLab(k.beneficiary)}${k.user_name ? `<div class="meta">${esc(k.user_name)}</div>` : ''}</td>
        <td data-l="Monto" class="num ${k.amount < 0 ? 'neg' : ''}">${money(k.amount)}</td>
        <td data-l="Estado"><span class="pill k-${k.status}">${lab(k.status)}</span>${k.paid_at ? `<div class="meta">${fmtTime(k.paid_at)}</div>` : ''}</td>
        <td>${finance && k.status === 'pendiente' ? `<button class="btn small" data-pay="${k.id}">${k.amount < 0 ? 'Cobrar' : 'Pagar'}</button>` : ''}</td>
      </tr>`).join('')}</tbody></table></div>` : '<p class="empty">No hay comisiones en este filtro.</p>'}`;
  bindFilters(el, 'commissions', { 'k-status': 'status' }, () => viewCommissions(el));
  el.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    const k = list.find((x) => x.id === Number(b.dataset.pay));
    if (!confirm(`${k.amount < 0 ? '¿Registrar el cobro de' : '¿Marcar como pagada la comisión de'} ${money(Math.abs(k.amount))} (${benLab(k.beneficiary)})? Se registrará en Finanzas.`)) return;
    try {
      await api('POST', `/api/commissions/${k.id}/pay`);
      toast('Registrado en finanzas');
    } catch (err) { toast(err.message, 'error'); }
  }));
}

function settingsDialog() {
  const s = crm.meta.settings;
  const input = (name, value) => `<input name="${name}" type="number" step="any" min="0" max="100" value="${value}" required>`;
  openDialog({
    title: 'Reglas de comisión',
    wide: true,
    body: `
      <label>% de comisión por defecto (si el proyecto no define el suyo) ${input('default_commission_pct', s.default_commission_pct)}</label>
      <h4>Pago por hitos (deben sumar 100)</h4>
      <div class="form-grid three">${crm.meta.milestones.map((m) => `<label>${lab(m)} ${input(`m_${m}`, s.milestones[m])}</label>`).join('')}</div>
      <h4>Reparto de cada comisión (deben sumar 100)</h4>
      <div class="form-grid">${crm.meta.beneficiaries.map((b) => `<label>${benLab(b)} ${input(`s_${b}`, s.split[b])}</label>`).join('')}</div>
      <p class="muted small">Los cambios se aplican a las comisiones que se generen a partir de ahora.</p>`,
    onSubmit: async (form) => {
      const body = {
        default_commission_pct: form.default_commission_pct.value,
        milestones: Object.fromEntries(crm.meta.milestones.map((m) => [m, form[`m_${m}`].value])),
        split: Object.fromEntries(crm.meta.beneficiaries.map((b) => [b, form[`s_${b}`].value])),
      };
      crm.meta.settings = await api('PUT', '/api/crm/settings', body);
      toast('Reglas actualizadas');
    },
  });
}

// ---------- Tareas ----------

async function viewTasks() {
  const f = filters.tasks;
  const params = new URLSearchParams({ limit: 1000 });
  if (f.area) params.set('area', f.area);
  if (f.status && f.status !== 'abiertas') params.set('status', f.status);
  if (f.mine) params.set('assignee_id', state.user.id);
  let list = await api('GET', `/api/crm/tasks?${params}`);
  if (f.status === 'abiertas') list = list.filter((t) => t.status !== 'hecha');
  const now = today();
  const root = panel('tasks');
  root.innerHTML = `
    <div class="toolbar">
      ${toolbarSelect('tk-area', crm.meta.areas.map((a) => [a, lab(a)]), f.area, 'Todas las áreas')}
      ${toolbarSelect('tk-status', [['abiertas', 'Abiertas'], ['pendiente', 'Pendientes'], ['en_curso', 'En curso'], ['hecha', 'Hechas']], f.status, 'Todas')}
      <label class="check"><input id="tk-mine" type="checkbox" ${f.mine ? 'checked' : ''}> Solo mías</label>
      <button class="btn primary" id="t-add">+ Tarea</button>
    </div>
    <ul class="task-list">${list.map((t) => `
      <li class="task ${t.status === 'hecha' ? 'done' : ''} ${t.status !== 'hecha' && t.due_date && t.due_date < now ? 'late' : ''}" data-id="${t.id}">
        <input type="checkbox" ${t.status === 'hecha' ? 'checked' : ''} title="Marcar como hecha">
        <div class="info">
          <b>${esc(t.title)}</b> ${t.priority === 'alta' ? '<span class="pill s-descartado">Alta</span>' : ''}
          <div class="meta">${lab(t.area)} · ${esc(t.assignee_name || 'Sin asignar')}${t.due_date ? ` · vence ${fmtDate(t.due_date)}` : ''}${t.status === 'en_curso' ? ' · En curso' : ''}${t.contact_name ? ` · ${esc(t.contact_name)}` : ''}</div>
        </div>
      </li>`).join('') || '<li class="empty">No hay tareas en este filtro.</li>'}</ul>`;
  bindFilters(root, 'tasks', { 'tk-area': 'area', 'tk-status': 'status', 'tk-mine': 'mine' }, viewTasks);
  root.querySelector('#t-add').addEventListener('click', () =>
    editDialog('tasks', null, { defaults: { assignee_id: state.user.id, area: state.user.area } }));
  root.querySelector('.task-list').addEventListener('click', async (e) => {
    const li = e.target.closest('.task');
    if (!li) return;
    const task = list.find((t) => t.id === Number(li.dataset.id));
    if (e.target.matches('input[type=checkbox]')) {
      try {
        await api('PUT', `/api/crm/tasks/${task.id}`, { status: e.target.checked ? 'hecha' : 'pendiente' });
      } catch (err) { toast(err.message, 'error'); e.target.checked = !e.target.checked; }
    } else editDialog('tasks', task);
  });
}

const VIEWS = {
  dashboard: viewDashboard,
  contacts: viewContacts,
  deals: viewDeals,
  projects: viewProjects,
  marketing: viewMarketing,
  finance: viewFinance,
  tasks: viewTasks,
};
