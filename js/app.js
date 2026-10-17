(function () {
  'use strict';

  const view = document.getElementById('view');
  const topbar = document.getElementById('topbar');
  const toastEl = document.getElementById('toast');

  const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const cfg = (window.MOTO_CONFIG || {}).firebase || {};
  const configured = Boolean(cfg.apiKey && cfg.projectId) && !/YOUR-/.test(cfg.apiKey + cfg.projectId);

  const TYPES = { motorcycle: 'Motorcycle', car: 'Car' };
  const STATUS = { in_stock: 'In stock', reserved: 'Reserved', sold: 'Sold' };
  const CATEGORIES = {
    transport: 'Transport',
    repair: 'Repair',
    parts: 'Parts',
    documents: 'Registration / documents',
    cleaning: 'Cleaning',
    commission: 'Commission / agent fee',
    other: 'Other',
  };
  // Papers checklist. OR/CR records which copy we have; the others are yes/no.
  const ORCR = { original: 'Original', xerox: 'Xerox' };
  const PAPERS = [
    ['orcr', 'OR/CR'],
    ['deed', 'Deed of Sale'],
    ['owner_id', 'ID with Signature of the Owner'],
  ];
  const NUMERIC = ['year', 'purchase_price', 'sale_price', 'amount', 'deposit', 'agreed_price'];
  const MAX_PHOTOS = 8;

  const ICONS = {
    motorcycle: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="16" r="3.2"/><circle cx="19" cy="16" r="3.2"/><path d="M5 16l4-6h5l2.5 6M9 10L7.5 7H5.5M14 10l2-3h2.5"/></svg>',
    car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16v-3.5L5.2 7.5h13.6L21 12.5V16zM3 12.5h18"/><circle cx="7.5" cy="16.5" r="2"/><circle cx="16.5" cy="16.5" r="2"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/><circle cx="12" cy="13.5" r="3.5"/></svg>',
  };

  // ---------- Formatting ----------

  const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });
  const pesoShort = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', notation: 'compact', maximumFractionDigits: 1 });
  const money = (n) => (n == null ? '—' : peso.format(n));
  const signed = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + peso.format(n));
  const profitClass = (n) => (n == null ? '' : n >= 0 ? 'pos' : 'neg');
  const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key] || 0), 0);
  const unitName = (u) => [u.year, u.brand, u.model].filter(Boolean).join(' ');
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / 864e5);

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
    const all = allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '';
    return all + Object.entries(map).map(([value, label]) =>
      `<option value="${value}"${String(value) === String(selected) ? ' selected' : ''}>${esc(label)}</option>`
    ).join('');
  }

  // ---------- Feedback ----------

  let toastTimer;
  function toast(message, kind, sticky) {
    toastEl.textContent = message;
    toastEl.className = 'toast show ' + (kind || 'ok');
    clearTimeout(toastTimer);
    if (!sticky) toastTimer = setTimeout(() => { toastEl.className = 'toast'; }, 3200);
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
      : o.select
        ? `<select id="${name}" name="${name}"${req} aria-describedby="${name}-error">${o.select}</select>`
        : `<input id="${name}" name="${name}" type="${o.type || 'text'}" value="${esc(value)}"${req} ${o.attrs || ''} aria-describedby="${name}-error">`;
    return `<div class="field${o.wide ? ' wide' : ''}">
      <label for="${name}">${esc(label)}${o.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
      ${control}
      <p class="error" id="${name}-error"></p>
    </div>`;
  }

  const MONEY_ATTRS = 'inputmode="decimal" step="0.01" min="0" placeholder="0.00"';

  function yearOptions(selected) {
    const top = new Date().getFullYear() + 1;
    const years = {};
    for (let y = top; y >= 1980; y--) years[y] = y;
    if (selected && !years[selected]) years[selected] = selected;
    return options(years, selected, 'Select year');
  }

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

  // ---------- Photos ----------
  // The free Spark plan has no Cloud Storage, so photos are shrunk in the browser and saved
  // as JPEG data URLs in Firestore: a full photo per doc in units/{id}/photos, plus a small
  // square `thumb` of the cover photo on the unit itself for lists.

  async function loadImage(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { /* fall back */ }
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Can’t read this photo. Use a JPG or PNG image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  function toJpeg(src, maxSide, quality, square) {
    const w = src.width;
    const h = src.height;
    let sx = 0, sy = 0, sw = w, sh = h;
    if (square) { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; }
    const scale = Math.min(1, maxSide / Math.max(sw, sh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sw * scale));
    canvas.height = Math.max(1, Math.round(sh * scale));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function processPhoto(file) {
    if (!/^image\//.test(file.type)) throw new Error(`“${file.name}” isn’t a photo.`);
    const img = await loadImage(file);
    let data = toJpeg(img, 1280, 0.72);
    if (data.length > 650000) data = toJpeg(img, 1024, 0.6);
    return { data, thumb: toJpeg(img, 128, 0.7, true) };
  }

  const unitThumb = (u, large) => (u.thumb
    ? `<span class="unit-icon photo${large ? ' lg' : ''}"><img src="${esc(u.thumb)}" alt=""></span>`
    : `<span class="unit-icon${large ? ' lg' : ''}">${ICONS[u.type]}</span>`);

  // ---------- Data ----------

  // Firestore layout: units/{id} with a running `total_expenses` and `photo_count`, plus
  // units/{id}/expenses/{id} and units/{id}/photos/{id}. Each expense or photo write
  // updates its counter on the unit in the same batch.
  let fb = null; // Firebase SDK functions, loaded in start()
  let auth = null;
  let db = null;
  let session = null;

  const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
  const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);
  const hasPaper = (u, key) => {
    const v = u.papers && u.papers[key];
    return key === 'orcr' ? Boolean(ORCR[v]) : v === true;
  };
  const papersDone = (u) => PAPERS.filter(([key]) => hasPaper(u, key)).length;
  const papersMissing = (u) => PAPERS.filter(([key]) => !hasPaper(u, key)).map(([, label]) => label);

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
      days_in_stock: daysBetween(d.purchase_date, d.sale_date || today()),
      balance: d.status === 'reserved' && d.agreed_price != null ? round2(d.agreed_price - (d.deposit || 0)) : null,
    };
  }

  const unitsCol = () => fb.collection(db, 'units');
  const unitRef = (id) => fb.doc(db, 'units', id);
  const expensesCol = (unitId) => fb.collection(db, 'units', unitId, 'expenses');
  const photosCol = (unitId) => fb.collection(db, 'units', unitId, 'photos');
  const byCreated = (a, b) => millis(a.created_at) - millis(b.created_at);

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
        a.date.localeCompare(b.date) || byCreated(a, b));
    },
    async listAllExpenses() {
      const snap = await fb.getDocs(fb.collectionGroup(db, 'expenses'));
      return snap.docs.map((d) => d.data());
    },
    async listPhotos(unitId) {
      const snap = await fb.getDocs(photosCol(unitId));
      return snap.docs.map((d) => ({ ...d.data(), id: d.id })).sort(byCreated);
    },
    async createUnit(values) {
      const ref = await fb.addDoc(unitsCol(), {
        papers: {}, ...values, status: 'in_stock', total_expenses: 0, photo_count: 0,
        created_at: fb.serverTimestamp(), created_by: session.email,
      });
      return ref.id;
    },
    updateUnit: (id, values) => fb.updateDoc(unitRef(id), values),
    async deleteUnit(id) {
      const [expenses, photos] = await Promise.all([fb.getDocs(expensesCol(id)), fb.getDocs(photosCol(id))]);
      const refs = expenses.docs.concat(photos.docs).map((d) => d.ref);
      // Photos are large, so delete in small batches to stay under the request size limit.
      for (let i = 0; i < refs.length; i += 20) {
        const batch = fb.writeBatch(db);
        refs.slice(i, i + 20).forEach((r) => batch.delete(r));
        await batch.commit();
      }
      await fb.deleteDoc(unitRef(id));
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
    async addPhoto(unitId, photo, makeCover) {
      const ref = fb.doc(photosCol(unitId));
      const batch = fb.writeBatch(db);
      batch.set(ref, { ...photo, created_at: fb.serverTimestamp(), created_by: session.email });
      const patch = { photo_count: fb.increment(1) };
      if (makeCover) Object.assign(patch, { thumb: photo.thumb, cover_id: ref.id });
      batch.update(unitRef(unitId), patch);
      await batch.commit();
      return ref.id;
    },
    deletePhoto(unitId, photo, nextCover, wasCover) {
      const batch = fb.writeBatch(db);
      batch.delete(fb.doc(db, 'units', unitId, 'photos', photo.id));
      const patch = { photo_count: fb.increment(-1) };
      if (wasCover) Object.assign(patch, nextCover ? { thumb: nextCover.thumb, cover_id: nextCover.id } : { thumb: null, cover_id: null });
      batch.update(unitRef(unitId), patch);
      return batch.commit();
    },
    setCover: (unitId, photo) => fb.updateDoc(unitRef(unitId), { thumb: photo.thumb, cover_id: photo.id }),
  };

  // Shrinks and saves photos one by one. `hasCover` says whether the unit already has a cover.
  async function uploadPhotos(unitId, files, hasCover, existing) {
    const room = MAX_PHOTOS - existing;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (files.length > list.length) toast(`Only ${MAX_PHOTOS} photos per unit. Saving the first ${list.length}.`, 'err');
    for (let i = 0; i < list.length; i++) {
      toast(`Saving photo ${i + 1} of ${list.length}…`, 'ok', true);
      const photo = await processPhoto(list[i]);
      await api.addPhoto(unitId, photo, !hasCover && i === 0);
    }
    return list.length;
  }

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
    const nav = !parts.length ? 'dashboard' : parts[0] === 'reports' ? 'reports' : parts[1] === 'new' ? 'new' : 'units';
    document.querySelectorAll('[data-nav]').forEach((a) => {
      if (a.dataset.nav === nav) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (!view.querySelector('.page')) view.innerHTML = '<p class="loading">Loading…</p>';
    try {
      if (!parts.length) await renderDashboard(token);
      else if (parts[0] === 'reports') await renderReports(token);
      else if (parts[0] !== 'units') location.hash = '#/';
      else if (parts.length === 1) await renderUnits(token);
      else if (parts[1] === 'new') await renderUnitForm(null, token);
      else if (parts[2] === 'edit') await renderUnitForm(parts[1], token);
      else await renderUnitDetail(parts[1], token);
    } catch (err) {
      console.error(err);
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

  function unitRow(u, custom) {
    const c = custom || {};
    const meta = c.meta || [u.plate_no, 'Bought ' + fmtDate(u.purchase_date)].filter(Boolean).join(' · ');
    let figures = c.figures;
    if (!figures) {
      if (u.status === 'sold') {
        figures = `<span class="fig ${profitClass(u.profit)}">${signed(u.profit)}</span>
          <span class="meta">Sold ${fmtDate(u.sale_date)}</span>`;
      } else if (u.status === 'reserved') {
        figures = `<span class="fig">${money(u.agreed_price != null ? u.agreed_price : u.total_cost)}</span>
          <span class="meta"><span class="pill reserved">Reserved</span></span>
          <span class="meta">${pesoShort.format(u.deposit || 0)} down</span>`;
      } else {
        figures = `<span class="fig">${money(u.total_cost)}</span>
          <span class="meta">${plural(u.days_in_stock, 'day')} in stock</span>`;
      }
    }
    return `<a class="unit-row" href="#/units/${u.id}">
      ${unitThumb(u)}
      <span class="unit-main">
        <strong>${esc(unitName(u))}</strong>
        <span class="meta${c.warn ? ' warn' : ''}">${esc(meta)}</span>
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

  // Unsold units with papers still missing, longest in stock first.
  function papersFollowUp(units) {
    return units
      .filter((u) => u.status !== 'sold' && papersMissing(u).length)
      .sort((a, b) => b.days_in_stock - a.days_in_stock)
      .map((u) => ({ u, meta: 'Missing: ' + papersMissing(u).join(', ') }));
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

    const unsold = units.filter((u) => u.status !== 'sold');
    const reserved = units.filter((u) => u.status === 'reserved');
    const sold = units.filter((u) => u.status === 'sold');
    const month = today().slice(0, 7);
    const soldMonth = sold.filter((u) => (u.sale_date || '').startsWith(month));
    const motos = unsold.filter((u) => u.type === 'motorcycle').length;
    const totalProfit = sum(sold, 'profit');
    const monthProfit = sum(soldMonth, 'profit');
    const monthName = new Date().toLocaleDateString('en-PH', { month: 'long' });

    const recentSales = [...sold].sort((a, b) => b.sale_date.localeCompare(a.sale_date)).slice(0, 5);
    const oldest = [...unsold].sort((a, b) => b.days_in_stock - a.days_in_stock).slice(0, 5);
    const followUp = papersFollowUp(units).slice(0, 6);
    const stockSub = [plural(motos, 'motorcycle'), plural(unsold.length - motos, 'car')]
      .concat(reserved.length ? [`${reserved.length} reserved`] : []).join(' · ');

    view.innerHTML = `<div class="page">
      <div class="page-head"><h1>Dashboard</h1></div>
      <div class="stats">
        ${stat('Units in stock', unsold.length, stockSub)}
        ${stat('Money in stock', money(sum(unsold, 'total_cost')), 'Purchase + expenses of unsold units')}
        ${stat(`Profit in ${monthName}`, signed(monthProfit), `${plural(soldMonth.length, 'unit')} sold`, profitClass(monthProfit))}
        ${stat('Total profit', signed(totalProfit), `${plural(sold.length, 'unit')} sold`, profitClass(totalProfit))}
        ${stat('Total sales', money(sum(sold, 'sale_price')))}
        ${stat('Deposits held', money(sum(reserved, 'deposit')), reserved.length ? `${plural(reserved.length, 'reserved unit')}` : 'No reservations')}
      </div>
      ${followUp.length ? `
        <section class="panel attention">
          <h2>Papers to follow up</h2>
          <div class="unit-list">${followUp.map((f) => unitRow(f.u, {
            meta: f.meta, warn: true,
            figures: `<span class="meta">${papersDone(f.u)} of ${PAPERS.length} papers done</span>`,
          })).join('')}</div>
        </section>` : ''}
      <div class="columns">
        <section class="panel">
          <h2>Recent sales</h2>
          ${recentSales.length ? `<div class="unit-list">${recentSales.map((u) => unitRow(u)).join('')}</div>` : '<p class="muted">No sales yet.</p>'}
        </section>
        <section class="panel">
          <h2>Longest in stock</h2>
          ${oldest.length ? `<div class="unit-list">${oldest.map((u) => unitRow(u)).join('')}</div>` : '<p class="muted">Everything is sold.</p>'}
        </section>
      </div>
    </div>`;
  }

  // ---------- Units list ----------

  const filters = { q: '', type: '', status: '' };

  function matches(u) {
    if (filters.type && u.type !== filters.type) return false;
    if (filters.status === 'unsold' ? u.status === 'sold' : filters.status && u.status !== filters.status) return false;
    const needle = filters.q.toLowerCase();
    if (!needle) return true;
    return [u.brand, u.model, u.plate_no, u.color, u.year, u.bought_from, u.sold_to, u.reserved_by, u.engine_no, u.chassis_no]
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
        <input type="search" id="f-q" placeholder="Search brand, model, plate, buyer…" aria-label="Search units" value="${esc(filters.q)}">
        <select id="f-type" aria-label="Filter by type">${options(TYPES, filters.type, 'All types')}</select>
        <select id="f-status" aria-label="Filter by status">${options({ unsold: 'Not sold yet', ...STATUS }, filters.status, 'All statuses')}</select>
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
        ? `${plural(shown.length, 'unit')} · cost ${money(sum(shown, 'total_cost'))}` +
          (soldShown.length ? ` · profit <span class="${profitClass(sum(soldShown, 'profit'))}">${signed(sum(soldShown, 'profit'))}</span>` : '')
        : '';
      list.innerHTML = shown.length
        ? shown.map((u) => unitRow(u)).join('')
        : `<p class="muted empty-list">${units.length ? 'No units match these filters.' : 'No units yet. Add your first one.'}</p>`;
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
      ['Plate no.', 'plate_no'], ['Engine no.', 'engine_no'], ['Chassis no.', 'chassis_no'], ['Color', 'color'],
      ['Purchase date', 'purchase_date'], ['Purchase price', 'purchase_price'], ['Bought from', 'bought_from'],
      ['Expenses', 'total_expenses'], ['Total cost', 'total_cost'], ['Status', (u) => STATUS[u.status]],
      ['Reserved by', 'reserved_by'], ['Reserved on', 'reserved_date'], ['Deposit', 'deposit'], ['Agreed price', 'agreed_price'],
      ['Sale date', 'sale_date'], ['Sale price', 'sale_price'], ['Sold to', 'sold_to'], ['Profit', 'profit'],
      ['Days in stock', 'days_in_stock'],
      ['OR/CR', (u) => ORCR[u.papers && u.papers.orcr] || ''],
      ['Deed of Sale', (u) => (hasPaper(u, 'deed') ? 'Yes' : 'No')],
      ['ID with Signature of the Owner', (u) => (hasPaper(u, 'owner_id') ? 'Yes' : 'No')],
      ['Notes', 'notes'],
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

  function saleFormHtml(unit, title) {
    return `<form id="sale-form" novalidate>
      ${title ? `<h3>${title}</h3>` : ''}
      <div class="grid-2">
        ${field('sale_price', 'Sold for (₱)', unit.agreed_price, { type: 'number', required: true, attrs: MONEY_ATTRS })}
        ${field('sale_date', 'Date sold', today(), { type: 'date', required: true })}
        ${field('sold_to', 'Sold to', unit.reserved_by, { wide: true, attrs: 'placeholder="Buyer’s name (optional)"' })}
      </div>
      <p class="preview muted" id="sale-preview" aria-live="polite">Total cost so far: ${money(unit.total_cost)}</p>
      <button class="btn" type="submit">Mark as sold</button>
    </form>`;
  }

  function reserveFormHtml() {
    return `<form id="reserve-form" novalidate>
      <div class="grid-2">
        ${field('reserved_by', 'Buyer', '', { required: true, attrs: 'placeholder="Buyer’s name"' })}
        ${field('reserved_date', 'Date reserved', today(), { type: 'date', required: true })}
        ${field('deposit', 'Deposit / down payment (₱)', '', { type: 'number', required: true, attrs: MONEY_ATTRS })}
        ${field('agreed_price', 'Agreed price (₱)', '', { type: 'number', attrs: MONEY_ATTRS })}
      </div>
      <button class="btn" type="submit">Reserve</button>
    </form>`;
  }

  function salePanelHtml(unit) {
    if (unit.status === 'sold') {
      return `<dl class="details">
          <div><dt>Sold on</dt><dd>${fmtDate(unit.sale_date)}</dd></div>
          <div><dt>Sold for</dt><dd>${money(unit.sale_price)}</dd></div>
          ${unit.sold_to ? `<div><dt>Sold to</dt><dd>${esc(unit.sold_to)}</dd></div>` : ''}
          ${unit.deposit ? `<div><dt>Deposit received</dt><dd>${money(unit.deposit)} · ${fmtDate(unit.reserved_date)}</dd></div>` : ''}
        </dl>
        <button class="btn-ghost" type="button" id="undo-sale">Undo sale (back to ${unit.reserved_by ? 'reserved' : 'in stock'})</button>`;
    }
    if (unit.status === 'reserved') {
      return `<dl class="details">
          <div><dt>Reserved by</dt><dd>${esc(unit.reserved_by)}</dd></div>
          <div><dt>Reserved on</dt><dd>${fmtDate(unit.reserved_date)}</dd></div>
          <div><dt>Deposit</dt><dd>${money(unit.deposit)}</dd></div>
          ${unit.agreed_price != null ? `
            <div><dt>Agreed price</dt><dd>${money(unit.agreed_price)}</dd></div>
            <div><dt>Balance to collect</dt><dd>${money(unit.balance)}</dd></div>` : ''}
        </dl>
        <div class="subform">${saleFormHtml(unit, 'Complete the sale')}</div>
        <button class="btn-ghost" type="button" id="cancel-reservation">Cancel reservation</button>`;
    }
    return `<div class="toggle" role="group" aria-label="Sell or reserve">
        <button type="button" class="toggle-btn" data-mode="sell" aria-pressed="true">Sell now</button>
        <button type="button" class="toggle-btn" data-mode="reserve" aria-pressed="false">Reserve with deposit</button>
      </div>
      <div data-pane="sell">${saleFormHtml(unit)}</div>
      <div data-pane="reserve" hidden>${reserveFormHtml()}</div>`;
  }

  // The saved papers of a unit, in the shape the checklist edits.
  const savedPapers = (u) => ({
    orcr: ORCR[u.papers && u.papers.orcr] ? u.papers.orcr : null,
    deed: hasPaper(u, 'deed'),
    owner_id: hasPaper(u, 'owner_id'),
  });

  // Checklist controls for the add/edit form; saved with the rest of the unit.
  function papersFieldsHtml(papers) {
    const orcr = papers.orcr || '';
    return `<ul class="checklist">
        <li class="orcr-row">
          <span class="orcr-label" id="orcr-label">OR/CR</span>
          <div class="choice" role="radiogroup" aria-labelledby="orcr-label">
            ${Object.entries({ '': 'Not yet', ...ORCR }).map(([value, label]) => `<label>
              <input type="radio" name="orcr" value="${value}"${orcr === value ? ' checked' : ''}>
              <span>${label}</span></label>`).join('')}
          </div>
        </li>
        ${PAPERS.filter(([key]) => key !== 'orcr').map(([key, label]) => `<li><label>
          <input type="checkbox" name="${key}" data-paper="${key}"${papers[key] ? ' checked' : ''}>
          <span>${esc(label)}</span></label></li>`).join('')}
      </ul>`;
  }

  const readPapers = (form) => ({
    orcr: (form.querySelector('input[name=orcr]:checked') || {}).value || null,
    deed: form.elements.deed.checked,
    owner_id: form.elements.owner_id.checked,
  });

  // Set by "Update papers" so the edit form opens scrolled to the Papers section.
  let focusPapersFor = null;

  // Read-only summary on the unit page; papers are changed in the edit form.
  function papersPanelHtml(unit) {
    const p = savedPapers(unit);
    return `<h2>Papers <span class="muted small" id="papers-count">${papersDone(unit)} of ${PAPERS.length} done</span></h2>
      <ul class="paper-status">
        ${PAPERS.map(([key, label]) => {
          const ok = hasPaper(unit, key);
          const value = key === 'orcr' ? (ORCR[p.orcr] || 'Not yet') : (ok ? 'Yes' : 'Not yet');
          return `<li class="${ok ? 'ok' : 'missing'}">
            <span class="mark" aria-hidden="true">${ok ? '✓' : '–'}</span>
            <span class="paper-name">${esc(label)}</span>
            <span class="paper-value">${value}</span></li>`;
        }).join('')}
      </ul>
      <a class="btn-secondary" href="#/units/${unit.id}/edit" id="update-papers">Update papers</a>`;
  }

  async function renderUnitDetail(id, token) {
    const [unit, expenses] = await Promise.all([api.getUnit(id), api.listExpenses(id)]);
    if (stale(token)) return;
    if (!unit) { view.innerHTML = notFound(); return; }

    const isSold = unit.status === 'sold';
    const byCategory = Object.keys(CATEGORIES)
      .map((c) => [c, sum(expenses.filter((e) => e.category === c), 'amount')])
      .filter(([, total]) => total > 0);
    const details = [
      ['Type', TYPES[unit.type]], ['Plate no.', unit.plate_no], ['Engine no.', unit.engine_no], ['Chassis no.', unit.chassis_no],
      ['Color', unit.color], ['Bought on', fmtDate(unit.purchase_date)], ['Bought from', unit.bought_from],
    ].filter(([, v]) => v);

    view.innerHTML = `<div class="page">
      <a class="back" href="#/units">← All units</a>
      <div class="page-head">
        <div class="title-row">
          ${unitThumb(unit, true)}
          <div>
            <h1>${esc(unitName(unit))}</h1>
            <div class="badges">${statusBadge(unit.status)}<span class="muted small">${plural(unit.days_in_stock, 'day')} ${isSold ? 'until sold' : 'in stock'}</span></div>
          </div>
        </div>
        <div class="actions">
          <a class="btn-secondary" href="#/units/${unit.id}/edit">Edit</a>
          <button class="btn-danger" type="button" id="delete-unit">Delete</button>
        </div>
      </div>

      <section class="panel gallery" id="gallery" aria-label="Photos">
        <p class="muted small">${unit.photo_count ? 'Loading photos…' : ''}</p>
      </section>

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
                <strong>${esc(CATEGORIES[e.category] || e.category)}</strong>
                <span class="meta">${fmtDate(e.date)}${e.description ? ' · ' + esc(e.description) : ''}</span>
              </span>
              <span class="exp-amount">${money(e.amount)}</span>
              <button class="icon-btn" type="button" data-delete-expense="${e.id}" aria-label="Delete ${esc(CATEGORIES[e.category])} expense of ${money(e.amount)}">×</button>
            </li>`).join('')}</ul>` : '<p class="muted">No expenses yet.</p>'}
          <form id="expense-form" class="subform" novalidate>
            <h3>Add expense</h3>
            <div class="grid-2">
              ${field('category', 'Category', '', { required: true, select: options(CATEGORIES, 'transport') })}
              ${field('amount', 'Amount (₱)', '', { type: 'number', required: true, attrs: MONEY_ATTRS })}
              ${field('date', 'Date', today(), { type: 'date', required: true })}
              ${field('description', 'Note', '', { attrs: 'placeholder="e.g. Change oil, LBC shipping"' })}
            </div>
            <button class="btn" type="submit">Add expense</button>
          </form>
        </section>

        <div class="stack">
          <section class="panel" id="sale-panel">
            <h2>${unit.status === 'reserved' ? 'Reservation' : 'Sale'}</h2>
            ${salePanelHtml(unit)}
          </section>
          <section class="panel" id="papers-panel">${papersPanelHtml(unit)}</section>
          <section class="panel">
            <h2>Details</h2>
            <dl class="details">${details.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
            ${unit.notes ? `<p class="notes">${esc(unit.notes)}</p>` : ''}
          </section>
        </div>
      </div>
    </div>`;

    const act = (fn, done) => async () => {
      try { await fn(); if (done) toast(done); await route(); } catch (err) { toast(friendlyError(err), 'err'); }
    };

    view.querySelector('#delete-unit').addEventListener('click', async () => {
      if (!confirm(`Delete ${unitName(unit)}? Its expenses and photos will be deleted too. This can’t be undone.`)) return;
      try {
        toast('Deleting…', 'ok', true);
        await api.deleteUnit(unit.id);
        toast('Unit deleted.');
        location.hash = '#/units';
      } catch (err) { toast(friendlyError(err), 'err'); }
    });

    view.querySelectorAll('[data-delete-expense]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!confirm('Delete this expense?')) return;
        act(() => api.deleteExpense(unit.id, expenses.find((x) => x.id === btn.dataset.deleteExpense)), 'Expense deleted.')();
      });
    });

    const expenseForm = view.querySelector('#expense-form');
    expenseForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!validate(expenseForm)) return;
      busy(expenseForm.querySelector('button[type=submit]'), act(() => api.addExpense(unit.id, formValues(expenseForm)), 'Expense added.'));
    });

    // Sell / reserve toggle for units in stock.
    view.querySelectorAll('.toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        view.querySelectorAll('.toggle-btn').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
        view.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== btn.dataset.mode; });
      });
    });

    const saleForm = view.querySelector('#sale-form');
    if (saleForm) {
      const preview = saleForm.querySelector('#sale-preview');
      const showPreview = () => {
        const input = saleForm.elements.sale_price;
        const price = Number(input.value);
        if (!input.value || Number.isNaN(price)) {
          preview.className = 'preview muted';
          preview.textContent = `Total cost so far: ${money(unit.total_cost)}`;
          return;
        }
        const profit = price - unit.total_cost;
        preview.className = 'preview ' + profitClass(profit);
        preview.textContent = `${profit >= 0 ? 'Profit' : 'Loss'} at this price: ${signed(profit)}`;
      };
      saleForm.elements.sale_price.addEventListener('input', showPreview);
      showPreview();
      saleForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const ok = validate(saleForm, {
          sale_date: (v) => (v < unit.purchase_date ? 'Can’t be before the purchase date.' : ''),
        });
        if (!ok) return;
        busy(saleForm.querySelector('button[type=submit]'),
          act(() => api.updateUnit(unit.id, { ...formValues(saleForm), status: 'sold' }), 'Marked as sold.'));
      });
    }

    const reserveForm = view.querySelector('#reserve-form');
    if (reserveForm) {
      reserveForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const ok = validate(reserveForm, {
          reserved_date: (v) => (v < unit.purchase_date ? 'Can’t be before the purchase date.' : ''),
          agreed_price: (v) => (v && Number(v) < Number(reserveForm.elements.deposit.value) ? 'Can’t be less than the deposit.' : ''),
        });
        if (!ok) return;
        busy(reserveForm.querySelector('button[type=submit]'),
          act(() => api.updateUnit(unit.id, { ...formValues(reserveForm), status: 'reserved' }), 'Unit reserved.'));
      });
    }

    const cancelRes = view.querySelector('#cancel-reservation');
    if (cancelRes) {
      cancelRes.addEventListener('click', () => {
        if (!confirm('Cancel this reservation? The unit goes back to in stock and the deposit record is cleared.')) return;
        act(() => api.updateUnit(unit.id, { status: 'in_stock', reserved_by: null, reserved_date: null, deposit: null, agreed_price: null }),
          'Reservation cancelled.')();
      });
    }

    const undo = view.querySelector('#undo-sale');
    if (undo) {
      undo.addEventListener('click', () => {
        const back = unit.reserved_by ? 'reserved' : 'in_stock';
        if (!confirm(`Undo this sale? The unit goes back to ${STATUS[back].toLowerCase()} and the sale price and date are cleared.`)) return;
        act(() => api.updateUnit(unit.id, { status: back, sale_date: null, sale_price: null, sold_to: null }), 'Sale undone.')();
      });
    }

    view.querySelector('#update-papers').addEventListener('click', () => { focusPapersFor = unit.id; });

    loadGallery(unit, token);
  }

  async function loadGallery(unit, token) {
    const box = view.querySelector('#gallery');
    let photos = [];
    try {
      photos = unit.photo_count ? await api.listPhotos(unit.id) : [];
    } catch (err) {
      if (!stale(token)) box.innerHTML = `<p class="muted small">Couldn’t load photos. ${esc(friendlyError(err))}</p>`;
      return;
    }
    if (stale(token)) return;
    let selected = photos.find((p) => p.id === unit.cover_id) || photos[0];

    const draw = () => {
      const isCover = selected && selected.id === unit.cover_id;
      box.innerHTML = `
        ${selected ? `
          <button type="button" class="gallery-main" id="photo-open" aria-label="View photo full size">
            <img src="${esc(selected.data)}" alt="Photo of ${esc(unitName(unit))}">
          </button>` : `
          <div class="gallery-empty">${ICONS.camera}<p>No photos yet. Add photos of the unit so everyone can see its condition.</p></div>`}
        ${photos.length > 1 ? `<div class="gallery-strip">${photos.map((p) => `
          <button type="button" class="gallery-thumb" data-photo="${p.id}" aria-label="Show photo" aria-pressed="${p === selected}">
            <img src="${esc(p.thumb)}" alt="">${p.id === unit.cover_id ? '<span class="cover-tag">Cover</span>' : ''}
          </button>`).join('')}</div>` : ''}
        <div class="gallery-actions">
          ${photos.length < MAX_PHOTOS ? `<label class="btn-secondary file-btn">
            ${ICONS.camera} Add photos
            <input type="file" accept="image/*" multiple id="photo-input">
          </label>` : `<span class="muted small">${MAX_PHOTOS} photos max.</span>`}
          ${selected && !isCover ? '<button type="button" class="btn-ghost" id="photo-cover">Set as cover</button>' : ''}
          ${selected ? '<button type="button" class="btn-ghost danger" id="photo-delete">Delete photo</button>' : ''}
          <span class="muted small">${photos.length} of ${MAX_PHOTOS}</span>
        </div>`;

      box.querySelectorAll('[data-photo]').forEach((b) => b.addEventListener('click', () => {
        selected = photos.find((p) => p.id === b.dataset.photo);
        draw();
      }));
      const open = box.querySelector('#photo-open');
      if (open) open.addEventListener('click', () => openLightbox(selected.data, unitName(unit)));

      const input = box.querySelector('#photo-input');
      if (input) input.addEventListener('change', async () => {
        if (!input.files.length) return;
        input.disabled = true;
        try {
          const n = await uploadPhotos(unit.id, input.files, Boolean(unit.cover_id), photos.length);
          toast(`${plural(n, 'photo')} added.`);
          await route();
        } catch (err) {
          toast(friendlyError(err), 'err');
          await route();
        }
      });

      const cover = box.querySelector('#photo-cover');
      if (cover) cover.addEventListener('click', () => busy(cover, async () => {
        try {
          await api.setCover(unit.id, selected);
          toast('Cover photo set.');
          await route();
        } catch (err) { toast(friendlyError(err), 'err'); }
      }));

      const del = box.querySelector('#photo-delete');
      if (del) del.addEventListener('click', () => {
        if (!confirm('Delete this photo?')) return;
        busy(del, async () => {
          try {
            const wasCover = selected.id === unit.cover_id;
            const next = photos.find((p) => p.id !== selected.id) || null;
            await api.deletePhoto(unit.id, selected, next, wasCover);
            toast('Photo deleted.');
            await route();
          } catch (err) { toast(friendlyError(err), 'err'); }
        });
      });
    };
    draw();
  }

  function openLightbox(src, name) {
    let dlg = document.getElementById('lightbox');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'lightbox';
      dlg.className = 'lightbox';
      dlg.innerHTML = '<button type="button" class="lightbox-close" aria-label="Close">×</button><img alt="">';
      dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.lightbox-close')) dlg.close(); });
      document.body.appendChild(dlg);
    }
    const img = dlg.querySelector('img');
    img.src = src;
    img.alt = 'Photo of ' + name;
    dlg.showModal();
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
    const showReservation = unit.status === 'reserved' || Boolean(unit.reserved_by);
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
          ${field('year', 'Year', unit.year, { select: yearOptions(unit.year) })}
          ${field('color', 'Color', unit.color)}
          ${field('plate_no', 'Plate no.', unit.plate_no, { attrs: 'autocomplete="off"' })}
          ${field('engine_no', 'Engine no.', unit.engine_no, { attrs: 'autocomplete="off"' })}
          ${field('chassis_no', 'Chassis no.', unit.chassis_no, { wide: true, attrs: 'autocomplete="off"' })}
        </div>

        ${id ? '' : `
          <h2>Photos</h2>
          <div class="photo-picker">
            <label class="btn-secondary file-btn">${ICONS.camera} Choose or take photos
              <input type="file" accept="image/*" multiple id="new-photos">
            </label>
            <p class="muted small">Up to ${MAX_PHOTOS}. The first photo becomes the cover in the list.</p>
            <div class="picker-previews" id="picker-previews"></div>
          </div>`}

        <h2>Purchase</h2>
        <div class="grid-2">
          ${field('purchase_price', 'Bought for (₱)', unit.purchase_price, { type: 'number', required: true, attrs: MONEY_ATTRS })}
          ${field('purchase_date', 'Date bought', unit.purchase_date, { type: 'date', required: true })}
          ${field('bought_from', 'Bought from', unit.bought_from, { wide: true, attrs: 'placeholder="Seller’s name (optional)"' })}
        </div>

        ${showReservation ? `
          <h2>Reservation</h2>
          <div class="grid-2">
            ${field('reserved_by', 'Buyer', unit.reserved_by, { required: true })}
            ${field('reserved_date', 'Date reserved', unit.reserved_date, { type: 'date', required: true })}
            ${field('deposit', 'Deposit / down payment (₱)', unit.deposit, { type: 'number', required: true, attrs: MONEY_ATTRS })}
            ${field('agreed_price', 'Agreed price (₱)', unit.agreed_price, { type: 'number', attrs: MONEY_ATTRS })}
          </div>` : ''}

        ${isSold ? `
          <h2>Sale</h2>
          <div class="grid-2">
            ${field('sale_price', 'Sold for (₱)', unit.sale_price, { type: 'number', required: true, attrs: MONEY_ATTRS })}
            ${field('sale_date', 'Date sold', unit.sale_date, { type: 'date', required: true })}
            ${field('sold_to', 'Sold to', unit.sold_to, { wide: true })}
          </div>` : ''}

        <h2 id="papers">Papers</h2>
        ${papersFieldsHtml(id ? savedPapers(unit) : {})}

        ${field('notes', 'Notes', unit.notes, { textarea: true })}

        <div class="form-actions">
          <button class="btn" type="submit">${id ? 'Save changes' : 'Save unit'}</button>
          <a class="btn-ghost" href="${back}">Cancel</a>
          <span class="unsaved" id="form-status" aria-live="polite"></span>
        </div>
      </form>
    </div>`;

    const form = view.querySelector('#unit-form');
    let picked = [];

    // Track unsaved changes so leaving the form asks first.
    const snapshot = () => JSON.stringify([...new FormData(form)].filter(([, v]) => typeof v === 'string'));
    const initial = snapshot();
    const isDirty = () => snapshot() !== initial || picked.length > 0;
    const status = form.querySelector('#form-status');
    const showDirty = () => { status.textContent = isDirty() ? 'Unsaved changes' : ''; };
    form.addEventListener('input', showDirty);
    form.addEventListener('change', showDirty);
    leaveGuard = () => (isDirty() ? { message: 'You have unsaved changes. Leave without saving?', discard() {} } : null);
    if (focusPapersFor === id) {
      focusPapersFor = null;
      form.querySelector('#papers').scrollIntoView({ block: 'start' });
    }
    const picker = form.querySelector('#new-photos');
    if (picker) {
      const previews = form.querySelector('#picker-previews');
      const drawPreviews = () => {
        previews.querySelectorAll('img').forEach((img) => URL.revokeObjectURL(img.src));
        previews.innerHTML = picked.map((f, i) => `<span class="picker-item">
          <img src="${URL.createObjectURL(f)}" alt="">${i === 0 ? '<span class="cover-tag">Cover</span>' : ''}
          <button type="button" class="picker-remove" data-remove="${i}" aria-label="Remove photo ${i + 1}">×</button>
        </span>`).join('');
        previews.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', () => {
          picked.splice(Number(b.dataset.remove), 1);
          drawPreviews();
        }));
      };
      picker.addEventListener('change', () => {
        picked = picked.concat(Array.from(picker.files).filter((f) => /^image\//.test(f.type))).slice(0, MAX_PHOTOS);
        picker.value = '';
        drawPreviews();
        showDirty();
      });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ok = validate(form, {
        sale_date: (v) => (v < form.elements.purchase_date.value ? 'Can’t be before the purchase date.' : ''),
        reserved_date: (v) => (v < form.elements.purchase_date.value ? 'Can’t be before the purchase date.' : ''),
      });
      if (!ok) return;
      busy(form.querySelector('button[type=submit]'), async () => {
        try {
          const values = formValues(form);
          PAPERS.forEach(([key]) => { delete values[key]; });
          values.papers = { ...((unit && unit.papers) || {}), ...readPapers(form) };
          if (id) {
            await api.updateUnit(id, values);
            leaveGuard = null;
            toast('Changes saved.');
            location.hash = '#/units/' + id;
          } else {
            const newId = await api.createUnit(values);
            leaveGuard = null;
            if (picked.length) {
              try {
                await uploadPhotos(newId, picked, false, 0);
              } catch (err) {
                toast('Unit saved, but a photo couldn’t be saved: ' + friendlyError(err), 'err');
                location.hash = '#/units/' + newId;
                return;
              }
            }
            toast('Unit saved. You can add its expenses now.');
            location.hash = '#/units/' + newId;
          }
        } catch (err) { toast(friendlyError(err), 'err'); }
      });
    });
  }

  // ---------- Reports ----------

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthLabel = (key, withYear) => MONTHS[Number(key.slice(5, 7)) - 1] + (withYear ? ' ' + key.slice(0, 4) : '');

  function monthRange(from, to) {
    const keys = [];
    let y = Number(from.slice(0, 4));
    let m = Number(from.slice(5, 7));
    const end = to.slice(0, 7);
    for (let guard = 0; guard < 600; guard++) {
      const key = `${y}-${String(m).padStart(2, '0')}`;
      keys.push(key);
      if (key >= end) break;
      m++; if (m > 12) { m = 1; y++; }
    }
    return keys;
  }

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = 10 ** Math.floor(Math.log10(raw));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // Vertical bars of profit per month. Losses go below the zero line, so polarity is
  // read from position as well as color. Hover or focus a month for its numbers.
  function drawProfitChart(box, rows) {
    const W = Math.max(280, box.clientWidth);
    const H = 240;
    const m = { t: 12, r: 4, b: 26, l: 58 };
    let max = Math.max(0, ...rows.map((r) => r.profit));
    let min = Math.min(0, ...rows.map((r) => r.profit));
    if (max === min) max = 1000;
    const step = niceStep((max - min) / 4);
    max = Math.ceil(max / step) * step;
    min = Math.floor(min / step) * step;
    const plotH = H - m.t - m.b;
    const y = (v) => m.t + ((max - v) / (max - min)) * plotH;
    const y0 = y(0);
    const band = (W - m.l - m.r) / rows.length;
    const bw = Math.max(3, Math.min(32, band - 2, band * 0.64));
    const every = Math.max(1, Math.ceil(34 / band));
    const multiYear = rows.length && rows[0].key.slice(0, 4) !== rows[rows.length - 1].key.slice(0, 4);

    let svg = '';
    for (let v = min; v <= max + step / 2; v += step) {
      svg += `<line class="${Math.abs(v) < step / 1e6 ? 'zero' : 'grid'}" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/>`;
      svg += `<text class="axis" x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${esc(pesoShort.format(v))}</text>`;
    }
    if (min < 0) svg += `<line class="zero" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>`;
    rows.forEach((r, i) => {
      const x = m.l + i * band + (band - bw) / 2;
      if (r.profit) {
        const yv = y(r.profit);
        const rad = Math.min(4, bw / 2, Math.abs(yv - y0));
        const d = r.profit > 0
          ? `M${x},${y0}V${yv + rad}Q${x},${yv} ${x + rad},${yv}H${x + bw - rad}Q${x + bw},${yv} ${x + bw},${yv + rad}V${y0}Z`
          : `M${x},${y0}V${yv - rad}Q${x},${yv} ${x + rad},${yv}H${x + bw - rad}Q${x + bw},${yv} ${x + bw},${yv - rad}V${y0}Z`;
        svg += `<path class="bar ${r.profit > 0 ? 'pos' : 'neg'}" d="${d}"/>`;
      }
      if (i % every === 0) {
        const jan = r.key.slice(5) === '01';
        svg += `<text class="axis" x="${m.l + i * band + band / 2}" y="${H - 8}" text-anchor="middle">${monthLabel(r.key)}${multiYear && (jan || i === 0) ? ' ’' + r.key.slice(2, 4) : ''}</text>`;
      }
      svg += `<rect class="hit" data-i="${i}" x="${m.l + i * band}" y="${m.t}" width="${band}" height="${plotH}" tabindex="0"
        aria-label="${esc(monthLabel(r.key, true))}: profit ${esc(signed(r.profit))}, ${plural(r.count, 'unit')} sold"/>`;
    });

    box.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Profit by month">${svg}</svg>
      <div class="chart-tip" hidden></div>`;
    const tip = box.querySelector('.chart-tip');
    const show = (rect) => {
      const r = rows[Number(rect.dataset.i)];
      box.querySelectorAll('.hit').forEach((h) => h.classList.toggle('on', h === rect));
      tip.innerHTML = `<strong>${esc(monthLabel(r.key, true))}</strong>
        <span>Profit <b class="${profitClass(r.profit)}">${esc(signed(r.profit))}</b></span>
        <span>Sales <b>${esc(money(r.sales))}</b></span>
        <span>${plural(r.count, 'unit')} sold</span>`;
      tip.hidden = false;
      const cx = Number(rect.getAttribute('x')) + band / 2;
      const left = Math.min(Math.max(cx - tip.offsetWidth / 2, 0), W - tip.offsetWidth);
      tip.style.left = left + 'px';
    };
    const hide = (rect) => { rect.classList.remove('on'); tip.hidden = true; };
    box.querySelectorAll('.hit').forEach((rect) => {
      rect.addEventListener('pointerenter', () => show(rect));
      rect.addEventListener('pointerleave', () => hide(rect));
      rect.addEventListener('focus', () => show(rect));
      rect.addEventListener('blur', () => hide(rect));
    });
  }

  let redrawChart = null;
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (redrawChart) redrawChart(); }, 150);
  });

  function groupTable(title, keyLabel, groups) {
    if (!groups.length) return '';
    return `<section class="panel">
      <h2>${title}</h2>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">${keyLabel}</th><th scope="col" class="num">Sold</th><th scope="col" class="num">Profit</th>
          <th scope="col" class="num">Avg profit</th><th scope="col" class="num">Avg days</th></tr></thead>
        <tbody>${groups.map((g) => `<tr>
          <th scope="row">${esc(g.label)}</th>
          <td class="num">${g.count}</td>
          <td class="num ${profitClass(g.profit)}">${signed(g.profit)}</td>
          <td class="num">${signed(g.profit / g.count)}</td>
          <td class="num">${Math.round(g.days / g.count)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </section>`;
  }

  function groupBy(units, keyFn, labelFn) {
    const map = new Map();
    units.forEach((u) => {
      const k = keyFn(u);
      const g = map.get(k) || { label: labelFn(u), count: 0, profit: 0, days: 0 };
      g.count++; g.profit += u.profit; g.days += u.days_in_stock;
      map.set(k, g);
    });
    return [...map.values()].sort((a, b) => b.profit - a.profit);
  }

  const reportState = { period: 'last12' };

  async function renderReports(token) {
    const [units, expenses] = await Promise.all([loadUnits(), api.listAllExpenses()]);
    if (stale(token)) return;
    const sold = units.filter((u) => u.status === 'sold');
    const years = [...new Set(sold.map((u) => u.sale_date.slice(0, 4)).concat(today().slice(0, 4)))].sort().reverse();
    const periods = { last12: 'Last 12 months' };
    years.forEach((y) => { periods[y] = y; });
    periods.all = 'All time';
    if (!periods[reportState.period]) reportState.period = 'last12';

    view.innerHTML = `<div class="page">
      <div class="page-head">
        <h1>Reports</h1>
        <select id="r-period" aria-label="Period" class="period">${options(periods, reportState.period)}</select>
      </div>
      <div id="report-body"></div>
    </div>`;
    const body = view.querySelector('#report-body');

    const draw = () => {
      const period = reportState.period;
      const now = today();
      let months;
      if (period === 'last12') {
        let y = Number(now.slice(0, 4));
        let mo = Number(now.slice(5, 7)) - 11;
        if (mo < 1) { mo += 12; y--; }
        months = monthRange(`${y}-${String(mo).padStart(2, '0')}`, now);
      } else if (period === 'all') {
        const first = sold.map((u) => u.sale_date).sort()[0] || now;
        months = monthRange(first, now);
      } else {
        months = monthRange(period + '-01', period === now.slice(0, 4) ? now : period + '-12');
      }
      const inPeriod = (date) => Boolean(date) && months.includes(date.slice(0, 7));
      const s = sold.filter((u) => inPeriod(u.sale_date));
      const profit = sum(s, 'profit');
      const cost = sum(s, 'total_cost');
      const rows = months.map((key) => {
        const inMonth = s.filter((u) => u.sale_date.startsWith(key));
        return { key, profit: round2(sum(inMonth, 'profit')), sales: sum(inMonth, 'sale_price'), count: inMonth.length };
      });
      const ranked = [...s].sort((a, b) => b.profit - a.profit);
      const exp = expenses.filter((e) => inPeriod(e.date));
      const expTotal = sum(exp, 'amount');
      const expByCat = Object.entries(CATEGORIES)
        .map(([k, label]) => ({ label, total: sum(exp.filter((e) => e.category === k), 'amount') }))
        .filter((c) => c.total > 0).sort((a, b) => b.total - a.total);
      const expMax = Math.max(1, ...expByCat.map((c) => c.total));

      body.innerHTML = `
        <div class="stats">
          ${stat('Units sold', s.length)}
          ${stat('Profit', signed(profit), null, profitClass(s.length ? profit : null))}
          ${stat('Sales', money(sum(s, 'sale_price')))}
          ${stat('Average profit', s.length ? signed(profit / s.length) : '—', 'Per unit sold', profitClass(s.length ? profit : null))}
          ${stat('Average margin', cost ? `${Math.round((profit / cost) * 1000) / 10}%` : '—', 'Profit ÷ total cost')}
          ${stat('Average days to sell', s.length ? Math.round(sum(s, 'days_in_stock') / s.length) : '—', 'From purchase to sale')}
        </div>

        <section class="panel">
          <h2>Profit by month</h2>
          ${s.length ? `<div class="chart" id="profit-chart"></div>
            <details class="table-toggle">
              <summary>View as table</summary>
              <div class="table-wrap"><table class="table">
                <thead><tr><th scope="col">Month</th><th scope="col" class="num">Units sold</th><th scope="col" class="num">Sales</th><th scope="col" class="num">Profit</th></tr></thead>
                <tbody>${rows.filter((r) => r.count).reverse().map((r) => `<tr>
                  <th scope="row">${monthLabel(r.key, true)}</th><td class="num">${r.count}</td>
                  <td class="num">${money(r.sales)}</td><td class="num ${profitClass(r.profit)}">${signed(r.profit)}</td></tr>`).join('')}</tbody>
              </table></div>
            </details>` : '<p class="muted">No units sold in this period.</p>'}
        </section>

        <div class="columns">
          ${groupTable('By type', 'Type', groupBy(s, (u) => u.type, (u) => TYPES[u.type]))}
          ${groupTable('By brand', 'Brand', groupBy(s, (u) => (u.brand || '').trim().toLowerCase(), (u) => (u.brand || '').trim()))}
        </div>

        ${s.length > 5 ? `<div class="columns">
          <section class="panel">
            <h2>Most profitable</h2>
            <div class="unit-list">${ranked.slice(0, 5).map((u) => unitRow(u)).join('')}</div>
          </section>
          <section class="panel">
            <h2>Least profitable</h2>
            <div class="unit-list">${ranked.slice(-5).reverse().map((u) => unitRow(u)).join('')}</div>
          </section>
        </div>` : s.length ? `<section class="panel">
          <h2>Profit per unit</h2>
          <div class="unit-list">${ranked.map((u) => unitRow(u)).join('')}</div>
        </section>` : ''}

        <section class="panel">
          <h2>Where expenses go <span class="muted small">${money(expTotal)} total</span></h2>
          ${expByCat.length ? `<ul class="hbars">${expByCat.map((c) => `<li>
            <span class="hbar-label">${esc(c.label)}</span>
            <span class="hbar-track"><span class="hbar-fill" style="width:${Math.max(1, (c.total / expMax) * 100)}%"></span></span>
            <span class="hbar-value">${money(c.total)} <span class="muted">${Math.round((c.total / expTotal) * 100)}%</span></span>
          </li>`).join('')}</ul>` : '<p class="muted">No expenses in this period.</p>'}
        </section>`;

      const chart = body.querySelector('#profit-chart');
      redrawChart = chart ? () => { if (chart.isConnected) drawProfitChart(chart, rows); } : null;
      if (redrawChart) redrawChart();
    };
    draw();
    view.querySelector('#r-period').addEventListener('change', (e) => { reportState.period = e.target.value; draw(); });
  }

  // ---------- Start ----------

  // A page with unsaved edits sets leaveGuard to return { message, discard } while
  // there is something to lose; navigating away asks first.
  let leaveGuard = null;
  let currentHash = location.hash;
  window.addEventListener('beforeunload', (e) => {
    if (leaveGuard && leaveGuard()) { e.preventDefault(); e.returnValue = ''; }
  });

  window.addEventListener('hashchange', () => {
    const pending = leaveGuard && leaveGuard();
    if (pending) {
      if (!confirm(pending.message)) {
        history.replaceState(null, '', currentHash || '#/'); // replaceState doesn't fire hashchange
        return;
      }
      pending.discard();
    }
    leaveGuard = null;
    currentHash = location.hash;
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
