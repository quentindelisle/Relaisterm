/* RelaisZ v1.3 – évaluation du relais en EPS · N'EPS by Quentin Delisle */
'use strict';

const KEY = 'relaisz_v1';
const PTS = { main: 3, noTurn: 3 };
const nbP = () => Math.min(5, Math.max(3, S.settings.nbPass ?? 4)); // passages retenus (3 à 5)

/* ---------------- état & stockage ---------------- */
const S = load();
// migrations : v2 = nombre de passages réglable ; v3 = note /20 (barème fixe + autoréférencé /5), genre des élèves
if ((S.settings.v ?? 0) < 3) {
  S.settings.nbPass = S.settings.nbPass ?? 4; S.settings.floor5 = S.settings.floor5 ?? 1;
  S.settings.total = Math.min(100, Math.max(60, S.settings.total || 80));
  S.settings.zt = Math.min(30, Math.max(20, S.settings.zt || 20));
  S.settings.v = 3;
}
function DEFAULTS() { return { total: 80, zt: 20, floor5: 1, nbPass: 4, v: 3 }; }
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.classes) return d; } catch (e) {}
  return { settings: DEFAULTS(), classes: [], cur: null };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('⚠️ Sauvegarde impossible (stockage plein ?)'); }
}
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (ms, d = 2) => (ms / 1000).toFixed(d).replace('.', ',');
const fnum = (n, d = 2) => n.toFixed(d).replace('.', ',');
const cls = () => S.classes.find(c => c.id === S.cur) || null;
const stu = (c, id) => c.students.find(s => s.id === id);
const fullName = s => s ? `${s.nom} ${s.prenom}`.trim() : '(élève supprimé)';
const cap = w => w ? w.charAt(0).toLocaleUpperCase('fr') + w.slice(1).toLocaleLowerCase('fr') : '';
const norm = w => (w || '').toLocaleLowerCase('fr');
// « Prénom N. » ; si deux élèves ont le même prénom et la même initiale, on ajoute des lettres (Lucas Ma. / Lucas Mo.)
function dn(c, id) {
  const s = stu(c, id); if (!s) return '(élève supprimé)';
  if (!s.prenom) return s.nom;
  const nom = s.nom.replace(/\s+/g, '');
  let k = 1;
  const twins = c.students.filter(o => o.id !== s.id && norm(o.prenom) === norm(s.prenom));
  while (k < nom.length && twins.some(o => norm(o.nom.replace(/\s+/g, '')).startsWith(norm(nom.slice(0, k))))) k++;
  return `${s.prenom} ${cap(nom.slice(0, k))}.`;
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------------- navigation ---------------- */
let view = 'classes';
function show(v) {
  if (['tiles', 'results'].includes(v) && !cls()) { toast('Importez ou choisissez une classe'); v = 'classes'; }
  view = v;
  $$('.view').forEach(e => e.classList.toggle('active', e.id === 'v-' + v));
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.view === v || (b.dataset.view === 'tiles' && ['chrono', 'eval'].includes(v))));
  $('#hdr-class').textContent = cls() ? '· ' + cls().name : '';
  ({ classes: renderClasses, tiles: renderTiles, results: renderResults, settings: renderSettings }[v] || (() => {}))();
  window.scrollTo(0, 0);
}
$$('.tab').forEach(b => b.addEventListener('click', () => {
  if (['chrono', 'eval'].includes(view) && !confirm('Quitter le passage en cours ? Il ne sera pas enregistré.')) return;
  stopClock(); show(b.dataset.view);
}));

/* ---------------- scores ----------------
   Chaque course (passage) est notée /20 pour CHAQUE élève :
   · Critères /10 : main 3 + ne se retourne pas 3 + écart de vitesse Zt 4 (commun aux 2 élèves)
   · Performance /10 : barème fixe /5 (selon le genre, proratisé à la distance) + autoréférencé /5 (classe)
   Note finale /20 = somme des N meilleures courses ÷ N (course manquante = 0). */
function passagesOf(c, sid) {
  return c.passages.filter(p => p.d === sid || p.r === sid).sort((a, b) => a.ts - b.ts);
}
const r1 = x => Math.round(x * 10) / 10;
// détail d'une course pour un élève donné
function courseOf(c, p, sid, sc = autoScale(c)) {
  const s = stu(c, sid), g = s?.g || null;
  const fixed = fixedPoints(p.tEnd, dist(p), g);
  const auto = autoPoints(sc, p);
  const perf = r1((fixed ?? 0) + auto);
  return { crit: p.score, fixed, auto, perf, total: r1(p.score + perf), g };
}
function noteOf(c, sid, sc = autoScale(c)) {
  const courses = passagesOf(c, sid).map(p => ({ p, ...courseOf(c, p, sid, sc) }));
  const tot = courses.map(x => x.total);
  const kept = [...courses].sort((a, b) => b.total - a.total).slice(0, nbP());
  const sum = kept.reduce((a, x) => a + x.total, 0);
  const avg = k => kept.reduce((a, x) => a + x[k], 0) / nbP();
  const keptIds = new Set(kept.map(x => x.p.id));
  return { n: courses.length, courses, keptIds, scores: tot, note: sum / nbP(), crit: avg('crit'), perf: avg('perf'),
    noG: !stu(c, sid)?.g && courses.length > 0 };
}
// Écart de vitesse Zt / hors Zt, en % (arrondi au dixième comme à l'affichage)
const SPEED_TIERS = [
  { pts: 4, test: d => d > 0,    label: 'Plus rapide dans la Zt' },
  { pts: 3, test: d => d >= -8,  label: 'Vitesse proche (0 à −8 %)' },
  { pts: 2, test: d => d >= -15, label: 'Vitesse correcte (−8,1 à −15 %)' },
  { pts: 1, test: d => d >= -20, label: 'Vitesse faible (−15,1 à −20 %)' },
  { pts: 0, test: () => true,    label: 'Vitesse inférieure (< −20 %)' }
];
function speedPoints(vZt, vR) {
  const diff = Math.round((vZt - vR) / vR * 1000) / 10;
  const t = SPEED_TIERS.find(x => x.test(diff));
  return { pts: t.pts, key: 'p' + t.pts, label: t.label, diff };
}

/* ---------- barème fixe (Lycée Monge, relais 100 m) ----------
   Temps en secondes sur 100 m, points sur 3 → convertis sur 5.
   Proratisé à la distance courue : seuil × distance / 100. Interpolation linéaire entre les paliers.
   Plus lent que le 1er palier = 0 ; plus rapide que le dernier = 5. */
const BAREME_PTS = [0.1, 0.2, 0.4, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 2.2, 2.4, 2.6, 2.8, 3];
const BAREME_100 = {
  F: [19.5, 19, 18.8, 18.4, 18.1, 17.9, 17.7, 17.5, 17.3, 16.9, 16.5, 16.2, 16, 15.8, 15.6, 15.4],
  G: [17.5, 17, 16.5, 16.2, 15.8, 15.6, 15.4, 15, 14.5, 14.3, 14.1, 13.8, 13.6, 13.4, 13.2, 13]
};
const FIXED_MAX = 5, AUTO_MAX = 5;
const dist = p => p?.cfg?.total || S.settings.total;
const gLabel = g => g === 'F' ? 'Fille' : g === 'G' ? 'Garçon' : '?';
// points /3 pour un temps (s) sur 100 m
function pts100(t, g) {
  const T = BAREME_100[g], P = BAREME_PTS;
  if (t > T[0]) return 0;
  if (t <= T[T.length - 1]) return P[P.length - 1];
  for (let i = 0; i < T.length - 1; i++) {
    if (t <= T[i] && t >= T[i + 1]) {
      if (T[i] === T[i + 1]) return P[i + 1];
      return P[i] + (P[i + 1] - P[i]) * (T[i] - t) / (T[i] - T[i + 1]);
    }
  }
  return 0;
}
// points /5 pour un temps (ms) sur « total » mètres ; null si genre inconnu
function fixedPoints(ms, total, g) {
  if (!BAREME_100[g] || ms == null) return null;
  const t100 = ms / 1000 * 100 / total;
  return r1(pts100(t100, g) * FIXED_MAX / 3);
}
// temps (s) proratisé pour chaque palier, pour affichage
const fixedRows = (g, total) => BAREME_100[g].map((t, i) => [r1(BAREME_PTS[i] * FIXED_MAX / 3), t * total / 100]);

/* ---------- barème autoréférencé /5 ----------
   Sur toutes les courses de la classe, temps ramenés à 100 m (t × 100 / distance) :
   meilleure course = 5, moins bonne = plancher, linéaire entre les deux, arrondi au dixième. */
const floorNote = () => S.settings.floor5 ?? 1;
const t100 = p => p.tEnd * 100 / dist(p);
function autoScale(c) {
  const t = c.passages.map(t100);
  if (!t.length) return null;
  return { tMin: Math.min(...t), tMax: Math.max(...t), n: t.length, floor: floorNote() };
}
function autoPoints(sc, p) {
  if (!sc) return AUTO_MAX;
  if (sc.tMax === sc.tMin) return AUTO_MAX;
  const raw = sc.floor + (AUTO_MAX - sc.floor) * (sc.tMax - t100(p)) / (sc.tMax - sc.tMin);
  return r1(Math.min(AUTO_MAX, Math.max(sc.floor, raw)));
}
// temps (ms, sur 100 m) correspondant à une note autoréférencée
function autoTimeFor(sc, note) {
  if (sc.tMax === sc.tMin) return sc.tMin;
  return sc.tMax - (note - sc.floor) / (AUTO_MAX - sc.floor) * (sc.tMax - sc.tMin);
}
function bestTime(c, sid) {
  const t = passagesOf(c, sid).map(p => p.tEnd);
  return t.length ? Math.min(...t) : null;
}

/* ---------------- import ---------------- */
let pending = null;
$('#imp-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try {
    const rows = /\.(csv|txt)$/i.test(f.name) ? await readCSV(f) : await readXLSX(f);
    const list = parseRows(rows);
    if (!list.length) { toast('Aucun élève trouvé dans le fichier'); return; }
    pending = list;
    if (!$('#imp-name').value.trim()) $('#imp-name').value = f.name.replace(/\.[^.]+$/, '');
    $('#imp-preview').innerHTML = `
      <p><b>${list.length} élèves détectés</b> – vérifiez le découpage Nom / Prénom et indiquez le genre (F / G) :</p>
      <div class="row gap wrap" style="margin-bottom:8px"><span class="hint" style="margin:0">Tous :</span>
        <button class="btn ghost small" data-allg="F">F</button><button class="btn ghost small" data-allg="G">G</button>
        <span class="hint" style="margin:0" id="imp-gcount"></span></div>
      <div class="preview-list">${list.map((s, i) => `<div class="prev-row"><span class="grow"><b>${esc(s.nom)}</b> ${esc(s.prenom)}</span>
        <span class="gseg" data-i="${i}"><button data-g="F">F</button><button data-g="G">G</button></span></div>`).join('')}</div>
      <div class="row gap wrap">
        <button class="btn primary" id="imp-ok">Créer la classe</button>
        ${cls() ? `<button class="btn ghost" id="imp-add">Ajouter à « ${esc(cls().name)} »</button>` : ''}
        <button class="btn ghost" id="imp-no">Annuler</button>
      </div>`;
    const paintG = () => {
      $$('#imp-preview .gseg').forEach(el => el.querySelectorAll('button').forEach(b =>
        b.className = pending[+el.dataset.i].g === b.dataset.g ? 'on ' + b.dataset.g : ''));
      const miss = pending.filter(s => !s.g).length;
      $('#imp-gcount').textContent = miss ? `${miss} genre(s) non renseigné(s)` : '✓ tous les genres sont renseignés';
    };
    $$('#imp-preview .gseg button').forEach(b => b.onclick = () => {
      const s = pending[+b.parentElement.dataset.i]; s.g = s.g === b.dataset.g ? null : b.dataset.g; paintG();
    });
    $$('#imp-preview [data-allg]').forEach(b => b.onclick = () => { pending.forEach(s => s.g = b.dataset.allg); paintG(); });
    paintG();
    const gOk = () => !pending.some(s => !s.g) || confirm('Certains élèves n\'ont pas de genre : leur note au barème fixe sera de 0 tant qu\'il n\'est pas renseigné (modifiable ensuite dans Résultats).\nContinuer ?');
    $('#imp-ok').onclick = () => {
      if (!gOk()) return;
      const name = $('#imp-name').value.trim() || 'Classe';
      const c = { id: uid(), name, students: pending.map(s => ({ id: uid(), ...s })), passages: [], created: Date.now() };
      S.classes.push(c); S.cur = c.id; save(); resetImport();
      toast(`Classe « ${name} » créée`); show('tiles');
    };
    if ($('#imp-add')) $('#imp-add').onclick = () => {
      if (!gOk()) return;
      const c = cls();
      const known = new Set(c.students.map(s => (s.nom + '|' + s.prenom).toLowerCase()));
      let n = 0;
      pending.forEach(s => { if (!known.has((s.nom + '|' + s.prenom).toLowerCase())) { c.students.push({ id: uid(), ...s }); n++; } });
      save(); resetImport(); toast(`${n} élève(s) ajouté(s)`); show('tiles');
    };
    $('#imp-no').onclick = resetImport;
  } catch (err) {
    console.error(err); toast('Lecture du fichier impossible');
  }
});
function resetImport() { pending = null; $('#imp-preview').innerHTML = ''; $('#imp-name').value = ''; }

function readXLSX(f) {
  return f.arrayBuffer().then(buf => {
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  });
}
async function readCSV(f) {
  const buf = await f.arrayBuffer();
  let txt = new TextDecoder('utf-8').decode(buf);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(buf); // CSV Excel FR
  txt = txt.replace(/^﻿/, '');
  const lines = txt.split(/\r?\n/).filter(l => l.trim());
  const first = lines[0] || '';
  const sep = [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.map(l => splitCSVLine(l, sep));
}
function splitCSVLine(line, sep) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur); return out;
}
const isUpper = w => /\p{L}/u.test(w) && w === w.toLocaleUpperCase('fr');
function splitName(full) {
  const parts = full.trim().replace(/\s+/g, ' ').split(' ');
  if (parts.length === 1) return { nom: parts[0], prenom: '' };
  let i = 0; while (i < parts.length && isUpper(parts[i])) i++;
  if (i === 0 || i === parts.length) i = 1; // pas de majuscules distinctives : 1er mot = nom
  return { nom: parts.slice(0, i).join(' '), prenom: parts.slice(i).join(' ') };
}
// genre : F / G (accepte aussi Fille, Garçon, M, H, Femme, Homme, ♀, ♂)
function parseG(v) {
  const x = norm(String(v ?? '').trim()).replace(/\.$/, '');
  if (/^(f|fille|filles|femme|féminin|feminin|♀)$/.test(x)) return 'F';
  if (/^(g|m|h|garçon|garcon|garçons|garcons|homme|masculin|♂)$/.test(x)) return 'G';
  return null;
}
function parseRows(rows) {
  const out = [];
  rows.forEach((r, idx) => {
    let cells = r.map(v => String(v ?? '').trim());
    if (!cells[0]) return;
    if (idx === 0 && /^(nom|noms|élève|eleve|élèves|eleves|name|identit)/i.test(cells[0])) return; // en-tête
    // une colonne (B, C ou D) contenant F / G… = genre
    let g = null;
    const gi = cells.findIndex((v, i) => i > 0 && parseG(v));
    if (gi > 0) { g = parseG(cells[gi]); cells = cells.filter((_, i) => i !== gi); }
    const a = cells[0], b = cells[1] || '';
    // colonne B = prénom seulement si ce n'est pas un nombre / une date
    if (b && !/^[\d\s.,/:-]+$/.test(b)) out.push({ nom: a, prenom: b, g });
    else out.push({ ...splitName(a), g });
  });
  return out.sort(byName);
}
const byName = (x, y) => (x.nom + ' ' + x.prenom).localeCompare(y.nom + ' ' + y.prenom, 'fr', { sensitivity: 'base' });
const byFirst = (x, y) => ((x.prenom || x.nom) + ' ' + x.nom).localeCompare((y.prenom || y.nom) + ' ' + y.nom, 'fr', { sensitivity: 'base' });

/* ---------------- classes ---------------- */
function renderClasses() {
  const el = $('#class-list');
  if (!S.classes.length) { el.innerHTML = '<div class="empty">Aucune classe pour l\'instant.</div>'; return; }
  el.innerHTML = S.classes.map(c => `
    <div class="list-item ${c.id === S.cur ? 'current' : ''}">
      <div class="grow"><b>${esc(c.name)}</b><div class="meta">${c.students.length} élèves · ${c.passages.length} passages</div></div>
      <button class="btn ${c.id === S.cur ? 'primary' : 'ghost'} small" data-open="${c.id}">${c.id === S.cur ? 'Ouverte' : 'Ouvrir'}</button>
      <button class="btn ghost small" data-ren="${c.id}">Renommer</button>
      <button class="btn danger-ghost small" data-del="${c.id}">Suppr.</button>
    </div>`).join('');
  el.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { S.cur = b.dataset.open; save(); show('tiles'); });
  el.querySelectorAll('[data-ren]').forEach(b => b.onclick = () => {
    const c = S.classes.find(x => x.id === b.dataset.ren); const n = prompt('Nouveau nom :', c.name);
    if (n && n.trim()) { c.name = n.trim(); save(); renderClasses(); $('#hdr-class').textContent = cls() ? '· ' + cls().name : ''; }
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => {
    const c = S.classes.find(x => x.id === b.dataset.del);
    if (!confirm(`Supprimer la classe « ${c.name} » et tous ses passages ?`)) return;
    S.classes = S.classes.filter(x => x.id !== c.id); if (S.cur === c.id) S.cur = S.classes[0]?.id || null;
    save(); show('classes');
  });
}

/* ---------------- tuiles ---------------- */
let sel = { d: null, r: null };
function renderTiles() {
  const c = cls(); const el = $('#tiles');
  if (!c.students.length) { el.innerHTML = '<div class="empty">Aucun élève.</div>'; updateSelBar(); return; }
  renderCfgLine();
  const sc = autoScale(c);
  el.innerHTML = [...c.students].sort(byFirst).map(s => {
    const { n, note } = noteOf(c, s.id, sc);
    const dots = Array.from({ length: Math.max(nbP(), n) }, (_, i) =>
      `<span class="dot ${i < n ? (i < nbP() ? 'on' : 'extra') : ''}"></span>`).join('');
    const role = sel.d === s.id ? 'd' : sel.r === s.id ? 'r' : '';
    return `<button class="tile ${n >= nbP() ? 'done' : ''} ${role ? 'sel-' + role : ''}" data-id="${s.id}">
      ${role ? `<span class="role ${role} badge">${role.toUpperCase()}</span>` : ''}
      <span class="nom">${esc(dn(c, s.id))}</span>
      <span class="gtag ${s.g || 'none'}">${s.g || '?'}</span>
      <span class="foot"><span class="dots">${dots}</span><span class="avg">${n ? fnum(note, 1) : ''}</span></span>
    </button>`;
  }).join('');
  el.querySelectorAll('.tile').forEach(t => t.onclick = () => pick(t.dataset.id));
  updateSelBar();
}
function pick(id) {
  const c = cls();
  if (sel.d === id) { sel.d = sel.r; sel.r = null; }
  else if (sel.r === id) sel.r = null;
  else if (!sel.d) sel.d = id;
  else sel.r = id;
  renderTiles();
  if (sel.d && sel.r) {
    const full = [sel.d, sel.r].filter(x => noteOf(c, x).n >= nbP()).map(x => dn(c, x));
    if (full.length && !confirm(`${full.join(' et ')} a/ont déjà ${nbP()} passages.\nContinuer ? (les ${nbP()} meilleurs seront retenus)`)) { sel.r = null; renderTiles(); return; }
    setTimeout(startRun, 250);
  }
}
function updateSelBar() {
  const c = cls();
  [['d', 'Touchez le démarreur'], ['r', 'puis le relayeur']].forEach(([k, ph]) => {
    const slot = $('#slot-' + k);
    slot.classList.toggle('filled', !!sel[k]);
    slot.querySelector('.who').textContent = sel[k] ? dn(c, sel[k]) : ph;
  });
}
$('#sel-clear').onclick = () => { sel = { d: null, r: null }; renderTiles(); };
$('#add-student').onclick = () => {
  const v = prompt('NOM Prénom de l\'élève :'); if (!v || !v.trim()) return;
  let g = null;
  while (!g) {
    const a = prompt('Genre : F (fille) ou G (garçon) ?', ''); if (a === null) return;
    g = parseG(a); if (!g) toast('Répondre F ou G');
  }
  cls().students.push({ id: uid(), ...splitName(v), g }); save(); renderTiles();
};

/* ---------------- chrono ---------------- */
let run = null, raf = null, wake = null;
function startRun() {
  run = { d: sel.d, r: sel.r, t0: null, marks: [] }; // marks : [entréeZt, finZt, fin] en ms depuis le départ
  sel = { d: null, r: null };
  paintPair(); renderChrono(); show('chrono');
  requestWake();
}
function paintPair() {
  const c = cls();
  $('#c-d').textContent = $('#e-d').textContent = dn(c, run.d);
  $('#c-r').textContent = $('#e-r').textContent = dn(c, run.r);
}
$('#c-swap').onclick = () => { [run.d, run.r] = [run.r, run.d]; paintPair(); };

function step() { return run.t0 === null ? 0 : run.marks.length + 1; }
function renderChrono() {
  const st = step();
  $$('.cbtn').forEach(b => {
    const k = +b.dataset.step;
    b.classList.toggle('next', k === st); b.classList.toggle('done', k < st); b.disabled = k !== st;
  });
  const m = run.marks;
  $('#s1').textContent = m[0] != null ? fmt(m[0]) : '–';
  $('#s2').textContent = m[1] != null ? fmt(m[1] - m[0]) : '–';
  $('#s3').textContent = m[2] != null ? fmt(m[2]) : '–';
  if (run.t0 === null) $('#clock').textContent = '0,00';
  else if (m[2] != null) $('#clock').textContent = fmt(m[2]);
}
function tick() {
  if (!run || run.t0 === null || run.marks.length >= 3) return;
  $('#clock').textContent = fmt(performance.now() - run.t0);
  raf = requestAnimationFrame(tick);
}
function stopClock() { cancelAnimationFrame(raf); raf = null; releaseWake(); }

// pointerdown = top immédiat (plus précis que click)
$$('.cbtn').forEach(b => b.addEventListener('pointerdown', e => {
  e.preventDefault();
  if (!run || +b.dataset.step !== step()) return;
  const now = performance.now();
  if (run.t0 === null) { run.t0 = now; tick(); }
  else run.marks.push(now - run.t0);
  if (navigator.vibrate) navigator.vibrate(30);
  renderChrono();
  if (run.marks.length === 3) { cancelAnimationFrame(raf); setTimeout(openEval, 350); }
}));
$('#c-undo').onclick = () => {
  if (!run) return;
  if (run.marks.length) run.marks.pop();
  else if (run.t0 !== null) { run.t0 = null; cancelAnimationFrame(raf); }
  renderChrono(); if (run.t0 !== null && run.marks.length < 3) { cancelAnimationFrame(raf); tick(); }
};
$('#c-reset').onclick = () => { if (!run) return; run.t0 = null; run.marks = []; cancelAnimationFrame(raf); renderChrono(); };
$('#c-cancel').onclick = () => { if (confirm('Abandonner ce passage ?')) { run = null; stopClock(); show('tiles'); } };

async function requestWake() { try { if ('wakeLock' in navigator) wake = await navigator.wakeLock.request('screen'); } catch (e) {} }
function releaseWake() { try { wake && wake.release(); } catch (e) {} wake = null; }

/* ---------------- évaluation ---------------- */
let ev = null;
function openEval() {
  const { total, zt } = S.settings;
  const [tIn, tOut, tEnd] = run.marks;
  const tZt = tOut - tIn, tRest = tEnd - tZt;
  if (tZt <= 0 || tRest <= 0) { toast('Temps incohérents, recommencez'); $('#c-reset').onclick(); return; }
  const vZt = zt / (tZt / 1000), vR = (total - zt) / (tRest / 1000);
  const sp = speedPoints(vZt, vR);
  ev = { main: null, noTurn: null, tZt, tRest, tEnd, tIn, vZt, vR, sp };
  stopClock();

  $('#e-times').innerHTML = `
    <div><span>Temps total (${total} m)</span><b>${fmt(tEnd)} s</b></div>
    <div><span>Entrée Zt</span><b>${fmt(tIn)} s</b></div>
    <div><span>Temps Zt (${zt} m)</span><b>${fmt(tZt)} s</b></div>
    <div><span>Hors Zt (${total - zt} m)</span><b>${fmt(tRest)} s</b></div>`;
  $('#speed-box').innerHTML = `
    <div class="speed">
      <div><span>Vitesse dans la Zt</span><b>${fnum(vZt)} m/s</b><span>${fnum(vZt * 3.6, 1)} km/h</span></div>
      <div><span>Vitesse hors Zt</span><b>${fnum(vR)} m/s</b><span>${fnum(vR * 3.6, 1)} km/h</span></div>
    </div>
    <div class="verdict p${sp.pts}">${sp.label} : ${sp.diff > 0 ? '+' : ''}${fnum(sp.diff, 1)} % → ${sp.pts} pt${sp.pts > 1 ? 's' : ''}</div>`;

  $$('#v-eval .yn .btn').forEach(b => b.classList.remove('chosen'));
  ['#q2', '#q3', '#e-total', '#e-save'].forEach(s => $(s).classList.add('hidden'));
  show('eval');
}
$$('#v-eval .yn .btn').forEach(b => b.onclick = () => {
  const q = b.dataset.q, v = b.dataset.v === '1';
  ev[q] = v;
  b.parentElement.querySelectorAll('.btn').forEach(x => x.classList.toggle('chosen', x === b));
  if (q === 'main') $('#q2').classList.remove('hidden');
  if (ev.main !== null && ev.noTurn !== null) {
    ['#q3', '#e-total', '#e-save'].forEach(s => $(s).classList.remove('hidden'));
    const pm = ev.main ? PTS.main : 0, pn = ev.noTurn ? PTS.noTurn : 0;
    ev.score = pm + pn + ev.sp.pts;
    const c = cls(), tmp = { tEnd: ev.tEnd, cfg: { total: S.settings.total } };
    const sc = autoScale({ passages: [...c.passages, tmp] });
    const auto = autoPoints(sc, tmp);
    const line = (sid, role) => {
      const g = stu(c, sid)?.g, fx = fixedPoints(ev.tEnd, S.settings.total, g);
      const tot = r1(ev.score + (fx ?? 0) + auto);
      return `<div class="perf-line"><span><span class="role ${role}">${role.toUpperCase()}</span> ${esc(dn(c, sid))}
        <span class="gtag ${g || 'none'}">${g || '?'}</span></span>
        <span>Barème ${fx == null ? '<b class="warn">genre ?</b>' : fnum(fx, 1)} + Auto ${fnum(auto, 1)} = <b>${fnum(r1((fx ?? 0) + auto), 1)}</b>/10</span>
        <span class="tot"><b>${fnum(tot, 1)}</b>/20</span></div>`;
    };
    $('#e-total').innerHTML = `Critères : <b>${ev.score}</b> / 10
      <div class="hint">Main ${pm} + Ne se retourne pas ${pn} + Vitesse Zt ${ev.sp.pts}</div>
      <div class="perf-title">Performance ${S.settings.total} m en ${fmt(ev.tEnd)} s (barème fixe /5 + autoréférencé /5)</div>
      ${line(run.d, 'd')}${line(run.r, 'r')}
      <div class="hint">La part autoréférencée est recalculée à chaque nouvelle course de la classe.</div>`;
  }
  b.closest('.card').nextElementSibling?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('#e-save').onclick = () => {
  const c = cls();
  c.passages.push({
    id: uid(), ts: Date.now(), d: run.d, r: run.r,
    tIn: Math.round(ev.tIn), tZt: Math.round(ev.tZt), tEnd: Math.round(ev.tEnd),
    vZt: +ev.vZt.toFixed(3), vR: +ev.vR.toFixed(3),
    main: ev.main, noTurn: ev.noTurn, speed: ev.sp.key, ptsSpeed: ev.sp.pts, score: ev.score,
    cfg: { ...S.settings }
  });
  save();
  toast(`Passage enregistré (critères ${ev.score}/10)`);
  run = null; ev = null; show('tiles');
};
$('#e-cancel').onclick = () => { if (confirm('Annuler ce passage sans l\'enregistrer ?')) { run = null; ev = null; show('tiles'); } };

/* ---------------- résultats ---------------- */
function resultRows(c) {
  const sc = autoScale(c);
  return [...c.students].sort(byFirst).map(s => {
    const r = noteOf(c, s.id, sc);
    return { s, ...r, best: bestTime(c, s.id) };
  });
}
function renderScale(c) {
  const total = S.settings.total;
  $('#r-fixed-title').textContent = `Barème fixe /5 – ${total} m`;
  $('#r-fixed').innerHTML = `
    <div class="fx-wrap"><table class="fx">
      <tr><th>Pts /5</th>${fixedRows('F', total).map(([n]) => `<th>${fnum(n, 1)}</th>`).join('')}</tr>
      <tr><td class="gcell F">Filles</td>${fixedRows('F', total).map(([, t]) => `<td>${fnum(t, 2)}</td>`).join('')}</tr>
      <tr><td class="gcell G">Garçons</td>${fixedRows('G', total).map(([, t]) => `<td>${fnum(t, 2)}</td>`).join('')}</tr>
    </table></div>
    <p class="hint">Barème relais 100 m du lycée (0,1 à 3 pts) converti sur 5 et proratisé à ${total} m (temps × ${fnum(total / 100, 2)}). Note calculée par interpolation linéaire entre les paliers ; plus lent que le 1er palier = 0. Chaque course est notée avec la distance à laquelle elle a été courue.</p>`;

  const sc = autoScale(c), el = $('#r-scale');
  if (!sc) { el.innerHTML = '<div class="empty">Le barème autoréférencé se construit dès la première course chronométrée.</div>'; return; }
  const k = total / 100;
  el.innerHTML = `
    <div class="scale-head">
      <div><span>Meilleure course</span><b>${fmt(sc.tMin * k)} s</b><small>sur ${total} m = 5/5</small></div>
      <div><span>Moins bonne course</span><b>${fmt(sc.tMax * k)} s</b><small>sur ${total} m = ${fnum(sc.floor, 1)}/5</small></div>
      <div><span>Courses</span><b>${sc.n}</b><small>dans la classe</small></div>
    </div>
    ${sc.tMax === sc.tMin ? '<p class="hint">Une seule course de référence pour l\'instant : elle vaut 5/5.</p>' : `
    <div class="scale-grid">${[5, 4, 3, 2, 1, 0].filter(n => n >= sc.floor).map(n => `<div><b>${n}</b><span>${fmt(autoTimeFor(sc, n) * k)} s</span></div>`).join('')}</div>`}
    <p class="hint">Toutes les courses de la classe (temps ramenés à ${total} m si des distances différentes ont été courues). Meilleure = 5, moins bonne = ${fnum(sc.floor, 1)}, linéaire entre les deux, arrondi au dixième. Le barème évolue à chaque nouvelle course.</p>`;
}
function renderNbPass() {
  $$('#nbpass button').forEach(b => b.classList.toggle('on', +b.dataset.n === nbP()));
}
$$('#nbpass button').forEach(b => b.onclick = () => { S.settings.nbPass = +b.dataset.n; save(); renderResults(); toast(`Note calculée sur ${b.dataset.n} courses`); });
function renderResults() {
  const c = cls(); $('#r-class').textContent = '· ' + c.name; renderNbPass();
  const rows = resultRows(c);
  const maxP = Math.max(nbP(), ...rows.map(r => r.n));
  const missG = rows.filter(r => !r.s.g).length;
  $('#r-warn').innerHTML = missG ? `<div class="warnbox">⚠️ ${missG} élève(s) sans genre : touchez « ? » dans la colonne G pour le renseigner (barème fixe = 0 en attendant).</div>` : '';
  $('#r-table').innerHTML = `
    <tr><th style="text-align:left">Élève</th><th>G</th>${Array.from({ length: maxP }, (_, i) => `<th>C${i + 1}<br><small>/20</small></th>`).join('')}
      <th class="sep">Critères<br>/10</th><th>Perf.<br>/10</th><th>Note<br>/20</th><th class="sep">Meilleur<br>temps</th></tr>
    ${rows.map(r => `<tr>
      <td class="name">${esc(dn(c, r.s.id))}</td>
      <td class="gbtn gcell ${r.s.g || 'none'}" data-g="${r.s.id}">${r.s.g || '?'}</td>
      ${Array.from({ length: maxP }, (_, i) => {
        const x = r.courses[i];
        return x == null ? `<td class="miss">${i < nbP() ? '0' : ''}</td>`
          : `<td class="pbtn ${r.n > nbP() && !r.keptIds.has(x.p.id) ? 'drop' : ''}" data-p="${x.p.id}" data-s="${r.s.id}" title="critères ${x.crit} + barème ${x.fixed ?? '?'} + auto ${x.auto}">${fnum(x.total, 1)}<small>${x.crit} | ${fnum(x.perf, 1)}</small></td>`;
      }).join('')}
      <td class="sep">${fnum(r.crit, 2)}</td><td>${fnum(r.perf, 2)}</td>
      <td class="note">${fnum(r.note, 2)}</td>
      <td class="sep ${r.best == null ? 'miss' : ''}">${r.best == null ? '–' : fmt(r.best) + ' s'}</td></tr>`).join('')}`;
  $('#r-table').querySelectorAll('[data-p]').forEach(td => td.onclick = () => passageDetail(td.dataset.p, td.dataset.s));
  $('#r-table').querySelectorAll('[data-g]').forEach(td => td.onclick = () => {
    const s = stu(c, td.dataset.g); s.g = s.g === 'F' ? 'G' : s.g === 'G' ? null : 'F'; save(); renderResults();
  });
  renderScale(c);

  const sc = autoScale(c);
  const h = [...c.passages].sort((a, b) => b.ts - a.ts);
  $('#r-hist').innerHTML = h.length ? h.map(p => {
    const cd = courseOf(c, p, p.d, sc), cr = courseOf(c, p, p.r, sc);
    return `
    <div class="list-item">
      <div class="grow"><span class="role d">D</span> ${esc(dn(c, p.d))} <b>${fnum(cd.total, 1)}</b> → <span class="role r">R</span> ${esc(dn(c, p.r))} <b>${fnum(cr.total, 1)}</b> <small>/20</small>
        <div class="meta">${new Date(p.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })} · ${dist(p)} m (Zt ${p.cfg?.zt ?? '?'} m) en ${fmt(p.tEnd)} s · Zt ${fmt(p.tZt)} s ·
        critères ${p.score}/10 (main ${p.main ? '✓' : '✗'} · ne se retourne pas ${p.noTurn ? '✓' : '✗'} · vitesse ${p.ptsSpeed} pts) · auto ${fnum(cd.auto, 1)}/5</div></div>
      <button class="btn danger-ghost small" data-delp="${p.id}">Suppr.</button>
    </div>`;
  }).join('') : '<div class="empty">Aucun passage enregistré.</div>';
  $('#r-hist').querySelectorAll('[data-delp]').forEach(b => b.onclick = () => delPassage(b.dataset.delp));
}
function passageDetail(pid, sid) {
  const c = cls(), p = c.passages.find(x => x.id === pid), x = courseOf(c, p, sid);
  const txt = `${dn(c, p.d)} (D) → ${dn(c, p.r)} (R)\n` +
    `${dist(p)} m, Zt ${p.cfg?.zt ?? '?'} m · temps ${fmt(p.tEnd)} s · Zt ${fmt(p.tZt)} s\n` +
    `V Zt ${fnum(p.vZt)} m/s · V hors Zt ${fnum(p.vR)} m/s\n\n` +
    `Pour ${dn(c, sid)} (${gLabel(x.g)}) : ${fnum(x.total, 1)}/20\n` +
    `· Critères ${x.crit}/10 (main ${p.main ? '3' : '0'} + ne se retourne pas ${p.noTurn ? '3' : '0'} + vitesse Zt ${p.ptsSpeed})\n` +
    `· Barème fixe ${x.fixed == null ? '? (genre manquant)' : fnum(x.fixed, 1)}/5 + autoréférencé ${fnum(x.auto, 1)}/5\n\nSupprimer ce passage (pour les 2 élèves) ?`;
  if (confirm(txt)) delPassage(pid, true);
}
function delPassage(pid, confirmed) {
  if (!confirmed && !confirm('Supprimer ce passage ? (il sera retiré pour les 2 élèves)')) return;
  const c = cls(); c.passages = c.passages.filter(p => p.id !== pid); save(); renderResults(); toast('Passage supprimé');
}

/* ---------------- export ---------------- */
function exportData() {
  const c = cls(); const rows = resultRows(c); const sc = autoScale(c);
  const head = ['Nom', 'Prénom', 'Genre', ...Array.from({ length: nbP() }, (_, i) => 'Course ' + (i + 1) + ' /20'), 'Courses effectuées',
    'Critères /10', 'Performance /10', 'Note /20', 'Meilleur temps (s)'];
  const notes = rows.map(r => [r.s.nom, r.s.prenom, r.s.g || '',
    ...Array.from({ length: nbP() }, (_, i) => r.scores[i] ?? 0), r.n,
    +r.crit.toFixed(2), +r.perf.toFixed(2), +r.note.toFixed(2),
    r.best == null ? '' : +(r.best / 1000).toFixed(2)]);
  const det = [['Date', 'Distance (m)', 'Zt (m)', 'Démarreur', 'Relayeur', 'Temps total (s)', 'Entrée Zt (s)', 'Temps Zt (s)', 'V Zt (m/s)', 'V hors Zt (m/s)',
    'Main valable', 'Ne se retourne pas', 'Pts vitesse Zt', 'Critères /10', 'Auto /5', 'Barème D /5', 'Note D /20', 'Barème R /5', 'Note R /20']]
    .concat([...c.passages].sort((a, b) => a.ts - b.ts).map(p => {
      const cd = courseOf(c, p, p.d, sc), cr = courseOf(c, p, p.r, sc);
      return [new Date(p.ts).toLocaleString('fr-FR'), dist(p), p.cfg?.zt ?? '', fullName(stu(c, p.d)), fullName(stu(c, p.r)),
        +(p.tEnd / 1000).toFixed(2), +(p.tIn / 1000).toFixed(2), +(p.tZt / 1000).toFixed(2), p.vZt, p.vR,
        p.main ? 'Oui' : 'Non', p.noTurn ? 'Oui' : 'Non', p.ptsSpeed, p.score, cd.auto,
        cd.fixed ?? '', cd.total, cr.fixed ?? '', cr.total];
    }));
  const total = S.settings.total;
  const scale = [[`Barème fixe ${total} m`, 'Filles (s)', 'Garçons (s)']]
    .concat(fixedRows('F', total).map(([n, t], i) => [n, +t.toFixed(2), +fixedRows('G', total)[i][1].toFixed(2)]))
    .concat([[], [`Autoréférencé ${total} m`, 'Temps (s)']])
    .concat(sc ? [5, 4, 3, 2, 1, 0].filter(n => n >= sc.floor).map(n => [n, +(autoTimeFor(sc, n) * total / 100 / 1000).toFixed(2)]) : []);
  return { head, notes, det, scale, name: c.name };
}
const safeName = s => s.replace(/[^\p{L}\d _-]+/gu, '').trim() || 'classe';
async function deliver(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: filename }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
$('#exp-xlsx').onclick = () => {
  const d = exportData(); const wb = XLSX.utils.book_new();
  const ws1 = XLSX.utils.aoa_to_sheet([d.head, ...d.notes]); ws1['!cols'] = [{ wch: 20 }, { wch: 16 }, ...d.head.slice(2).map(() => ({ wch: 12 }))];
  const ws2 = XLSX.utils.aoa_to_sheet(d.det); ws2['!cols'] = d.det[0].map((_, i) => ({ wch: [0, 3, 4].includes(i) ? 22 : 12 }));
  const ws3 = XLSX.utils.aoa_to_sheet(d.scale); ws3['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, ws1, 'Notes'); XLSX.utils.book_append_sheet(wb, ws2, 'Passages');
  XLSX.utils.book_append_sheet(wb, ws3, 'Barèmes');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  deliver(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `Relais_${safeName(d.name)}.xlsx`);
};
$('#exp-csv').onclick = () => {
  const d = exportData();
  const csv = '﻿' + [d.head, ...d.notes].map(r => r.map(v => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
  deliver(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `Relais_${safeName(d.name)}.csv`);
};

/* ---------------- réglages & sauvegarde ---------------- */
function fillSelect(el, from, to, step, unit) {
  if (!el.options.length) for (let v = from; v <= to; v += step) el.add(new Option(`${v} ${unit}`, v));
}
function renderSettings() {
  fillSelect($('#set-total'), 60, 100, 5, 'm'); fillSelect($('#set-zt'), 20, 30, 1, 'm');
  $('#set-total').value = S.settings.total; $('#set-zt').value = S.settings.zt;
  $('#set-floor').value = floorNote();
  renderCfgLine();
}
function renderCfgLine() {
  const el = $('#cfg-line'); if (el) el.textContent = `Course : ${S.settings.total} m · Zt ${S.settings.zt} m`;
}
$('#set-save').onclick = () => {
  const total = parseInt($('#set-total').value, 10), zt = parseInt($('#set-zt').value, 10);
  const floor5 = parseFloat($('#set-floor').value);
  if (!(total >= 60 && total <= 100 && zt >= 20 && zt <= 30)) { toast('Distance 60–100 m, Zt 20–30 m'); return; }
  if (!(floor5 >= 0 && floor5 < 5)) { toast('Note minimale autoréférencée : entre 0 et 4,5'); return; }
  Object.assign(S.settings, { total, zt, floor5 }); save(); renderCfgLine(); toast('Réglages enregistrés');
};
$('#bk-export').onclick = () => {
  const d = new Date().toISOString().slice(0, 10);
  deliver(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }), `RelaisZ_sauvegarde_${d}.json`);
};
$('#bk-import').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (!d || !Array.isArray(d.classes)) throw 0;
    if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
    Object.keys(S).forEach(k => delete S[k]); Object.assign(S, d);
    S.settings = Object.assign(DEFAULTS(), S.settings || {}, { v: 3 });
    save(); toast('Sauvegarde restaurée'); show('classes');
  } catch (err) { toast('Fichier de sauvegarde invalide'); }
});

/* ---------------- démarrage ---------------- */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && view === 'chrono') requestWake(); });
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
renderCfgLine();
show(cls() ? 'tiles' : 'classes');
