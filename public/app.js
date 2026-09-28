'use strict';

const state = {
  token: localStorageGet('token'),
  user: null,
  products: new Map(),
  movements: [],
  users: [],
  tab: 'inventory',
  socket: null,
};

const $ = (sel) => document.querySelector(sel);
const TYPE_LABEL = { entrada: 'Entrada', salida: 'Salida', merma: 'Merma', ajuste: 'Ajuste' };

function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localStorageSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtQty(n) {
  return Number(n).toLocaleString('es', { maximumFractionDigits: 3 });
}

function fmtTime(iso) {
  const d = new Date(iso);
  const today = new Date();
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `hoy ${time}`;
  return `${d.toLocaleDateString('es', { day: '2-digit', month: 'short' })} ${time}`;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && url !== '/api/login') {
    logout(false);
    throw new Error(data.error || 'Sesión caducada');
  }
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  while ($('#toasts').children.length > 3) $('#toasts').firstChild.remove();
  setTimeout(() => el.remove(), 4000);
}

// ---------- Sesión ----------

async function start() {
  if (!state.token) return showLogin();
  try {
    state.user = await api('GET', '/api/me');
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-form [name=username]').focus();
}

async function showApp() {
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#me-btn').textContent = `${state.user.name} ▾`;
  document.querySelectorAll('.admin-only').forEach((el) => { el.hidden = state.user.role !== 'admin'; });
  connectSocket();
  await loadProducts();
  if (state.tab !== 'inventory') switchTab(state.tab);
}

function logout(callServer = true) {
  if (callServer && state.token) api('POST', '/api/logout').catch(() => {});
  state.token = null;
  state.user = null;
  localStorageSet('token', null);
  state.socket?.disconnect();
  state.socket = null;
  showLogin();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  $('#login-error').hidden = true;
  try {
    const { token, user } = await api('POST', '/api/login', {
      username: form.username.value,
      pin: form.pin.value,
    });
    state.token = token;
    state.user = user;
    localStorageSet('token', token);
    form.reset();
    showApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').hidden = false;
  }
});

$('#me-btn').addEventListener('click', () => {
  openDialog({
    title: state.user.name,
    ok: 'Cambiar PIN',
    body: `
      <p class="muted">Usuario: <b>${esc(state.user.username)}</b> · ${state.user.role === 'admin' ? 'Administrador' : 'Personal'}</p>
      <label>PIN actual <input name="current_pin" type="password" inputmode="numeric" required></label>
      <label>PIN nuevo (4-8 dígitos) <input name="new_pin" type="password" inputmode="numeric" pattern="\\d{4,8}" required></label>
      <button type="button" class="btn danger" id="logout-btn">Cerrar sesión</button>`,
    onOpen: (body) => body.querySelector('#logout-btn').addEventListener('click', () => { closeDialog(); logout(); }),
    onSubmit: async (f) => {
      const { token } = await api('PUT', '/api/me/pin', { current_pin: f.current_pin.value, new_pin: f.new_pin.value });
      state.token = token;
      localStorageSet('token', token);
      state.socket.auth.token = token;
      state.socket.disconnect().connect();
      toast('PIN actualizado');
    },
  });
});

// ---------- Tiempo real ----------

function connectSocket() {
  state.socket?.disconnect();
  const socket = io({ auth: { token: state.token } });
  state.socket = socket;

  socket.on('connect', () => {
    $('#conn').className = 'conn on';
    $('#conn').title = 'Conectado en tiempo real';
  });
  socket.on('disconnect', () => {
    $('#conn').className = 'conn off';
    $('#conn').title = 'Sin conexión — reconectando…';
  });
  // Tras una reconexión recargamos todo por si nos perdimos algún cambio.
  socket.io.on('reconnect', () => {
    loadProducts();
    if (state.tab === 'movements') loadMovements();
  });
  socket.on('connect_error', (err) => {
    if (err.message === 'unauthorized') logout(false);
  });

  socket.on('presence', (list) => {
    const others = list.filter((u) => u.id !== state.user.id);
    $('#online').textContent = others.length
      ? `En línea: ${others.map((u) => u.name).join(', ')}`
      : 'Solo tú en línea';
  });

  socket.on('product:updated', ({ product, by }) => {
    state.products.set(product.id, product);
    renderProducts();
    flash(product.id);
    refreshCategories();
    state.dialogProductWatcher?.(); // mantiene al día un diálogo de movimiento abierto
  });

  socket.on('product:deleted', ({ product, by }) => {
    state.products.delete(product.id);
    renderProducts();
    if (by.id !== state.user.id) toast(`${by.name} eliminó ${product.name}`);
  });

  socket.on('movement:created', ({ movement, by }) => {
    if (by.id !== state.user.id) {
      const sign = movement.type === 'entrada' ? '+' : movement.type === 'ajuste' ? '=' : '−';
      toast(`${by.name}: ${TYPE_LABEL[movement.type]} ${sign}${fmtQty(movement.quantity)} ${movement.unit} de ${movement.product_name}`);
    }
    if (matchesMovementFilter(movement)) {
      state.movements.unshift(movement);
      renderMovements();
    }
  });
}

function flash(id) {
  const el = document.querySelector(`.product[data-id="${id}"]`);
  if (!el) return;
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 900);
}

// ---------- Pestañas ----------

document.querySelectorAll('.tab').forEach((btn) => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== `tab-${tab}`; });
  if (tab === 'movements') loadMovements();
  if (tab === 'users') loadUsers();
}

// ---------- Inventario ----------

async function loadProducts() {
  const list = await api('GET', '/api/products');
  state.products = new Map(list.map((p) => [p.id, p]));
  refreshCategories();
  renderProducts();
}

function isLow(p) { return p.quantity <= p.min_stock; }

function refreshCategories() {
  const sel = $('#category-filter');
  const current = sel.value;
  const cats = [...new Set([...state.products.values()].map((p) => p.category))].sort((a, b) => a.localeCompare(b, 'es'));
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map((c) => `<option ${c === current ? 'selected' : ''}>${esc(c)}</option>`).join('');
}

function renderProducts() {
  const term = $('#search').value.trim().toLowerCase();
  const cat = $('#category-filter').value;
  const onlyLow = $('#low-filter').checked;
  const all = [...state.products.values()];

  const low = all.filter(isLow).length;
  $('#summary').innerHTML = `
    <div class="stat"><b>${all.length}</b><span>Productos</span></div>
    <div class="stat ${low ? 'warn' : ''}"><b>${low}</b><span>Con stock bajo</span></div>
    <div class="stat"><b>${new Set(all.map((p) => p.category)).size}</b><span>Categorías</span></div>`;

  const visible = all
    .filter((p) => !term || p.name.toLowerCase().includes(term) || p.category.toLowerCase().includes(term))
    .filter((p) => !cat || p.category === cat)
    .filter((p) => !onlyLow || isLow(p))
    .sort((a, b) => a.category.localeCompare(b.category, 'es') || a.name.localeCompare(b.name, 'es'));

  if (!visible.length) {
    $('#product-list').innerHTML = `<p class="empty">${all.length ? 'No hay productos que coincidan.' :
      state.user.role === 'admin' ? 'Aún no hay productos. Pulsa “+ Producto” para empezar.' : 'Aún no hay productos.'}</p>`;
    return;
  }

  const groups = new Map();
  for (const p of visible) {
    if (!groups.has(p.category)) groups.set(p.category, []);
    groups.get(p.category).push(p);
  }

  const admin = state.user.role === 'admin';
  $('#product-list').innerHTML = [...groups].map(([category, items]) => `
    <h3 class="category-title">${esc(category)}</h3>
    <div class="products">
      ${items.map((p) => `
        <article class="product ${isLow(p) ? 'low' : ''}" data-id="${p.id}">
          <div class="product-head">
            <span class="product-name">${esc(p.name)}</span>
            ${isLow(p) ? '<span class="badge">Stock bajo</span>' : ''}
          </div>
          <div class="qty">${fmtQty(p.quantity)} <small>${esc(p.unit)} · mín. ${fmtQty(p.min_stock)}</small></div>
          <div class="meta">${p.updated_by_name ? `Últ. cambio: ${esc(p.updated_by_name)}, ${fmtTime(p.updated_at)}` : ''}</div>
          <div class="actions">
            <button class="btn in" data-act="entrada">+ Entrada</button>
            <button class="btn out" data-act="salida">− Salida</button>
            <button class="btn small ghost" data-act="history" title="Historial">🕘</button>
            ${admin ? '<button class="btn small ghost" data-act="edit" title="Editar">✏️</button>' : ''}
          </div>
        </article>`).join('')}
    </div>`).join('');
}

['#search', '#category-filter', '#low-filter'].forEach((sel) => $(sel).addEventListener('input', renderProducts));

$('#product-list').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const product = state.products.get(Number(btn.closest('.product').dataset.id));
  const act = btn.dataset.act;
  if (act === 'edit') productDialog(product);
  else if (act === 'history') historyDialog(product);
  else movementDialog(product, act);
});

$('#add-product').addEventListener('click', () => productDialog());

function productDialog(p) {
  const cats = [...new Set([...state.products.values()].map((x) => x.category))];
  openDialog({
    title: p ? 'Editar producto' : 'Nuevo producto',
    body: `
      <label>Nombre <input name="name" required maxlength="120" value="${esc(p?.name)}"></label>
      <label>Categoría <input name="category" list="cat-options" maxlength="60" placeholder="Ej.: Carnes, Bebidas, Verduras" value="${esc(p?.category)}"></label>
      <datalist id="cat-options">${cats.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
      <label>Unidad <input name="unit" list="unit-options" maxlength="20" placeholder="kg, litros, unidades…" value="${esc(p?.unit)}"></label>
      <datalist id="unit-options">${['unidad', 'kg', 'g', 'litro', 'ml', 'caja', 'botella', 'paquete', 'lata'].map((u) => `<option value="${u}">`).join('')}</datalist>
      <label>Stock mínimo (avisa cuando baje de aquí) <input name="min_stock" type="number" min="0" step="any" value="${p?.min_stock ?? 0}"></label>
      ${p ? '<button type="button" class="btn danger" id="delete-product">Eliminar producto</button>'
          : '<label>Cantidad inicial <input name="quantity" type="number" min="0" step="any" value="0"></label>'}`,
    onOpen: (body) => body.querySelector('#delete-product')?.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar “${p.name}” del inventario? El historial se conserva.`)) return;
      try {
        await api('DELETE', `/api/products/${p.id}`);
        closeDialog();
        toast('Producto eliminado');
      } catch (err) { toast(err.message, 'error'); }
    }),
    onSubmit: async (f) => {
      const data = { name: f.name.value, category: f.category.value, unit: f.unit.value, min_stock: f.min_stock.value };
      if (p) await api('PUT', `/api/products/${p.id}`, data);
      else await api('POST', '/api/products', { ...data, quantity: f.quantity.value });
      toast(p ? 'Producto actualizado' : 'Producto creado');
    },
  });
}

function movementDialog(p, type) {
  const types = ['entrada', 'salida', 'merma', ...(state.user.role === 'admin' ? ['ajuste'] : [])];
  openDialog({
    title: p.name,
    ok: 'Registrar',
    body: `
      <p class="muted">Stock actual: <b id="cur-qty">${fmtQty(p.quantity)}</b> ${esc(p.unit)}</p>
      <div class="segmented">
        ${types.map((t) => `<label><input type="radio" name="type" value="${t}" ${t === type ? 'checked' : ''}>${TYPE_LABEL[t]}</label>`).join('')}
      </div>
      <label><span id="qty-label">Cantidad (${esc(p.unit)})</span>
        <input name="quantity" type="number" min="0" step="any" inputmode="decimal" required>
      </label>
      <label>Nota (opcional) <input name="note" maxlength="200" placeholder="Proveedor, motivo, mesa…"></label>
      <p class="preview" id="preview"></p>`,
    onOpen: (body, form) => {
      const update = () => {
        const cur = state.products.get(p.id)?.quantity ?? p.quantity;
        body.querySelector('#cur-qty').textContent = fmtQty(cur);
        const t = form.type.value;
        const q = Number(form.quantity.value);
        body.querySelector('#qty-label').textContent = t === 'ajuste' ? `Cantidad real contada (${p.unit})` : `Cantidad (${p.unit})`;
        if (!form.quantity.value || !Number.isFinite(q)) { body.querySelector('#preview').textContent = ''; return; }
        const after = t === 'entrada' ? cur + q : t === 'ajuste' ? q : cur - q;
        body.querySelector('#preview').textContent = `Quedarán ${fmtQty(Math.round(after * 1000) / 1000)} ${p.unit}`;
      };
      form.addEventListener('input', update);
      state.dialogProductWatcher = update;
      form.quantity.focus();
    },
    onSubmit: async (f) => {
      await api('POST', `/api/products/${p.id}/movements`, {
        type: f.type.value, quantity: f.quantity.value, note: f.note.value,
      });
      toast(`${TYPE_LABEL[f.type.value]} registrada`);
    },
  });
}

async function historyDialog(p) {
  openDialog({
    title: `Historial · ${p.name}`,
    ok: null,
    body: '<p class="muted">Cargando…</p>',
    onOpen: async (body) => {
      try {
        const list = await api('GET', `/api/movements?product_id=${p.id}&limit=50`);
        body.innerHTML = list.length
          ? `<ul class="movement-list">${list.map(movementItem).join('')}</ul>`
          : '<p class="muted">Sin movimientos todavía.</p>';
      } catch (err) { body.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    },
  });
}

$('#export-products').addEventListener('click', (e) => {
  e.preventDefault();
  location.href = `/api/export/products.csv?token=${encodeURIComponent(state.token)}`;
});

// ---------- Movimientos ----------

function movementFilterRange() {
  const day = $('#mov-date').value;
  if (!day) return {};
  const from = new Date(`${day}T00:00:00`);
  const to = new Date(from); to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function matchesMovementFilter(m) {
  const type = $('#mov-type').value;
  const { from, to } = movementFilterRange();
  return (!type || m.type === type) && (!from || (m.created_at >= from && m.created_at < to));
}

async function loadMovements() {
  const params = new URLSearchParams({ limit: 200, ...movementFilterRange() });
  if ($('#mov-type').value) params.set('type', $('#mov-type').value);
  state.movements = await api('GET', `/api/movements?${params}`);
  renderMovements();
}

function movementItem(m) {
  const sign = m.type === 'entrada' ? '+' : m.type === 'ajuste' ? '=' : '−';
  return `
    <li class="movement">
      <div class="amount ${m.type}">${sign}${fmtQty(m.quantity)}<br><span class="type-tag">${TYPE_LABEL[m.type]}</span></div>
      <div class="info">
        <div><b>${esc(m.product_name)}</b> <span class="muted">${fmtQty(m.before_qty)} → ${fmtQty(m.after_qty)} ${esc(m.unit)}</span></div>
        <div class="meta">${esc(m.user_name)} · ${fmtTime(m.created_at)}${m.note ? ` · “${esc(m.note)}”` : ''}</div>
      </div>
    </li>`;
}

function renderMovements() {
  $('#movement-list').innerHTML = state.movements.length
    ? state.movements.map(movementItem).join('')
    : '<li class="empty">No hay movimientos.</li>';
}

['#mov-type', '#mov-date'].forEach((sel) => $(sel).addEventListener('change', loadMovements));

$('#export-movements').addEventListener('click', (e) => {
  e.preventDefault();
  const params = new URLSearchParams({ token: state.token, ...movementFilterRange() });
  location.href = `/api/export/movements.csv?${params}`;
});

// ---------- Personal ----------

async function loadUsers() {
  state.users = await api('GET', '/api/users');
  $('#user-list').innerHTML = state.users.map((u) => `
    <tr>
      <td><b>${esc(u.name)}</b></td>
      <td>${esc(u.username)}</td>
      <td>${u.role === 'admin' ? 'Administrador' : 'Personal'}</td>
      <td>${u.active ? 'Activo' : '<span class="muted">Desactivado</span>'}</td>
      <td><button class="btn small ghost" data-user="${u.id}">Editar</button></td>
    </tr>`).join('');
}

$('#add-user').addEventListener('click', () => userDialog());
$('#user-list').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-user]');
  if (btn) userDialog(state.users.find((u) => u.id === Number(btn.dataset.user)));
});

function userDialog(u) {
  openDialog({
    title: u ? `Editar · ${u.name}` : 'Nueva persona',
    body: `
      <label>Nombre <input name="name" required maxlength="60" value="${esc(u?.name)}"></label>
      ${u ? '' : '<label>Usuario (para entrar) <input name="username" required pattern="[a-zA-Z0-9._\\-]{2,30}" autocapitalize="none"></label>'}
      <label>Rol
        <select name="role">
          <option value="personal" ${u?.role !== 'admin' ? 'selected' : ''}>Personal — registra entradas, salidas y mermas</option>
          <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>Administrador — además gestiona productos, ajustes y personal</option>
        </select>
      </label>
      <label>${u ? 'Nuevo PIN (déjalo vacío para no cambiarlo)' : 'PIN (4-8 dígitos)'}
        <input name="pin" type="password" inputmode="numeric" pattern="\\d{4,8}" ${u ? '' : 'required'}>
      </label>
      ${u ? `<label class="check"><input name="active" type="checkbox" ${u.active ? 'checked' : ''}> Puede entrar</label>` : ''}`,
    onSubmit: async (f) => {
      if (u) {
        await api('PUT', `/api/users/${u.id}`, { name: f.name.value, role: f.role.value, pin: f.pin.value, active: f.active.checked });
      } else {
        await api('POST', '/api/users', { name: f.name.value, username: f.username.value, role: f.role.value, pin: f.pin.value });
      }
      toast(u ? 'Cambios guardados' : 'Persona añadida');
      loadUsers();
    },
  });
}

// ---------- Diálogo ----------

let dialogSubmit = null;

function openDialog({ title, body, ok = 'Guardar', onOpen, onSubmit }) {
  const dialog = $('#dialog');
  $('#dialog-title').textContent = title;
  $('#dialog-body').innerHTML = body;
  $('#dialog-error').hidden = true;
  $('#dialog-ok').hidden = !ok;
  $('#dialog-ok').textContent = ok || '';
  $('#dialog-ok').disabled = false;
  $('#dialog-cancel').textContent = ok ? 'Cancelar' : 'Cerrar';
  dialogSubmit = onSubmit;
  state.dialogProductWatcher = null;
  dialog.showModal();
  onOpen?.($('#dialog-body'), $('#dialog-form'));
}

function closeDialog() {
  state.dialogProductWatcher = null;
  $('#dialog').close();
}

$('#dialog-cancel').addEventListener('click', closeDialog);

$('#dialog-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!dialogSubmit) return closeDialog();
  const okBtn = $('#dialog-ok');
  okBtn.disabled = true;
  try {
    await dialogSubmit(e.target);
    closeDialog();
  } catch (err) {
    $('#dialog-error').textContent = err.message;
    $('#dialog-error').hidden = false;
  } finally {
    okBtn.disabled = false;
  }
});

start();
