// ===== Chinchón – Marcador =====
const APP_VERSION = '1.1.0';
const KEY = 'chinchon-data-v1';
const DEFAULT_RULES = `🃏 NORMAS DEL CHINCHÓN

• Baraja española de 40 cartas. Se reparten 7 cartas a cada jugador.
• Objetivo: ligar las cartas en tríos/cuartetos (mismo número) o escaleras (mismo palo, 3 o más seguidas).
• Se puede cerrar cuando las cartas sin ligar suman 3 puntos o menos.
• Al cerrar, cada jugador suma los puntos de las cartas que no ha ligado (sota 10, caballo 11, rey 12).
• Cerrar con todo ligado: −10 puntos.
• Cerrar sin haber bajado nada antes: −25 puntos.
• CHINCHÓN (escalera de 7 del mismo palo): gana la partida directamente.
• Quien pasa de 100 puntos queda eliminado.
• Reenganche: el eliminado puede volver con los puntos del jugador que más tenga (máximo de reenganches acordado).
• Gana el último jugador que queda.

(Pulsa ✏️ Editar para cambiar estas normas)`;

let S = load();
let tab = S.game ? 'play' : 'play';
let draft = {}; // entradas de la ronda en curso: { idx: {pts:'', m10, m25, pen} }

function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d) return d; } catch (e) {}
  return { groups: [], games: [], game: null, rules: DEFAULT_RULES, settings: { limit: 100, maxRejoins: 1, penalty: 10 } };
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10);
const vibrate = (ms = 15) => navigator.vibrate && navigator.vibrate(ms);
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="card">${html}</div>`; m.classList.remove('hidden'); }
function closeModal() { $('#modal').classList.add('hidden'); }
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => { tab = b.dataset.tab; vibrate(); render(); });

function render() {
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const titles = { play: S.game ? 'Partida en juego' : 'Chinchón', groups: 'Grupos', history: 'Historial', rules: 'Normas' };
  $('#title').textContent = titles[tab];
  const v = $('#view');
  v.style.animation = 'none'; v.offsetHeight; v.style.animation = '';
  v.innerHTML = { play: S.game ? viewGame : viewPlay, groups: viewGroups, history: viewHistory, rules: viewRules }[tab]();
}

// ---------- JUGAR ----------
let selGroup = null;
function viewPlay() {
  const st = S.settings;
  if (!S.groups.length) return `<div class="hero"><img src="icon-192.png" alt="Chinchón"><h2>¡Bienvenido!</h2>
    <p class="muted">Primero crea un grupo con los jugadores.</p><button id="go-groups" class="btn block" onclick="tab='groups';render();openGroupForm()">➕ Crear grupo</button></div>`;
  if (!selGroup || !S.groups.find(g => g.id === selGroup)) selGroup = S.groups[0].id;
  return `<div class="hero" style="padding:14px"><img src="icon-192.png" alt="Chinchón"></div>
  <h2>¿Quién juega?</h2>
  ${S.groups.map(g => `<div class="card row between" onclick="selGroup='${g.id}';render()" style="cursor:pointer;${g.id === selGroup ? 'border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)' : ''}">
     <div><b>${esc(g.name)}</b><div class="muted">${g.players.map(esc).join(' · ')}</div></div><div>${g.id === selGroup ? '✅' : '⚪'}</div></div>`).join('')}
  <h2>Ajustes de la partida</h2>
  <div class="card">
    ${stepper('Límite de puntos (eliminado al pasarlo)', 'limit', st.limit, 5)}
    ${stepper('Reenganches permitidos por jugador', 'maxRejoins', st.maxRejoins, 1)}
    ${stepper('Puntos de penalización', 'penalty', st.penalty, 5)}
  </div>
  <button id="btn-new-game" class="btn block" onclick="newGame()">🃏 Nueva partida</button>`;
}
function stepper(label, key, val, step) {
  return `<label>${label}</label><div class="stepper">
    <button class="btn ghost sm" onclick="setSetting('${key}',${-step})">−</button><b>${val}</b>
    <button class="btn ghost sm" onclick="setSetting('${key}',${step})">+</button></div>`;
}
function setSetting(k, d) { S.settings[k] = Math.max(0, S.settings[k] + d); save(); render(); }

function newGame() {
  const g = S.groups.find(x => x.id === selGroup); if (!g) return;
  S.game = {
    id: uid(), groupId: g.id, groupName: g.name, date: Date.now(), settings: { ...S.settings },
    players: g.players.map(n => ({ name: n, score: 0, rejoins: 0, out: false, chinchones: 0 })), rounds: []
  };
  draft = {}; save(); vibrate(30); render();
}

// ---------- PARTIDA ----------
function entryTotal(e, pen) { return (parseInt(e.pts) || 0) + (e.m10 ? -10 : 0) + (e.m25 ? -25 : 0) + (e.pen || 0) * pen; }
function viewGame() {
  const G = S.game, st = G.settings;
  const alive = G.players.filter(p => !p.out);
  const minScore = Math.min(...alive.map(p => p.score));
  return `<div class="row between muted" style="margin-bottom:10px"><span>${esc(G.groupName)} · Ronda ${G.rounds.length + 1}</span>
    <span>Límite ${st.limit} · Reeng. ${st.maxRejoins}</span></div>
  <div class="players">${G.players.map((p, i) => {
    const e = draft[i] || {}; const t = entryTotal(e, st.penalty);
    const rejLeft = st.maxRejoins - p.rejoins;
    return `<div class="player ${p.out ? 'out' : ''} ${!p.out && alive.length > 1 && p.score === minScore && G.rounds.length ? 'leader' : ''}">
      <div class="row between"><span class="name">${!p.out && p.score === minScore && G.rounds.length ? '👑 ' : ''}${esc(p.name)}</span>
        <div class="badges">${p.rejoins ? `<span class="badge">🔁 ${p.rejoins}</span>` : ''}${p.out ? '<span class="badge red">Eliminado</span>' : `<span class="badge">${rejLeft > 0 ? rejLeft + ' reeng.' : 'sin reeng.'}</span>`}</div></div>
      <div class="row between"><div class="score" id="score-${i}">${p.score}</div><div class="muted">faltan ${Math.max(0, st.limit - p.score)}</div></div>
      <div class="bar"><i style="width:${Math.min(100, p.score / st.limit * 100)}%"></i></div>
      ${p.out ? '' : `<div class="entry"><input id="pts-${i}" type="number" inputmode="numeric" placeholder="Puntos de la mano" value="${e.pts ?? ''}" oninput="setPts(${i},this.value)">
        <div class="pending" id="pend-${i}">${t > 0 ? '+' + t : t}</div></div>
      <div class="quick">
        <button class="${e.m10 ? 'on' : ''}" onclick="toggle(${i},'m10')">−10</button>
        <button class="${e.m25 ? 'on' : ''}" onclick="toggle(${i},'m25')">−25</button>
        <button class="q-ch" onclick="chinchon(${i})">🃏 Chin.</button>
        <button class="q-pen ${e.pen ? 'on' : ''}" onclick="penalty(${i})">⚠️ ${e.pen ? '×' + e.pen : '+' + st.penalty}</button>
      </div>`}
    </div>`;
  }).join('')}</div>
  <div class="sticky-actions">
    ${G.rounds.length ? '<button class="btn ghost" onclick="undoRound()">↩️</button>' : ''}
    <button id="btn-close-round" class="btn block" onclick="closeRound()">✅ Apuntar ronda</button>
  </div>
  ${G.rounds.length ? `<h2>Rondas</h2><div class="card"><table><tr><th>#</th>${G.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${G.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => `<td>${t === null ? '–' : (t > 0 ? '+' + t : t)}${r.events[i] ? `<div class="tag">${r.events[i]}</div>` : ''}</td>`).join('')}</tr>`).join('')}
  </table></div>` : ''}
  <button class="btn danger block" style="margin-top:12px" onclick="abandonGame()">Abandonar partida</button>`;
}
function setPts(i, v) {
  draft[i] = { ...(draft[i] || {}), pts: v };
  const t = entryTotal(draft[i], S.game.settings.penalty); $('#pend-' + i).textContent = t > 0 ? '+' + t : t;
}
function toggle(i, k) { draft[i] = { ...(draft[i] || {}) }; draft[i][k] = !draft[i][k]; if (k === 'm10' && draft[i].m10) draft[i].m25 = false; if (k === 'm25' && draft[i].m25) draft[i].m10 = false; vibrate(); render(); }
function penalty(i) { draft[i] = { ...(draft[i] || {}) }; draft[i].pen = ((draft[i].pen || 0) + 1) % 4; vibrate(); render(); }
function chinchon(i) {
  const p = S.game.players[i];
  modal(`<div class="win"><div style="font-size:3rem">🃏</div><h2>¿Chinchón de ${esc(p.name)}?</h2><p class="muted">Gana la partida directamente.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">Cancelar</button><button class="btn block" onclick="closeModal();doChinchon(${i})">¡Sí, chinchón!</button></div></div>`);
}
function doChinchon(i) {
  const G = S.game; G.players[i].chinchones++;
  G.rounds.push({ before: JSON.parse(JSON.stringify(G.players)), totals: G.players.map((p, j) => p.out ? null : 0), events: G.players.map((p, j) => j === i ? '🃏 CHINCHÓN' : '') });
  finishGame(i, 'chinchón');
}
function closeRound() {
  const G = S.game, st = G.settings;
  const before = JSON.parse(JSON.stringify(G.players));
  const totals = [], events = [];
  G.players.forEach((p, i) => {
    if (p.out) { totals.push(null); events.push(''); return; }
    const e = draft[i] || {}; const t = entryTotal(e, st.penalty);
    p.score += t; totals.push(t);
    events.push([e.m10 && '−10', e.m25 && '−25', e.pen && '⚠️×' + e.pen].filter(Boolean).join(' '));
  });
  // Eliminaciones y reenganches
  const busted = G.players.filter(p => !p.out && p.score > st.limit);
  const safe = G.players.filter(p => !p.out && p.score <= st.limit);
  const msgs = [];
  if (busted.length && !safe.length) {
    // todos se pasan a la vez: sigue el que menos tenga
    const min = Math.min(...busted.map(p => p.score));
    busted.forEach(p => { if (p.score !== min) { p.out = true; msgs.push(`❌ ${p.name} eliminado`); } });
  } else if (busted.length) {
    const top = Math.max(...safe.map(p => p.score));
    busted.forEach(p => {
      const i = G.players.indexOf(p);
      if (p.rejoins < st.maxRejoins) { p.rejoins++; p.score = top; events[i] += ' 🔁'; msgs.push(`🔁 ¡${p.name} se reengancha con ${top}!`); }
      else { p.out = true; events[i] += ' ❌'; msgs.push(`❌ ${p.name} eliminado`); }
    });
  }
  G.rounds.push({ before, totals, events });
  draft = {}; save(); vibrate(25);
  const alive = G.players.filter(p => !p.out);
  if (alive.length === 1) return finishGame(G.players.indexOf(alive[0]), 'último en pie');
  render();
  G.players.forEach((p, i) => { const el = $('#score-' + i); if (el && totals[i]) el.classList.add('bump'); });
  if (msgs.length) toast(msgs.join(' · '), 3200);
}
function undoRound() {
  const G = S.game; const r = G.rounds.pop(); if (!r) return;
  G.players = r.before; save(); toast('Ronda deshecha'); render();
}
function abandonGame() {
  modal(`<h2>¿Abandonar partida?</h2><p class="muted">No se guardará en el historial.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">No</button><button class="btn danger block" onclick="S.game=null;draft={};save();closeModal();render()">Sí, abandonar</button></div>`);
}
function finishGame(wi, how) {
  const G = S.game; G.winner = G.players[wi].name; G.how = how; G.end = Date.now();
  S.games.unshift(G); S.game = null; draft = {}; save(); render();
  confetti(); vibrate([60, 40, 120]);
  modal(`<div class="win"><div class="trophy">🏆</div><h2 style="font-size:1.6rem">¡Gana ${esc(G.winner)}!</h2>
    <p class="muted">Por ${how} · ${G.rounds.length} rondas</p>
    ${G.players.map(p => `<div class="rank"><span>${esc(p.name)}${p.rejoins ? ' 🔁' + p.rejoins : ''}</span><b>${p.score}</b></div>`).join('')}
    <div class="row" style="margin-top:14px"><button class="btn ghost block" onclick="closeModal();tab='history';render()">Historial</button>
    <button class="btn block" onclick="closeModal();selGroup='${G.groupId}';newGame()">Revancha</button></div></div>`);
}
function confetti() {
  const colors = ['#e6c068', '#f6eedb', '#4ccb8a', '#e5605a', '#5fb4e8'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('div'); c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw'; c.style.background = colors[i % 5];
    c.style.animationDuration = 1.5 + Math.random() * 2 + 's'; c.style.animationDelay = Math.random() * .5 + 's';
    document.body.appendChild(c); setTimeout(() => c.remove(), 4500);
  }
}

// ---------- GRUPOS ----------
function viewGroups() {
  return `<button id="btn-new-group" class="btn block" onclick="openGroupForm()">➕ Nuevo grupo</button><h2>Tus grupos</h2>
  ${S.groups.length ? S.groups.map(g => {
    const wins = winsFor(g.id);
    return `<div class="card"><div class="row between"><b>${esc(g.name)}</b>
      <div class="row"><button class="btn ghost sm" onclick="openGroupForm('${g.id}')">✏️</button><button class="btn danger sm" onclick="delGroup('${g.id}')">🗑️</button></div></div>
      ${g.players.map(p => `<div class="rank"><span>${esc(p)}</span><span class="muted">🏆 ${wins[p] || 0}</span></div>`).join('')}</div>`;
  }).join('') : '<div class="empty">Aún no hay grupos</div>'}`;
}
function openGroupForm(id) {
  const g = S.groups.find(x => x.id === id) || { name: '', players: ['', '', ''] };
  window._gp = [...g.players];
  const draw = () => modal(`<h2>${id ? 'Editar' : 'Nuevo'} grupo</h2>
    <label>Nombre del grupo</label><input id="g-name" value="${esc(g.name)}" placeholder="Ej: Los de casa">
    <label>Jugadores (2 a 6)</label>
    ${_gp.map((p, i) => `<div class="row" style="margin-bottom:6px"><input id="g-p${i}" value="${esc(p)}" placeholder="Jugador ${i + 1}" oninput="_gp[${i}]=this.value">
      ${_gp.length > 2 ? `<button class="btn ghost sm" onclick="g_rm(${i})">✕</button>` : ''}</div>`).join('')}
    ${_gp.length < 6 ? '<button class="btn ghost sm" onclick="g_add()">➕ Añadir jugador</button>' : ''}
    <div class="row" style="margin-top:14px"><button class="btn ghost block" onclick="closeModal()">Cancelar</button>
    <button id="btn-save-group" class="btn block" onclick="saveGroup('${id || ''}')">Guardar</button></div>`);
  window.g_add = () => { g.name = $('#g-name').value; _gp.push(''); draw(); };
  window.g_rm = i => { g.name = $('#g-name').value; _gp.splice(i, 1); draw(); };
  draw();
}
function saveGroup(id) {
  const name = $('#g-name').value.trim() || 'Grupo';
  const players = _gp.map(s => s.trim()).filter(Boolean);
  if (players.length < 2) return toast('Pon al menos 2 jugadores');
  if (id) Object.assign(S.groups.find(g => g.id === id), { name, players });
  else { const g = { id: uid(), name, players }; S.groups.push(g); selGroup = g.id; }
  save(); closeModal(); render(); toast('Grupo guardado ✅');
}
function delGroup(id) {
  modal(`<h2>¿Borrar grupo?</h2><p class="muted">El historial de partidas se mantiene.</p><div class="row">
    <button class="btn ghost block" onclick="closeModal()">No</button><button class="btn danger block" onclick="S.groups=S.groups.filter(g=>g.id!=='${id}');save();closeModal();render()">Borrar</button></div>`);
}
function winsFor(gid) { const w = {}; S.games.filter(g => !gid || g.groupId === gid).forEach(g => w[g.winner] = (w[g.winner] || 0) + 1); return w; }

// ---------- HISTORIAL ----------
let histFilter = '';
function viewHistory() {
  const games = S.games.filter(g => !histFilter || g.groupId === histFilter);
  const w = Object.entries(winsFor(histFilter)).sort((a, b) => b[1] - a[1]);
  const medals = ['🥇', '🥈', '🥉'];
  return `<select onchange="histFilter=this.value;render()"><option value="">Todos los grupos</option>
    ${S.groups.map(g => `<option value="${g.id}" ${g.id === histFilter ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
  ${w.length ? `<h2>Ranking de victorias</h2><div class="card">${w.map(([n, c], i) => `<div class="rank"><span>${medals[i] || '·'} ${esc(n)}</span><b>${c}</b></div>`).join('')}</div>` : ''}
  <h2>Partidas (${games.length})</h2>
  ${games.length ? games.map(g => `<div class="card" onclick="showGame('${g.id}')" style="cursor:pointer">
    <div class="row between"><b>🏆 ${esc(g.winner)}</b><span class="muted">${new Date(g.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    <div class="muted">${esc(g.groupName)} · ${g.rounds.length} rondas · ${g.how}</div>
    <div class="muted">${g.players.map(p => `${esc(p.name)} ${p.score}`).join(' · ')}</div></div>`).join('') : '<div class="empty">Todavía no habéis jugado ninguna partida</div>'}`;
}
function showGame(id) {
  const g = S.games.find(x => x.id === id);
  modal(`<h2>${esc(g.groupName)} – ${new Date(g.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</h2>
    <p>🏆 <b>${esc(g.winner)}</b> <span class="muted">(${g.how})</span></p>
    <div style="max-height:45vh;overflow:auto"><table><tr><th>#</th>${g.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${g.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => `<td>${t === null ? '–' : t}${r.events[i] ? `<div class="tag">${r.events[i]}</div>` : ''}</td>`).join('')}</tr>`).join('')}
    <tr><th>Σ</th>${g.players.map(p => `<th>${p.score}</th>`).join('')}</tr></table></div>
    <div class="row" style="margin-top:14px"><button class="btn danger block" onclick="S.games=S.games.filter(x=>x.id!=='${id}');save();closeModal();render()">🗑️ Borrar</button>
    <button class="btn block" onclick="closeModal()">Cerrar</button></div>`);
}

// ---------- NORMAS ----------
let editingRules = false;
function viewRules() {
  if (editingRules) return `<textarea id="rules-text">${esc(S.rules)}</textarea>
    <div class="row" style="margin-top:10px"><button class="btn ghost block" onclick="editingRules=false;render()">Cancelar</button>
    <button id="btn-save-rules" class="btn block" onclick="S.rules=$('#rules-text').value;save();editingRules=false;render();toast('Normas guardadas ✅')">💾 Guardar</button></div>
    <button class="btn ghost sm" style="margin-top:10px" onclick="$('#rules-text').value=DEFAULT_RULES">Restaurar normas por defecto</button>`;
  return `<button id="btn-edit-rules" class="btn block" onclick="editingRules=true;render()">✏️ Editar normas</button>
    <div class="card rules-view" style="margin-top:12px">${esc(S.rules)}</div>`;
}

render();
$('#version').textContent = 'v' + APP_VERSION;

// ---------- AUTO-ACTUALIZACIÓN ----------
// Al abrir la app, al volver a ella y cada minuto: si hay versión nueva publicada,
// borra todas las cachés, actualiza el service worker y recarga a la fuerza.
async function checkUpdate() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { version } = await r.json();
    if (version && version !== APP_VERSION) {
      if (sessionStorage.getItem('reloadedFor') === version) return; // evita bucles
      sessionStorage.setItem('reloadedFor', version);
      toast('🔄 Actualizando a v' + version + '…');
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
      if (navigator.serviceWorker) for (const reg of await navigator.serviceWorker.getRegistrations()) await reg.unregister();
      location.replace(location.pathname + '?v=' + version + '&t=' + Date.now());
    }
  } catch (e) { /* sin conexión: seguimos con la versión actual */ }
}
checkUpdate();
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkUpdate(); });
window.addEventListener('focus', checkUpdate);
setInterval(checkUpdate, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
