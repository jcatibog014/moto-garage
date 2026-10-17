(function () {
  'use strict';

  const view = document.getElementById('view');
  const topbar = document.getElementById('topbar');
  const toastEl = document.getElementById('toast');

  const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const cfg = (window.MOTO_CONFIG || {}).firebase || {};
  const configured = Boolean(cfg.apiKey && cfg.projectId) && !/YOUR-/.test(cfg.apiKey + cfg.projectId);

  const TYPES = { motorcycle: 'Motorcycle', car: 'Car' };
  const STATUS = { in_stock: 'In stock', sold: 'Sold' };
  const CATEGORIES = {
    transport: 'Transport',
    repair: 'Repair',
    parts: 'Parts',
    documents: 'Registration / documents',
    cleaning: 'Cleaning',
    other: 'Other',
  };
  const NUMERIC = ['year', 'purchase_price', 'sale_price', 'amount'];

  const ICONS = {
    motorcycle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="16" r="3.2"/><circle cx="19" cy="16" r="3.2"/><path d="M5 16l4-6h5l2.5 6M9 10L7.5 7H5.5M14 10l2-3h2.5"/></svg>',
    car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16v-3.5L5.2 7.5h13.6L21 12.5V16zM3 12.5h18"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/></svg>',
  };

  // ---------- Formatting ----------

  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const money = (n) => (n == null ? '—' : peso.format(n));
  const signed = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + peso.format(n));
  const profitClass = (n) => (n == null ? '' : n >= 0 ? 'pos' : 'neg');
  const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key] || 0), 0);
  const unitName = (u) => [u.year, u.brand, u.model].filter(Boolean).join(' ');

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function today() {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function options(map, selected, allLabel) {
    const all = allLabel ? `<option value="">${esc(allLabel)}</option>` : '';
    return all + Object.entries(map).map(([value, label]) =>
      `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(label)}</option>`
    ).join('');
  }

  // ---------- Feedback ----------

  let toastTimer;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = 'toast show ' + (kind || 'ok');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
  }

  function friendlyError(err) {
    const code = (err && err.code) || '';
    const msg = (err && err.message) || String(err);
    if (code === 'permission-denied') return 'Your account isn’t on the team list. Ask the owner to add your email to firestore.rules.';
    if (code === 'unavailable' || /Failed to fetch|NetworkError|offline/i.test(msg)) return 'Can’t reach the server. Check your internet connection.';
    return msg;
  }

  // ---------- Forms ----------

  function field(name, label, value, opts) {
    const o = opts || {};
    const req = o.required ? ' required' : '';
    const control = o.textarea
      ? `<textarea id="${name}" name="${name}" rows="3"${req} aria-describedby="${name}-error">${esc(value)}</textarea>`
      : `<input id="${name}" name="${name}" type="${o.type || 'text'}" value="${esc(value)}"${req} ${o.attrs || ''} aria-describedby="${name}-error">`;
    return `<div class="field${o.wide ? ' wide' : ''}">
      <label for="${name}">${esc(label)}${o.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      ${control}
      <p class="error" id="${name}-error"></p>
    </div>`;
  }

  const MONEY_ATTRS = 'inputmode="decimal" step="0.01" min="0" placeholder="0.00"';

  function setError(form, name, message) {
    const el = form.elements[name];
    const err = form.querySelector('#' + name + '-error');
    if (err) err.textContent = message;
    if (el && el.setAttribute) el.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function validate(form, extra) {
    let first = null;
    form.querySelectorAll('input[id], select[id], textarea[id]').forEach((el) => {
      if (!form.querySelector('#' + el.id + '-error')) return;
      const v = el.validity;
      let msg = '';
      if (v.valueMissing) msg = 'This field is required.';
      else if (v.badInput || v.stepMismatch || v.typeMismatch) msg = el.type === 'email' ? 'Enter a valid email.' : 'Enter a valid number.';
      else if (v.rangeUnderflow) msg = `Must be at least ${el.min}.`;
      else if (v.rangeOverflow) msg = `Must be at most ${el.max}.`;
      else if (extra && extra[el.name]) msg = extra[el.name](el.value) || '';
      setError(form, el.name, msg);
      if (msg && !first) first = el;
    });
    if (first) first.focus();
    return !first;
  }

  function formValues(form) {
    const out = {};
    new FormData(form).forEach((raw, key) => {
      const v = String(raw).trim();
      out[key] = v === '' ? null : NUMERIC.includes(key) ? Number(v) : v;
    });
    return out;
  }

  async function busy(button, task) {
    button.disabled = true;
    try { await task(); } finally { button.disabled = false; }
  }

  // ---------- Data ----------

  // Firestore layout: units/{id} with a running `total_expenses`, and
  // units/{id}/expenses/{id}. Every expense write updates the total in the same batch.
  let fb = null; // Firebase SDK functions, loaded in start()
  let auth = null;
  let db = null;
  let session = null;

  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

  // Adds the derived totals that the screens use.
  function summarize(id, d) {
    const total_expenses = round2(d.total_expenses);
    const total_cost = round2(d.purchase_price + total_expenses);
    return {
      ...d,
      id,
      total_expenses,
      total_cost,
      profit: d.status === 'sold' ? round2(d.sale_price - total_cost) : null,
      days_in_stock: Math.round((Date.parse(d.sale_date || today()) - Date.parse(d.purchase_date)) / 864e5),
    };
  }

  const unitsCol = () => fb.collection(db, 'units');
  const unitRef = (id) => fb.doc(db, 'units', id);
  const expensesCol = (unitId) => fb.collection(db, 'units', unitId, 'expenses');

  const api = {
    async listUnits() {
      const snap = await fb.getDocs(unitsCol());
      return snap.docs.map((d) => summarize(d.id, d.data())).sort((a, b) =>
        b.purchase_date.localeCompare(a.purchase_date) || millis(b.created_at) - millis(a.created_at));
    },
    async getUnit(id) {
      const snap = await fb.getDoc(unitRef(id));
      return snap.exists() ? summarize(snap.id, snap.data()) : null;
    },
    async listExpenses(unitId) {
      const snap = await fb.getDocs(expensesCol(unitId));
      return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort((a, b) =>
        a.date.localeCompare(b.date) || millis(a.created_at) - millis(b.created_at));
    },
    async createUnit(values) {
      const ref = await fb.addDoc(unitsCol(), {
        ...values, status: 'in_stock', total_expenses: 0,
        created_at: fb.serverTimestamp(), created_by: session.email,
      });
      return ref.id;
    },
    updateUnit: (id, values) => fb.updateDoc(unitRef(id), values),
    async deleteUnit(id) {
      const expenses = await fb.getDocs(expensesCol(id));
      const batch = fb.writeBatch(db);
      expenses.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(unitRef(id));
      await batch.commit();
    },
    addExpense(unitId, values) {
      const batch = fb.writeBatch(db);
      batch.set(fb.doc(expensesCol(unitId)), { ...values, created_at: fb.serverTimestamp(), created_by: session.email });
      batch.update(unitRef(unitId), { total_expenses: fb.increment(values.amount) });
      return batch.commit();
    },
    deleteExpense(unitId, expense) {
      const batch = fb.writeBatch(db);
      batch.delete(fb.doc(db, 'units', unitId, 'expenses', expense.id));
      batch.update(unitRef(unitId), { total_expenses: fb.increment(-expense.amount) });
      return batch.commit();
    },
  };

  const loadUnits = () => api.listUnits();

  // ---------- Router ----------

  let routeToken = 0;
  const stale = (token) => token !== routeToken;

  async function route() {
    const token = ++routeToken;
    if (!configured || !fb) return renderSetup();
    if (!session) {
      topbar.hidden = true;
      return renderLogin();
    }
    topbar.hidden = false;

    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    const nav = !parts.length ? 'dashboard' : parts[1] === 'new' ? 'new' : 'units';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (!view.querySelector('.page')) view.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (!parts.length) await renderDashboard(token);
      else if (parts[0] !== 'units') location.hash = '#/';
      else if (parts.length === 1) await renderUnits(token);
      else if (parts[1] === 'new') await renderUnitForm(null, token);
      else if (parts[2] === 'edit') await renderUnitForm(parts[1], token);
      else await renderUnitDetail(parts[1], token);
    } catch (err) {
      if (!stale(token)) renderError(err);
    }
  }

  function renderError(err) {
    view.innerHTML = `<div class="page"><div class="panel notice">
      <h1>Something went wrong</h1>
      <p>${esc(friendlyError(err))}</p>
      <button class="btn" type="button" id="retry">Try again</button>
    </div></div>`;
    view.querySelector('#retry').addEventListener('click', route);
  }

  const notFound = () => `<div class="page"><div class="panel notice">
    <h1>Unit not found</h1><p>It may have been deleted.</p>
    <a class="btn" href="#/units">Back to units</a></div></div>`;

  // ---------- Setup & login ----------

  function renderSetup() {
    topbar.hidden = true;
    const offline = configured && !fb;
    view.innerHTML = `<div class="auth page"><div class="auth-card">
      ${brandMark()}
      <h1>${offline ? 'Can’t load the app' : 'Finish setting up'}</h1>
      ${offline
        ? '<p>Firebase didn’t load. Check your internet connection and refresh.</p>'
        : `<p>Connect the app to your Firebase project:</p>
           <ol class="steps">
             <li>Create a project at <a href="https://console.firebase.google.com" target="_blank" rel="noopener">console.firebase.google.com</a> with Firestore and Email/Password sign-in.</li>
             <li>Copy the web app config into <code>js/config.js</code>.</li>
           </ol>
           <p class="muted small">The README has the full steps.</p>`}
    </div></div>`;
  }

  function brandMark() {
    return `<div class="auth-brand">
      <svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8"/><path d="M8 22V10l8 7 8-7v12"/></svg>
      <span>Moto Garage</span></div>`;
  }

  function renderLogin() {
    view.innerHTML = `<div class="auth page"><div class="auth-card">
      ${brandMark()}
      <h1>Log in</h1>
      <p class="muted">Track your units, expenses and profit.</p>
      <form id="login-form" novalidate>
        ${field('email', 'Email', '', { type: 'email', required: true, attrs: 'autocomplete="email"' })}
        ${field('password', 'Password', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
        <p class="form-error" id="login-error" role="alert"></p>
        <button class="btn btn-block" type="submit">Log in</button>
      </form>
      <button class="btn-ghost btn-block forgot" type="button" id="forgot">Forgot password?</button>
      <p class="muted small">No account yet? Ask the owner to add you.</p>
    </div></div>`;

    const form = view.querySelector('#login-form');
    view.querySelector('#forgot').addEventListener('click', (e) => {
      const errorEl = form.querySelector('#login-error');
      const email = form.elements.email.value.trim();
      if (!email || !form.elements.email.validity.valid) {
        setError(form, 'email', 'Enter your email first, then tap “Forgot password?”.');
        form.elements.email.focus();
        return;
      }
      setError(form, 'email', '');
      busy(e.currentTarget, async () => {
        try {
          await fb.sendPasswordResetEmail(auth, email);
        } catch (err) {
          if (!/user-not-found|invalid-email/.test(err.code)) { errorEl.textContent = friendlyError(err); return; }
        }
        // Same message either way, so the form doesn't reveal which emails have accounts.
        toast('If that email has an account, a reset link is on its way. Check your inbox and spam.');
      });
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const errorEl = form.querySelector('#login-error');
      errorEl.textContent = '';
      if (!validate(form)) return;
      busy(form.querySelector('button'), async () => {
        try {
          await fb.signInWithEmailAndPassword(auth, form.elements.email.value.trim(), form.elements.password.value);
        } catch (err) {
          errorEl.textContent =
            /invalid-credential|wrong-password|user-not-found|invalid-email/.test(err.code) ? 'Wrong email or password.'
            : err.code === 'auth/too-many-requests' ? 'Too many tries. Wait a few minutes and try again.'
            : friendlyError(err);
        }
      });
    });
  }

  // ---------- Shared pieces ----------

  function unitRow(u) {
    const meta = [u.plate_no, 'Bought ' + fmtDate(u.purchase_date)].filter(Boolean).join(' · ');
    const figures = u.status === 'sold'
      ? `<span class="fig ${profitClass(u.profit)}">${signed(u.profit)}</span>
         <span class="meta">Sold ${fmtDate(u.sale_date)}</span>`
      : `<span class="fig">${money(u.total_cost)}</span>
         <span class="meta">${u.days_in_stock} ${u.days_in_stock === 1 ? 'day' : 'days'} in stock</span>`;
    return `<a class="unit-row" href="#/units/${u.id}">
      <span class="unit-icon">${ICONS[u.type]}</span>
      <span class="unit-main">
        <strong>${esc(unitName(u))}</strong>
        <span class="meta">${esc(meta)}</span>
      </span>
      <span class="unit-figs">${figures}</span>
    </a>`;
  }

  const statusBadge = (s) => `<span class="badge ${s}">${STATUS[s]}</span>`;

  function stat(label, value, sub, cls) {
    return `<div class="stat">
      <span class="stat-label">${esc(label)}</span>
      <span class="stat-value ${cls || ''}">${value}</span>
      ${sub ? `<span class="stat-sub">${sub}</span>` : ''}
    </div>`;
  }

  // ---------- Dashboard ----------

  async function renderDashboard(token) {
    const units = await loadUnits();
    if (stale(token)) return;

    if (!units.length) {
      view.innerHTML = `<div class="page"><div class="panel empty">
        <span class="empty-icons">${ICONS.motorcycle}${ICONS.car}</span>
        <h1>No units yet</h1>
        <p>Add the first motorcycle or car you bought to start tracking costs and profit.</p>
        <a class="btn" href="#/units/new">+ Add unit</a>
      </div></div>`;
      return;
    }

    const inStock = units.filter((u) => u.status === 'in_stock');
    const sold = units.filter((u) => u.status === 'sold');
    const month = today().slice(0, 7);
    const soldMonth = sold.filter((u) => (u.sale_date || '').startsWith(month));
    const motos = inStock.filter((u) => u.type === 'motorcycle').length;
    const totalProfit = sum(sold, 'profit');
    const monthProfit = sum(soldMonth, 'profit');
    const monthName = new Date().toLocaleDateString('en-PH', { month: 'long' });

    const recentSales = [...sold].sort((a, b) => b.sale_date.localeCompare(a.sale_date)).slice(0, 5);
    const oldest = [...inStock].sort((a, b) => b.days_in_stock - a.days_in_stock).slice(0, 5);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

    view.innerHTML = `<div class="page">
      <div class="page-head"><h1>Dashboard</h1></div>
      <div class="stats">
        ${stat('Units in stock', inStock.length, `${plural(motos, 'motorcycle')} · ${plural(inStock.length - motos, 'car')}`)}
        ${stat('Money in stock', money(sum(inStock, 'total_cost')), 'Purchase + expenses of unsold units')}
        ${stat(`Profit in ${monthName}`, signed(monthProfit), `${plural(soldMonth.length, 'unit')} sold`, profitClass(monthProfit))}
        ${stat('Total profit', signed(totalProfit), `${plural(sold.length, 'unit')} sold`, profitClass(totalProfit))}
        ${stat('Total sales', money(sum(sold, 'sale_price')))}
        ${stat('Average profit', sold.length ? signed(totalProfit / sold.length) : '—', 'Per unit sold', profitClass(sold.length ? totalProfit : null))}
      </div>
      <div class="columns">
        <section class="panel">
          <h2>Recent sales</h2>
          ${recentSales.length ? `<div class="unit-list">${recentSales.map(unitRow).join('')}</div>` : '<p class="muted">No sales yet.</p>'}
        </section>
        <section class="panel">
          <h2>Longest in stock</h2>
          ${oldest.length ? `<div class="unit-list">${oldest.map(unitRow).join('')}</div>` : '<p class="muted">Everything is sold.</p>'}
        </section>
      </div>
    </div>`;
  }

  // ---------- Units list ----------

  const filters = { q: '', type: '', status: '' };

  function matches(u) {
    if (filters.type && u.type !== filters.type) return false;
    if (filters.status && u.status !== filters.status) return false;
    const needle = filters.q.toLowerCase();
    if (!needle) return true;
    return [u.brand, u.model, u.plate_no, u.color, u.year, u.bought_from, u.sold_to]
      .some((v) => v != null && String(v).toLowerCase().includes(needle));
  }

  async function renderUnits(token) {
    const units = await loadUnits();
    if (stale(token)) return;

    view.innerHTML = `<div class="page">
      <div class="page-head">
        <h1>Units</h1>
        <div class="actions">
          <button class="btn-secondary" type="button" id="export">Export CSV</button>
          <a class="btn" href="#/units/new">+ Add unit</a>
        </div>
      </div>
      <div class="filters">
        <input type="search" id="f-q" placeholder="Search brand, model, plate…" aria-label="Search units" value="${esc(filters.q)}">
        <select id="f-type" aria-label="Filter by type">${options(TYPES, filters.type, 'All types')}</select>
        <select id="f-status" aria-label="Filter by status">${options(STATUS, filters.status, 'All statuses')}</select>
      </div>
      <p class="list-summary" id="list-summary" aria-live="polite"></p>
      <div class="unit-list panel-list" id="unit-list"></div>
    </div>`;

    const list = view.querySelector('#unit-list');
    const summary = view.querySelector('#list-summary');
    const draw = () => {
      const shown = units.filter(matches);
      const soldShown = shown.filter((u) => u.status === 'sold');
      summary.innerHTML = shown.length
        ? `${shown.length} ${shown.length === 1 ? 'unit' : 'units'} · cost ${money(sum(shown, 'total_cost'))}` +
          (soldShown.length ? ` · profit <span class="${profitClass(sum(soldShown, 'profit'))}">${signed(sum(soldShown, 'profit'))}</span>` : '')
        : '';
      list.innerHTML = shown.length
        ? shown.map(unitRow).join('')
        : `<p class="muted empty-list">${units.length ? 'No units match these filters.' : 'No units yet. Add your first one.'}</p>`;
      return shown;
    };
    draw();

    [['f-q', 'q', 'input'], ['f-type', 'type', 'change'], ['f-status', 'status', 'change']].forEach(([id, key, evt]) => {
      view.querySelector('#' + id).addEventListener(evt, (e) => { filters[key] = e.target.value; draw(); });
    });
    view.querySelector('#export').addEventListener('click', () => exportCsv(units.filter(matches)));
  }

  function exportCsv(units) {
    const cols = [
      ['Type', (u) => TYPES[u.type]], ['Brand', 'brand'], ['Model', 'model'], ['Year', 'year'],
      ['Plate no.', 'plate_no'], ['Color', 'color'], ['Purchase date', 'purchase_date'],
      ['Purchase price', 'purchase_price'], ['Bought from', 'bought_from'], ['Expenses', 'total_expenses'],
      ['Total cost', 'total_cost'], ['Status', (u) => STATUS[u.status]], ['Sale date', 'sale_date'],
      ['Sale price', 'sale_price'], ['Sold to', 'sold_to'], ['Profit', 'profit'],
      ['Days in stock', 'days_in_stock'], ['Notes', 'notes'],
    ];
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const rows = [cols.map((c) => c[0])].concat(units.map((u) =>
      cols.map(([, get]) => (typeof get === 'function' ? get(u) : u[get]))
    ));
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `moto-garage-units-${today()}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  // ---------- Unit detail ----------

  async function renderUnitDetail(id, token) {
    const [unit, expenses] = await Promise.all([api.getUnit(id), api.listExpenses(id)]);
    if (stale(token)) return;
    if (!unit) { view.innerHTML = notFound(); return; }

    const isSold = unit.status === 'sold';
    const byCategory = Object.keys(CATEGORIES)
      .map((c) => [c, sum(expenses.filter((e) => e.category === c), 'amount')])
      .filter(([, total]) => total > 0);
    const details = [
      ['Type', TYPES[unit.type]], ['Plate no.', unit.plate_no], ['Color', unit.color],
      ['Bought on', fmtDate(unit.purchase_date)], ['Bought from', unit.bought_from],
    ].filter(([, v]) => v);

    view.innerHTML = `<div class="page">
      <a class="back" href="#/units">← All units</a>
      <div class="page-head">
        <div class="title-row">
          <span class="unit-icon lg">${ICONS[unit.type]}</span>
          <div>
            <h1>${esc(unitName(unit))}</h1>
            <div class="badges">${statusBadge(unit.status)}<span class="muted small">${unit.days_in_stock} ${unit.days_in_stock === 1 ? 'day' : 'days'} ${isSold ? 'until sold' : 'in stock'}</span></div>
          </div>
        </div>
        <div class="actions">
          <a class="btn-secondary" href="#/units/${unit.id}/edit">Edit</a>
          <button class="btn-danger" type="button" id="delete-unit">Delete</button>
        </div>
      </div>

      <div class="ledger panel">
        <div class="ledger-row"><span>Bought for</span><span>${money(unit.purchase_price)}</span></div>
        <div class="ledger-row"><span>Expenses</span><span>+ ${money(unit.total_expenses)}</span></div>
        <div class="ledger-row total"><span>Total cost</span><span>${money(unit.total_cost)}</span></div>
        ${isSold ? `
          <div class="ledger-row"><span>Sold for</span><span>${money(unit.sale_price)}</span></div>
          <div class="ledger-row profit ${profitClass(unit.profit)}"><span>${unit.profit >= 0 ? 'Profit' : 'Loss'}</span><span>${signed(unit.profit)}</span></div>` : ''}
      </div>

      <div class="columns">
        <section class="panel">
          <h2>Expenses</h2>
          ${byCategory.length ? `<div class="chips">${byCategory.map(([c, t]) =>
            `<span class="chip">${esc(CATEGORIES[c])} <b>${money(t)}</b></span>`).join('')}</div>` : ''}
          ${expenses.length ? `<ul class="expense-list">${expenses.map((e) => `
            <li>
              <span class="exp-main">
                <strong>${esc(CATEGORIES[e.category])}</strong>
                <span class="meta">${fmtDate(e.date)}${e.description ? ' · ' + esc(e.description) : ''}</span>
              </span>
              <span class="exp-amount">${money(e.amount)}</span>
              <button class="icon-btn" type="button" data-delete-expense="${e.id}" aria-label="Delete ${esc(CATEGORIES[e.category])} expense of ${money(e.amount)}">×</button>
            </li>`).join('')}</ul>` : '<p class="muted">No expenses yet.</p>'}
          <form id="expense-form" class="subform" novalidate>
            <h3>Add expense</h3>
            <div class="grid-2">
              <div class="field">
                <label for="category">Category <span class="req" aria-hidden="true">*</span></label>
                <select id="category" name="category" required aria-describedby="category-error">${options(CATEGORIES, 'transport')}</select>
                <p class="error" id="category-error"></p>
              </div>
              ${field('amount', 'Amount (₱)', '', { type: 'number', required: true, attrs: MONEY_ATTRS })}
              ${field('date', 'Date', today(), { type: 'date', required: true })}
              ${field('description', 'Note', '', { attrs: 'placeholder="e.g. Change oil, LBC shipping"' })}
            </div>
            <button class="btn" type="submit">Add expense</button>
          </form>
        </section>

        <div class="stack">
          <section class="panel">
            <h2>Sale</h2>
            ${isSold ? `
              <dl class="details">
                <div><dt>Sold on</dt><dd>${fmtDate(unit.sale_date)}</dd></div>
                <div><dt>Sold for</dt><dd>${money(unit.sale_price)}</dd></div>
                ${unit.sold_to ? `<div><dt>Sold to</dt><dd>${esc(unit.sold_to)}</dd></div>` : ''}
              </dl>
              <button class="btn-ghost" type="button" id="undo-sale">Undo sale (back to in stock)</button>` : `
              <form id="sale-form" novalidate>
                <div class="grid-2">
                  ${field('sale_price', 'Sold for (₱)', '', { type: 'number', required: true, attrs: MONEY_ATTRS })}
                  ${field('sale_date', 'Date sold', today(), { type: 'date', required: true })}
                  ${field('sold_to', 'Sold to', '', { wide: true, attrs: 'placeholder="Buyer’s name (optional)"' })}
                </div>
                <p class="preview muted" id="sale-preview" aria-live="polite">Total cost so far: ${money(unit.total_cost)}</p>
                <button class="btn" type="submit">Mark as sold</button>
              </form>`}
          </section>
          <section class="panel">
            <h2>Details</h2>
            <dl class="details">${details.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
            ${unit.notes ? `<p class="notes">${esc(unit.notes)}</p>` : ''}
          </section>
        </div>
      </div>
    </div>`;

    view.querySelector('#delete-unit').addEventListener('click', async () => {
      if (!confirm(`Delete ${unitName(unit)}? Its expenses will be deleted too. This can’t be undone.`)) return;
      try {
        await api.deleteUnit(unit.id);
        toast('Unit deleted.');
        location.hash = '#/units';
      } catch (err) { toast(friendlyError(err), 'err'); }
    });

    view.querySelectorAll('[data-delete-expense]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this expense?')) return;
        try {
          await api.deleteExpense(unit.id, expenses.find((x) => x.id === btn.dataset.deleteExpense));
          toast('Expense deleted.');
          route();
        } catch (err) { toast(friendlyError(err), 'err'); }
      });
    });

    const expenseForm = view.querySelector('#expense-form');
    expenseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate(expenseForm)) return;
      busy(expenseForm.querySelector('button[type=submit]'), async () => {
        try {
          await api.addExpense(unit.id, formValues(expenseForm));
          toast('Expense added.');
          await route();
        } catch (err) { toast(friendlyError(err), 'err'); }
      });
    });

    const saleForm = view.querySelector('#sale-form');
    if (saleForm) {
      const preview = saleForm.querySelector('#sale-preview');
      saleForm.elements.sale_price.addEventListener('input', (e) => {
        const price = Number(e.target.value);
        if (!e.target.value || Number.isNaN(price)) {
          preview.className = 'preview muted';
          preview.textContent = `Total cost so far: ${money(unit.total_cost)}`;
          return;
        }
        const profit = price - unit.total_cost;
        preview.className = 'preview ' + profitClass(profit);
        preview.textContent = `${profit >= 0 ? 'Profit' : 'Loss'} at this price: ${signed(profit)}`;
      });
      saleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const ok = validate(saleForm, {
          sale_date: (v) => (v < unit.purchase_date ? 'Can’t be before the purchase date.' : ''),
        });
        if (!ok) return;
        busy(saleForm.querySelector('button[type=submit]'), async () => {
          try {
            await api.updateUnit(unit.id, { ...formValues(saleForm), status: 'sold' });
            toast('Marked as sold.');
            await route();
          } catch (err) { toast(friendlyError(err), 'err'); }
        });
      });
    }

    const undo = view.querySelector('#undo-sale');
    if (undo) {
      undo.addEventListener('click', async () => {
        if (!confirm('Move this unit back to in stock? The sale price and date will be cleared.')) return;
        try {
          await api.updateUnit(unit.id, { status: 'in_stock', sale_date: null, sale_price: null, sold_to: null });
          toast('Moved back to in stock.');
          route();
        } catch (err) { toast(friendlyError(err), 'err'); }
      });
    }
  }

  // ---------- Add / edit unit ----------

  async function renderUnitForm(id, token) {
    let unit = { type: 'motorcycle', purchase_date: today(), status: 'in_stock' };
    if (id) {
      unit = await api.getUnit(id);
      if (stale(token)) return;
      if (!unit) { view.innerHTML = notFound(); return; }
    }
    const isSold = unit.status === 'sold';
    const back = id ? '#/units/' + id : '#/units';

    view.innerHTML = `<div class="page narrow">
      <a class="back" href="${back}">← ${id ? 'Back to unit' : 'All units'}</a>
      <div class="page-head"><h1>${id ? 'Edit unit' : 'Add unit'}</h1></div>
      <form id="unit-form" class="panel form" novalidate>
        <fieldset class="segmented">
          <legend>Type</legend>
          ${Object.entries(TYPES).map(([value, label]) => `
            <label><input type="radio" name="type" value="${value}"${unit.type === value ? ' checked' : ''}>
              <span>${ICONS[value]}${label}</span></label>`).join('')}
        </fieldset>

        <h2>Unit</h2>
        <div class="grid-2">
          ${field('brand', 'Brand', unit.brand, { required: true, attrs: 'placeholder="e.g. Honda, Toyota" autocomplete="off"' })}
          ${field('model', 'Model', unit.model, { required: true, attrs: 'placeholder="e.g. Click 125i, Vios" autocomplete="off"' })}
          ${field('year', 'Year', unit.year, { type: 'number', attrs: 'inputmode="numeric" min="1950" max="2100" step="1"' })}
          ${field('plate_no', 'Plate no.', unit.plate_no, { attrs: 'autocomplete="off"' })}
          ${field('color', 'Color', unit.color)}
        </div>

        <h2>Purchase</h2>
        <div class="grid-2">
          ${field('purchase_price', 'Bought for (₱)', unit.purchase_price, { type: 'number', required: true, attrs: MONEY_ATTRS })}
          ${field('purchase_date', 'Date bought', unit.purchase_date, { type: 'date', required: true })}
          ${field('bought_from', 'Bought from', unit.bought_from, { wide: true, attrs: 'placeholder="Seller’s name (optional)"' })}
        </div>

        ${isSold ? `
          <h2>Sale</h2>
          <div class="grid-2">
            ${field('sale_price', 'Sold for (₱)', unit.sale_price, { type: 'number', required: true, attrs: MONEY_ATTRS })}
            ${field('sale_date', 'Date sold', unit.sale_date, { type: 'date', required: true })}
            ${field('sold_to', 'Sold to', unit.sold_to, { wide: true })}
          </div>` : ''}

        ${field('notes', 'Notes', unit.notes, { textarea: true })}

        <div class="form-actions">
          <button class="btn" type="submit">${id ? 'Save changes' : 'Add unit'}</button>
          <a class="btn-ghost" href="${back}">Cancel</a>
        </div>
      </form>
    </div>`;

    const form = view.querySelector('#unit-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = validate(form, {
        sale_date: (v) => (v < form.elements.purchase_date.value ? 'Can’t be before the purchase date.' : ''),
      });
      if (!ok) return;
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          const values = formValues(form);
          if (id) {
            await api.updateUnit(id, values);
            toast('Changes saved.');
            location.hash = '#/units/' + id;
          } else {
            const newId = await api.createUnit(values);
            toast('Unit added. You can add its expenses now.');
            location.hash = '#/units/' + newId;
          }
        } catch (err) { toast(friendlyError(err), 'err'); }
      });
    });
  }

  // ---------- Start ----------

  window.addEventListener('hashchange', () => {
    view.innerHTML = '<p class="loading">Loading…</p>';
    window.scrollTo(0, 0);
    route();
  });

  async function start() {
    if (!configured) return renderSetup();
    try {
      const mods = await Promise.all(['app', 'auth', 'firestore'].map((m) => import(`${FIREBASE_SDK}firebase-${m}.js`)));
      fb = Object.assign({}, ...mods);
    } catch (err) {
      console.error(err);
      return renderSetup();
    }
    const app = fb.initializeApp(cfg);
    auth = fb.getAuth(app);
    db = fb.getFirestore(app);

    // Re-render only on the first auth state and when signing in or out.
    let first = true;
    fb.onAuthStateChanged(auth, (user) => {
      const changed = Boolean(user) !== Boolean(session);
      session = user;
      if (first || changed) route();
      first = false;
    });

    document.getElementById('logout').addEventListener('click', async () => {
      await fb.signOut(auth);
      location.hash = '#/';
    });
  }

  start();
})();
