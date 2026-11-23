/* வரவு (இந்தியன் 2 வீலர் ஸ்டாண்ட்) — Cash, PhonePe, Rent & Vehicle collection manager
   All data is stored on this device in IndexedDB (falls back to localStorage). */
(function () {
  'use strict';

  /* =========================================================
     Constants & helpers
     ========================================================= */
  const DENOMS = [500, 200, 100, 50, 20, 10, 5];
  const TA_MONTHS = ['ஜனவரி', 'பிப்ரவரி', 'மார்ச்', 'ஏப்ரல்', 'மே', 'ஜூன்', 'ஜூலை', 'ஆகஸ்ட்', 'செப்டம்பர்', 'அக்டோபர்', 'நவம்பர்', 'டிசம்பர்'];
  const TA_DAYS = ['ஞாயிறு', 'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி'];
  const TYPE_LABEL = { cash: 'ரொக்கம்', phonepe: 'PhonePe', rent: 'வாடகை', vehicle: 'வாகனம்' };
  const TYPE_ICON = { cash: '💵', phonepe: '📱', rent: '🔑', vehicle: '🚙' };
  const MODE_LABEL = { cash: 'ரொக்கம்', phonepe: 'PhonePe' };
  const TYPES = ['cash', 'phonepe', 'rent', 'vehicle'];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r2 = n => Math.round((+n || 0) * 100) / 100;
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) && n > 0 ? n : 0; };
  const int = v => { const n = parseInt(v, 10); return isFinite(n) && n > 0 ? n : 0; };
  const inr = n => (n < 0 ? '-' : '') + '₹' + Math.abs(r2(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const nIN = n => (+n || 0).toLocaleString('en-IN');
  const pad = n => String(n).padStart(2, '0');
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curMonth = () => todayStr().slice(0, 7);
  const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
  const weekOf = ds => Math.min(5, Math.ceil(+ds.slice(8, 10) / 7));
  const daysInMonth = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const weeksIn = ym => Math.ceil(daysInMonth(ym) / 7);
  const weekRange = (ym, w) => [(w - 1) * 7 + 1, w === 5 ? daysInMonth(ym) : Math.min(w * 7, daysInMonth(ym))];
  const fmtDate = ds => { if (!ds) return ''; const [y, m, d] = ds.split('-'); return `${d}-${m}-${y}`; };
  const dayName = ds => { const [y, m, d] = ds.split('-').map(Number); return TA_DAYS[new Date(y, m - 1, d).getDay()]; };
  const monthLabel = ym => { if (!isMonth(ym)) return ''; const [y, m] = ym.split('-'); return `${TA_MONTHS[+m - 1]} ${y}`; };
  const shortMon = ym => TA_MONTHS[+ym.slice(5, 7) - 1];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0);
  const byDateDesc = (a, b) => -byDate(a, b);
  const inIframe = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  /* =========================================================
     Storage (IndexedDB → localStorage → memory)
     ========================================================= */
  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  }
  function idbOpen() {
    return new Promise((res, rej) => {
      if (!('indexedDB' in window) || !window.indexedDB) return rej(new Error('no indexedDB'));
      const rq = indexedDB.open('vasool-db', 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
      rq.onblocked = () => rej(new Error('blocked'));
    });
  }
  function idbTx(db, store, mode, fn) {
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const st = t.objectStore(store);
      let out;
      const r = fn(st);
      if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('abort'));
    });
  }

  const Store = {
    mode: 'memory',
    db: null,
    records: [],
    settings: { defaultRent: 300, defaultRate: 10, lastBackup: null },
    persisted: false,
    async init() {
      try {
        this.db = await withTimeout(idbOpen(), 4000);
        this.records = (await idbTx(this.db, 'records', 'readonly', st => st.getAll())) || [];
        const s = await idbTx(this.db, 'meta', 'readonly', st => st.get('settings'));
        if (s && s.value) Object.assign(this.settings, s.value);
        this.mode = 'idb';
      } catch (e) {
        try {
          const raw = localStorage.getItem('vasool_data');
          localStorage.setItem('vasool_probe', '1'); localStorage.removeItem('vasool_probe');
          if (raw) { const d = JSON.parse(raw); this.records = d.records || []; Object.assign(this.settings, d.settings || {}); }
          this.mode = 'local';
        } catch (e2) { this.mode = 'memory'; }
      }
      try {
        if (navigator.storage && navigator.storage.persist) {
          this.persisted = (await navigator.storage.persisted()) || (await navigator.storage.persist());
        }
      } catch (e) { /* ignore */ }
    },
    _local() { try { localStorage.setItem('vasool_data', JSON.stringify({ records: this.records, settings: this.settings })); } catch (e) { toast('⚠ சேமிக்க முடியவில்லை (storage full?)'); } },
    async put(rec) {
      rec.updatedAt = Date.now();
      if (!rec.createdAt) rec.createdAt = rec.updatedAt;
      const i = this.records.findIndex(r => r.id === rec.id);
      if (i >= 0) this.records[i] = rec; else this.records.push(rec);
      if (this.mode === 'idb') await idbTx(this.db, 'records', 'readwrite', st => st.put(rec));
      else if (this.mode === 'local') this._local();
    },
    async del(id) {
      this.records = this.records.filter(r => r.id !== id);
      if (this.mode === 'idb') await idbTx(this.db, 'records', 'readwrite', st => st.delete(id));
      else if (this.mode === 'local') this._local();
    },
    async replaceAll(recs) {
      this.records = recs.slice();
      if (this.mode === 'idb') {
        await idbTx(this.db, 'records', 'readwrite', st => { st.clear(); recs.forEach(r => st.put(r)); return null; });
      } else if (this.mode === 'local') this._local();
    },
    async saveSettings() {
      if (this.mode === 'idb') await idbTx(this.db, 'meta', 'readwrite', st => st.put({ key: 'settings', value: this.settings }));
      else if (this.mode === 'local') this._local();
    },
    find(id) { return this.records.find(r => r.id === id); }
  };

  /* =========================================================
     Calculations
     ========================================================= */
  function inMonth(ym) { return Store.records.filter(r => r.date && r.date.startsWith(ym)); }
  function inWeek(ym, w) { return inMonth(ym).filter(r => weekOf(r.date) === w); }
  function onDate(ds) { return Store.records.filter(r => r.date === ds); }

  function vehicleTrips(r) { return r.vehicles * (r.multiply ? (r.days || 1) : 1); }

  /* One function computes every total, so the same rupee is never added twice.
     Grand total = Cash count + PhonePe entries + Rent received + Vehicle collection.
     Breakdown by how money came in: Cash in hand = Cash count + rent paid in cash + vehicle paid in cash;
     PhonePe total = PhonePe entries + rent paid by PhonePe + vehicle paid by PhonePe.
     Cash in hand + PhonePe total always equals the Grand total. */
  function summarize(recs) {
    const s = {
      cash: 0, cashCounts: 0, notes: 0, denoms: {},
      phonepe: 0, phonepeCount: 0,
      rent: 0, rentCount: 0, rentCash: 0, rentPP: 0,
      vehicles: 0, vehicleAmt: 0, vehicleCount: 0, vehCash: 0, vehPP: 0, vehDays: 0,
      dates: new Set()
    };
    DENOMS.forEach(d => { s.denoms[d] = 0; });
    for (const r of recs) {
      if (r.date) s.dates.add(r.date);
      if (r.type === 'cash') {
        s.cash += r.amount; s.cashCounts++; s.notes += r.count || 0;
        DENOMS.forEach(d => { s.denoms[d] += int(r.notes && r.notes[d]); });
      } else if (r.type === 'phonepe') {
        s.phonepe += r.amount; s.phonepeCount++;
      } else if (r.type === 'rent') {
        s.rent += r.amount; s.rentCount++;
        if (r.mode === 'phonepe') s.rentPP += r.amount; else s.rentCash += r.amount;
      } else if (r.type === 'vehicle') {
        s.vehicles += vehicleTrips(r); s.vehicleAmt += r.amount; s.vehicleCount++; s.vehDays += r.days || 1;
        if (r.mode === 'phonepe') s.vehPP += r.amount; else s.vehCash += r.amount;
      }
    }
    ['cash', 'phonepe', 'rent', 'rentCash', 'rentPP', 'vehicleAmt', 'vehCash', 'vehPP'].forEach(k => { s[k] = r2(s[k]); });
    s.grand = r2(s.cash + s.phonepe + s.rent + s.vehicleAmt);
    s.cashInHand = r2(s.cash + s.rentCash + s.vehCash);
    s.ppAll = r2(s.phonepe + s.rentPP + s.vehPP);
    s.workingDays = s.dates.size;
    return s;
  }

  /* Rent: pending is tracked per rent-month and per name (house / vehicle / person). */
  const rentKey = r => (r.month || '') + '|' + (r.name || '').trim().toLowerCase();
  function rentEntryPending(rec) {
    const same = Store.records.filter(r => r.type === 'rent' && rentKey(r) === rentKey(rec)).sort(byDate);
    let cum = 0;
    for (const r of same) { cum += r.amount; if (r.id === rec.id) return r2(rec.rent - cum); }
    return r2(rec.rent - rec.amount);
  }
  function rentStatus(ym) {
    const groups = new Map();
    Store.records.filter(r => r.type === 'rent' && r.month === ym).sort(byDate).forEach(r => {
      const key = (r.name || '').trim().toLowerCase();
      const g = groups.get(key) || { name: (r.name || '').trim() || '—', rent: 0, received: 0, count: 0, last: '' };
      g.rent = r.rent; g.received = r2(g.received + r.amount); g.count++; g.last = r.date;
      groups.set(key, g);
    });
    const list = Array.from(groups.values()).map(g => Object.assign(g, { pending: r2(g.rent - g.received) }));
    const tot = list.reduce((a, g) => ({ rent: a.rent + g.rent, received: a.received + g.received, pending: a.pending + Math.max(0, g.pending) }), { rent: 0, received: 0, pending: 0 });
    return { list, tot };
  }
  const pendTxt = p => p > 0 ? `நிலுவை ${inr(p)}` : p < 0 ? `கூடுதல் ${inr(-p)}` : 'முழுவதும் பெறப்பட்டது ✓';

  /* =========================================================
     UI helpers: toast, modal, downloads
     ========================================================= */
  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.add('hidden'), 2600);
  }
  function ask(title, bodyHTML, buttons) {
    return new Promise(res => {
      const m = $('#modal');
      $('#modalTitle').textContent = title;
      $('#modalBody').innerHTML = bodyHTML || '';
      const bx = $('#modalBtns'); bx.innerHTML = '';
      const close = v => { m.classList.add('hidden'); m.onclick = null; res(v); };
      buttons.forEach(b => {
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'btn block ' + (b.cls || ''); el.textContent = b.label;
        el.onclick = () => close(b.value);
        bx.appendChild(el);
      });
      m.onclick = e => { if (e.target === m) close(null); };
      m.classList.remove('hidden');
    });
  }

  let claudeDownloads = null;
  async function saveFile(filename, blob) {
    if (claudeDownloads) {
      try { await claudeDownloads.save({ filename, data: blob }); toast('✓ கோப்பு சேமிக்கப்பட்டது'); return true; }
      catch (e) { if (e && e.code === 'declined') return false; }
    }
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.rel = 'noopener';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 5000);
      toast('✓ பதிவிறக்கம்: ' + filename);
      return true;
    } catch (e) { toast('பதிவிறக்க முடியவில்லை'); return false; }
  }

  /* =========================================================
     App state & router
     ========================================================= */
  const S = {
    view: 'home',
    month: curMonth(),
    edit: null,                     // { type, id } while editing a record
    weekSel: null,
    cashDraft: null,
    forms: {},                      // remembers the date chosen in each form
    hist: { type: '', month: curMonth(), week: '', date: '', q: '' }
  };
  const VIEWS = ['home', 'cash', 'phonepe', 'rent', 'vehicle', 'weeks', 'report', 'history', 'backup'];
  const RENDER = {};

  function route() {
    let v = (location.hash || '#home').slice(1);
    if (!VIEWS.includes(v)) v = 'home';
    if (S.edit && S.edit.type !== v) S.edit = null;
    const changed = S.view !== v;
    S.view = v;
    $$('.view').forEach(x => x.classList.toggle('active', x.id === 'view-' + v));
    const navKey = TYPES.includes(v) ? 'entry' : v;
    $$('.bottomnav a').forEach(a => a.classList.toggle('on', a.dataset.nav === navKey));
    const entryLink = $('.bottomnav a[data-nav="entry"]');
    if (TYPES.includes(v)) entryLink.setAttribute('href', '#' + v);
    RENDER[v]();
    if (changed) window.scrollTo(0, 0);
  }
  function refresh() { RENDER[S.view](); }
  function go(v) { if (('#' + v) === location.hash) route(); else location.hash = v; }

  /* =========================================================
     Shared fragments
     ========================================================= */
  function segHTML(active) {
    return `<div class="seg">${TYPES.map(t => `<a href="#${t}" class="t-${t} ${t === active ? 'on' : ''}">${TYPE_ICON[t]} ${TYPE_LABEL[t]}</a>`).join('')}</div>`;
  }
  function editBarHTML(rec) {
    return rec ? `<div class="editing-bar">✏️ திருத்துகிறது: ${fmtDate(rec.date)} — ${inr(rec.amount)} <span class="spacer"></span>
      <button type="button" class="btn sm ghost" data-act="cancel-edit">ரத்து</button></div>` : '';
  }
  function modeRadio(name, val) {
    return `<div class="radio-row">
      <label><input type="radio" name="${name}" value="cash" ${val !== 'phonepe' ? 'checked' : ''}> 💵 ரொக்கம்</label>
      <label><input type="radio" name="${name}" value="phonepe" ${val === 'phonepe' ? 'checked' : ''}> 📱 PhonePe</label></div>`;
  }
  function itemDetail(r) {
    switch (r.type) {
      case 'cash': {
        const parts = DENOMS.filter(d => int(r.notes && r.notes[d])).map(d => `₹${d}×${r.notes[d]}`);
        return `${parts.join(', ') || '—'} · ${nIN(r.count)} நோட்டுகள்`;
      }
      case 'phonepe': return '';
      case 'rent': {
        const p = rentEntryPending(r);
        return `${r.name ? esc(r.name) + ' · ' : ''}${monthLabel(r.month)} வாடகை ${inr(r.rent)} · ${pendTxt(p)} · ${MODE_LABEL[r.mode] || 'ரொக்கம்'}`;
      }
      case 'vehicle':
        return `${nIN(r.vehicles)} வாகனம் × ${inr(r.rate)}${r.multiply ? ` × ${r.days} நாள்` : ''} · ${r.days || 1} நாள் · ${MODE_LABEL[r.mode] || 'ரொக்கம்'}`;
    }
    return '';
  }
  function itemHTML(r, showDate) {
    const det = itemDetail(r);
    return `<div class="item">
      <div class="top"><span class="chip ${r.type}">${TYPE_ICON[r.type]} ${TYPE_LABEL[r.type]}</span>
        ${showDate ? `<span class="small muted">${fmtDate(r.date)}</span>` : ''}</div>
      <div class="amt num">${inr(r.amount)}</div>
      ${det ? `<div class="det">${det}</div>` : ''}
      ${r.note ? `<div class="det">📝 ${esc(r.note)}</div>` : ''}
      <div class="acts">
        <button type="button" class="btn sm ghost" data-act="edit" data-id="${esc(r.id)}">✏️ திருத்து</button>
        <button type="button" class="btn sm danger" data-act="del" data-id="${esc(r.id)}">🗑 நீக்கு</button>
      </div></div>`;
  }
  function listHTML(recs, showDate, emptyMsg) {
    if (!recs.length) return `<div class="empty">${emptyMsg || 'பதிவுகள் இல்லை'}</div>`;
    return `<div class="list">${recs.map(r => itemHTML(r, showDate)).join('')}</div>`;
  }
  function monthPicker(id, val) { return `<input type="month" id="${id}" value="${val}">`; }
  const formDate = type => (S.forms[type] && isDate(S.forms[type])) ? S.forms[type] : todayStr();

  /* =========================================================
     1. DASHBOARD
     ========================================================= */
  RENDER.home = function () {
    const ym = S.month;
    const recs = inMonth(ym);
    const s = summarize(recs);
    const today = todayStr();
    const ts = summarize(onDate(today));
    const nW = weeksIn(ym);
    const weeks = [];
    for (let w = 1; w <= nW; w++) weeks.push({ w, s: summarize(recs.filter(r => weekOf(r.date) === w)) });
    const isCur = ym === curMonth();
    let curW = isCur ? weekOf(today) : 0;
    if (!curW) { const withData = weeks.filter(x => x.s.grand > 0); curW = withData.length ? withData[withData.length - 1].w : 1; }
    const curWeek = weeks.find(x => x.w === curW) || weeks[0];
    const maxW = Math.max(1, ...weeks.map(x => x.s.grand));
    const [ws, we] = weekRange(ym, curW);
    const rs = rentStatus(ym);
    const last = Store.settings.lastBackup;
    const daysSince = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const needBackup = Store.records.length > 0 && (daysSince === null || daysSince >= 7);
    const recent = Store.records.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 5);

    $('#view-home').innerHTML = `
      <div class="hero">
        <div class="month-pick"><span class="lbl">மாதம்:</span>${monthPicker('homeMonth', ym)}</div>
        <div class="lbl">மாத மொத்த வசூல் (Monthly Grand Total)</div>
        <div class="big num">${inr(s.grand)}</div>
        <div class="split">
          <div>💵 கையில் ரொக்கம்<b class="num">${inr(s.cashInHand)}</b></div>
          <div>📱 மொத்த PhonePe<b class="num">${inr(s.ppAll)}</b></div>
        </div>
      </div>

      <div class="quick">
        <a href="#cash" class="cash"><span class="qi">💵</span>ரொக்கம்</a>
        <a href="#phonepe" class="phonepe"><span class="qi">📱</span>PhonePe</a>
        <a href="#rent" class="rent"><span class="qi">🔑</span>வாடகை</a>
        <a href="#vehicle" class="vehicle"><span class="qi">🚙</span>வாகனம்</a>
      </div>

      ${needBackup ? `<div class="card" style="border-color:#f0d58a;background:#fffaf0">
        <b>💾 Backup எடுக்கவும்</b>
        <div class="small muted">${last ? daysSince + ' நாட்களுக்கு முன் கடைசி backup.' : 'இதுவரை backup எடுக்கவில்லை.'} போன் மாறினாலோ, browser data அழிந்தாலோ பதிவுகளைத் திரும்பப் பெற backup அவசியம்.</div>
        <div class="btn-row"><button type="button" class="btn sm primary" data-act="backup-now">இப்போது Backup</button></div></div>` : ''}

      <div class="stats">
        <a href="#cash" class="stat cash"><div class="k">💵 மொத்த ரொக்க வசூல்</div><div class="v num">${inr(s.cash)}</div><div class="s">${nIN(s.notes)} நோட்டுகள் · ${s.cashCounts} எண்ணிக்கை</div></a>
        <a href="#phonepe" class="stat phonepe"><div class="k">📱 மொத்த PhonePe</div><div class="v num">${inr(s.phonepe)}</div><div class="s">${s.phonepeCount} பதிவுகள்</div></a>
        <a href="#rent" class="stat rent"><div class="k">🔑 மாத வாடகை வசூல்</div><div class="v num">${inr(s.rent)}</div><div class="s">${rs.tot.pending > 0 ? 'நிலுவை ' + inr(rs.tot.pending) : s.rentCount + ' பதிவுகள்'}</div></a>
        <a href="#vehicle" class="stat trips"><div class="k">🚙 மொத்த வாகன எண்ணிக்கை</div><div class="v num">${nIN(s.vehicles)}</div><div class="s">${s.vehicleCount} பதிவுகள்</div></a>
        <a href="#vehicle" class="stat vehicle"><div class="k">🚙 மொத்த வாகன வசூல்</div><div class="v num">${inr(s.vehicleAmt)}</div><div class="s">${nIN(s.vehicles)} × கட்டணம்</div></a>
        <a href="#weeks" class="stat week"><div class="k">📁 வார வசூல் — வாரம் ${curW}</div><div class="v num">${inr(curWeek.s.grand)}</div><div class="s">${ws}–${we} ${shortMon(ym)}</div></a>
        <div class="stat wide" style="--c:#c8161d">
          <div class="k">📅 இன்று (${fmtDate(today)}, ${dayName(today)})</div>
          <div class="v num">${inr(ts.grand)}</div>
          <div class="s">ரொக்கம் ${inr(ts.cash)} · PhonePe ${inr(ts.phonepe)} · வாடகை ${inr(ts.rent)} · வாகனம் ${inr(ts.vehicleAmt)}</div>
        </div>
      </div>

      <div class="card weekbars">
        <div class="row"><b>வாரவாரியான வசூல் — ${monthLabel(ym)}</b><span class="spacer"></span><a class="small" href="#weeks">விவரம் →</a></div>
        ${weeks.map(x => { const [a, b] = weekRange(ym, x.w); return `<div class="wb ${x.w === curW && isCur ? 'cur' : ''}"><span>வாரம் ${x.w}<br><span class="small muted">${a}–${b}</span></span><div class="bar"><i style="width:${Math.round(x.s.grand / maxW * 100)}%"></i></div><span class="num">${inr(x.s.grand)}</span></div>`; }).join('')}
      </div>

      <h3 class="sec">சமீபத்திய பதிவுகள்</h3>
      ${listHTML(recent, true, 'இன்னும் பதிவுகள் இல்லை. மேலே உள்ள பொத்தான்களில் ஒன்றைத் தொட்டு தொடங்கவும்.')}
    `;
    $('#homeMonth').onchange = e => { if (isMonth(e.target.value)) { S.month = e.target.value; refresh(); } };
  };

  /* =========================================================
     2. CASH NOTES CALCULATOR
     ========================================================= */
  RENDER.cash = function () {
    const ed = S.edit && S.edit.type === 'cash' ? Store.find(S.edit.id) : null;
    const d = ed || S.cashDraft || { date: formDate('cash'), notes: {}, note: '' };
    $('#view-cash').innerHTML = `
      ${segHTML('cash')}
      ${editBarHTML(ed)}
      <div class="card">
        <h2 class="title">💵 ரொக்க நோட்டு கணக்கீடு</h2>
        <div class="field"><label class="f" for="cDate">தேதி (Date)</label><input type="date" id="cDate" value="${d.date}"></div>
        <table class="notes">
          ${DENOMS.map(dn => `<tr>
            <td class="den">₹${dn}</td><td class="x">×</td>
            <td><div class="stepper">
              <button type="button" data-step="-1" data-den="${dn}" aria-label="குறை">−</button>
              <input type="number" inputmode="numeric" min="0" step="1" id="n${dn}" data-den="${dn}" value="${int(d.notes[dn]) || ''}" placeholder="0" aria-label="₹${dn} நோட்டுகள்">
              <button type="button" data-step="1" data-den="${dn}" aria-label="கூட்டு">+</button>
            </div></td>
            <td class="amt num" id="a${dn}">₹0</td></tr>`).join('')}
        </table>
        <div class="totbox">
          <div><span>மொத்த நோட்டுகள்</span><b class="num" id="cCount">0</b></div>
          <div class="main"><span>மொத்த ரொக்கம்</span><b class="num" id="cTotal">₹0</b></div>
        </div>
        <div class="field"><label class="f" for="cNote">குறிப்பு (Notes)</label><input type="text" id="cNote" value="${esc(d.note || '')}" placeholder="விருப்பம்"></div>
        <div class="btn-row">
          <button type="button" class="btn ghost" id="cClear">🧹 அழி</button>
          <button type="button" class="btn primary" id="cSave">💾 ${ed ? 'புதுப்பி' : 'சேமி'}</button>
        </div>
        <div class="explain">ரொக்க எண்ணிக்கையில் கடை / தினசரி ரொக்க வசூலை மட்டும் சேர்க்கவும். வாடகை, வாகனப் பணம் அவற்றின் பகுதிகளில் தனியாகப் பதிவு செய்யுங்கள் — அப்போது ஒரே தொகை இரண்டு முறை கணக்கில் வராது.</div>
      </div>
      <h3 class="sec" id="cListTitle"></h3>
      <div id="cList"></div>`;

    const calc = () => {
      let total = 0, count = 0;
      DENOMS.forEach(dn => {
        const n = int($('#n' + dn).value);
        $('#a' + dn).textContent = inr(n * dn);
        total += n * dn; count += n;
      });
      $('#cCount').textContent = nIN(count);
      $('#cTotal').textContent = inr(total);
      return { total, count };
    };
    const draft = () => {
      if (ed) return;
      const notes = {}; DENOMS.forEach(dn => { const n = int($('#n' + dn).value); if (n) notes[dn] = n; });
      S.cashDraft = { date: $('#cDate').value, notes, note: $('#cNote').value };
    };
    const showList = () => {
      const ds = $('#cDate').value;
      const recs = Store.records.filter(r => r.type === 'cash' && r.date === ds).sort(byDate);
      const mon = summarize(inMonth((ds || todayStr()).slice(0, 7)).filter(r => r.type === 'cash'));
      $('#cListTitle').textContent = `சேமித்த ரொக்க எண்ணிக்கை — ${fmtDate(ds)}`;
      $('#cList').innerHTML = listHTML(recs, false, 'இந்த தேதிக்கு ரொக்க பதிவு இல்லை') +
        `<div class="sum-line"><span>இந்த மாத மொத்த ரொக்கம்</span><span class="num">${inr(mon.cash)}</span></div>`;
    };
    $$('#view-cash .stepper input').forEach(i => i.addEventListener('input', () => { calc(); draft(); }));
    $$('#view-cash [data-step]').forEach(b => b.addEventListener('click', () => {
      const i = $('#n' + b.dataset.den);
      i.value = Math.max(0, int(i.value) + (+b.dataset.step)) || '';
      calc(); draft();
    }));
    $('#cDate').addEventListener('change', () => { S.forms.cash = $('#cDate').value; draft(); showList(); });
    $('#cNote').addEventListener('input', draft);
    $('#cClear').onclick = () => { DENOMS.forEach(dn => { $('#n' + dn).value = ''; }); $('#cNote').value = ''; S.cashDraft = null; calc(); };
    $('#cSave').onclick = async () => {
      const ds = $('#cDate').value;
      if (!isDate(ds)) return toast('தேதியைத் தேர்ந்தெடுக்கவும்');
      const { total, count } = calc();
      if (total <= 0) return toast('குறைந்தது ஒரு நோட்டு எண்ணிக்கையை உள்ளிடவும்');
      const notes = {}; DENOMS.forEach(dn => { const n = int($('#n' + dn).value); if (n) notes[dn] = n; });
      const others = Store.records.filter(r => r.type === 'cash' && r.date === ds && (!ed || r.id !== ed.id));
      let replace = false;
      if (others.length) {
        const oTot = others.reduce((a, r) => a + r.amount, 0);
        const ans = await ask('இந்த தேதிக்கு ஏற்கனவே ரொக்க எண்ணிக்கை உள்ளது',
          `${fmtDate(ds)} அன்று ${others.length} எண்ணிக்கை (${inr(oTot)}) சேமிக்கப்பட்டுள்ளது.<br><br>
           <b>மாற்று</b> — பழையதை நீக்கி இந்த எண்ணிக்கையை மட்டும் வைக்கும் (அதே பணத்தை மீண்டும் எண்ணினால் இதைத் தேர்ந்தெடுக்கவும்).<br>
           <b>தனியாகச் சேர்</b> — இது புதிய பணம் என்றால் மட்டும்.`,
          [{ label: '🔁 பழையதை மாற்று', value: 'replace', cls: 'primary' }, { label: '➕ தனியாகச் சேர்', value: 'add' }, { label: 'ரத்து', value: null, cls: 'ghost' }]);
        if (!ans) return;
        replace = ans === 'replace';
      }
      const rec = Object.assign(ed ? Object.assign({}, ed) : { id: uid(), type: 'cash' },
        { date: ds, notes, count, amount: r2(total), note: $('#cNote').value.trim() });
      try {
        if (replace) for (const o of others) await Store.del(o.id);
        await Store.put(rec);
      } catch (e) { return toast('⚠ சேமிப்பில் பிழை: ' + e.message); }
      S.forms.cash = ds; S.cashDraft = null; S.edit = null;
      toast(`✓ ரொக்கம் ${inr(total)} சேமிக்கப்பட்டது`);
      refresh();
    };
    calc(); showList();
  };

  /* =========================================================
     3. PHONEPE
     ========================================================= */
  RENDER.phonepe = function () {
    const ed = S.edit && S.edit.type === 'phonepe' ? Store.find(S.edit.id) : null;
    const d = ed || { date: formDate('phonepe'), amount: '', note: '' };
    $('#view-phonepe').innerHTML = `
      ${segHTML('phonepe')}
      ${editBarHTML(ed)}
      <div class="card">
        <h2 class="title">📱 PhonePe வசூல்</h2>
        <div class="field"><label class="f" for="pDate">தேதி (Date)</label><input type="date" id="pDate" value="${d.date}"></div>
        <div class="field"><label class="f" for="pAmt">PhonePe தொகை (₹)</label><input type="number" inputmode="decimal" min="0" step="any" id="pAmt" value="${d.amount || ''}" placeholder="0"></div>
        <div class="field"><label class="f" for="pNote">பரிவர்த்தனை விவரம் / குறிப்பு</label><input type="text" id="pNote" value="${esc(d.note || '')}" placeholder="எ.கா. UTR / பெயர் / பொருள்"></div>
        <div class="btn-row"><button type="button" class="btn primary" id="pSave">💾 ${ed ? 'புதுப்பி' : 'சேமி'}</button></div>
      </div>
      <h3 class="sec" id="pListTitle"></h3>
      <div id="pList"></div>`;
    const showList = () => {
      const ds = $('#pDate').value;
      const recs = Store.records.filter(r => r.type === 'phonepe' && r.date === ds).sort(byDate);
      const dayTot = recs.reduce((a, r) => a + r.amount, 0);
      const mon = summarize(inMonth((ds || todayStr()).slice(0, 7)).filter(r => r.type === 'phonepe'));
      $('#pListTitle').textContent = `PhonePe பதிவுகள் — ${fmtDate(ds)}`;
      $('#pList').innerHTML = listHTML(recs, false, 'இந்த தேதிக்கு PhonePe பதிவு இல்லை') +
        `<div class="sum-line"><span>இன்றைய PhonePe மொத்தம் (${recs.length})</span><span class="num">${inr(dayTot)}</span></div>
         <div class="sum-line"><span>இந்த மாத PhonePe மொத்தம்</span><span class="num">${inr(mon.phonepe)}</span></div>`;
    };
    $('#pDate').addEventListener('change', () => { S.forms.phonepe = $('#pDate').value; showList(); });
    $('#pSave').onclick = async () => {
      const ds = $('#pDate').value, amt = num($('#pAmt').value);
      if (!isDate(ds)) return toast('தேதியைத் தேர்ந்தெடுக்கவும்');
      if (amt <= 0) return toast('தொகையை உள்ளிடவும்');
      const rec = Object.assign(ed ? Object.assign({}, ed) : { id: uid(), type: 'phonepe' }, { date: ds, amount: r2(amt), note: $('#pNote').value.trim() });
      try { await Store.put(rec); } catch (e) { return toast('⚠ சேமிப்பில் பிழை: ' + e.message); }
      S.forms.phonepe = ds; S.edit = null;
      toast(`✓ PhonePe ${inr(amt)} சேமிக்கப்பட்டது`);
      refresh();
      setTimeout(() => { const i = $('#pAmt'); if (i) i.focus(); }, 50);
    };
    showList();
  };

  /* =========================================================
     4. MONTHLY RENT
     ========================================================= */
  RENDER.rent = function () {
    const ed = S.edit && S.edit.type === 'rent' ? Store.find(S.edit.id) : null;
    const date = ed ? ed.date : formDate('rent');
    const d = ed || { date, month: (S.forms.rentMonth && isMonth(S.forms.rentMonth)) ? S.forms.rentMonth : date.slice(0, 7), name: S.forms.rentName || '', rent: '', amount: '', mode: 'cash', note: '' };
    const names = Array.from(new Set(Store.records.filter(r => r.type === 'rent' && r.name).map(r => r.name.trim()))).sort();
    $('#view-rent').innerHTML = `
      ${segHTML('rent')}
      ${editBarHTML(ed)}
      <div class="card">
        <h2 class="title">🔑 மாத வாடகை வசூல்</h2>
        <div class="field"><label class="f" for="rName">வீடு / வாகனம் / நபர் பெயர் (விருப்பம்)</label>
          <input type="text" id="rName" list="rNames" value="${esc(d.name || '')}" placeholder="எ.கா. கீழ் வீடு, ராஜா">
          <datalist id="rNames">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>
        <div class="grid2">
          <div class="field"><label class="f" for="rMonth">வாடகை மாதம்</label><input type="month" id="rMonth" value="${d.month}"></div>
          <div class="field"><label class="f" for="rDate">பெற்ற தேதி</label><input type="date" id="rDate" value="${d.date}"></div>
        </div>
        <div class="grid2">
          <div class="field"><label class="f" for="rRent">மாத வாடகை (₹)</label><input type="number" inputmode="decimal" min="0" step="any" id="rRent" value="${d.rent || ''}" placeholder="${Store.settings.defaultRent}"></div>
          <div class="field"><label class="f" for="rAmt">பெற்ற தொகை (₹)</label><input type="number" inputmode="decimal" min="0" step="any" id="rAmt" value="${d.amount || ''}" placeholder="0"></div>
        </div>
        <div class="field"><label class="f">பணம் வந்த வழி</label>${modeRadio('rMode', d.mode)}</div>
        <div class="calc-out rent" id="rOut"></div>
        <div class="field"><label class="f" for="rNote">குறிப்பு</label><input type="text" id="rNote" value="${esc(d.note || '')}" placeholder="விருப்பம்"></div>
        <div class="btn-row"><button type="button" class="btn primary" id="rSave">💾 ${ed ? 'புதுப்பி' : 'சேமி'}</button></div>
      </div>
      <h3 class="sec" id="rStatTitle"></h3>
      <div id="rStatus"></div>
      <h3 class="sec" id="rListTitle"></h3>
      <div id="rList"></div>`;

    const defaultRentFor = (name, month) => {
      const prev = Store.records.filter(r => r.type === 'rent' && (r.name || '').trim().toLowerCase() === name.trim().toLowerCase()).sort(byDate);
      const sameMonth = prev.filter(r => r.month === month);
      if (sameMonth.length) return sameMonth[sameMonth.length - 1].rent;
      if (prev.length) return prev[prev.length - 1].rent;
      return Store.settings.defaultRent;
    };
    const rentVal = () => num($('#rRent').value) || defaultRentFor($('#rName').value, $('#rMonth').value);
    const calc = () => {
      const name = $('#rName').value, month = $('#rMonth').value;
      const rent = rentVal(), amt = num($('#rAmt').value);
      const key = month + '|' + name.trim().toLowerCase();
      const prior = r2(Store.records.filter(r => r.type === 'rent' && rentKey(r) === key && (!ed || r.id !== ed.id)).reduce((a, r) => a + r.amount, 0));
      const pending = r2(rent - prior - amt);
      $('#rOut').innerHTML = `மாத வாடகை <b class="num" style="font-size:16px">${inr(rent)}</b>
        ${prior ? ` − முன்பு பெற்றது <b class="num" style="font-size:16px">${inr(prior)}</b>` : ''}
        − இப்போது <b class="num" style="font-size:16px">${inr(amt)}</b><br>
        ${pending >= 0 ? 'நிலுவைத் தொகை (Pending)' : 'கூடுதலாகப் பெற்றது'}: <b class="num">${inr(Math.abs(pending))}</b>`;
      return { rent, amt, pending };
    };
    const showLists = () => {
      const month = isMonth($('#rMonth').value) ? $('#rMonth').value : curMonth();
      const st = rentStatus(month);
      $('#rStatTitle').textContent = `வாடகை நிலை — ${monthLabel(month)}`;
      $('#rStatus').innerHTML = st.list.length ? `<div class="card tbl-wrap"><table class="t">
        <tr><th>பெயர்</th><th class="r">வாடகை</th><th class="r">பெற்றது</th><th class="r">நிலுவை</th></tr>
        ${st.list.map(g => `<tr><td>${esc(g.name)}</td><td class="r num">${inr(g.rent)}</td><td class="r num">${inr(g.received)}</td><td class="r num">${g.pending > 0 ? inr(g.pending) : g.pending < 0 ? '+' + inr(-g.pending) : '✓'}</td></tr>`).join('')}
        <tr class="tot"><td>மொத்தம்</td><td class="r num">${inr(st.tot.rent)}</td><td class="r num">${inr(st.tot.received)}</td><td class="r num">${inr(st.tot.pending)}</td></tr>
        </table></div>` : `<div class="empty">இந்த மாதத்திற்கு வாடகை பதிவு இல்லை</div>`;
      const recs = Store.records.filter(r => r.type === 'rent' && r.month === month).sort(byDateDesc);
      $('#rListTitle').textContent = `வாடகை பதிவுகள் — ${monthLabel(month)}`;
      $('#rList').innerHTML = listHTML(recs, true, 'பதிவுகள் இல்லை');
    };
    ['rName', 'rRent', 'rAmt'].forEach(id => $('#' + id).addEventListener('input', calc));
    $('#rMonth').addEventListener('change', () => { S.forms.rentMonth = $('#rMonth').value; calc(); showLists(); });
    $('#rDate').addEventListener('change', () => { S.forms.rent = $('#rDate').value; });
    $('#rName').addEventListener('change', () => { S.forms.rentName = $('#rName').value; calc(); });
    $('#rSave').onclick = async () => {
      const ds = $('#rDate').value, month = $('#rMonth').value;
      if (!isDate(ds)) return toast('பெற்ற தேதியைத் தேர்ந்தெடுக்கவும்');
      if (!isMonth(month)) return toast('வாடகை மாதத்தைத் தேர்ந்தெடுக்கவும்');
      const { rent, amt } = calc();
      if (rent <= 0) return toast('மாத வாடகையை உள்ளிடவும்');
      if (amt <= 0) return toast('பெற்ற தொகையை உள்ளிடவும்');
      const mode = ($('input[name="rMode"]:checked') || {}).value || 'cash';
      const rec = Object.assign(ed ? Object.assign({}, ed) : { id: uid(), type: 'rent' },
        { date: ds, month, name: $('#rName').value.trim(), rent: r2(rent), amount: r2(amt), mode, note: $('#rNote').value.trim() });
      try { await Store.put(rec); } catch (e) { return toast('⚠ சேமிப்பில் பிழை: ' + e.message); }
      S.forms.rent = ds; S.forms.rentMonth = month; S.forms.rentName = rec.name; S.edit = null;
      toast(`✓ வாடகை ${inr(amt)} சேமிக்கப்பட்டது`);
      refresh();
    };
    calc(); showLists();
  };

  /* =========================================================
     5. VEHICLE COLLECTION
     ========================================================= */
  RENDER.vehicle = function () {
    const ed = S.edit && S.edit.type === 'vehicle' ? Store.find(S.edit.id) : null;
    const d = ed || { date: formDate('vehicle'), vehicles: '', days: 1, rate: Store.settings.defaultRate, multiply: false, mode: 'cash', note: '' };
    $('#view-vehicle').innerHTML = `
      ${segHTML('vehicle')}
      ${editBarHTML(ed)}
      <div class="card">
        <h2 class="title">🚙 வாகன வசூல்</h2>
        <div class="field"><label class="f" for="vDate">தேதி (Date)</label><input type="date" id="vDate" value="${d.date}"></div>
        <div class="grid3">
          <div class="field"><label class="f" for="vCount">வாகனங்கள்</label><input type="number" inputmode="numeric" min="0" step="1" id="vCount" value="${d.vehicles || ''}" placeholder="0"></div>
          <div class="field"><label class="f" for="vDays">நாட்கள்</label><input type="number" inputmode="numeric" min="1" step="1" id="vDays" value="${d.days || 1}"></div>
          <div class="field"><label class="f" for="vRate">கட்டணம் ₹</label><input type="number" inputmode="decimal" min="0" step="any" id="vRate" value="${d.rate}"></div>
        </div>
        <label class="check"><input type="checkbox" id="vMul" ${d.multiply ? 'checked' : ''}> நாட்களாலும் பெருக்கு (ஒவ்வொரு நாளும் அதே வாகனங்கள் என்றால்)</label>
        <div class="field"><label class="f">பணம் வந்த வழி</label>${modeRadio('vMode', d.mode)}</div>
        <div class="calc-out vehicle" id="vOut"></div>
        <div class="field"><label class="f" for="vNote">குறிப்பு</label><input type="text" id="vNote" value="${esc(d.note || '')}" placeholder="விருப்பம்"></div>
        <div class="btn-row"><button type="button" class="btn primary" id="vSave">💾 ${ed ? 'புதுப்பி' : 'சேமி'}</button></div>
      </div>
      <h3 class="sec" id="vListTitle"></h3>
      <div id="vList"></div>`;
    const calc = () => {
      const v = int($('#vCount').value), days = int($('#vDays').value) || 1, rate = num($('#vRate').value), mul = $('#vMul').checked;
      const total = r2(v * rate * (mul ? days : 1));
      $('#vOut').innerHTML = `${nIN(v)} வாகனம் × ${inr(rate)}${mul ? ` × ${days} நாள்` : ''} = <b class="num">${inr(total)}</b>`;
      return { v, days, rate, mul, total };
    };
    const showList = () => {
      const ds = $('#vDate').value;
      const recs = Store.records.filter(r => r.type === 'vehicle' && r.date === ds).sort(byDate);
      const day = summarize(recs);
      const mon = summarize(inMonth((ds || todayStr()).slice(0, 7)).filter(r => r.type === 'vehicle'));
      $('#vListTitle').textContent = `வாகன பதிவுகள் — ${fmtDate(ds)}`;
      $('#vList').innerHTML = listHTML(recs, false, 'இந்த தேதிக்கு வாகன பதிவு இல்லை') +
        `<div class="sum-line"><span>இன்று: ${nIN(day.vehicles)} வாகனம்</span><span class="num">${inr(day.vehicleAmt)}</span></div>
         <div class="sum-line"><span>இந்த மாதம்: ${nIN(mon.vehicles)} வாகனம்</span><span class="num">${inr(mon.vehicleAmt)}</span></div>`;
    };
    ['vCount', 'vDays', 'vRate'].forEach(id => $('#' + id).addEventListener('input', calc));
    $('#vMul').addEventListener('change', calc);
    $('#vDate').addEventListener('change', () => { S.forms.vehicle = $('#vDate').value; showList(); });
    $('#vSave').onclick = async () => {
      const ds = $('#vDate').value;
      if (!isDate(ds)) return toast('தேதியைத் தேர்ந்தெடுக்கவும்');
      const c = calc();
      if (c.v <= 0) return toast('வாகன எண்ணிக்கையை உள்ளிடவும்');
      if (c.rate <= 0) return toast('கட்டணத்தை உள்ளிடவும்');
      const mode = ($('input[name="vMode"]:checked') || {}).value || 'cash';
      const rec = Object.assign(ed ? Object.assign({}, ed) : { id: uid(), type: 'vehicle' },
        { date: ds, vehicles: c.v, days: c.days, rate: r2(c.rate), multiply: c.mul, amount: c.total, mode, note: $('#vNote').value.trim() });
      try { await Store.put(rec); } catch (e) { return toast('⚠ சேமிப்பில் பிழை: ' + e.message); }
      S.forms.vehicle = ds; S.edit = null;
      toast(`✓ வாகன வசூல் ${inr(c.total)} சேமிக்கப்பட்டது`);
      refresh();
    };
    calc(); showList();
  };

  /* =========================================================
     6. WEEKLY FOLDERS
     ========================================================= */
  function weekSummaryTable(s) {
    return `<table class="t">
      <tr><td>💵 ரொக்க வசூல்</td><td class="r num">${inr(s.cash)}</td></tr>
      <tr><td>🔢 ரொக்க நோட்டுகள்</td><td class="r num">${nIN(s.notes)}</td></tr>
      <tr><td>📱 PhonePe வசூல்</td><td class="r num">${inr(s.phonepe)}</td></tr>
      <tr><td>🔑 வாடகை வசூல்</td><td class="r num">${inr(s.rent)}</td></tr>
      <tr><td>🚙 வாகன எண்ணிக்கை</td><td class="r num">${nIN(s.vehicles)}</td></tr>
      <tr><td>🚙 வாகன வசூல்</td><td class="r num">${inr(s.vehicleAmt)}</td></tr>
      <tr class="tot"><td>மொத்த வசூல்</td><td class="r num">${inr(s.grand)}</td></tr></table>`;
  }
  function denomTable(s) {
    const rows = DENOMS.filter(d => s.denoms[d]);
    if (!rows.length) return '<div class="empty">நோட்டு எண்ணிக்கை இல்லை</div>';
    return `<table class="t"><tr><th>நோட்டு</th><th class="r">எண்ணிக்கை</th><th class="r">தொகை</th></tr>
      ${rows.map(d => `<tr><td>₹${d}</td><td class="r num">${nIN(s.denoms[d])}</td><td class="r num">${inr(d * s.denoms[d])}</td></tr>`).join('')}
      <tr class="tot"><td>மொத்தம்</td><td class="r num">${nIN(s.notes)}</td><td class="r num">${inr(s.cash)}</td></tr></table>`;
  }
  function dailyRows(recs) {
    const map = new Map();
    recs.forEach(r => { if (!map.has(r.date)) map.set(r.date, []); map.get(r.date).push(r); });
    return Array.from(map.keys()).sort().map(ds => ({ date: ds, s: summarize(map.get(ds)) }));
  }
  function dailyTable(recs) {
    const days = dailyRows(recs);
    if (!days.length) return '<div class="empty">பதிவுகள் இல்லை</div>';
    const t = summarize(recs);
    return `<div class="tbl-wrap"><table class="t">
      <tr><th>தேதி</th><th class="r">ரொக்கம்</th><th class="r">PhonePe</th><th class="r">வாடகை</th><th class="r">வாகனம்</th><th class="r">மொத்தம்</th></tr>
      ${days.map(x => `<tr><td>${x.date.slice(8)} <span class="small muted">${dayName(x.date).slice(0, 3)}</span></td><td class="r num">${nIN(x.s.cash)}</td><td class="r num">${nIN(x.s.phonepe)}</td><td class="r num">${nIN(x.s.rent)}</td><td class="r num">${nIN(x.s.vehicleAmt)}</td><td class="r num"><b>${nIN(x.s.grand)}</b></td></tr>`).join('')}
      <tr class="tot"><td>மொத்தம்</td><td class="r num">${nIN(t.cash)}</td><td class="r num">${nIN(t.phonepe)}</td><td class="r num">${nIN(t.rent)}</td><td class="r num">${nIN(t.vehicleAmt)}</td><td class="r num">${nIN(t.grand)}</td></tr>
      </table></div>`;
  }

  RENDER.weeks = function () {
    const ym = S.month, nW = weeksIn(ym);
    if (S.weekSel && S.weekSel > nW) S.weekSel = null;
    const weeks = [];
    for (let w = 1; w <= nW; w++) weeks.push({ w, s: summarize(inWeek(ym, w)) });
    const sel = S.weekSel ? weeks.find(x => x.w === S.weekSel) : null;
    const selRecs = sel ? inWeek(ym, sel.w).sort(byDateDesc) : [];
    $('#view-weeks').innerHTML = `
      <h2 class="title">📁 வாராந்திர பதிவுகள்</h2>
      <div class="card row"><label class="f" for="wMonth" style="margin:0">மாதம்</label>${monthPicker('wMonth', ym)}</div>
      <div class="folders">
        ${weeks.map(x => { const [a, b] = weekRange(ym, x.w); return `<button type="button" class="folder ${S.weekSel === x.w ? 'sel' : ''}" data-week="${x.w}">
          <div class="wn">வாரம் ${x.w}</div><div class="wr">${a}–${b} ${shortMon(ym)}</div>
          <div class="wt num">${inr(x.s.grand)}</div>
          <div class="wl">${x.s.workingDays} நாள் · ${Store.records.length ? (inWeek(ym, x.w).length + ' பதிவுகள்') : ''}</div></button>`; }).join('')}
      </div>
      ${sel ? (() => { const [a, b] = weekRange(ym, sel.w); return `
        <h3 class="sec">வாரம் ${sel.w} — ${a}–${b} ${monthLabel(ym)}</h3>
        <div class="card">${weekSummaryTable(sel.s)}</div>
        <h3 class="sec">ரொக்க நோட்டு எண்ணிக்கை</h3>
        <div class="card">${denomTable(sel.s)}</div>
        <h3 class="sec">நாள்வாரியாக</h3>
        <div class="card">${dailyTable(selRecs)}</div>
        <h3 class="sec">இந்த வாரப் பதிவுகள்</h3>
        ${listHTML(selRecs, true, 'இந்த வாரத்தில் பதிவுகள் இல்லை')}`; })() : `<div class="empty">ஒரு வார folder-ஐத் தொட்டு அதன் விவரங்களைப் பார்க்கவும்</div>`}`;
    $('#wMonth').onchange = e => { if (isMonth(e.target.value)) { S.month = e.target.value; S.weekSel = null; refresh(); } };
    $$('#view-weeks [data-week]').forEach(b => b.onclick = () => {
      S.weekSel = S.weekSel === +b.dataset.week ? null : +b.dataset.week; refresh();
      if (S.weekSel) setTimeout(() => { const h = $('#view-weeks h3.sec'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30);
    });
  };

  /* =========================================================
     7 & 8. MONTHLY REPORT + FINAL CALCULATION
     ========================================================= */
  function finalCalcHTML(s) {
    const ok = r2(s.cashInHand + s.ppAll) === s.grand;
    return `<div class="final">
      <div class="ln"><span>💵 மொத்த ரொக்கம் (Total Cash)</span><b>${inr(s.cash)}</b></div>
      <div class="ln"><span>📱 மொத்த PhonePe (Total PhonePe)</span><b>${inr(s.phonepe)}</b></div>
      <div class="ln"><span>🔑 மொத்த வாடகை (Total Rent)</span><b>${inr(s.rent)}</b></div>
      <div class="ln"><span>🚙 மொத்த வாகன வசூல் (Vehicle)</span><b>${inr(s.vehicleAmt)}</b></div>
      <div class="gt"><span>மொத்தம் (Grand Total)</span><span class="num">${inr(s.grand)}</span></div>
    </div>`;
  }
  function breakdownHTML(s) {
    const ok = r2(s.cashInHand + s.ppAll) === s.grand;
    return `<div class="tbl-wrap"><table class="t">
      <tr><th>வகை</th><th class="r">💵 ரொக்கம்</th><th class="r">📱 PhonePe</th><th class="r">மொத்தம்</th></tr>
      <tr><td>ரொக்க எண்ணிக்கை / PhonePe</td><td class="r num">${inr(s.cash)}</td><td class="r num">${inr(s.phonepe)}</td><td class="r num">${inr(s.cash + s.phonepe)}</td></tr>
      <tr><td>வாடகை</td><td class="r num">${inr(s.rentCash)}</td><td class="r num">${inr(s.rentPP)}</td><td class="r num">${inr(s.rent)}</td></tr>
      <tr><td>வாகனம்</td><td class="r num">${inr(s.vehCash)}</td><td class="r num">${inr(s.vehPP)}</td><td class="r num">${inr(s.vehicleAmt)}</td></tr>
      <tr class="tot"><td>மொத்தம்</td><td class="r num">${inr(s.cashInHand)}</td><td class="r num">${inr(s.ppAll)}</td><td class="r num">${inr(s.grand)}</td></tr>
    </table></div>
    <div class="${ok ? 'check-ok' : 'check-bad'}">${ok ? '✓ சரிபார்ப்பு: ரொக்கம் ' + inr(s.cashInHand) + ' + PhonePe ' + inr(s.ppAll) + ' = மொத்தம் ' + inr(s.grand) : '⚠ கணக்கு பொருந்தவில்லை'}</div>
    <div class="explain"><b>கணக்கு முறை:</b><ul>
      <li>ஒவ்வொரு தொகையும் ஒரே ஒரு பகுதியில் மட்டுமே பதிவாகிறது — ரொக்க எண்ணிக்கை, PhonePe, வாடகை, வாகனம்.</li>
      <li>மொத்தம் = ரொக்கம் + PhonePe + வாடகை + வாகனம்.</li>
      <li>வாடகை / வாகனப் பணம் ரொக்கமா PhonePe-ஆ என்பதைப் பொறுத்து மேலே உள்ள பிரிப்பில் அந்தந்த நெடுவரிசையில் வருகிறது; மொத்தத்தில் மீண்டும் கூட்டப்படுவதில்லை.</li>
    </ul></div>`;
  }
  function rentStatusTable(ym) {
    const st = rentStatus(ym);
    if (!st.list.length) return '<div class="empty">இந்த மாதத்திற்கு வாடகை பதிவு இல்லை</div>';
    return `<div class="tbl-wrap"><table class="t"><tr><th>பெயர்</th><th class="r">வாடகை</th><th class="r">பெற்றது</th><th class="r">நிலுவை</th></tr>
      ${st.list.map(g => `<tr><td>${esc(g.name)}</td><td class="r num">${inr(g.rent)}</td><td class="r num">${inr(g.received)}</td><td class="r num">${g.pending > 0 ? inr(g.pending) : g.pending < 0 ? '+' + inr(-g.pending) : '✓'}</td></tr>`).join('')}
      <tr class="tot"><td>மொத்தம்</td><td class="r num">${inr(st.tot.rent)}</td><td class="r num">${inr(st.tot.received)}</td><td class="r num">${inr(st.tot.pending)}</td></tr></table></div>`;
  }

  RENDER.report = function () {
    const ym = S.month;
    const recs = inMonth(ym);
    const s = summarize(recs);
    const nW = weeksIn(ym);
    const weeks = [];
    for (let w = 1; w <= nW; w++) weeks.push({ w, s: summarize(recs.filter(r => weekOf(r.date) === w)) });
    $('#view-report').innerHTML = `
      <h2 class="title">📊 மாத அறிக்கை</h2>
      <div class="card row wrap"><label class="f" for="mMonth" style="margin:0">மாதம்</label>${monthPicker('mMonth', ym)}<span class="spacer"></span><b>${monthLabel(ym)}</b></div>

      <div class="actions-grid" style="margin-bottom:12px">
        <button type="button" class="btn primary" data-act="pdf">📄 PDF பதிவிறக்கு</button>
        <button type="button" class="btn" data-act="print">🖨 அச்சிடு</button>
        <button type="button" class="btn" data-act="xlsx">📗 Excel</button>
        <button type="button" class="btn" data-act="csv">📑 CSV</button>
      </div>

      <div class="stats">
        <div class="stat cash"><div class="k">💵 மொத்த ரொக்கம்</div><div class="v num">${inr(s.cash)}</div><div class="s">${nIN(s.notes)} நோட்டுகள்</div></div>
        <div class="stat phonepe"><div class="k">📱 மொத்த PhonePe</div><div class="v num">${inr(s.phonepe)}</div><div class="s">${s.phonepeCount} பதிவுகள்</div></div>
        <div class="stat rent"><div class="k">🔑 மொத்த வாடகை</div><div class="v num">${inr(s.rent)}</div><div class="s">${s.rentCount} பதிவுகள்</div></div>
        <div class="stat trips"><div class="k">🚙 மொத்த வாகனங்கள்</div><div class="v num">${nIN(s.vehicles)}</div><div class="s">${s.vehicleCount} பதிவுகள்</div></div>
        <div class="stat vehicle"><div class="k">🚙 வாகன வசூல்</div><div class="v num">${inr(s.vehicleAmt)}</div></div>
        <div class="stat week"><div class="k">📅 வேலை நாட்கள்</div><div class="v num">${s.workingDays}</div><div class="s">பதிவு உள்ள நாட்கள்</div></div>
      </div>

      <h3 class="sec">இறுதி கணக்கீடு (Final Calculation)</h3>
      <div class="card">${finalCalcHTML(s)}</div>

      <h3 class="sec">ரொக்கம் / PhonePe பிரிப்பு</h3>
      <div class="card">${breakdownHTML(s)}</div>

      <h3 class="sec">வாரவாரியாக</h3>
      <div class="card tbl-wrap"><table class="t">
        <tr><th>வாரம்</th><th class="r">ரொக்கம்</th><th class="r">PhonePe</th><th class="r">வாடகை</th><th class="r">வாகனம்</th><th class="r">மொத்தம்</th></tr>
        ${weeks.map(x => `<tr><td>வாரம் ${x.w}</td><td class="r num">${nIN(x.s.cash)}</td><td class="r num">${nIN(x.s.phonepe)}</td><td class="r num">${nIN(x.s.rent)}</td><td class="r num">${nIN(x.s.vehicleAmt)}</td><td class="r num"><b>${nIN(x.s.grand)}</b></td></tr>`).join('')}
        <tr class="tot"><td>மொத்தம்</td><td class="r num">${nIN(s.cash)}</td><td class="r num">${nIN(s.phonepe)}</td><td class="r num">${nIN(s.rent)}</td><td class="r num">${nIN(s.vehicleAmt)}</td><td class="r num">${nIN(s.grand)}</td></tr>
      </table></div>

      <h3 class="sec">ரொக்க நோட்டு சுருக்கம்</h3>
      <div class="card">${denomTable(s)}</div>

      <h3 class="sec">வாடகை நிலை — ${monthLabel(ym)}</h3>
      <div class="card">${rentStatusTable(ym)}</div>

      <h3 class="sec">நாள்வாரியான வசூல் வரலாறு</h3>
      <div class="card">${dailyTable(recs)}</div>`;
    $('#mMonth').onchange = e => { if (isMonth(e.target.value)) { S.month = e.target.value; refresh(); } };
  };

  /* =========================================================
     9. HISTORY: search & filter
     ========================================================= */
  RENDER.history = function () {
    const h = S.hist;
    const nW = isMonth(h.month) ? weeksIn(h.month) : 5;
    $('#view-history').innerHTML = `
      <h2 class="title">🕘 பதிவு வரலாறு</h2>
      <div class="card">
        <div class="grid2">
          <div class="field"><label class="f" for="hDate">தேதி மூலம் தேடு</label><input type="date" id="hDate" value="${h.date}"></div>
          <div class="field"><label class="f" for="hType">வகை</label><select id="hType">
            <option value="">அனைத்தும்</option>${TYPES.map(t => `<option value="${t}" ${h.type === t ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('')}</select></div>
          <div class="field"><label class="f" for="hMonth">மாதம்</label><input type="month" id="hMonth" value="${h.month}"></div>
          <div class="field"><label class="f" for="hWeek">வாரம்</label><select id="hWeek">
            <option value="">அனைத்து வாரங்கள்</option>${Array.from({ length: nW }, (_, i) => `<option value="${i + 1}" ${+h.week === i + 1 ? 'selected' : ''}>வாரம் ${i + 1}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label class="f" for="hQ">குறிப்பு / பெயரில் தேடு</label><input type="search" id="hQ" value="${esc(h.q)}" placeholder="தேடு…"></div>
        <div class="btn-row"><button type="button" class="btn ghost" id="hClear">வடிகட்டிகளை நீக்கு</button><button type="button" class="btn" id="hAll">எல்லா மாதங்களும்</button></div>
      </div>
      <div id="hRes"></div>`;
    const apply = () => {
      let recs = Store.records.slice();
      if (h.date) recs = recs.filter(r => r.date === h.date);
      else {
        if (h.month) recs = recs.filter(r => r.date.startsWith(h.month));
        if (h.week) recs = recs.filter(r => weekOf(r.date) === +h.week);
      }
      if (h.type) recs = recs.filter(r => r.type === h.type);
      if (h.q) { const q = h.q.toLowerCase(); recs = recs.filter(r => ((r.note || '') + ' ' + (r.name || '')).toLowerCase().includes(q)); }
      recs.sort(byDateDesc);
      const s = summarize(recs);
      const groups = new Map();
      recs.forEach(r => { if (!groups.has(r.date)) groups.set(r.date, []); groups.get(r.date).push(r); });
      const scope = h.date ? fmtDate(h.date) : (h.month ? monthLabel(h.month) + (h.week ? ' · வாரம் ' + h.week : '') : 'எல்லா மாதங்களும்');
      $('#hRes').innerHTML = `<div class="sum-line" style="margin-bottom:12px"><span>${esc(scope)} · ${recs.length} பதிவுகள்</span><span class="num">${inr(s.grand)}</span></div>` +
        (recs.length ? Array.from(groups.entries()).map(([ds, list]) => {
          const ss = summarize(list);
          return `<div class="daygroup"><div class="dayhead"><span>${fmtDate(ds)} <span class="small muted">${dayName(ds)}</span></span><span class="num">${inr(ss.grand)}</span></div>
            <div class="list">${list.map(r => itemHTML(r, false)).join('')}</div></div>`;
        }).join('') : '<div class="empty">பொருந்தும் பதிவுகள் இல்லை</div>');
    };
    $('#hDate').onchange = e => { h.date = e.target.value; apply(); };
    $('#hType').onchange = e => { h.type = e.target.value; apply(); };
    $('#hMonth').onchange = e => { h.month = e.target.value; h.week = ''; refresh(); };
    $('#hWeek').onchange = e => { h.week = e.target.value; apply(); };
    $('#hQ').oninput = e => { h.q = e.target.value; apply(); };
    $('#hClear').onclick = () => { S.hist = { type: '', month: curMonth(), week: '', date: '', q: '' }; refresh(); };
    $('#hAll').onclick = () => { h.month = ''; h.week = ''; h.date = ''; refresh(); };
    apply();
  };

  /* =========================================================
     11. BACKUP / RESTORE / SETTINGS
     ========================================================= */
  RENDER.backup = function () {
    const st = Store.settings;
    const modeTxt = { idb: 'IndexedDB (நிரந்தர சேமிப்பு) ✓', local: 'localStorage ✓', memory: '⚠ தற்காலிகம் மட்டும் — மூடினால் அழியும்' }[Store.mode];
    const months = Array.from(new Set(Store.records.map(r => r.date.slice(0, 7)))).sort();
    $('#view-backup').innerHTML = `
      <h2 class="title">⚙ Backup & அமைப்புகள்</h2>
      <div class="card">
        <b>💾 Backup எடு</b>
        <p class="small muted">எல்லாப் பதிவுகளும் ஒரு .json கோப்பாகச் சேமிக்கப்படும். அதை Google Drive / WhatsApp-இல் உங்களுக்கே அனுப்பி பாதுகாப்பாக வைக்கவும்.</p>
        <button type="button" class="btn primary block" data-act="backup-now">⬇ Backup பதிவிறக்கு</button>
        <p class="small muted">கடைசி backup: ${st.lastBackup ? new Date(st.lastBackup).toLocaleString('en-IN') : 'இல்லை'}</p>
      </div>
      <div class="card">
        <b>♻ Restore (மீட்டெடு)</b>
        <p class="small muted">முன்பு எடுத்த backup .json கோப்பைத் தேர்ந்தெடுக்கவும்.</p>
        <input type="file" id="restoreFile" accept=".json,application/json" class="hidden">
        <button type="button" class="btn block" id="restoreBtn">📂 Backup கோப்பைத் தேர்ந்தெடு</button>
      </div>
      <div class="card">
        <b>📤 எல்லாப் பதிவுகளையும் ஏற்றுமதி</b>
        <div class="btn-row"><button type="button" class="btn" data-act="xlsx-all">📗 Excel</button><button type="button" class="btn" data-act="csv-all">📑 CSV</button></div>
      </div>
      <div class="card">
        <b>🔧 இயல்புநிலை மதிப்புகள்</b>
        <div class="grid2" style="margin-top:8px">
          <div class="field"><label class="f" for="sRent">மாத வாடகை ₹</label><input type="number" inputmode="decimal" id="sRent" value="${st.defaultRent}"></div>
          <div class="field"><label class="f" for="sRate">வாகனக் கட்டணம் ₹</label><input type="number" inputmode="decimal" id="sRate" value="${st.defaultRate}"></div>
        </div>
        <button type="button" class="btn block" id="sSave">💾 சேமி</button>
      </div>
      <div class="card small">
        <b>📦 சேமிப்பு நிலை</b>
        <div>சேமிப்பு: ${modeTxt}</div>
        <div>நிரந்தர அனுமதி (persistent): ${Store.persisted ? 'ஆம் ✓' : 'இல்லை (ஆப்பை நிறுவினால் கிடைக்கும்)'}</div>
        <div>மொத்தப் பதிவுகள்: ${Store.records.length} · மாதங்கள்: ${months.length ? months.map(monthLabel).join(', ') : '—'}</div>
      </div>
      <div class="card small" id="installHelp">
        <b>📲 Android-இல் நிறுவ</b>
        <div>Chrome-இல் இந்தப் பக்கத்தைத் திறந்து ⋮ மெனு → <b>"Add to Home screen" / "Install app"</b> தொடவும்.</div>
        <button type="button" class="btn block ${deferredInstall ? '' : 'hidden'}" data-act="install" style="margin-top:8px">⬇ இப்போது நிறுவு</button>
      </div>
      <div class="card">
        <b style="color:var(--danger)">⚠ எல்லாத் தரவையும் அழி</b>
        <p class="small muted">முதலில் backup எடுக்கவும். இது திரும்பப் பெற முடியாது.</p>
        <button type="button" class="btn danger block" id="wipeBtn">🗑 எல்லாப் பதிவுகளையும் நீக்கு</button>
      </div>`;
    $('#restoreBtn').onclick = () => $('#restoreFile').click();
    $('#restoreFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) await restoreFrom(f); };
    $('#sSave').onclick = async () => {
      st.defaultRent = num($('#sRent').value) || 300; st.defaultRate = num($('#sRate').value) || 10;
      await Store.saveSettings(); toast('✓ அமைப்புகள் சேமிக்கப்பட்டன');
    };
    $('#wipeBtn').onclick = async () => {
      const a = await ask('எல்லாப் பதிவுகளையும் நீக்கவா?', `${Store.records.length} பதிவுகள் நிரந்தரமாக நீக்கப்படும்.`,
        [{ label: '⬇ முதலில் Backup எடு', value: 'backup', cls: 'primary' }, { label: '🗑 Backup இல்லாமல் நீக்கு', value: 'wipe', cls: 'danger' }, { label: 'ரத்து', value: null, cls: 'ghost' }]);
      if (a === 'backup') { await doBackup(); return; }
      if (a !== 'wipe') return;
      const b = await ask('உறுதியாக?', 'இதைத் திரும்பப் பெற முடியாது.', [{ label: 'ஆம், நீக்கு', value: true, cls: 'danger' }, { label: 'வேண்டாம்', value: false, cls: 'ghost' }]);
      if (!b) return;
      await Store.replaceAll([]); toast('எல்லாப் பதிவுகளும் நீக்கப்பட்டன'); refresh();
    };
  };

  function stamp() { const d = new Date(); return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`; }
  async function doBackup() {
    const data = { app: 'vasool-kanakku', version: 1, exportedAt: new Date().toISOString(), settings: Object.assign({}, Store.settings), records: Store.records };
    const ok = await saveFile(`vasool-backup-${stamp()}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    if (ok) { Store.settings.lastBackup = Date.now(); await Store.saveSettings(); if (S.view === 'home' || S.view === 'backup') refresh(); }
  }
  function cleanRecord(r) {
    if (!r || typeof r !== 'object' || !TYPES.includes(r.type) || !isDate(r.date)) return null;
    const o = { id: String(r.id || uid()), type: r.type, date: r.date, note: String(r.note || '').slice(0, 500), createdAt: +r.createdAt || Date.now(), updatedAt: +r.updatedAt || Date.now() };
    if (r.type === 'cash') {
      o.notes = {}; let total = 0, count = 0;
      DENOMS.forEach(d => { const n = int(r.notes && r.notes[d]); if (n) { o.notes[d] = n; total += n * d; count += n; } });
      o.amount = r2(total); o.count = count;
    } else if (r.type === 'phonepe') { o.amount = r2(num(r.amount)); }
    else if (r.type === 'rent') {
      o.month = isMonth(r.month) ? r.month : r.date.slice(0, 7); o.name = String(r.name || '').slice(0, 100);
      o.rent = r2(num(r.rent)); o.amount = r2(num(r.amount)); o.mode = r.mode === 'phonepe' ? 'phonepe' : 'cash';
    } else if (r.type === 'vehicle') {
      o.vehicles = int(r.vehicles); o.days = int(r.days) || 1; o.rate = r2(num(r.rate)); o.multiply = !!r.multiply;
      o.amount = r2(o.vehicles * o.rate * (o.multiply ? o.days : 1)); o.mode = r.mode === 'phonepe' ? 'phonepe' : 'cash';
    }
    return o.amount > 0 ? o : null;
  }
  async function restoreFrom(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { return toast('⚠ இது சரியான backup கோப்பு அல்ல'); }
    const raw = Array.isArray(data) ? data : (data && data.records);
    if (!Array.isArray(raw)) return toast('⚠ backup-இல் பதிவுகள் இல்லை');
    const recs = raw.map(cleanRecord).filter(Boolean);
    const a = await ask('Restore செய்யவா?', `Backup-இல் <b>${recs.length}</b> சரியான பதிவுகள் உள்ளன. இப்போது இந்தப் போனில் <b>${Store.records.length}</b> பதிவுகள் உள்ளன.<br><br>
      <b>இணை (Merge)</b> — இரண்டையும் சேர்க்கும்; ஒரே பதிவு இருந்தால் புதியதை வைக்கும்.<br><b>மாற்று (Replace)</b> — இப்போதைய தரவை நீக்கி backup-ஐ மட்டும் வைக்கும்.`,
      [{ label: '🔗 இணை (Merge)', value: 'merge', cls: 'primary' }, { label: '🔁 முழுவதும் மாற்று', value: 'replace', cls: 'danger' }, { label: 'ரத்து', value: null, cls: 'ghost' }]);
    if (!a) return;
    let out;
    if (a === 'replace') out = recs;
    else {
      const map = new Map(Store.records.map(r => [r.id, r]));
      recs.forEach(r => { const cur = map.get(r.id); if (!cur || (r.updatedAt || 0) >= (cur.updatedAt || 0)) map.set(r.id, r); });
      out = Array.from(map.values());
    }
    try {
      await Store.replaceAll(out);
      if (data.settings && typeof data.settings === 'object') {
        if (num(data.settings.defaultRent)) Store.settings.defaultRent = num(data.settings.defaultRent);
        if (num(data.settings.defaultRate)) Store.settings.defaultRate = num(data.settings.defaultRate);
        await Store.saveSettings();
      }
    } catch (e) { return toast('⚠ Restore பிழை: ' + e.message); }
    toast(`✓ ${recs.length} பதிவுகள் மீட்டெடுக்கப்பட்டன`);
    refresh();
  }

  /* =========================================================
     Exports: PDF, print, Excel, CSV
     ========================================================= */
  function recDetailPlain(r) {
    switch (r.type) {
      case 'cash': return DENOMS.filter(d => int(r.notes && r.notes[d])).map(d => `${d}x${r.notes[d]}`).join(' ') + ` (${r.count} notes)`;
      case 'rent': return `${r.name ? r.name + ' | ' : ''}${r.month} rent ${r.rent} | pending ${rentEntryPending(r)}`;
      case 'vehicle': return `${r.vehicles} x ${r.rate}${r.multiply ? ' x ' + r.days + ' days' : ''} | ${r.days} day(s)`;
    }
    return '';
  }
  function csvRows(recs) {
    const rows = [['Date / தேதி', 'Day', 'Week', 'Type / வகை', 'Amount / தொகை', 'Paid via', 'Details', 'Notes / குறிப்பு']];
    recs.slice().sort(byDate).forEach(r => rows.push([fmtDate(r.date), dayName(r.date), 'Week ' + weekOf(r.date), TYPE_LABEL[r.type], r.amount,
      r.type === 'phonepe' ? 'PhonePe' : r.type === 'cash' ? 'Cash' : (r.mode === 'phonepe' ? 'PhonePe' : 'Cash'), recDetailPlain(r), r.note || '']));
    return rows;
  }
  function workbook(recs, title, ym) {
    const s = summarize(recs);
    const sheets = [];
    const sum = [[title], [], ['Item / விவரம்', 'Amount / தொகை'],
      ['Total Cash / மொத்த ரொக்கம்', s.cash], ['Total PhonePe / மொத்த PhonePe', s.phonepe], ['Total Rent / மொத்த வாடகை', s.rent],
      ['Total Vehicle Collection / வாகன வசூல்', s.vehicleAmt], ['GRAND TOTAL / மொத்தம்', s.grand], [],
      ['Total vehicles / மொத்த வாகனங்கள்', s.vehicles], ['Working days / வேலை நாட்கள்', s.workingDays], ['Cash notes counted / நோட்டுகள்', s.notes], [],
      ['Breakdown / பிரிப்பு', 'Cash / ரொக்கம்', 'PhonePe', 'Total'],
      ['Cash count & PhonePe entries', s.cash, s.phonepe, r2(s.cash + s.phonepe)],
      ['Rent', s.rentCash, s.rentPP, s.rent], ['Vehicle', s.vehCash, s.vehPP, s.vehicleAmt],
      ['TOTAL', s.cashInHand, s.ppAll, s.grand]];
    const bold = [0, 2, 7, 13, 17];
    if (ym) {
      sum.push([], ['Week / வாரம்', 'Cash', 'PhonePe', 'Rent', 'Vehicles', 'Vehicle ₹', 'Total']);
      bold.push(sum.length - 1);
      for (let w = 1; w <= weeksIn(ym); w++) {
        const ws = summarize(recs.filter(r => weekOf(r.date) === w)); const [a, b] = weekRange(ym, w);
        sum.push([`Week ${w} (${a}-${b})`, ws.cash, ws.phonepe, ws.rent, ws.vehicles, ws.vehicleAmt, ws.grand]);
      }
    }
    sheets.push({ name: 'Summary', rows: sum, widths: [38, 16, 14, 14, 12, 14, 14], boldRows: bold });
    const daily = [['Date', 'Day', 'Week', 'Cash', 'PhonePe', 'Rent', 'Vehicles', 'Vehicle ₹', 'Total']];
    dailyRows(recs).forEach(x => daily.push([fmtDate(x.date), dayName(x.date), weekOf(x.date), x.s.cash, x.s.phonepe, x.s.rent, x.s.vehicles, x.s.vehicleAmt, x.s.grand]));
    daily.push(['TOTAL', '', '', s.cash, s.phonepe, s.rent, s.vehicles, s.vehicleAmt, s.grand]);
    sheets.push({ name: 'Daily', rows: daily, widths: [12, 10, 7, 12, 12, 12, 10, 12, 13], boldRows: [0, daily.length - 1] });
    const cash = [['Date', ...DENOMS.map(d => '₹' + d), 'Notes', 'Amount', 'Note']];
    recs.filter(r => r.type === 'cash').sort(byDate).forEach(r => cash.push([fmtDate(r.date), ...DENOMS.map(d => int(r.notes[d])), r.count, r.amount, r.note || '']));
    cash.push(['TOTAL', ...DENOMS.map(d => s.denoms[d]), s.notes, s.cash, '']);
    sheets.push({ name: 'Cash Count', rows: cash, widths: [12, 7, 7, 7, 7, 7, 7, 7, 8, 12, 30], boldRows: [0, cash.length - 1] });
    const pp = [['Date', 'Amount', 'Transaction details / Note']];
    recs.filter(r => r.type === 'phonepe').sort(byDate).forEach(r => pp.push([fmtDate(r.date), r.amount, r.note || '']));
    pp.push(['TOTAL', s.phonepe, '']);
    sheets.push({ name: 'PhonePe', rows: pp, widths: [12, 12, 40], boldRows: [0, pp.length - 1] });
    const rent = [['Date received', 'Name', 'Rent month', 'Monthly rent', 'Received', 'Pending after this', 'Paid via', 'Note']];
    recs.filter(r => r.type === 'rent').sort(byDate).forEach(r => rent.push([fmtDate(r.date), r.name || '', monthLabel(r.month), r.rent, r.amount, rentEntryPending(r), MODE_LABEL[r.mode] || 'ரொக்கம்', r.note || '']));
    rent.push(['TOTAL', '', '', '', s.rent, '', '', '']);
    sheets.push({ name: 'Rent', rows: rent, widths: [13, 16, 16, 12, 11, 15, 10, 28], boldRows: [0, rent.length - 1] });
    const veh = [['Date', 'Vehicles', 'Days', 'Rate', 'x Days?', 'Amount', 'Paid via', 'Note']];
    recs.filter(r => r.type === 'vehicle').sort(byDate).forEach(r => veh.push([fmtDate(r.date), r.vehicles, r.days, r.rate, r.multiply ? 'Yes' : 'No', r.amount, MODE_LABEL[r.mode] || 'ரொக்கம்', r.note || '']));
    veh.push(['TOTAL', s.vehicles, '', '', '', s.vehicleAmt, '', '']);
    sheets.push({ name: 'Vehicle', rows: veh, widths: [12, 10, 7, 8, 8, 12, 10, 28], boldRows: [0, veh.length - 1] });
    return VExport.xlsx(sheets);
  }

  function pdfBlocks(ym) {
    const recs = inMonth(ym), s = summarize(recs);
    const B = [];
    B.push({ t: 'h1', text: `மாத அறிக்கை — ${monthLabel(ym)}` });
    B.push({ t: 'meta', text: `இந்தியன் டூ வீலர் ஸ்டாண்ட் · உருவாக்கியது: ${new Date().toLocaleString('en-IN')} · வேலை நாட்கள்: ${s.workingDays} · பதிவுகள்: ${recs.length}` });
    B.push({ t: 'h2', text: 'இறுதி கணக்கீடு (Final Calculation)' });
    B.push({ t: 'kv', rows: [['மொத்த ரொக்கம் (Total Cash)', inr(s.cash)], ['மொத்த PhonePe (Total PhonePe)', inr(s.phonepe)], ['மொத்த வாடகை (Total Rent)', inr(s.rent)], ['மொத்த வாகன வசூல் (Vehicle Collection)', inr(s.vehicleAmt)], ['மொத்தம் (Grand Total)', inr(s.grand), true]] });
    B.push({ t: 'kv', rows: [['மொத்த வாகனங்கள் (Total vehicles)', nIN(s.vehicles)], ['ரொக்க நோட்டுகள் (Notes counted)', nIN(s.notes)], ['வேலை நாட்கள் (Working days)', String(s.workingDays)]] });
    B.push({ t: 'h2', text: 'ரொக்கம் / PhonePe பிரிப்பு' });
    B.push({ t: 'table', cols: [{ l: 'வகை', w: 2.2 }, { l: 'ரொக்கம்', w: 1, a: 'r' }, { l: 'PhonePe', w: 1, a: 'r' }, { l: 'மொத்தம்', w: 1, a: 'r' }],
      rows: [['ரொக்க எண்ணிக்கை / PhonePe', inr(s.cash), inr(s.phonepe), inr(s.cash + s.phonepe)], ['வாடகை', inr(s.rentCash), inr(s.rentPP), inr(s.rent)], ['வாகனம்', inr(s.vehCash), inr(s.vehPP), inr(s.vehicleAmt)]],
      total: ['மொத்தம்', inr(s.cashInHand), inr(s.ppAll), inr(s.grand)] });
    B.push({ t: 'h2', text: 'வாரவாரியாக' });
    const wr = [];
    for (let w = 1; w <= weeksIn(ym); w++) { const ws = summarize(recs.filter(r => weekOf(r.date) === w)); const [a, b] = weekRange(ym, w); wr.push([`வாரம் ${w} (${a}-${b})`, nIN(ws.cash), nIN(ws.phonepe), nIN(ws.rent), nIN(ws.vehicles), nIN(ws.vehicleAmt), nIN(ws.grand)]); }
    B.push({ t: 'table', cols: [{ l: 'வாரம்', w: 1.8 }, { l: 'ரொக்கம்', a: 'r' }, { l: 'PhonePe', a: 'r' }, { l: 'வாடகை', a: 'r' }, { l: 'வாகனங்கள்', a: 'r' }, { l: 'வாகன ₹', a: 'r' }, { l: 'மொத்தம்', a: 'r' }],
      rows: wr, total: ['மொத்தம்', nIN(s.cash), nIN(s.phonepe), nIN(s.rent), nIN(s.vehicles), nIN(s.vehicleAmt), nIN(s.grand)] });
    B.push({ t: 'h2', text: 'ரொக்க நோட்டு சுருக்கம்' });
    B.push({ t: 'table', cols: [{ l: 'நோட்டு' }, { l: 'எண்ணிக்கை', a: 'r' }, { l: 'தொகை', a: 'r' }],
      rows: DENOMS.map(d => ['₹' + d, nIN(s.denoms[d]), inr(d * s.denoms[d])]), total: ['மொத்தம்', nIN(s.notes), inr(s.cash)] });
    const st = rentStatus(ym);
    B.push({ t: 'h2', text: `வாடகை நிலை — ${monthLabel(ym)}` });
    B.push({ t: 'table', cols: [{ l: 'பெயர்', w: 2 }, { l: 'வாடகை', a: 'r' }, { l: 'பெற்றது', a: 'r' }, { l: 'நிலுவை', a: 'r' }],
      rows: st.list.map(g => [g.name, inr(g.rent), inr(g.received), g.pending > 0 ? inr(g.pending) : g.pending < 0 ? '+' + inr(-g.pending) : '✓']),
      total: st.list.length ? ['மொத்தம்', inr(st.tot.rent), inr(st.tot.received), inr(st.tot.pending)] : null, empty: 'வாடகை பதிவு இல்லை' });
    B.push({ t: 'h2', text: 'நாள்வாரியான வசூல்' });
    B.push({ t: 'table', cols: [{ l: 'தேதி', w: 1.5 }, { l: 'ரொக்கம்', a: 'r' }, { l: 'PhonePe', a: 'r' }, { l: 'வாடகை', a: 'r' }, { l: 'வாகனம்', a: 'r' }, { l: 'மொத்தம்', a: 'r' }],
      rows: dailyRows(recs).map(x => [fmtDate(x.date), nIN(x.s.cash), nIN(x.s.phonepe), nIN(x.s.rent), nIN(x.s.vehicleAmt), nIN(x.s.grand)]),
      total: ['மொத்தம்', nIN(s.cash), nIN(s.phonepe), nIN(s.rent), nIN(s.vehicleAmt), nIN(s.grand)], empty: 'பதிவுகள் இல்லை' });
    B.push({ t: 'h2', text: 'எல்லாப் பதிவுகள்' });
    B.push({ t: 'table', small: true, cols: [{ l: 'தேதி', w: 1.2 }, { l: 'வகை', w: 1 }, { l: 'தொகை', w: 1, a: 'r' }, { l: 'விவரம் / குறிப்பு', w: 3.6 }],
      rows: recs.slice().sort(byDate).map(r => [fmtDate(r.date), TYPE_LABEL[r.type], inr(r.amount), [recDetailPlain(r), r.note].filter(Boolean).join(' · ')]), empty: 'பதிவுகள் இல்லை' });
    return B;
  }
  function printHTML(ym) {
    // Black & white statement for printing.
    const blocks = pdfBlocks(ym);
    return '<div class="pr">' + blocks.map(b => {
      if (b.t === 'h1') return `<h1>${esc(b.text)}</h1>`;
      if (b.t === 'meta') return `<div class="meta">${esc(b.text)}</div>`;
      if (b.t === 'h2') return `<h2>${esc(b.text)}</h2>`;
      if (b.t === 'kv') return `<table>${b.rows.map(([k, v, st]) => `<tr${st ? ' class="tot"' : ''}><td>${esc(k)}</td><td class="r">${esc(v)}</td></tr>`).join('')}</table>`;
      if (b.t === 'table') return `<table><tr>${b.cols.map(c => `<th class="${c.a === 'r' ? 'r' : ''}">${esc(c.l)}</th>`).join('')}</tr>
        ${b.rows.length ? b.rows.map(r => `<tr>${r.map((v, i) => `<td class="${b.cols[i].a === 'r' ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${b.cols.length}">${esc(b.empty || '—')}</td></tr>`}
        ${b.total ? `<tr class="tot">${b.total.map((v, i) => `<td class="${b.cols[i].a === 'r' ? 'r' : ''}">${esc(v)}</td>`).join('')}</tr>` : ''}</table>`;
      return '';
    }).join('') + '</div>';
  }

  async function exportAction(act) {
    const ym = S.month;
    try {
      if (act === 'pdf') {
        toast('PDF உருவாகிறது…');
        const blob = await VExport.pdf(pdfBlocks(ym), `வசூல் அறிக்கை ${monthLabel(ym)}`);
        await saveFile(`vasool-report-${ym}.pdf`, blob);
      } else if (act === 'print') {
        if (inIframe) {
          const a = await ask('அச்சிடுதல்', 'இந்த முன்னோட்டத்தில் நேரடியாக அச்சிட முடியாது. PDF-ஐப் பதிவிறக்கி அதை அச்சிடவும்.', [{ label: '📄 PDF பதிவிறக்கு', value: 'pdf', cls: 'primary' }, { label: 'மூடு', value: null, cls: 'ghost' }]);
          if (a) return exportAction('pdf');
          return;
        }
        $('#printArea').innerHTML = printHTML(ym);
        setTimeout(() => { try { window.print(); } catch (e) { toast('அச்சிட முடியவில்லை — PDF பயன்படுத்தவும்'); } }, 60);
      } else if (act === 'xlsx') {
        await saveFile(`vasool-${ym}.xlsx`, workbook(inMonth(ym), `வசூல் அறிக்கை — ${monthLabel(ym)}`, ym));
      } else if (act === 'csv') {
        await saveFile(`vasool-${ym}.csv`, VExport.csv(csvRows(inMonth(ym))));
      } else if (act === 'xlsx-all') {
        await saveFile(`vasool-all-${stamp()}.xlsx`, workbook(Store.records, 'இந்தியன் டூ வீலர் ஸ்டாண்ட் — எல்லாப் பதிவுகள்', null));
      } else if (act === 'csv-all') {
        await saveFile(`vasool-all-${stamp()}.csv`, VExport.csv(csvRows(Store.records)));
      }
    } catch (e) { toast('⚠ பிழை: ' + e.message); }
  }

  /* =========================================================
     Global click handling (edit / delete / exports)
     ========================================================= */
  document.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act, id = b.dataset.id;
    if (act === 'edit') {
      const r = Store.find(id); if (!r) return;
      S.edit = { type: r.type, id: r.id };
      go(r.type);
    } else if (act === 'del') {
      const r = Store.find(id); if (!r) return;
      const ok = await ask('இந்தப் பதிவை நீக்கவா?', `${TYPE_ICON[r.type]} ${TYPE_LABEL[r.type]} · ${fmtDate(r.date)} · <b>${inr(r.amount)}</b>${r.note ? '<br>📝 ' + esc(r.note) : ''}`,
        [{ label: '🗑 நீக்கு', value: true, cls: 'danger' }, { label: 'ரத்து', value: false, cls: 'ghost' }]);
      if (!ok) return;
      try { await Store.del(id); } catch (err) { return toast('⚠ நீக்க முடியவில்லை'); }
      if (S.edit && S.edit.id === id) S.edit = null;
      toast('🗑 நீக்கப்பட்டது'); refresh();
    } else if (act === 'cancel-edit') {
      S.edit = null; refresh();
    } else if (act === 'backup-now') {
      await doBackup();
    } else if (act === 'install') {
      promptInstall();
    } else if (['pdf', 'print', 'xlsx', 'csv', 'xlsx-all', 'csv-all'].includes(act)) {
      await exportAction(act);
    }
  });

  /* =========================================================
     PWA install & service worker
     ========================================================= */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); deferredInstall = e;
    $('#installBtn').classList.remove('hidden');
    if (S.view === 'backup') refresh();
  });
  async function promptInstall() {
    if (!deferredInstall) { toast('Chrome ⋮ மெனு → "Add to Home screen" தொடவும்'); return; }
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
    deferredInstall = null; $('#installBtn').classList.add('hidden');
  }
  $('#installBtn').addEventListener('click', promptInstall);
  window.addEventListener('appinstalled', () => { $('#installBtn').classList.add('hidden'); toast('✓ ஆப் நிறுவப்பட்டது'); });

  if ('serviceWorker' in navigator && !inIframe && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => { }); });
  }

  /* =========================================================
     Start
     ========================================================= */
  async function start() {
    await Store.init();
    const warn = $('#storageWarn');
    if (Store.mode === 'memory') {
      warn.innerHTML = '⚠ இந்த உலாவியில் நிரந்தர சேமிப்பு கிடைக்கவில்லை. பதிவுகள் பக்கத்தை மூடினால் அழியும் — Backup எடுக்கவும்.';
      warn.classList.remove('hidden');
    } else if (inIframe) {
      warn.innerHTML = 'ℹ இது முன்னோட்டம் (preview). உங்கள் போனில் நிரந்தரமாகப் பயன்படுத்த, உங்கள் சொந்த இணைப்பில் திறந்து "Install" செய்யவும். பதிவுகளை Backup மூலம் மாற்றிக்கொள்ளலாம்.';
      warn.classList.remove('hidden');
    }
    window.addEventListener('hashchange', route);
    route();
    // Downloads inside the Claude preview frame go through its download capability.
    try {
      if (inIframe && window.claude && typeof window.claude.use === 'function') {
        window.claude.use('downloads').then(d => { claudeDownloads = d || null; }).catch(() => { });
      }
    } catch (e) { /* ignore */ }
  }
  // Expose a tiny hook for automated tests.
  window.__vasool = { Store, summarize, inMonth, rentStatus, rentEntryPending, S };
  start();
})();
