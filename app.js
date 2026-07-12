/* ============================================================
   Korvgrund Runt — handikappberäknad start
   All fart hanteras internt i KNOP. 1 knop = 1,852 km/h.
   ============================================================ */

'use strict';

const KMH_PER_KNOT = 1.852;

/* Racedag för nedräkningen. Startklockslaget (t.ex. 13:00) kommer från
   arrangörsinställningarna; datumet sätts här. Ändra om racet flyttas. */
const RACE_DATE = '2026-07-15'; // onsdag 15 juli

/* Kartans startvy för live-spårningen (centreras på startplatsen tills
   båtar delar position). Samma punkt som Skippo-länken i banan-sektionen. */
const RACE_CENTER = [61.8353, 17.3571167]; // [lat, lng] — startlinjen (61°50.118'N 17°21.427'E)
const RACE_ZOOM = 13;
const STALE_MS = 45000; // position räknas som "tyst" efter 45 s utan uppdatering

/* Delad databas (Supabase). anon-nyckeln är publik och säker att ligga i
   webbläsaren — behörighet styrs server-sidan av Row Level Security:
   alla får läsa och anmäla sig, men bara inloggad arrangör får ta bort,
   låsa och ändra inställningar. */
const SUPABASE_URL = 'https://ewpqzzaxsbngiemdvgts.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV3cHF6emF4c2JuZ2llbWR2Z3RzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM3MDQ0OTYsImV4cCI6MjA5OTI4MDQ5Nn0.Rmn8FdGbhF2SUmkqowoAlLLMqs5NiYPQh8KuZyrgPGE';
const sb = (window.supabase) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
   4. DELAD DATA (Supabase i realtid)
   ============================================================ */
let state = {
  settings: { distanceNm: 4.6, firstStart: '13:00:00', maxDevPct: 20 },
  locked: false,
  entries: [],
  positions: [],
};

function rowToEntry(r) {
  return {
    id: r.id, name: r.name, boatName: r.boat_name, category: r.category,
    boatModel: r.boat_model, engineModel: r.engine_model,
    enginePower: r.engine_power, weightKg: r.weight_kg, speedKnots: Number(r.speed_knots),
  };
}

async function loadFromDb() {
  if (!sb) { showDbError(); return; }
  try {
    const [rs, regs] = await Promise.all([
      sb.from('race_state').select('*').eq('id', 1).single(),
      sb.from('registrations').select('*').order('created_at', { ascending: true }),
    ]);
    if (rs.error) throw rs.error;
    if (regs.error) throw regs.error;
    state.settings = {
      distanceNm: Number(rs.data.distance_nm),
      firstStart: rs.data.first_start,
      maxDevPct: rs.data.max_dev_pct,
    };
    state.locked = !!rs.data.locked;
    state.entries = (regs.data || []).map(rowToEntry);
    refreshSettingsInputs();
    renderAll();
  } catch (e) {
    showDbError();
  }
}

function subscribeRealtime() {
  if (!sb) return;
  sb.channel('korvgrund-runt')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations' }, loadFromDb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'race_state' }, loadFromDb)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'boat_positions' }, loadPositions)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'korv_orders' }, loadKorv)
    .subscribe();
}

async function updateRaceState(patch) {
  if (!sb || !isAdmin()) return;
  const { error } = await sb.from('race_state').update(patch).eq('id', 1);
  if (error) { alert('Kunde inte spara: ' + error.message); return; }
  await loadFromDb();
}

function refreshSettingsInputs() {
  if (document.activeElement !== el.distanceNm) el.distanceNm.value = state.settings.distanceNm;
  if (document.activeElement !== el.firstStart) el.firstStart.value = state.settings.firstStart;
  if (document.activeElement !== el.maxDev) el.maxDev.value = state.settings.maxDevPct;
}

function showDbError() {
  if (!el.statusBanner) return;
  el.statusBanner.className = 'status-banner status-locked';
  el.statusBanner.innerHTML = '<span class="txt"><b>Kunde inte ansluta till anmälningsdatabasen.</b> Kontrollera nätverket och ladda om sidan.</span>';
}

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
  thanksModal: $('thanksModal'), thanksCloseBtn: $('thanksCloseBtn'), thanksCountdownBtn: $('thanksCountdownBtn'),
  countdownCard: $('countdownCard'), cdPicker: $('cdPicker'), myEntrySelect: $('myEntrySelect'),
  cdBody: $('cdBody'), cdEmpty: $('cdEmpty'), cdStatus: $('cdStatus'), cdBoat: $('cdBoat'),
  cdTime: $('cdTime'), cdTimeLabel: $('cdTimeLabel'), cdMeta: $('cdMeta'),
  thanksCode: $('thanksCode'), thanksCodeVal: $('thanksCodeVal'),
  liveMap: $('liveMap'), liveEmpty: $('liveEmpty'), liveList: $('liveList'),
  shareIdle: $('shareIdle'), sharePick: $('sharePick'), shareBoat: $('shareBoat'), shareCode: $('shareCode'),
  shareStartBtn: $('shareStartBtn'), shareHint: $('shareHint'),
  shareActive: $('shareActive'), shareStatus: $('shareStatus'), shareStopBtn: $('shareStopBtn'),
  liveCodes: $('liveCodes'), codesList: $('codesList'),
  adminModal: $('adminModal'), adminForm: $('adminForm'), adminEmail: $('adminEmail'),
  adminPassword: $('adminPassword'), adminLoginBtn: $('adminLoginBtn'), adminCancelBtn: $('adminCancelBtn'), adminError: $('adminError'),
  heroCountdown: $('heroCountdown'),
  weatherBody: $('weatherBody'), weatherFoot: $('weatherFoot'),
  korvForm: $('korvForm'), korvName: $('korvName'), korvSausages: $('korvSausages'), korvDrinks: $('korvDrinks'),
  korvBtn: $('korvBtn'), korvMsg: $('korvMsg'), korvTallyNote: $('korvTallyNote'),
  ktSausages: $('ktSausages'), ktDrinks: $('ktDrinks'), ktOrders: $('ktOrders'),
  korvAdmin: $('korvAdmin'), korvList: $('korvList'),
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

/* ---------- Min start: nedräkning till egen starttid ---------- */
let myEntryId = null;      // vald båt (id som sträng)
let cdLastRemaining = null; // för att känna av T-0-passagen (vibration)

function raceDayMidnightMs() {
  // Lokal midnatt på racedagen; starttiden läggs på som sekunder.
  return new Date(`${RACE_DATE}T00:00:00`).getTime();
}
function fmtCountdown(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function currentStartList() {
  return computeStartList(state.entries, state.settings.distanceNm, clockToSec(state.settings.firstStart));
}

function renderMyStart() {
  if (!el.myEntrySelect) return;
  const list = currentStartList();
  const has = list.length > 0;
  el.cdEmpty.hidden = has;
  el.cdPicker.hidden = !has;

  const cur = myEntryId ? String(myEntryId) : '';
  el.myEntrySelect.innerHTML =
    '<option value="">Välj din båt …</option>' +
    list.map((e) =>
      `<option value="${e.id}">${escapeHtml(e.name)} · ${escapeHtml(e.boatName || '')} (start ${fmtClock(e.startSec)})</option>`
    ).join('');

  const me = list.find((e) => String(e.id) === cur);
  // Nolla bara valet om fältet är laddat men båten saknas — inte medan datan
  // fortfarande hämtas (då är listan tom och valet ska bevaras).
  if (has && cur && !me) {
    myEntryId = null;
    try { localStorage.removeItem('kgr_my_entry'); } catch {}
  }
  el.myEntrySelect.value = me ? cur : '';

  if (me) {
    el.cdBody.hidden = false;
    el.cdBoat.innerHTML =
      `<span class="cd-boat-name">${escapeHtml(me.boatName || me.name)}</span>` +
      `<span class="cd-boat-sub">${escapeHtml(me.name)} · plats ${me.place} av ${list.length}</span>`;
    const rel = fmtRelative(me.relOffsetMin);
    el.cdMeta.innerHTML =
      `<div class="cd-meta-item"><span class="cd-meta-k">Starttid</span><span class="cd-meta-v">${fmtClock(me.startSec)}</span></div>` +
      `<div class="cd-meta-item"><span class="cd-meta-k">Före snabbaste</span><span class="cd-meta-v">${rel.text}</span></div>` +
      (me.isFastest ? `<div class="cd-meta-item"><span class="cd-meta-k">Position</span><span class="cd-meta-v">Sist ut</span></div>` : '');
    el.cdStatus.textContent = state.locked
      ? '✓ Officiell starttid — fältet är låst'
      : '⚠ Preliminär — kan ändras tills arrangören låser fältet';
    el.cdStatus.className = 'cd-status ' + (state.locked ? 'official' : 'prelim');
  } else {
    el.cdBody.hidden = true;
    el.countdownCard.classList.remove('cd-go');
  }
  tickCountdown();
}

function tickCountdown() {
  if (!el.cdBody || el.cdBody.hidden || !myEntryId) return;
  const me = currentStartList().find((e) => String(e.id) === String(myEntryId));
  if (!me) return;
  const remaining = (raceDayMidnightMs() + me.startSec * 1000) - Date.now();
  if (remaining > 0) {
    el.cdTime.textContent = fmtCountdown(remaining);
    el.cdTimeLabel.textContent = 'till din start';
    el.countdownCard.classList.remove('cd-go');
  } else {
    el.cdTime.textContent = 'START!';
    el.cdTimeLabel.textContent = `Din tid gick ${fmtClock(me.startSec)}`;
    el.countdownCard.classList.add('cd-go');
  }
  if (cdLastRemaining !== null && cdLastRemaining > 0 && remaining <= 0 && navigator.vibrate) {
    navigator.vibrate([300, 120, 300, 120, 600]);
  }
  cdLastRemaining = remaining;
}

if (el.myEntrySelect) {
  el.myEntrySelect.addEventListener('change', () => {
    myEntryId = el.myEntrySelect.value || null;
    try {
      if (myEntryId) localStorage.setItem('kgr_my_entry', myEntryId);
      else localStorage.removeItem('kgr_my_entry');
    } catch {}
    cdLastRemaining = null;
    renderMyStart();
  });
}

/* ---------- Följ live: karta + positionsdelning ---------- */
let myCode = null;          // egen delningskod
let lastRegCode = null;     // kod från senaste anmälan (för tack-modalen)
let liveMap = null, liveMarkers = {}, liveMapFitted = false;
let sharing = false, geoWatchId = null, wakeLock = null, lastPush = 0;

function entryById(id) { return state.entries.find((e) => String(e.id) === String(id)); }
function boatLabel(id) { const e = entryById(id); return (e && (e.boatName || e.name)) || 'Båt'; }

function initLiveMap() {
  if (liveMap || !window.L || !el.liveMap) return;
  liveMap = L.map(el.liveMap, { zoomControl: true }).setView(RACE_CENTER, RACE_ZOOM);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '© OpenStreetMap',
  }).addTo(liveMap);
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18, opacity: 0.9,
  }).addTo(liveMap);
  L.circleMarker(RACE_CENTER, { radius: 7, color: '#0f2c47', weight: 2, fillColor: '#c9a35d', fillOpacity: 1 })
    .addTo(liveMap).bindTooltip('Start · Mål');
  setTimeout(() => liveMap && liveMap.invalidateSize(), 250);
}

async function loadPositions() {
  if (!sb) return;
  try {
    const { data, error } = await sb.from('boat_positions').select('*');
    if (error) throw error;
    state.positions = data || [];
  } catch {
    state.positions = []; // tabellen finns kanske inte än (före migrationen)
  }
  renderLive();
}

function fmtAge(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 10) return 'nyss';
  if (s < 60) return `${s} s sedan`;
  return `${Math.floor(s / 60)} min sedan`;
}

function renderLive() {
  const positions = state.positions || [];
  if (el.liveEmpty) el.liveEmpty.hidden = positions.length > 0;

  if (liveMap && window.L) {
    const seen = new Set(), bounds = [];
    positions.forEach((p) => {
      const id = String(p.registration_id);
      seen.add(id);
      const stale = (Date.now() - new Date(p.updated_at).getTime()) > STALE_MS;
      const icon = L.divIcon({
        className: '', iconSize: [0, 0],
        html: `<div class="boat-pin ${stale ? 'stale' : ''}">${escapeHtml(boatLabel(id))}</div>`,
      });
      if (liveMarkers[id]) liveMarkers[id].setLatLng([p.lat, p.lng]).setIcon(icon);
      else liveMarkers[id] = L.marker([p.lat, p.lng], { icon }).addTo(liveMap);
      bounds.push([p.lat, p.lng]);
    });
    Object.keys(liveMarkers).forEach((id) => {
      if (!seen.has(id)) { liveMap.removeLayer(liveMarkers[id]); delete liveMarkers[id]; }
    });
    if (bounds.length && !liveMapFitted) {
      liveMap.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
      liveMapFitted = true;
    }
  }
  renderLiveList();
}

function renderLiveList() {
  if (!el.liveList) return;
  const positions = (state.positions || []).slice()
    .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  el.liveList.innerHTML = positions.map((p) => {
    const age = Date.now() - new Date(p.updated_at).getTime();
    const stale = age > STALE_MS;
    return `<li><span class="ll-dot ${stale ? 'stale' : ''}"></span>` +
      `<span class="ll-name">${escapeHtml(boatLabel(p.registration_id))}</span>` +
      `<span class="ll-age">${fmtAge(age)}</span></li>`;
  }).join('');
}

function renderShareControl() {
  if (!el.shareIdle) return;
  el.shareActive.hidden = !sharing;
  el.shareIdle.hidden = sharing;
  if (sharing) return;
  const knowMe = !!(myEntryId && myCode);
  el.sharePick.hidden = knowMe;
  if (!knowMe) {
    const list = currentStartList();
    const cur = el.shareBoat.value || (myEntryId ? String(myEntryId) : '');
    el.shareBoat.innerHTML = '<option value="">Välj din båt …</option>' +
      list.map((e) => `<option value="${e.id}">${escapeHtml(e.name)} · ${escapeHtml(e.boatName || '')}</option>`).join('');
    el.shareBoat.value = list.some((e) => String(e.id) === cur) ? cur : '';
    if (myCode && !el.shareCode.value) el.shareCode.value = myCode;
  }
}

async function startSharing() {
  let regId, code;
  if (!el.sharePick.hidden) {
    regId = el.shareBoat.value;
    code = (el.shareCode.value || '').trim().toUpperCase();
  } else { regId = myEntryId; code = myCode; }
  if (!regId) { alert('Välj din båt först.'); return; }
  if (!code) { alert('Fyll i din delningskod.'); return; }
  if (!('geolocation' in navigator)) { alert('Din webbläsare saknar GPS-stöd.'); return; }

  myEntryId = String(regId); myCode = code;
  try { localStorage.setItem('kgr_my_entry', myEntryId); localStorage.setItem('kgr_my_code', myCode); } catch {}

  sharing = true; lastPush = 0;
  renderShareControl();
  el.shareStatus.textContent = 'Väntar på GPS …';
  requestWakeLock();
  geoWatchId = navigator.geolocation.watchPosition(onGeo, onGeoErr, {
    enableHighAccuracy: true, maximumAge: 2000, timeout: 15000,
  });
}

function onGeoErr() {
  el.shareStatus.textContent = 'Kunde inte läsa GPS. Tillåt platsåtkomst och försök igen.';
}
function onGeo(pos) {
  const now = Date.now();
  if (now - lastPush < 2500) return;
  lastPush = now;
  pushPosition(pos.coords);
}
async function pushPosition(c) {
  if (!sb || !sharing) return;
  try {
    const { error } = await sb.rpc('share_position', {
      p_registration_id: myEntryId, p_code: myCode,
      p_lat: c.latitude, p_lng: c.longitude,
      p_accuracy: c.accuracy ?? null, p_speed: c.speed ?? null, p_heading: c.heading ?? null,
    });
    if (error) throw error;
    const t = new Date();
    el.shareStatus.textContent = `Senast delad ${fmtClock(t.getHours() * 3600 + t.getMinutes() * 60 + t.getSeconds())}` +
      (c.accuracy ? ` · ±${Math.round(c.accuracy)} m` : '');
  } catch (e) {
    const msg = (e && e.message) || '';
    if (/share_position|does not exist|schema cache|not find/i.test(msg)) {
      el.shareStatus.textContent = 'Live-delning är inte aktiverad i databasen än.';
    } else if (/kod|code/i.test(msg)) {
      el.shareStatus.textContent = 'Fel delningskod — kontrollera koden.';
      stopSharing();
    } else {
      el.shareStatus.textContent = 'Kunde inte skicka position: ' + msg;
    }
  }
}
function stopSharing() {
  sharing = false;
  if (geoWatchId != null) { navigator.geolocation.clearWatch(geoWatchId); geoWatchId = null; }
  releaseWakeLock();
  renderShareControl();
}
async function requestWakeLock() {
  try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {}
}
async function releaseWakeLock() {
  try { if (wakeLock) { await wakeLock.release(); wakeLock = null; } } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && sharing && !wakeLock) requestWakeLock();
});
if (el.shareStartBtn) el.shareStartBtn.addEventListener('click', startSharing);
if (el.shareStopBtn) el.shareStopBtn.addEventListener('click', stopSharing);

async function loadCodes() {
  if (!el.liveCodes) return;
  if (!sb || !isAdmin()) { el.liveCodes.hidden = true; return; }
  try {
    const { data, error } = await sb.from('boat_secrets').select('registration_id, code');
    if (error) throw error;
    const byId = {};
    (data || []).forEach((r) => { byId[String(r.registration_id)] = r.code; });
    el.codesList.innerHTML = currentStartList().map((e) =>
      `<li><span>${escapeHtml(e.boatName || e.name)}</span><span class="cc-code">${escapeHtml(byId[String(e.id)] || '—')}</span></li>`
    ).join('');
    el.liveCodes.hidden = false;
  } catch { el.liveCodes.hidden = true; }
}

function renderLockState() {
  document.body.classList.toggle('locked', state.locked);
  el.lockBtn.textContent = state.locked ? 'Lås upp' : 'Lås startfältet';
  el.printBtn.hidden = !state.locked;
  [el.distanceNm, el.firstStart, el.maxDev].forEach((i) => { i.disabled = state.locked; });
}

function renderAll() {
  renderStatus(); renderLockState(); renderStartList(); renderMyStart();
  renderShareControl(); renderLive(); loadCodes(); loadKorvAdmin();
}

/* ============================================================
   7. HÄNDELSER
   ============================================================ */
el.distanceNm.addEventListener('change', () => {
  if (!isAdmin()) return;
  const v = parseFloat(el.distanceNm.value);
  if (v > 0) updateRaceState({ distance_nm: v });
});
el.firstStart.addEventListener('change', () => {
  if (!isAdmin()) return;
  let v = el.firstStart.value || '13:00:00';
  if (v.length === 5) v += ':00';
  updateRaceState({ first_start: v });
});
el.maxDev.addEventListener('change', () => {
  if (!isAdmin()) return;
  const v = parseInt(el.maxDev.value, 10);
  if (v >= 0 && v <= 90) updateRaceState({ max_dev_pct: v });
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

el.confirmBtn.addEventListener('click', async () => {
  if (state.locked || !pendingEstimate) return;
  const knots = parseFloat(el.confirmKnots.value);
  const name = el.name.value.trim();
  const boatName = el.boatName.value.trim();
  if (!name) { el.name.focus(); return; }
  if (!boatName) { el.boatName.focus(); return; }
  const check = validateConfirmed(knots, pendingEstimate.knots, state.settings.maxDevPct);
  if (!check.ok) { updateAdjust(); return; }
  if (!sb) { el.adjustKmh.textContent = 'Ingen databasanslutning.'; el.adjustKmh.className = 'hint warn'; return; }

  const isJet = el.category.value === 'jetski';
  const row = {
    name, boat_name: boatName, category: el.category.value,
    boat_model: el.boatModel.value.trim() || null,
    engine_model: el.engineModel.value.trim() || null,
    engine_power: isJet ? null : (parseInt(el.enginePower.value, 10) || null),
    weight_kg: isJet ? null : (parseInt(el.weightKg.value, 10) || null),
    speed_knots: round1(knots),
  };
  el.confirmBtn.disabled = true;
  lastRegCode = null;
  let inserted = null, error = null;
  const res = await sb.rpc('register_boat', {
    p_name: name, p_boat_name: boatName, p_category: el.category.value,
    p_boat_model: row.boat_model, p_engine_model: row.engine_model,
    p_engine_power: row.engine_power, p_weight_kg: row.weight_kg, p_speed_knots: row.speed_knots,
  });
  if (res.error && /register_boat|does not exist|schema cache|not find/i.test(res.error.message || '')) {
    // Före migrationen: falla tillbaka på direkt insert (utan kod).
    const ins = await sb.from('registrations').insert(row).select('id').single();
    inserted = ins.data; error = ins.error;
  } else {
    error = res.error;
    const r = Array.isArray(res.data) ? res.data[0] : res.data;
    if (r) { inserted = { id: r.id }; lastRegCode = r.code || null; }
  }
  el.confirmBtn.disabled = false;
  if (error) {
    el.adjustKmh.textContent = state.locked
      ? 'Anmälan är stängd — startfältet är låst.'
      : ('Kunde inte spara anmälan: ' + error.message);
    el.adjustKmh.className = 'hint warn';
    return;
  }
  if (inserted && inserted.id != null) {
    myEntryId = String(inserted.id);
    cdLastRemaining = null;
    try { localStorage.setItem('kgr_my_entry', myEntryId); } catch {}
    if (lastRegCode) {
      myCode = lastRegCode;
      try { localStorage.setItem('kgr_my_code', myCode); } catch {}
    }
  }
  resetForm();
  await loadFromDb();
  showThanks();
});

/* ---------- Tack-modal efter anmälan ---------- */
function showThanks() {
  if (el.thanksCode) {
    if (lastRegCode) { el.thanksCodeVal.textContent = lastRegCode; el.thanksCode.hidden = false; }
    else el.thanksCode.hidden = true;
  }
  if (!el.thanksModal) {
    document.getElementById('startlista').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  el.thanksModal.hidden = false;
}
function closeThanks() {
  if (el.thanksModal) el.thanksModal.hidden = true;
  document.getElementById('startlista').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function goToCountdown() {
  if (el.thanksModal) el.thanksModal.hidden = true;
  const sec = document.getElementById('min-start');
  if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
if (el.thanksCloseBtn) el.thanksCloseBtn.addEventListener('click', closeThanks);
if (el.thanksCountdownBtn) el.thanksCountdownBtn.addEventListener('click', goToCountdown);
if (el.thanksModal) el.thanksModal.addEventListener('click', (e) => { if (e.target === el.thanksModal) closeThanks(); });

el.cancelEstimate.addEventListener('click', resetForm);
function resetForm() {
  el.estimatePanel.hidden = true;
  pendingEstimate = null;
  el.form.reset();
  el.category.value = 'aluminium';
  toggleJetski();
}

async function removeEntry(id) {
  if (state.locked || !isAdmin() || !sb) return;
  const { error } = await sb.from('registrations').delete().eq('id', id);
  if (error) { alert('Kunde inte ta bort: ' + error.message); return; }
  await loadFromDb();
}

/* ---------- Admin (Supabase Auth: e-post + lösenord) ---------- */
let adminSession = null;
function isAdmin() { return !!adminSession; }
function applyAdmin() {
  document.body.classList.toggle('admin', isAdmin());
  if (el.adminLink) el.adminLink.textContent = isAdmin() ? 'Logga ut arrangör' : 'Arrangörsinloggning';
}
function openAdminModal() {
  el.adminError.textContent = '';
  el.adminEmail.value = '';
  el.adminPassword.value = '';
  el.adminModal.hidden = false;
  el.adminEmail.focus();
}
function closeAdminModal() { el.adminModal.hidden = true; }
async function submitAdminLogin() {
  if (!sb) return;
  const email = el.adminEmail.value.trim();
  const password = el.adminPassword.value;
  if (!email || !password) { el.adminError.textContent = 'Fyll i e-post och lösenord.'; return; }
  el.adminLoginBtn.disabled = true;
  const { error } = await sb.auth.signInWithPassword({ email, password });
  el.adminLoginBtn.disabled = false;
  if (error) { el.adminError.textContent = 'Inloggning misslyckades. Kontrollera uppgifterna.'; return; }
  closeAdminModal();
}
async function onAdminLinkClick() {
  if (!sb) return;
  if (isAdmin()) { await sb.auth.signOut(); return; }
  openAdminModal();
}
async function initAdmin() {
  if (el.adminLink) el.adminLink.addEventListener('click', onAdminLinkClick);
  if (el.adminForm) el.adminForm.addEventListener('submit', (e) => { e.preventDefault(); submitAdminLogin(); });
  if (el.adminCancelBtn) el.adminCancelBtn.addEventListener('click', closeAdminModal);
  if (el.adminModal) el.adminModal.addEventListener('click', (e) => { if (e.target === el.adminModal) closeAdminModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && el.adminModal && !el.adminModal.hidden) closeAdminModal(); });
  if (!sb) { applyAdmin(); return; }
  try { const { data } = await sb.auth.getSession(); adminSession = data.session; } catch {}
  applyAdmin();
  sb.auth.onAuthStateChange((_ev, session) => { adminSession = session; applyAdmin(); renderAll(); });
}

el.lockBtn.addEventListener('click', () => {
  if (!isAdmin()) return;
  if (!state.locked && state.entries.length === 0) return;
  updateRaceState({ locked: !state.locked });
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
   9. NEDRÄKNING TILL SJÄLVA LOPPET (hero, under datumet)
   ============================================================ */
function eventStartMs() {
  return raceDayMidnightMs() + clockToSec(state.settings.firstStart) * 1000;
}
function tickEventCountdown() {
  const cd = el.heroCountdown;
  if (!cd) return;
  const remaining = eventStartMs() - Date.now();
  cd.hidden = false;
  if (remaining <= 0) {
    if (remaining > -6 * 3600 * 1000) {          // upp till ~6 h efter start = "pågår"
      cd.classList.add('live');
      cd.innerHTML = '<span>Loppet pågår just nu 🏁</span>';
    } else {
      cd.classList.remove('live');
      cd.innerHTML = '<span>Tack för i år!</span>';
    }
    return;
  }
  cd.classList.remove('live');
  const total = Math.floor(remaining / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const clock = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  cd.innerHTML = d > 0
    ? `<span>Startskott om</span> <b>${d} d&nbsp;&nbsp;${clock}</b>`
    : `<span>Startskott om</span> <b>${clock}</b>`;
}

/* ============================================================
   10. VÄDERPROGNOS (SMHI öppna data — ingen nyckel behövs)
   ============================================================ */
const WSYMB2 = {
  1: ['Klart', '☀️'], 2: ['Mest klart', '🌤'], 3: ['Växlande molnighet', '⛅'], 4: ['Halvklart', '⛅'],
  5: ['Molnigt', '☁️'], 6: ['Mulet', '☁️'], 7: ['Dimma', '🌫'],
  8: ['Lätta regnskurar', '🌦'], 9: ['Regnskurar', '🌦'], 10: ['Kraftiga regnskurar', '🌧'],
  11: ['Åskskurar', '⛈'], 12: ['Lätt snöblandat regn', '🌨'], 13: ['Snöblandat regn', '🌨'], 14: ['Kraftigt snöblandat regn', '🌨'],
  15: ['Lätta snöbyar', '🌨'], 16: ['Snöbyar', '🌨'], 17: ['Kraftiga snöbyar', '❄️'],
  18: ['Lätt regn', '🌦'], 19: ['Regn', '🌧'], 20: ['Kraftigt regn', '🌧'], 21: ['Åska', '⛈'],
  22: ['Lätt snöblandat regn', '🌨'], 23: ['Snöblandat regn', '🌨'], 24: ['Kraftigt snöblandat regn', '🌨'],
  25: ['Lätt snöfall', '🌨'], 26: ['Snöfall', '❄️'], 27: ['Kraftigt snöfall', '❄️'],
};
const WIND_DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SV', 'V', 'NV'];
function windCompass(deg) { return WIND_DIRS[Math.round((Number(deg) || 0) / 45) % 8]; }
function paramVal(pt, name) {
  const p = (pt.parameters || []).find((x) => x.name === name);
  return p ? p.values[0] : null;
}

async function loadWeather() {
  if (!el.weatherBody) return;
  const [lat, lon] = RACE_CENTER;
  const url = `https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/${lon.toFixed(4)}/lat/${lat.toFixed(4)}/data.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('SMHI ' + res.status);
    const data = await res.json();
    const series = data.timeSeries || [];
    if (!series.length) throw new Error('tom prognos');
    const target = eventStartMs();
    const last = new Date(series[series.length - 1].validTime).getTime();
    if (target > last + 3600 * 1000) {
      renderWeatherNote('SMHI:s prognos sträcker sig cirka 10 dygn framåt. Kom tillbaka närmare loppet så visas väderläget vid starten här.');
      return;
    }
    let best = series[0], bestDiff = Infinity;
    for (const pt of series) {
      const diff = Math.abs(new Date(pt.validTime).getTime() - target);
      if (diff < bestDiff) { bestDiff = diff; best = pt; }
    }
    renderWeather(best);
  } catch {
    renderWeatherNote('Kunde inte hämta väderprognosen just nu — försök igen senare.');
  }
}
function renderWeather(pt) {
  const t = paramVal(pt, 't');
  const ws = paramVal(pt, 'ws');
  const wd = paramVal(pt, 'wd');
  const gust = paramVal(pt, 'gust');
  const [desc, emoji] = WSYMB2[paramVal(pt, 'Wsymb2')] || ['—', '⛅'];

  const rows = [];
  if (ws != null) rows.push(['Vind', `${Math.round(ws)} m/s${wd != null ? ' från ' + windCompass(wd) : ''}`]);
  if (gust != null) rows.push(['Byvind', `${Math.round(gust)} m/s`]);
  const rain = (paramVal(pt, 'pmax') != null) ? paramVal(pt, 'pmax') : paramVal(pt, 'pmean');
  if (rain != null) rows.push(['Nederbörd', rain > 0 ? `${sv(round1(rain))} mm/h` : 'Uppehåll']);
  const r = paramVal(pt, 'r');
  if (r != null) rows.push(['Luftfuktighet', `${Math.round(r)} %`]);

  el.weatherBody.innerHTML =
    '<div class="weather-main">' +
      `<span class="weather-symbol" aria-hidden="true">${emoji}</span>` +
      `<div><div class="weather-temp">${t != null ? Math.round(t) : '–'}<span>°C</span></div>` +
      `<p class="weather-desc">${escapeHtml(desc)}</p></div>` +
    '</div>' +
    '<div class="weather-grid">' +
      rows.map(([k, v]) => `<div class="weather-metric"><span class="wm-k">${escapeHtml(k)}</span><span class="wm-v">${escapeHtml(v)}</span></div>`).join('') +
    '</div>';
  const when = new Date(pt.validTime);
  el.weatherFoot.textContent = `Prognos för ${when.toLocaleString('sv-SE', { weekday: 'long', hour: '2-digit', minute: '2-digit' })} · källa SMHI`;
}
function renderWeatherNote(msg) {
  el.weatherBody.innerHTML = `<p class="weather-note">${escapeHtml(msg)}</p>`;
  if (el.weatherFoot) el.weatherFoot.textContent = 'Prognos: SMHI';
}

/* ============================================================
   11. KORVGRUND SPECIAL — förbeställ korv & dryck
   ============================================================ */
let korvTotals = { sausages: 0, drinks: 0, orders: 0 };

function setKorvTotals(r) {
  if (!r) return;
  korvTotals = {
    sausages: Number(r.total_sausages) || 0,
    drinks: Number(r.total_drinks) || 0,
    orders: Number(r.total_orders) || 0,
  };
}
async function loadKorv() {
  if (!sb || !el.ktSausages) return;
  try {
    const { data, error } = await sb.rpc('korv_totals');
    if (error) throw error;
    setKorvTotals(Array.isArray(data) ? data[0] : data);
  } catch { /* tabell/RPC ej migrerad än — visa nollor */ }
  renderKorvTally();
  loadKorvAdmin();
}
function renderKorvTally() {
  if (!el.ktSausages) return;
  el.ktSausages.textContent = korvTotals.sausages;
  el.ktDrinks.textContent = korvTotals.drinks;
  el.ktOrders.textContent = korvTotals.orders;
  if (el.korvTallyNote) {
    el.korvTallyNote.textContent = korvTotals.orders > 0
      ? `${korvTotals.orders} förbeställning${korvTotals.orders === 1 ? '' : 'ar'} hittills — grillen tackar. 🔥`
      : 'Bli först att förbeställa!';
  }
}
async function loadKorvAdmin() {
  if (!el.korvAdmin || !el.korvList) return;
  if (!sb || !isAdmin()) { el.korvList.innerHTML = ''; return; }
  try {
    const { data, error } = await sb.from('korv_orders')
      .select('name, sausages, drinks, created_at').order('created_at', { ascending: true });
    if (error) throw error;
    el.korvList.innerHTML = (data || []).map((o) =>
      `<li><span class="kl-name">${escapeHtml(o.name || '—')}</span>` +
      `<span class="kl-count">${o.sausages || 0}🌭 · ${o.drinks || 0}🥤</span></li>`
    ).join('') || '<li class="muted">Inga beställningar än.</li>';
  } catch { el.korvList.innerHTML = ''; }
}

if (el.korvForm) {
  el.korvForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (el.korvName.value || '').trim();
    const sausages = Math.max(0, parseInt(el.korvSausages.value, 10) || 0);
    const drinks = Math.max(0, parseInt(el.korvDrinks.value, 10) || 0);
    if (!name) { el.korvName.focus(); return; }
    if (sausages === 0 && drinks === 0) {
      el.korvMsg.textContent = 'Ange minst en korv eller en dryck.';
      el.korvMsg.className = 'hint warn';
      return;
    }
    if (!sb) { el.korvMsg.textContent = 'Ingen databasanslutning.'; el.korvMsg.className = 'hint warn'; return; }
    el.korvBtn.disabled = true;
    try {
      const { data, error } = await sb.rpc('order_korv', { p_name: name, p_sausages: sausages, p_drinks: drinks });
      if (error) throw error;
      setKorvTotals(Array.isArray(data) ? data[0] : data);
      renderKorvTally();
      loadKorvAdmin();
      el.korvMsg.textContent = `Tack ${name.split(' ')[0]}! ${sausages} korv${sausages === 1 ? '' : 'ar'} och ${drinks} dryck${drinks === 1 ? '' : 'er'} noterat. 🌭`;
      el.korvMsg.className = 'hint';
      el.korvForm.reset();
      el.korvSausages.value = 2; el.korvDrinks.value = 1;
    } catch (err) {
      const msg = (err && err.message) || '';
      el.korvMsg.textContent = /order_korv|does not exist|schema cache|not find/i.test(msg)
        ? 'Förbeställning är inte aktiverad i databasen än.'
        : 'Kunde inte spara: ' + msg;
      el.korvMsg.className = 'hint warn';
    } finally {
      el.korvBtn.disabled = false;
    }
  });
}

/* ============================================================
   8. INIT
   ============================================================ */
try {
  myEntryId = localStorage.getItem('kgr_my_entry');
  myCode = localStorage.getItem('kgr_my_code');
} catch {}
refreshSettingsInputs();
toggleJetski();
onScroll();
initAdmin();
initLiveMap();
renderAll();
loadFromDb();
loadPositions();
loadWeather();
loadKorv();
subscribeRealtime();
tickEventCountdown();
setInterval(tickCountdown, 250);
setInterval(tickEventCountdown, 250); // nedräkning till loppet i hero
setInterval(renderLive, 5000); // uppdatera åldrar/gråmarkering på kartan

/* Se till att kartan ritas rätt när sektionen kommer i vy (Leaflet behöver storlek). */
window.addEventListener('load', () => { if (liveMap) liveMap.invalidateSize(); });
window.addEventListener('hashchange', () => {
  if (location.hash === '#live' && liveMap) setTimeout(() => liveMap.invalidateSize(), 200);
});
