/* ============================================================
   Korvgrund Runt — handikappberäknad start
   All fart hanteras internt i KNOP. 1 knop = 1,852 km/h.
   ============================================================ */

'use strict';

const KMH_PER_KNOT = 1.852;
const STORAGE_KEY = 'korvgrundrunt.v2';
const ADMIN_FLAG = 'korvgrundrunt.admin';
// Lösenord/nyckel för arrangörsläge. Byt gärna till något eget.
// OBS: på en ren statisk sida är detta ett enkelt skydd — riktig behörighet
// läggs server-sidan när databasen (Supabase) kopplas på.
const ADMIN_KEY = 'korvgrund2026';

const knotsToKmh = (kn) => kn * KMH_PER_KNOT;
const kmhToKnots = (kmh) => kmh / KMH_PER_KNOT;
const round1 = (n) => Math.round(n * 10) / 10;
const sv = (n) => String(n).replace('.', ',');

/* ============================================================
   1. FARTUPPSKATTNING — modelltabell + Crouch-fallback
   ============================================================ */
const BOAT_TABLE = [
  { keys: ['silver fox br', 'silver fox'],        refHp: 60,  refKn: 27, cat: 'aluminium' },
  { keys: ['silver eagle brx', 'silver eagle'],   refHp: 115, refKn: 34, cat: 'aluminium' },
  { keys: ['silver hawk'],                        refHp: 100, refKn: 32, cat: 'aluminium' },
  { keys: ['buster xl'],                          refHp: 115, refKn: 32, cat: 'aluminium' },
  { keys: ['buster l'],                           refHp: 60,  refKn: 26, cat: 'aluminium' },
  { keys: ['buster m'],                           refHp: 40,  refKn: 24, cat: 'aluminium' },
  { keys: ['buster'],                             refHp: 60,  refKn: 26, cat: 'aluminium' },
  { keys: ['anytec 622', 'anytec'],               refHp: 150, refKn: 40, cat: 'aluminium' },
  { keys: ['uttern s57', 'uttern s', 'uttern'],   refHp: 100, refKn: 30, cat: 'planing' },
  { keys: ['ryds 548', 'ryds'],                   refHp: 60,  refKn: 27, cat: 'planing' },
  { keys: ['flipper 640', 'flipper'],             refHp: 150, refKn: 33, cat: 'planing' },
  { keys: ['yamarin 63', 'yamarin'],              refHp: 115, refKn: 32, cat: 'planing' },
  { keys: ['bella 700', 'bella'],                 refHp: 150, refKn: 32, cat: 'planing' },
  { keys: ['nimbus 305', 'nimbus'],               refHp: 300, refKn: 32, cat: 'planing' },
  { keys: ['pioner 12', 'pioner'],                refHp: 20,  refKn: 18, cat: 'aluminium' },
  { keys: ['axopar 28', 'axopar'],                refHp: 300, refKn: 40, cat: 'sport' },
  { keys: ['sting 610', 'sting'],                 refHp: 150, refKn: 36, cat: 'sport' },
  { keys: ['brig', 'zodiac', 'highfield'],        refHp: 150, refKn: 36, cat: 'rib' },
  // Vattenskotrar — toppfart i km/h
  { keys: ['yamaha vx', 'yamaha waverunner'],     kmh: 100, cat: 'jetski' },
  { keys: ['yamaha gp', 'yamaha fx'],             kmh: 110, cat: 'jetski' },
  { keys: ['sea-doo gti', 'seadoo gti', 'gti'],   kmh: 92,  cat: 'jetski' },
  { keys: ['sea-doo rxp', 'seadoo rxp', 'rxp'],   kmh: 110, cat: 'jetski' },
  { keys: ['kawasaki ultra', 'kawasaki'],         kmh: 112, cat: 'jetski' },
];

const CATEGORY = {
  aluminium:    { crouch: 160, weight: 650 },
  planing:      { crouch: 150, weight: 900 },
  sport:        { crouch: 190, weight: 750 },
  rib:          { crouch: 172, weight: 800 },
  displacement: { crouch: 95,  weight: 2500 },
  jetski:       { crouch: 200, weight: 350 },
};
const CATEGORY_LABEL = {
  aluminium: 'Aluminiumbåt', planing: 'Planande båt', sport: 'Sport / snabb',
  rib: 'RIB', displacement: 'Deplacementbåt', jetski: 'Vattenskoter',
};

function lookupModel(modelRaw) {
  const model = (modelRaw || '').trim().toLowerCase();
  if (!model) return null;
  let best = null, bestLen = 0;
  for (const row of BOAT_TABLE) {
    for (const key of row.keys) {
      if (model.includes(key) && key.length > bestLen) { best = row; bestLen = key.length; }
    }
  }
  return best;
}

/* Crouch: V(knop) = C / sqrt(vikt_lbs / hk) */
function crouchKnots(cat, weightKg, hp) {
  const c = CATEGORY[cat] || CATEGORY.planing;
  const w = (weightKg && weightKg > 0) ? weightKg : c.weight;
  const lbs = w * 2.2046;
  return c.crouch / Math.sqrt(lbs / hp);
}

function estimateSpeed(input) {
  const { category, boatModel, enginePower, weightKg, jetskiKmh } = input;
  const match = lookupModel(boatModel);

  if (category === 'jetski') {
    let kmh = Number(jetskiKmh); let source;
    if (kmh && kmh > 0) { source = 'Angiven km/h → knop'; }
    else if (match && match.kmh) { kmh = match.kmh; source = `Modelltabell: ${prettyModel(boatModel)}`; }
    else { return { error: 'Ange vattenskoterns toppfart i km/h.' }; }
    return { knots: round1(kmhToKnots(kmh)), kmh: round1(kmh), source };
  }

  const hp = Number(enginePower);
  if (!hp || hp <= 0) return { error: 'Ange motoreffekt i hästkrafter (> 0).' };

  if (match && match.refKn && match.refHp) {
    const knots = round1(match.refKn * Math.sqrt(hp / match.refHp));
    const note = hp === match.refHp ? '' : ` (skalad från ${match.refHp} hk)`;
    return { knots, kmh: round1(knotsToKmh(knots)), source: `Modelltabell: ${prettyModel(boatModel)}${note}` };
  }

  const knots = round1(crouchKnots(category, Number(weightKg), hp));
  return { knots, kmh: round1(knotsToKmh(knots)), source: `Uppskattad (${CATEGORY_LABEL[category] || 'skrovtyp'} · ${hp} hk)` };
}

function prettyModel(m) {
  const s = (m || '').trim();
  return s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : 'okänd modell';
}

/* ============================================================
   2. RIMLIGHETSSPÄRR
   Skyddar mot att medvetet ange för låg fart (sandbagging).
   Tillåt måttlig justering nedåt (standard 20 %), men blockera
   grova avvikelser. Uppåt tillåts generöst (typo-skydd vid 2×).
   ============================================================ */
function speedBounds(estimateKn, maxDevPct) {
  const dev = (Number(maxDevPct) >= 0 ? Number(maxDevPct) : 20) / 100;
  return {
    min: round1(estimateKn * (1 - dev)),
    max: round1(estimateKn * 2),
  };
}
function validateConfirmed(confirmedKn, estimateKn, maxDevPct) {
  if (!(confirmedKn > 0)) return { ok: false, msg: 'Fart måste vara större än 0.' };
  const b = speedBounds(estimateKn, maxDevPct);
  if (confirmedKn < b.min)
    return { ok: false, msg: `För låg jämfört med uppskattat ${sv(estimateKn)} kn. Lägst tillåtet: ${sv(b.min)} kn.` };
  if (confirmedKn > b.max)
    return { ok: false, msg: `Orimligt hög jämfört med uppskattat ${sv(estimateKn)} kn. Högst: ${sv(b.max)} kn.` };
  return { ok: true, bounds: b };
}

/* ============================================================
   3. HANDIKAPP / STARTTIDER
   ============================================================ */
function runtimeMin(distanceNm, knots) { return (distanceNm / knots) * 60; }

function computeStartList(entries, distanceNm, firstStartSec) {
  if (!entries.length) return [];
  const withRt = entries.map((e) => ({ ...e, runtime: runtimeMin(distanceNm, e.speedKnots) }));
  const minRt = Math.min(...withRt.map((e) => e.runtime));
  const maxRt = Math.max(...withRt.map((e) => e.runtime));
  const maxOffset = maxRt - minRt;

  const enriched = withRt.map((e) => {
    const relOffset = e.runtime - minRt;
    const startSec = firstStartSec + (maxOffset - relOffset) * 60;
    return { ...e, relOffsetMin: relOffset, startSec, isFastest: e.runtime === minRt };
  });
  enriched.sort((a, b) => a.startSec - b.startSec || a.name.localeCompare(b.name, 'sv'));
  enriched.forEach((e, i) => { e.place = i + 1; });
  return enriched;
}

function fmtRelative(min) {
  const total = Math.round(min * 60);
  if (total === 0) return { text: '±0:00', zero: true };
  const m = Math.floor(total / 60), s = total % 60;
  return { text: `−${m}:${String(s).padStart(2, '0')}`, zero: false };
}
function fmtClock(sec) {
  let t = ((sec % 86400) + 86400) % 86400;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
function clockToSec(hhmmss) {
  const p = (hhmmss || '13:00:00').split(':').map(Number);
  return (p[0] || 0) * 3600 + (p[1] || 0) * 60 + (p[2] || 0);
}
function fmtDurationMin(min) {
  const total = Math.round(min * 60), m = Math.floor(total / 60), s = total % 60;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

/* ============================================================
   4. PERSISTENS
   ============================================================ */
const defaultState = () => ({
  settings: { distanceNm: 4.6, firstStart: '13:00:00', maxDevPct: 20 },
  locked: false,
  entries: [],
});
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const p = JSON.parse(raw);
    return { ...defaultState(), ...p, settings: { ...defaultState().settings, ...(p.settings || {}) } };
  } catch { return defaultState(); }
}
function saveState() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

let state = loadState();

/* ============================================================
   5. DOM
   ============================================================ */
const $ = (id) => document.getElementById(id);
const el = {
  distanceNm: $('distanceNm'), firstStart: $('firstStart'), maxDev: $('maxDev'),
  form: $('entryForm'), name: $('name'), boatName: $('boatName'), category: $('category'), boatModel: $('boatModel'),
  engineModel: $('engineModel'), enginePower: $('enginePower'), weightKg: $('weightKg'),
  jetskiField: $('jetskiField'), jetskiKmh: $('jetskiKmh'), powerField: $('powerField'), weightField: $('weightField'),
  estimatePanel: $('estimatePanel'), estSource: $('estSource'), knotsValue: $('knotsValue'), kmhValue: $('kmhValue'),
  confirmKnots: $('confirmKnots'), adjustKmh: $('adjustKmh'), confirmBtn: $('confirmBtn'), cancelEstimate: $('cancelEstimate'),
  lockBtn: $('lockBtn'), printBtn: $('printBtn'), statusBanner: $('statusBanner'),
  startTable: $('startTable'), startBody: $('startBody'), emptyState: $('emptyState'),
  listTitle: $('listTitle'), listSub: $('listSub'), listBadge: $('listBadge'), listCount: $('listCount'),
  fineprint: $('fineprint'), listCard: $('listCard'),
  nav: $('siteNav'), navToggle: $('navToggle'), navLinks: $('navLinks'), adminLink: $('adminLink'),
};

let pendingEstimate = null; // fryst systemförslag att validera mot

/* ============================================================
   6. RENDERING
   ============================================================ */
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderStatus() {
  const open = !state.locked, n = state.entries.length;
  el.statusBanner.className = 'status-banner ' + (open ? 'status-open' : 'status-locked');
  el.statusBanner.innerHTML = open
    ? `<span class="txt"><b>Anmälan öppen.</b> ${n} anmäld${n === 1 ? '' : 'a'} — starttider räknas om vid varje ny anmälan.</span>`
    : `<span class="txt"><b>Startfältet är låst.</b> ${n} båt${n === 1 ? '' : 'ar'} i den officiella startlistan.</span>`;
}

function renderStartList() {
  const dist = state.settings.distanceNm;
  const list = computeStartList(state.entries, dist, clockToSec(state.settings.firstStart));
  const has = list.length > 0;

  el.emptyState.hidden = has;
  el.startTable.hidden = !has;

  el.listTitle.textContent = state.locked ? 'Officiell startlista' : 'Startfält';
  el.listSub.textContent = state.locked
    ? 'Fältet är fryst. Starttider och startplatser är låsta.'
    : 'Starttider räknas om automatiskt vid varje anmälan.';
  el.listBadge.textContent = state.locked ? 'Låst' : 'Öppet';
  el.listBadge.className = 'list-badge ' + (state.locked ? 'locked' : 'open');
  el.listCount.textContent = `${list.length} deltagare`;

  el.startBody.innerHTML = list.map((e) => {
    const rel = fmtRelative(e.relOffsetMin);
    const del = (state.locked || !isAdmin()) ? '' : `<td class="col-act no-print"><button class="row-del" title="Ta bort" data-id="${e.id}">✕</button></td>`;
    const tag = e.isFastest ? '<span class="tag-fastest">Snabbast · sist ut</span>' : '';
    return `
      <tr>
        <td class="col-place"><span class="place-badge ${e.place === 1 ? 'first' : ''}">${e.place}</span></td>
        <td class="col-name">
          <span class="cell-name">${escapeHtml(e.name)}</span>${tag}
          <div class="cell-boatname">${escapeHtml(e.boatName || '')}</div>
        </td>
        <td class="col-boat">
          <div class="cell-boat">${escapeHtml(e.boatModel || CATEGORY_LABEL[e.category] || '—')}</div>
          <div class="cell-boat eng">${escapeHtml(e.engineModel || '')}${e.enginePower ? ` · ${e.enginePower} hk` : ''}${e.weightKg ? ` · ${e.weightKg} kg` : ''}</div>
        </td>
        <td class="col-speed">
          <div class="speed-knots">${sv(round1(e.speedKnots))} <span class="u">kn</span></div>
          <div class="speed-kmh">${sv(round1(knotsToKmh(e.speedKnots)))} km/h</div>
        </td>
        <td class="col-rel"><span class="rel-time ${rel.zero ? 'zero' : ''}">${rel.text}</span></td>
        <td class="col-clock"><span class="clock-time">${fmtClock(e.startSec)}</span></td>
        ${del}
      </tr>`;
  }).join('');

  if (!state.locked && isAdmin()) {
    el.startBody.querySelectorAll('.row-del').forEach((b) => b.addEventListener('click', () => removeEntry(b.dataset.id)));
  }

  if (has) {
    const fastest = list.find((e) => e.isFastest);
    el.fineprint.textContent =
      `Sträcka ${sv(dist)} nm · körtid snabbaste båt ${fmtDurationMin(runtimeMin(dist, fastest.speedKnots))} · ` +
      `${list.length} deltagare. Startklocka baserad på första start ${state.settings.firstStart}.`;
  } else { el.fineprint.textContent = ''; }
}

function renderLockState() {
  document.body.classList.toggle('locked', state.locked);
  el.lockBtn.textContent = state.locked ? 'Lås upp' : 'Lås startfältet';
  el.printBtn.hidden = !state.locked;
  [el.distanceNm, el.firstStart, el.maxDev].forEach((i) => { i.disabled = state.locked; });
}

function renderAll() { renderStatus(); renderLockState(); renderStartList(); }

/* ============================================================
   7. HÄNDELSER
   ============================================================ */
function initInputs() {
  el.distanceNm.value = state.settings.distanceNm;
  el.firstStart.value = state.settings.firstStart;
  el.maxDev.value = state.settings.maxDevPct;
}
el.distanceNm.addEventListener('input', () => {
  if (!isAdmin()) return;
  const v = parseFloat(el.distanceNm.value);
  if (v > 0) { state.settings.distanceNm = v; saveState(); renderStartList(); }
});
el.firstStart.addEventListener('input', () => {
  if (!isAdmin()) return;
  const v = el.firstStart.value || '13:00:00';
  state.settings.firstStart = v.length === 5 ? v + ':00' : v;
  saveState(); renderStartList();
});
el.maxDev.addEventListener('input', () => {
  if (!isAdmin()) return;
  const v = parseInt(el.maxDev.value, 10);
  if (v >= 0 && v <= 90) { state.settings.maxDevPct = v; saveState(); }
});

el.category.addEventListener('change', toggleJetski);
function toggleJetski() {
  const isJet = el.category.value === 'jetski';
  el.jetskiField.hidden = !isJet;
  el.powerField.style.display = isJet ? 'none' : '';
  el.weightField.style.display = isJet ? 'none' : '';
  const cat = CATEGORY[el.category.value];
  if (cat) el.weightKg.placeholder = `≈ ${cat.weight} kg`;
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.locked) return;
  if (!el.name.value.trim()) { el.name.focus(); return; }
  if (!el.boatName.value.trim()) { el.boatName.focus(); return; }

  const result = estimateSpeed({
    category: el.category.value, boatModel: el.boatModel.value, enginePower: el.enginePower.value,
    weightKg: el.weightKg.value, jetskiKmh: el.jetskiKmh.value,
  });
  if (result.error) { showEstimateError(result.error); return; }

  pendingEstimate = result;
  el.estSource.textContent = result.source;
  el.knotsValue.textContent = sv(result.knots);
  el.kmhValue.textContent = sv(result.kmh);
  el.confirmKnots.value = result.knots;
  el.confirmKnots.classList.remove('invalid');
  updateAdjust();
  el.estimatePanel.hidden = false;
  el.estimatePanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

function showEstimateError(msg) {
  pendingEstimate = null;
  el.estSource.textContent = '';
  el.knotsValue.textContent = '—';
  el.kmhValue.textContent = '—';
  el.confirmKnots.value = '';
  el.adjustKmh.textContent = msg;
  el.adjustKmh.className = 'hint warn';
  el.estimatePanel.hidden = false;
  el.confirmBtn.disabled = true;
}

el.confirmKnots.addEventListener('input', updateAdjust);
function updateAdjust() {
  const kn = parseFloat(el.confirmKnots.value);
  if (!pendingEstimate) { el.confirmBtn.disabled = true; return; }
  const check = validateConfirmed(kn, pendingEstimate.knots, state.settings.maxDevPct);
  if (check.ok) {
    el.adjustKmh.textContent = `≈ ${sv(round1(knotsToKmh(kn)))} km/h · tillåtet ${sv(check.bounds.min)}–${sv(check.bounds.max)} kn`;
    el.adjustKmh.className = 'hint';
    el.confirmKnots.classList.remove('invalid');
    el.confirmBtn.disabled = false;
  } else {
    el.adjustKmh.textContent = check.msg;
    el.adjustKmh.className = 'hint warn';
    el.confirmKnots.classList.add('invalid');
    el.confirmBtn.disabled = true;
  }
}

el.confirmBtn.addEventListener('click', () => {
  if (state.locked || !pendingEstimate) return;
  const knots = parseFloat(el.confirmKnots.value);
  const name = el.name.value.trim();
  const boatName = el.boatName.value.trim();
  if (!name) { el.name.focus(); return; }
  if (!boatName) { el.boatName.focus(); return; }
  const check = validateConfirmed(knots, pendingEstimate.knots, state.settings.maxDevPct);
  if (!check.ok) { updateAdjust(); return; }

  state.entries.push({
    id: 'e' + Date.now() + Math.floor(Math.random() * 1000),
    name, boatName, category: el.category.value,
    boatModel: el.boatModel.value.trim(), engineModel: el.engineModel.value.trim(),
    enginePower: el.category.value === 'jetski' ? null : (parseInt(el.enginePower.value, 10) || null),
    weightKg: el.category.value === 'jetski' ? null : (parseInt(el.weightKg.value, 10) || null),
    speedKnots: round1(knots),
  });
  saveState();
  resetForm();
  renderAll();
  document.getElementById('startlista').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

el.cancelEstimate.addEventListener('click', resetForm);
function resetForm() {
  el.estimatePanel.hidden = true;
  pendingEstimate = null;
  el.form.reset();
  el.category.value = 'aluminium';
  toggleJetski();
}

function removeEntry(id) {
  if (state.locked || !isAdmin()) return;
  state.entries = state.entries.filter((e) => e.id !== id);
  saveState(); renderAll();
}

/* ---------- Admin-läge ---------- */
function isAdmin() {
  try { return localStorage.getItem(ADMIN_FLAG) === '1'; } catch { return false; }
}
function setAdmin(on) {
  try { on ? localStorage.setItem(ADMIN_FLAG, '1') : localStorage.removeItem(ADMIN_FLAG); } catch {}
  applyAdmin();
}
function applyAdmin() {
  document.body.classList.toggle('admin', isAdmin());
  if (el.adminLink) el.adminLink.textContent = isAdmin() ? 'Logga ut arrangör' : 'Arrangörsinloggning';
}
function initAdmin() {
  // Aktivera via länk ?admin=NYCKEL (t.ex. bokmärke för arrangören)
  try {
    const p = new URLSearchParams(location.search);
    if (p.get('admin') === ADMIN_KEY) {
      setAdmin(true);
      p.delete('admin');
      const qs = p.toString();
      history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
    }
  } catch {}
  applyAdmin();
  if (el.adminLink) el.adminLink.addEventListener('click', () => {
    if (isAdmin()) { setAdmin(false); renderAll(); return; }
    const pass = prompt('Lösenord för arrangör:');
    if (pass == null) return;
    if (pass === ADMIN_KEY) { setAdmin(true); renderAll(); }
    else alert('Fel lösenord.');
  });
}

el.lockBtn.addEventListener('click', () => {
  if (!isAdmin()) return;
  if (!state.locked && state.entries.length === 0) return;
  state.locked = !state.locked;
  saveState(); renderAll();
});
el.printBtn.addEventListener('click', () => window.print());

/* Nav: scroll-effekt + mobilmeny */
function onScroll() { el.nav.classList.toggle('scrolled', window.scrollY > 30); }
window.addEventListener('scroll', onScroll, { passive: true });
el.navToggle.addEventListener('click', () => {
  const open = el.navLinks.classList.toggle('open');
  el.navToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
});
el.navLinks.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => {
  el.navLinks.classList.remove('open');
  el.navToggle.setAttribute('aria-expanded', 'false');
}));

/* Hero-video: säkerställ att den loopar (muted autoplay), robust över webbläsare */
const heroVideo = document.querySelector('.hero-media');
if (heroVideo) {
  const playHero = () => { const p = heroVideo.play(); if (p && p.catch) p.catch(() => {}); };
  playHero();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) playHero(); });
  window.addEventListener('pointerdown', playHero, { once: true });
}

/* ============================================================
   8. INIT
   ============================================================ */
initInputs();
toggleJetski();
onScroll();
initAdmin();
renderAll();
