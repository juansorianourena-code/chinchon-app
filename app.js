// ===== Chinchón – Marcador =====
const APP_VERSION = '1.6.0';
const KEY = 'chinchon-data-v1';
const OFFICIAL_RULES = [
  ['La baraja', 'Se juega con baraja española de 40 cartas (sin ochos ni nueves). Pueden jugar de 2 a 6 jugadores.'],
  ['El reparto', 'Se reparten 7 cartas a cada jugador, una a una. El resto queda boca abajo como mazo y se da la vuelta a la primera carta para empezar el montón de descartes. El reparto rota cada mano.'],
  ['El turno', 'En su turno, cada jugador roba una carta (del mazo o la última del descarte) y después tira una carta al descarte. Siempre se queda con 7 cartas.'],
  ['Las combinaciones', 'Se ligan cartas de dos formas: grupos de 3 o 4 cartas del mismo número, o escaleras de 3 o más cartas seguidas del mismo palo. Una carta solo puede estar en una combinación.'],
  ['El valor de las cartas', 'Las cartas del 1 al 7 valen su número. Sota, caballo y rey valen 10 puntos cada una.'],
  ['Cerrar', 'Se puede cerrar al tirar, cuando se tienen 6 cartas ligadas y la suelta vale 3 o menos (o todas ligadas). La carta de cierre se deja boca abajo. No se puede cerrar en la primera vuelta.'],
  ['Colocar cartas', 'Cuando alguien cierra con una carta suelta, los demás enseñan sus combinaciones y pueden colocar sus cartas sueltas en las combinaciones del que ha cerrado.'],
  ['La puntuación', 'Tras cada cierre, cada jugador suma los puntos de sus cartas sin ligar. El que cierra suma el valor de su carta suelta. Gana quien menos puntos acumula.'],
  ['Menos diez', 'Si se cierra con las 7 cartas ligadas, se restan 10 puntos. En ese caso los demás no pueden colocar cartas.'],
  ['Menos veinticinco', 'Según la casa, cerrar con una escalera de 7 usando comodín (o la variante acordada) resta 25 puntos.'],
  ['El chinchón', 'Cerrar con una escalera de 7 cartas del mismo palo, sin comodín, es chinchón: se gana la partida al instante.'],
  ['La eliminación', 'Quien pasa del límite de puntos acordado (normalmente 100) queda eliminado.'],
  ['El reenganche', 'El eliminado puede reengancharse, volviendo con la misma puntuación que el jugador que más puntos tenga. El número de reenganches se acuerda antes de empezar.'],
  ['El ganador', 'Gana la partida el último jugador que queda sin eliminar, o quien haga chinchón.']
];
const ORD = ['Primera', 'Segunda', 'Tercera', 'Cuarta', 'Quinta', 'Sexta', 'Séptima', 'Octava', 'Novena', 'Décima', 'Undécima', 'Duodécima', 'Decimotercera', 'Decimocuarta', 'Decimoquinta', 'Decimosexta', 'Decimoséptima', 'Decimoctava', 'Decimonovena', 'Vigésima'];
const ordinal = i => ORD[i] || `Norma ${i + 1}`;
const officialCopy = () => OFFICIAL_RULES.map(([title, text]) => ({ title, text }));
const uid = () => Math.random().toString(36).slice(2, 10);
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vibrate = (ms = 15) => navigator.vibrate && navigator.vibrate(ms);

let S = load();
if (!S.rulesList) { S.rulesList = officialCopy(); save(); }
let tab = 'play';
let draft = {}; // entradas de la ronda en curso: { idx: {pts:'', m10, m25, pen} }

// ===== Multijugador / Sala en vivo =====
let currentRoomCode = null;
let myPlayerName = localStorage.getItem('chinchon_player_name') || null;
let myPlayerIndex = null;
let isHost = true;
let remoteDrafts = {};
let mqttClient = null;

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d) {
      if (!d.adminId) d.adminId = uid();
      if (d.settings && d.settings.potPerEntry === undefined) d.settings.potPerEntry = 0;
      return d;
    }
  } catch (e) {}
  return { adminId: uid(), groups: [], games: [], game: null, rulesList: officialCopy(), settings: { limit: 100, maxRejoins: 1, penalty: 10, potPerEntry: 0 } };
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
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
    <p class="muted">Primero crea un grupo con los jugadores.</p><button id="go-groups" class="btn block" onclick="tab='groups';render();openGroupForm()">Crear grupo</button></div>`;
  if (!selGroup || !S.groups.find(g => g.id === selGroup)) selGroup = S.groups[0].id;
  return `<div class="hero" style="padding:14px"><img src="icon-192.png" alt="Chinchón"></div>
  <h2>¿Quién juega?</h2>
  ${S.groups.map(g => `<div class="card row between" onclick="selGroup='${g.id}';render()" style="cursor:pointer;${g.id === selGroup ? 'border-color:var(--ink)' : ''}">
     <div><b>${esc(g.name)}</b><div class="muted">${g.players.map(esc).join(' · ')}</div></div><div>${g.id === selGroup ? '<b style="color:var(--accent)">●</b>' : '<span class="muted">○</span>'}</div></div>`).join('')}
  <h2>Ajustes de la partida</h2>
  <div class="card">
    ${stepper('Límite de puntos (eliminado al pasarlo)', 'limit', st.limit, 5)}
    ${stepper('Reenganches permitidos por jugador', 'maxRejoins', st.maxRejoins, 1)}
    ${stepper('Puntos de penalización', 'penalty', st.penalty, 5)}
    ${stepper('Bote por jugador y reenganche (€)', 'potPerEntry', st.potPerEntry || 0, 0.5)}
  </div>
  <button id="btn-new-game" class="btn block" onclick="promptGameMode()">Nueva partida</button>`;
}
function stepper(label, key, val, step) {
  return `<label>${label}</label><div class="stepper">
    <button class="btn ghost sm" onclick="setSetting('${key}',${-step})">−</button><b>${key === 'potPerEntry' ? (val > 0 ? val.toFixed(2) + ' €' : 'Sin bote') : val}</b>
    <button class="btn ghost sm" onclick="setSetting('${key}',${step})">+</button></div>`;
}
function setSetting(k, d) { S.settings[k] = Math.max(0, Math.round(((S.settings[k] || 0) + d) * 10) / 10); save(); render(); }

function promptGameMode() {
  const g = S.groups.find(x => x.id === selGroup);
  if (!g) return toast('Elige o crea un grupo primero');
  modal(`<h2>¿Cómo vais a jugar?</h2>
    <p class="muted">Elige cómo se apuntarán los puntos en esta partida:</p>
    
    <div class="card" onclick="closeModal();startNewGame('online')" style="cursor:pointer;margin-bottom:12px;border:1.5px solid var(--ok);background:#f6fbf8">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem;color:var(--ok)">📱 Modo Móviles (Mesa conectada)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Cada jugador apunta sus puntos desde su propio móvil por enlace.<br>
            👑 <b>Tú eres el Administrador</b> y siempre ves y controlas todo.
          </div>
        </div>
        <span style="font-size:1.5rem;color:var(--ok)">›</span>
      </div>
    </div>
    
    <div class="card" onclick="closeModal();startNewGame('single')" style="cursor:pointer">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem">✍️ Modo Clásico (Un solo móvil)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Una sola persona apunta las cartas y puntos de todos en este mismo teléfono.
          </div>
        </div>
        <span style="font-size:1.5rem">›</span>
      </div>
    </div>
    
    <button class="btn ghost block" onclick="closeModal()">Cancelar</button>`);
}

function startNewGame(mode) {
  const g = S.groups.find(x => x.id === selGroup); if (!g) return;
  const room = mode === 'online' ? ('CH-' + Math.random().toString(36).substring(2, 6).toUpperCase()) : null;
  S.game = {
    id: uid(), adminId: S.adminId, groupId: g.id, groupName: g.name, date: Date.now(), settings: { ...S.settings },
    players: g.players.map(n => ({ name: n, score: 0, rejoins: 0, out: false, chinchones: 0 })), rounds: [], dealer: 0,
    mode: mode, roomCode: room
  };
  draft = {}; remoteDrafts = {}; isHost = true;
  save(); vibrate(30); render();
  
  if (mode === 'online') {
    currentRoomCode = room;
    initMqtt(room, () => {
      sendMqtt({ type: 'sync', game: S.game, draft });
    });
    setTimeout(() => openShareModal(), 350);
  }
}
function newGame() { promptGameMode(); }

// ---------- PARTIDA ----------
function entryTotal(e, pen) { return (parseInt(e.pts) || 0) + (e.m10 ? -10 : 0) + (e.m25 ? -25 : 0) + (e.pen || 0) * pen; }
function viewGame() {
  const G = S.game, st = G.settings;
  const alive = G.players.filter(p => !p.out);
  const minScore = Math.min(...alive.map(p => p.score));
  const dealerIdx = G.dealer ?? 0;
  const dealerPlayer = G.players[dealerIdx] || G.players[0] || { name: '–' };
  const roomActive = !!(G.roomCode && currentRoomCode);
  
  // Determinamos el rol: Si coincide el adminId somos el Administrador supremo
  if (G.adminId) isHost = (G.adminId === S.adminId);
  syncMyPlayerIndex();
  const isGuest = !isHost && myPlayerIndex !== null;

  // Barra de cabecera según rol
  let topHeader = '';
  if (isHost) {
    topHeader = `<div class="row between" style="background:var(--paper2);border:1px solid var(--ink);border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:.85rem">
      <span>👑 <b>Eres el Administrador</b> ${G.mode === 'online' ? '· Sala ' + esc(G.roomCode) : '· Modo clásico'}</span>
      <span>${G.mode === 'online' ? '<button class="btn ghost sm" onclick="openShareModal()">🔗 Invitar / Enlace</button>' : ''}</span>
    </div>`;
  } else if (roomActive) {
    topHeader = `<div class="live-bar" onclick="openShareModal()">
      <span><i class="live-dot"></i><b>Mesa en directo: ${esc(G.roomCode)}</b></span>
      <span style="font-size:.8rem">Info ›</span>
    </div>`;
  }

  // Bote acumulado si aplica
  const potVal = st.potPerEntry || 0;
  let potBanner = '';
  if (potVal > 0) {
    const entriesCount = G.players.length + G.players.reduce((sum, p) => sum + (p.rejoins || 0), 0);
    const potTotal = (entriesCount * potVal).toFixed(2);
    potBanner = `<div class="pot-card">
      <span>💰 <b>Bote acumulado:</b></span>
      <b style="font-size:1.05rem;color:#7a5a0f">${potTotal} € <span class="muted" style="font-size:.78rem">(${entriesCount} entradas)</span></b>
    </div>`;
  }

  // Panel personal para invitados (su propio móvil)
  const guestBanner = isGuest && G.players[myPlayerIndex] ? `<div class="guest-panel">
    <div class="row between"><span class="guest-tag">Tu panel de juego</span>
      <span class="muted" style="font-size:.78rem;cursor:pointer" onclick="promptJoinIdentity(currentRoomCode)">Cambiar (${esc(myPlayerName)})</span></div>
    <div style="font-size:1.15rem;font-weight:700;margin:4px 0 6px">${esc(myPlayerName)} · ${G.players[myPlayerIndex].score} puntos</div>
    ${myPlayerIndex === dealerIdx && !G.players[myPlayerIndex].out ? '<div class="badge" style="background:var(--ink);color:var(--paper);display:block;text-align:center;padding:6px;font-weight:700;margin-bottom:8px">🂠 ¡Te toca barajar y dar cartas!</div>' : ''}
    <div class="row between muted" style="font-size:.85rem;margin-bottom:10px">
      <span>Faltan ${Math.max(0, st.limit - G.players[myPlayerIndex].score)} pts</span>
      <span>${st.maxRejoins - G.players[myPlayerIndex].rejoins} reeng. restantes</span>
    </div>
    ${G.players[myPlayerIndex].out ? '<div class="badge red" style="display:block;text-align:center;padding:8px">Estás eliminado de esta partida</div>' : `
      <label>Apunta tus puntos de esta mano:</label>
      <div class="entry"><input id="guest-pts" type="number" inputmode="numeric" placeholder="Puntos mano" value="${(draft[myPlayerIndex] || {}).pts ?? ''}" oninput="setPts(${myPlayerIndex},this.value);submitGuestPts()">
        <div class="pending">${entryTotal(draft[myPlayerIndex] || {}, st.penalty) > 0 ? '+' + entryTotal(draft[myPlayerIndex] || {}, st.penalty) : entryTotal(draft[myPlayerIndex] || {}, st.penalty)}</div></div>
      <div class="quick">
        <button class="${(draft[myPlayerIndex] || {}).m10 ? 'on' : ''}" onclick="toggle(${myPlayerIndex},'m10');submitGuestPts()">−10</button>
        <button class="${(draft[myPlayerIndex] || {}).m25 ? 'on' : ''}" onclick="toggle(${myPlayerIndex},'m25');submitGuestPts()">−25</button>
        <button class="q-ch" onclick="chinchon(${myPlayerIndex})">Chinchón</button>
        <button class="q-pen ${(draft[myPlayerIndex] || {}).pen ? 'on' : ''}" onclick="penalty(${myPlayerIndex});submitGuestPts()">${(draft[myPlayerIndex] || {}).pen ? '×' + (draft[myPlayerIndex] || {}).pen : '+' + st.penalty}</button>
      </div>
      <button class="btn block" style="margin-top:10px" onclick="submitGuestPts()">✅ Enviar mis puntos a la mesa</button>
      <button class="btn btn-bell block" style="margin-top:8px" onclick="triggerCloseBell()">🔔 ¡He cerrado la mano!</button>
    `}
  </div>` : '';

  return `${topHeader}${potBanner}${guestBanner}
  <div class="row between muted" style="margin-bottom:10px"><span>${esc(G.groupName)} · Ronda ${G.rounds.length + 1}</span>
    <span>Límite ${st.limit} · Reeng. ${st.maxRejoins}</span></div>
  <div class="dealer" ${isHost ? 'onclick="nextDealer()"' : ''}><span class="muted">Reparte</span> <b>${esc(dealerPlayer.name)}</b> ${isHost ? '<span class="muted">· tocar para cambiar</span>' : ''}</div>
  ${isHost ? `<button class="btn btn-bell block" style="margin-bottom:12px" onclick="triggerCloseBell()">🔔 ¡He cerrado la mano!</button>` : ''}
  <div class="players">${G.players.map((p, i) => {
    const e = draft[i] || {}; const t = entryTotal(e, st.penalty);
    const rejLeft = st.maxRejoins - p.rejoins;
    
    // Al Administrador le aparecen siempre todos los controles de todos los jugadores
    // A los invitados solo les aparece la vista informativa sin inputs para los demás
    const showControls = isHost;

    return `<div class="player ${p.out ? 'out' : ''} ${!p.out && alive.length > 1 && p.score === minScore && G.rounds.length ? 'leader' : ''}">
      <div class="row between"><span class="name">${!p.out && p.score === minScore && G.rounds.length ? '' : ''}${esc(p.name)}</span>
        <div class="badges">${remoteDrafts[i] ? '<span class="remote-badge">✓ Remoto</span>' : ''}${i === dealerIdx && !p.out ? '<span class="badge" style="border-color:var(--ink);color:var(--ink);font-weight:600">🂠 Reparte</span>' : ''}${p.rejoins ? `<span class="badge">↻ ${p.rejoins}</span>` : ''}${p.out ? '<span class="badge red">Eliminado</span>' : `<span class="badge">${rejLeft > 0 ? rejLeft + ' reeng.' : 'sin reeng.'}</span>`}</div></div>
      <div class="row between"><div class="score" id="score-${i}">${p.score}</div><div class="muted">faltan ${Math.max(0, st.limit - p.score)}</div></div>
      <div class="bar"><i style="width:${Math.min(100, p.score / st.limit * 100)}%"></i></div>
      ${p.out ? '' : (showControls ? `
        <div class="entry"><input id="pts-${i}" type="number" inputmode="numeric" placeholder="Puntos de la mano" value="${e.pts ?? ''}" oninput="setPts(${i},this.value)">
          <div class="pending" id="pend-${i}">${t > 0 ? '+' + t : t}</div></div>
        <div class="quick">
          <button class="${e.m10 ? 'on' : ''}" onclick="toggle(${i},'m10')">−10</button>
          <button class="${e.m25 ? 'on' : ''}" onclick="toggle(${i},'m25')">−25</button>
          <button class="q-ch" onclick="chinchon(${i})">Chinchón</button>
          <button class="q-pen ${e.pen ? 'on' : ''}" onclick="penalty(${i})">${e.pen ? '×' + e.pen : '+' + st.penalty}</button>
        </div>` : `
        <div style="margin-top:6px;font-size:.85rem">
          ${remoteDrafts[i] || (e.pts !== undefined && e.pts !== '') ? `<span style="color:var(--ok);font-weight:600">✓ Puntos apuntados (${t > 0 ? '+' + t : t})</span>` : '<span class="muted">⏳ Jugando mano...</span>'}
        </div>
      `)}
    </div>`;
  }).join('')}</div>
  ${isHost ? `
    <div class="sticky-actions">
      ${G.rounds.length ? '<button class="btn ghost" onclick="undoRound()">↩️</button>' : ''}
      <button id="btn-close-round" class="btn block" onclick="closeRound()">Apuntar ronda</button>
    </div>` : `
    <div class="card" style="text-align:center;padding:12px;background:var(--paper2);margin-top:14px">
      <span class="muted">👑 Esperando a que el Administrador cierre la ronda</span>
    </div>`}
  ${G.rounds.length ? `<h2>Rondas</h2><div class="card"><table><tr><th>#</th>${G.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${G.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => `<td>${t === null ? '–' : (t > 0 ? '+' + t : t)}${r.events[i] ? `<div class="tag">${r.events[i]}</div>` : ''}</td>`).join('')}</tr>`).join('')}
  </table></div>` : ''}
  ${isHost ? '<button class="btn danger block" style="margin-top:12px" onclick="abandonGame()">Abandonar partida</button>' : ''}`;
}
function setPts(i, v) {
  draft[i] = { ...(draft[i] || {}), pts: v };
  const t = entryTotal(draft[i], S.game.settings.penalty);
  const pend = $('#pend-' + i); if (pend) pend.textContent = t > 0 ? '+' + t : t;
}
function toggle(i, k) { draft[i] = { ...(draft[i] || {}) }; draft[i][k] = !draft[i][k]; if (k === 'm10' && draft[i].m10) draft[i].m25 = false; if (k === 'm25' && draft[i].m25) draft[i].m10 = false; vibrate(); render(); }
function penalty(i) { draft[i] = { ...(draft[i] || {}) }; draft[i].pen = ((draft[i].pen || 0) + 1) % 4; vibrate(); render(); }
function chinchon(i) {
  const p = S.game.players[i];
  modal(`<div class="win"><div style="font-size:3rem"></div><h2>¿Chinchón de ${esc(p.name)}?</h2><p class="muted">Gana la partida directamente.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">Cancelar</button><button class="btn block" onclick="closeModal();doChinchon(${i})">¡Sí, chinchón!</button></div></div>`);
}
function doChinchon(i) {
  const G = S.game; G.players[i].chinchones++;
  G.rounds.push({ before: JSON.parse(JSON.stringify(G.players)), totals: G.players.map((p, j) => p.out ? null : 0), events: G.players.map((p, j) => j === i ? 'CHINCHÓN' : '') });
  finishGame(i, 'chinchón');
}
function closeRound() {
  const G = S.game, st = G.settings;
  const before = JSON.parse(JSON.stringify(G.players));
  const totals = [], events = [], flags = [];
  G.players.forEach((p, i) => {
    if (p.out) { totals.push(null); events.push(''); return; }
    const e = draft[i] || {}; const t = entryTotal(e, st.penalty);
    p.score += t; totals.push(t);
    events.push([e.m10 && '−10', e.m25 && '−25', e.pen && '×' + e.pen].filter(Boolean).join(' '));
    flags[i] = { m10: !!e.m10, m25: !!e.m25, pen: e.pen || 0 };
  });
  // Eliminaciones y reenganches
  const busted = G.players.filter(p => !p.out && p.score > st.limit);
  const safe = G.players.filter(p => !p.out && p.score <= st.limit);
  const msgs = [];
  if (busted.length && !safe.length) {
    // todos se pasan a la vez: sigue el que menos tenga
    const min = Math.min(...busted.map(p => p.score));
    busted.forEach(p => { if (p.score !== min) { p.out = true; msgs.push(`✕ ${p.name} eliminado`); } });
  } else if (busted.length) {
    const top = Math.max(...safe.map(p => p.score));
    busted.forEach(p => {
      const i = G.players.indexOf(p);
      if (p.rejoins < st.maxRejoins) { p.rejoins++; p.score = top; events[i] += ' ↻ '; msgs.push(pick(TAUNT_REJOIN)(p.name, top)); }
      else { p.out = true; events[i] += ' ✕'; msgs.push(pick(TAUNT_OUT)(p.name)); }
    });
  }
  // pique: alguien al borde
  if (!msgs.length) G.players.forEach((p, i) => { if (!p.out && st.limit - p.score <= 10 && totals[i] > 0) msgs.push(pick(TAUNT_EDGE)(p.name, st.limit - p.score)); });
  G.rounds.push({ before, totals, events, flags, dealer: G.dealer ?? 0 });
  advanceDealer();
  draft = {}; remoteDrafts = {}; save(); vibrate(25);
  sendMqtt({ type: 'sync', game: G, draft: {} });
  const alive = G.players.filter(p => !p.out);
  if (alive.length === 1) return finishGame(G.players.indexOf(alive[0]), 'último en pie');
  render();
  G.players.forEach((p, i) => { const el = $('#score-' + i); if (el && totals[i]) el.classList.add('bump'); });
  if (msgs.length) toast(msgs.join(' · '), 3200);
}
function undoRound() {
  const G = S.game; const r = G.rounds.pop(); if (!r) return;
  G.players = r.before; if (r.dealer !== undefined) G.dealer = r.dealer; save(); toast('Ronda deshecha');
  sendMqtt({ type: 'sync', game: G, draft: {} });
  render();
}
function advanceDealer() {
  const G = S.game; if (!G || !G.players || !G.players.length) return;
  const n = G.players.length; let d = G.dealer ?? 0;
  for (let k = 0; k < n; k++) { d = (d + 1) % n; if (!G.players[d].out) break; }
  G.dealer = d;
}
function nextDealer() { advanceDealer(); save(); render(); vibrate(); if (S.game) sendMqtt({ type: 'sync', game: S.game, draft }); }
const pick = a => a[Math.floor(Math.random() * a.length)];
const TAUNT_REJOIN = [
  (n, t) => `${n} se reengancha con ${t}. Vida extra.`,
  (n, t) => `${n} vuelve con ${t}. Que no se acostumbre.`,
  (n, t) => `${n} paga y vuelve a la mesa con ${t}.`,
  (n, t) => `Resucita ${n}, con ${t}. A ver cuánto dura.`
];
const TAUNT_OUT = [
  n => `${n}, eliminado. Ya puedes ir haciendo café.`,
  n => `Se acabó para ${n}. Descanse en paz.`,
  n => `${n} fuera. Sin reenganches que valgan.`,
  n => `${n} eliminado. Otra vez será.`
];
const TAUNT_EDGE = [
  (n, f) => `${n} está con la soga al cuello: le faltan ${f}.`,
  (n, f) => `Ojo con ${n}, a ${f} de la calle.`,
  (n, f) => `${n} tiembla: solo le quedan ${f} puntos.`
];
function abandonGame() {
  modal(`<h2>¿Abandonar partida?</h2><p class="muted">No se guardará en el historial.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">No</button><button class="btn danger block" onclick="S.game=null;draft={};save();closeModal();render()">Sí, abandonar</button></div>`);
}
function finishGame(wi, how) {
  const G = S.game; G.winner = G.players[wi].name; G.how = how; G.end = Date.now();
  sendMqtt({ type: 'sync', game: G, draft: {} });
  S.games.unshift(G); S.game = null; draft = {}; save(); render();
  vibrate([60, 40, 120]);
  modal(`<div class="win"><div class="trophy">♠</div><h2 style="font-size:1.6rem">¡Gana ${esc(G.winner)}!</h2>
    <p class="muted">Por ${how} · ${G.rounds.length} rondas</p>
    ${G.players.map(p => `<div class="rank"><span>${esc(p.name)}${p.rejoins ? ' ↻ ' + p.rejoins : ''}</span><b>${p.score}</b></div>`).join('')}
    <button class="btn btn-wa block" style="margin-top:14px;font-size:1rem" onclick="openSendReportModal(S.games[0])">📲 Enviar resultado por WhatsApp</button>
    <div class="row" style="margin-top:8px"><button class="btn ghost block" onclick="closeModal();tab='history';render()">Historial</button>
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

// ===== SINCRONIZACIÓN EN TIEMPO REAL & MENSAJES =====
function initMqtt(roomCode, onConnect) {
  if (mqttClient && mqttClient.isConnected && mqttClient.isConnected()) {
    if (currentRoomCode !== roomCode) {
      try { mqttClient.unsubscribe(`chinchon/v1/${currentRoomCode}`); } catch(e) {}
      currentRoomCode = roomCode;
      mqttClient.subscribe(`chinchon/v1/${roomCode}`, { qos: 1 });
    }
    if (onConnect) onConnect();
    return;
  }
  if (typeof Paho === 'undefined' || !Paho.MQTT) {
    console.warn('Paho MQTT no disponible');
    return;
  }
  currentRoomCode = roomCode;
  const clientId = 'ch_' + Math.random().toString(36).substring(2, 9);
  try {
    mqttClient = new Paho.MQTT.Client('broker.emqx.io', 8084, '/mqtt', clientId);
    mqttClient.onConnectionLost = () => {
      setTimeout(() => { if (currentRoomCode) initMqtt(currentRoomCode); }, 3500);
    };
    mqttClient.onMessageArrived = msg => {
      try { handleMqttMsg(JSON.parse(msg.payloadString)); } catch(e) {}
    };
    mqttClient.connect({
      useSSL: true, timeout: 6, cleanSession: true, keepAliveInterval: 30,
      onSuccess: () => {
        mqttClient.subscribe(`chinchon/v1/${roomCode}`, { qos: 1 });
        if (onConnect) onConnect();
        if (!isHost || !S.game) sendMqtt({ type: 'reqSync' });
      },
      onFailure: () => fallbackHiveMqtt(roomCode, onConnect)
    });
  } catch(e) { console.warn('MQTT err', e); }
}

function fallbackHiveMqtt(roomCode, onConnect) {
  try {
    const clientId = 'ch_' + Math.random().toString(36).substring(2, 9);
    mqttClient = new Paho.MQTT.Client('broker.hivemq.com', 8884, '/mqtt', clientId);
    mqttClient.onMessageArrived = msg => {
      try { handleMqttMsg(JSON.parse(msg.payloadString)); } catch(e) {}
    };
    mqttClient.connect({
      useSSL: true, timeout: 6, cleanSession: true, keepAliveInterval: 30,
      onSuccess: () => {
        mqttClient.subscribe(`chinchon/v1/${roomCode}`, { qos: 1 });
        if (onConnect) onConnect();
        if (!isHost || !S.game) sendMqtt({ type: 'reqSync' });
      }
    });
  } catch(e) {}
}

function sendMqtt(data) {
  if (!mqttClient || !mqttClient.isConnected || !mqttClient.isConnected() || !currentRoomCode) return;
  try {
    const m = new Paho.MQTT.Message(JSON.stringify(data));
    m.destinationName = `chinchon/v1/${currentRoomCode}`;
    m.qos = 1;
    mqttClient.send(m);
  } catch(e) {}
}

function handleMqttMsg(d) {
  if (!d || !d.type) return;
  if (d.type === 'sync') {
    if (!isHost || (!S.game && d.game)) {
      S.game = d.game;
      if (d.draft) draft = { ...draft, ...d.draft };
      syncMyPlayerIndex();
      save();
      render();
    }
  } else if (d.type === 'reqSync') {
    if (isHost && S.game) sendMqtt({ type: 'sync', game: S.game, draft });
  } else if (d.type === 'join') {
    if (isHost && S.game) {
      const exists = S.game.players.findIndex(p => p.name.trim().toLowerCase() === d.name.trim().toLowerCase());
      if (exists === -1) {
        S.game.players.push({ name: d.name.trim(), score: 0, rejoins: 0, out: false, chinchones: 0 });
        toast(`¡${d.name} se ha unido a la mesa!`);
        save();
        render();
        sendMqtt({ type: 'sync', game: S.game, draft });
      } else {
        toast(`¡${d.name} está conectado!`);
        sendMqtt({ type: 'sync', game: S.game, draft });
      }
    }
  } else if (d.type === 'draft') {
    if (S.game && d.playerIndex >= 0 && d.playerIndex < S.game.players.length) {
      draft[d.playerIndex] = d.entry;
      remoteDrafts[d.playerIndex] = true;
      if (isHost) {
        save();
        sendMqtt({ type: 'sync', game: S.game, draft });
      }
      toast(`✓ ${d.playerName}: ${entryTotal(d.entry, S.game.settings.penalty)} pts`);
      render();
    }
  } else if (d.type === 'bell') {
    ringBellSound();
    vibrate([80, 50, 100]);
    toast(`🔔 ¡${d.name} ha cerrado la mano! Dejad de robar.`, 3600);
  }
}

// Sonido y aviso de campana de cierre
function ringBellSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);
      gain.gain.setValueAtTime(0.35, now + i * 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 1.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 1.2);
    });
  } catch(e) {}
}

function triggerCloseBell() {
  ringBellSound();
  vibrate([80, 40, 120]);
  const name = myPlayerName || (isHost ? 'El Administrador' : 'Alguien');
  sendMqtt({ type: 'bell', name });
  toast(`🔔 ¡Has anunciado tu cierre a la mesa!`);
}

function syncMyPlayerIndex() {
  if (!S.game || !myPlayerName) { myPlayerIndex = null; return; }
  const idx = S.game.players.findIndex(p => p.name.trim().toLowerCase() === myPlayerName.trim().toLowerCase());
  myPlayerIndex = idx >= 0 ? idx : null;
}

function checkRoomParam() {
  if (typeof window === 'undefined' || !window.location) return;
  let r = '';
  try {
    const urlP = new URLSearchParams(window.location.search);
    const hashP = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    r = (urlP.get('room') || hashP.get('room') || '').toUpperCase().trim();
  } catch(e) {}
  if (r) {
    isHost = false;
    currentRoomCode = r;
    initMqtt(r, () => {
      promptJoinIdentity(r);
    });
  }
}

function promptJoinIdentity(roomCode) {
  syncMyPlayerIndex();
  const players = S.game ? S.game.players : [];
  modal(`<h2>🃏 Unirse a la mesa ${esc(roomCode)}</h2>
    <p class="muted">Elige quién eres para apuntar tus propios puntos desde tu móvil:</p>
    ${players.length ? `<div style="margin-bottom:12px">${players.map((p, i) => `
      <button class="btn ghost block" style="margin-bottom:6px;text-align:left;font-size:1rem" onclick="selectRole('${esc(p.name)}', ${i})">
        👉 Soy <b>${esc(p.name)}</b>
      </button>`).join('')}</div>` : ''}
    <label>O introduce tu nombre si eres nuevo:</label>
    <div class="row" style="margin-top:6px">
      <input id="join-name" placeholder="Ej: Miguel" value="${esc(myPlayerName || '')}">
      <button class="btn" onclick="submitNewPlayer()">Entrar</button>
    </div>`);
}

function selectRole(name, idx) {
  myPlayerName = name;
  myPlayerIndex = idx;
  localStorage.setItem('chinchon_player_name', name);
  closeModal();
  toast(`Identificado como ${name}`);
  render();
}

function submitNewPlayer() {
  const name = ($('#join-name').value || '').trim();
  if (!name) return toast('Escribe tu nombre');
  myPlayerName = name;
  localStorage.setItem('chinchon_player_name', name);
  closeModal();
  sendMqtt({ type: 'join', name });
  toast(`Entrando como ${name}…`);
  setTimeout(() => { syncMyPlayerIndex(); render(); }, 800);
}

function ensureRoom() {
  if (!S.game) return;
  if (!S.game.roomCode) {
    S.game.roomCode = 'CH-' + Math.random().toString(36).substring(2, 6).toUpperCase();
    save();
  }
  currentRoomCode = S.game.roomCode;
  initMqtt(currentRoomCode, () => {
    sendMqtt({ type: 'sync', game: S.game, draft });
  });
}

function openShareModal() {
  ensureRoom();
  const G = S.game;
  const room = G.roomCode;
  const link = `${window.location.origin}${window.location.pathname}?room=${room}`;
  const shareText = `🃏 ¡Únete a nuestra mesa de Chinchón! Entra en este enlace para apuntar tus puntos: ${link}`;
  
  modal(`<h2>🔗 Invitar a la mesa en directo</h2>
    <div class="share-code-box">
      <div class="muted">CÓDIGO DE SALA</div>
      <div class="share-code">${room}</div>
      <div class="muted">Quien abra el enlace podrá apuntar sus puntos desde su propio móvil.</div>
    </div>
    <input readonly value="${link}" style="font-size:.85rem;margin-bottom:10px" onclick="this.select()">
    <div class="row" style="margin-bottom:8px">
      <button class="btn btn-wa block" onclick="openWaShare('${encodeURIComponent(shareText)}')">📲 Enviar por WhatsApp</button>
      <button class="btn ghost block" onclick="navigator.clipboard.writeText('${link}').then(()=>toast('Enlace copiado al portapapeles'))">📋 Copiar</button>
    </div>
    ${navigator.share ? `<button class="btn ghost block" style="margin-bottom:8px" onclick="navigator.share({title:'Chinchón en vivo',text:${JSON.stringify(shareText)},url:'${link}'})">📤 Compartir enlace…</button>` : ''}
    <button class="btn block" onclick="closeModal()">Listo</button>`);
}

function openWaShare(encodedText, phone = '') {
  const url = phone ? `https://wa.me/${phone}?text=${encodedText}` : `https://wa.me/?text=${encodedText}`;
  window.open(url, '_blank');
}

function submitGuestPts() {
  if (myPlayerIndex === null || !S.game) return;
  const e = draft[myPlayerIndex] || {};
  sendMqtt({ type: 'draft', playerIndex: myPlayerIndex, playerName: myPlayerName, entry: e });
  toast(`✓ Puntos de ${myPlayerName} enviados a la mesa`);
  vibrate(25);
}

function calculateTitles(G) {
  const titles = [];
  if (!G || !G.players || !G.rounds) return titles;
  
  // 1. El Francotirador: más cierres con −10 o −25
  let maxMinus = 0, sniper = null;
  G.players.forEach((p, i) => {
    let count = 0;
    G.rounds.forEach(r => {
      if (r.flags && r.flags[i] && (r.flags[i].m10 || r.flags[i].m25)) count++;
      else if (r.events && r.events[i] && (r.events[i].includes('−10') || r.events[i].includes('−25'))) count++;
    });
    if (count > maxMinus) { maxMinus = count; sniper = p.name; }
  });
  if (sniper && maxMinus > 0) titles.push(`👑 *El Francotirador:* ${sniper} (${maxMinus} ${maxMinus === 1 ? 'cierre perfecto' : 'cierres perfectos'})`);

  // 2. El Inmortal: quien se reenganchó y aguantó más
  const rejoining = G.players.filter(p => p.rejoins > 0);
  if (rejoining.length) {
    const best = [...rejoining].sort((a, b) => (a.out === b.out ? a.score - b.score : (a.out ? 1 : -1)))[0];
    if (best) titles.push(`🧟 *El Inmortal:* ${best.name} (${best.rejoins} ${best.rejoins === 1 ? 'reenganche' : 'reenganches'})`);
  }

  // 3. El Barista: el primero eliminado o con peor puntuación
  const firstElimRound = G.rounds.findIndex(r => r.totals && r.totals.some((t, i) => G.players[i].out && r.before && r.before[i] && !r.before[i].out));
  let barista = null;
  if (firstElimRound >= 0) {
    const bIdx = G.rounds[firstElimRound].totals.findIndex((t, i) => G.players[i].out && G.rounds[firstElimRound].before && G.rounds[firstElimRound].before[i] && !G.rounds[firstElimRound].before[i].out);
    if (bIdx >= 0) barista = G.players[bIdx].name;
  }
  if (!barista) {
    const worst = [...G.players].sort((a, b) => b.score - a.score)[0];
    if (worst) barista = worst.name;
  }
  if (barista) titles.push(`☕ *El Barista:* ${barista} (primer eliminado, encargado oficial del café)`);

  // 4. El Pupas: la peor mano individual
  let maxHand = 0, pupas = null;
  G.rounds.forEach(r => {
    if (r.totals) {
      r.totals.forEach((t, i) => {
        if (t && t > maxHand) { maxHand = t; pupas = G.players[i].name; }
      });
    }
  });
  if (pupas && maxHand >= 15) titles.push(`💥 *El Pupas:* ${pupas} (+${maxHand} pts de un golpe)`);

  return titles;
}

function buildGamePingReport(G) {
  if (!G) return '';
  const ranked = [...G.players].sort((a, b) => {
    if (a.out !== b.out) return a.out ? 1 : -1;
    return a.score - b.score;
  });
  const winner = ranked[0] || { name: G.winner || '–', score: 0 };
  const loser = ranked[ranked.length - 1] || { name: '–', score: 0 };
  const medals = ['🥇', '🥈', '🥉', '4º', '5º', '6º'];
  
  // Bote si aplica
  const st = G.settings || {};
  let potLine = '';
  if (st.potPerEntry && st.potPerEntry > 0) {
    const entries = G.players.length + G.players.reduce((sum, p) => sum + (p.rejoins || 0), 0);
    const pot = (entries * st.potPerEntry).toFixed(2);
    potLine = `💰 *Bote de la partida:* ${pot} € para ${winner.name} (${entries} entradas)\n\n`;
  }

  // Motes de honor
  const titles = calculateTitles(G);
  const titlesSection = titles.length ? `🎖️ *Menciones de honor:*\n${titles.join('\n')}\n\n` : '';

  return `🔔 *¡Ping! Fin de partida de Chinchón* 🃏\n\n` +
    `🏆 *Ha ganado:* ${winner.name} (${winner.score} pts${G.how ? ' · ' + G.how : ''})\n` +
    `💀 *Ha perdido:* ${loser.name} (${loser.score} pts${loser.out ? ' · Eliminado' : ''})\n\n` +
    potLine +
    titlesSection +
    `📊 *Clasificación final:*\n` +
    ranked.map((p, i) => `${medals[i] || '•'} *${p.name}*: ${p.score} pts${p.out ? ' _(Eliminado)_' : ''}${p.rejoins ? ' (↻ ' + p.rejoins + ')' : ''}`).join('\n') +
    `\n\n⏱️ *Rondas jugadas:* ${G.rounds.length}\n` +
    `Partida anotada con el Marcador de Chinchón.`;
}

function openSendReportModal(game) {
  const G = game || S.game || S.games[0];
  if (!G) return toast('No hay partida');
  const reportText = buildGamePingReport(G);
  const encoded = encodeURIComponent(reportText);

  modal(`<h2>📲 Enviar resultado de la partida</h2>
    <p class="muted">Elige a quién quieres mandarle el ping con el resultado:</p>
    <div style="margin-bottom:12px">
      <button class="btn btn-wa block" style="margin-bottom:10px;font-size:1rem" onclick="openWaShare('${encoded}')">
        👥 <b>Compartir con el grupo de WhatsApp</b>
      </button>
      <div class="muted" style="margin:10px 0 6px">O enviar mensaje privado a:</div>
      ${G.players.map(p => `
        <button class="btn ghost block" style="margin-bottom:6px;display:flex;justify-content:space-between;align-items:center" onclick="openWaShare('${encoded}')">
          <span>👤 <b>${esc(p.name)}</b> <span class="muted">(${p.score} pts)</span></span>
          <span style="color:#25d366;font-size:.85rem;font-weight:700">WhatsApp ›</span>
        </button>`).join('')}
    </div>
    <div class="row">
      <button class="btn ghost block" onclick="navigator.clipboard.writeText(${JSON.stringify(reportText)}).then(()=>toast('¡Mensaje copiado!'))">📋 Copiar texto</button>
      ${navigator.share ? `<button class="btn ghost block" onclick="navigator.share({title:'Resultado Chinchón',text:${JSON.stringify(reportText)}})">📤 Compartir…</button>` : ''}
    </div>
    <div style="margin-top:10px">
      <button class="btn block" onclick="closeModal()">Cerrar</button>
    </div>`);
}

// ---------- GRUPOS ----------
function viewGroups() {
  return `<button id="btn-new-group" class="btn block" onclick="openGroupForm()">Nuevo grupo</button><h2>Tus grupos</h2>
  ${S.groups.length ? S.groups.map(g => {
    const wins = winsFor(g.id);
    return `<div class="card"><div class="row between"><b>${esc(g.name)}</b>
      <div class="row"><button class="btn ghost sm" onclick="openGroupForm('${g.id}')">Editar</button><button class="btn danger sm" onclick="delGroup('${g.id}')">Borrar</button></div></div>
      ${g.players.map(p => `<div class="rank"><span>${esc(p)}</span><span class="muted">${wins[p] || 0}</span></div>`).join('')}</div>`;
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
    ${_gp.length < 6 ? '<button class="btn ghost sm" onclick="g_add()">Añadir jugador</button>' : ''}
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
  save(); closeModal(); render(); toast('Grupo guardado ');
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
  const medals = ['1.', '2.', '3.'];
  return `<select onchange="histFilter=this.value;render()"><option value="">Todos los grupos</option>
    ${S.groups.map(g => `<option value="${g.id}" ${g.id === histFilter ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}</select>
  ${w.length ? `<h2>Ranking de victorias</h2><div class="card">${w.map(([n, c], i) => `<div class="rank"><span>${medals[i] || '·'} ${esc(n)}</span><b>${c}</b></div>`).join('')}</div>` : ''}
  <h2>Partidas (${games.length})</h2>
  ${games.length ? games.map(g => `<div class="card" onclick="showGame('${g.id}')" style="cursor:pointer">
    <div class="row between"><b>${esc(g.winner)}</b><span class="muted">${new Date(g.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span></div>
    <div class="muted">${esc(g.groupName)} · ${g.rounds.length} rondas · ${g.how}</div>
    <div class="muted">${g.players.map(p => `${esc(p.name)} ${p.score}`).join(' · ')}</div></div>`).join('') : '<div class="empty">Todavía no habéis jugado ninguna partida</div>'}`;
}
function showGame(id) {
  const g = S.games.find(x => x.id === id);
  modal(`<h2>${esc(g.groupName)} – ${new Date(g.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</h2>
    <p><b>${esc(g.winner)}</b> <span class="muted">(${g.how})</span></p>
    <div style="max-height:45vh;overflow:auto"><table><tr><th>#</th>${g.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${g.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => `<td>${t === null ? '–' : t}${r.events[i] ? `<div class="tag">${r.events[i]}</div>` : ''}</td>`).join('')}</tr>`).join('')}
    <tr><th>Σ</th>${g.players.map(p => `<th>${p.score}</th>`).join('')}</tr></table></div>
    <button class="btn btn-wa block" style="margin-top:12px;font-size:1rem" onclick="openSendReportModal(S.games.find(x=>x.id==='${id}'))">📲 Enviar resultado por WhatsApp</button>
    <div class="row" style="margin-top:8px"><button class="btn danger block" onclick="S.games=S.games.filter(x=>x.id!=='${id}');save();closeModal();render()">Borrar</button>
    <button class="btn block" onclick="closeModal()">Cerrar</button></div>`);
}

// ---------- NORMAS ----------
// Dos vistas: "Nuestras" (editables, una a una) y "Oficiales" (referencia fija).
let rulesView = 'ours';
function viewRules() {
  const seg = `<div class="seg"><button class="${rulesView === 'ours' ? 'on' : ''}" onclick="rulesView='ours';render()">Nuestras normas</button>
    <button class="${rulesView === 'off' ? 'on' : ''}" onclick="rulesView='off';render()">Oficiales</button></div>`;
  if (rulesView === 'off') return seg + `<p class="muted" style="margin:4px 0 14px">Reglamento clásico del chinchón. Solo lectura.</p>
    ${OFFICIAL_RULES.map(([t, x], i) => ruleItem(i, t, x, false)).join('')}
    <button class="btn ghost block" style="margin-top:10px" onclick="resetRules()">Usar las oficiales como nuestras</button>`;
  const L = S.rulesList;
  return seg + `<p class="muted" style="margin:4px 0 14px">Toca una norma para cambiarla.</p>
    ${L.length ? L.map((r, i) => ruleItem(i, r.title, r.text, true)).join('') : '<div class="empty">No hay normas todavía</div>'}
    <button id="btn-add-rule" class="btn block" style="margin-top:10px" onclick="editRule(-1)">Añadir norma</button>`;
}
function ruleItem(i, title, text, editable) {
  return `<div class="rule" ${editable ? `onclick="editRule(${i})"` : ''}>
    <div class="rule-n">${ordinal(i)}</div>
    <div class="rule-t">${esc(title)}</div>
    <div class="rule-x">${esc(text)}</div></div>`;
}
function editRule(i) {
  const r = S.rulesList[i] || { title: '', text: '' }; const L = S.rulesList.length;
  modal(`<h2>${i < 0 ? 'Nueva norma' : ordinal(i) + ' norma'}</h2>
    <label>Título</label><input id="r-title" value="${esc(r.title)}" placeholder="Ej: El reenganche">
    <label>Qué dice</label><textarea id="r-text" style="min-height:140px">${esc(r.text)}</textarea>
    ${i >= 0 ? `<div class="row" style="margin-top:10px">
      <button class="btn ghost sm" ${i === 0 ? 'disabled' : ''} onclick="moveRule(${i},-1)">↑ Subir</button>
      <button class="btn ghost sm" ${i === L - 1 ? 'disabled' : ''} onclick="moveRule(${i},1)">↓ Bajar</button>
      <span style="flex:1"></span><button class="btn danger sm" onclick="delRule(${i})">Borrar</button></div>` : ''}
    <div class="row" style="margin-top:14px"><button class="btn ghost block" onclick="closeModal()">Cancelar</button>
    <button id="btn-save-rule" class="btn block" onclick="saveRule(${i})">Guardar</button></div>`);
}
function saveRule(i) {
  const title = $('#r-title').value.trim(), text = $('#r-text').value.trim();
  if (!title && !text) return toast('Escribe algo');
  if (i < 0) S.rulesList.push({ title, text }); else S.rulesList[i] = { title, text };
  save(); closeModal(); render(); toast('Norma guardada');
}
function moveRule(i, d) { const L = S.rulesList; [L[i], L[i + d]] = [L[i + d], L[i]]; save(); render(); editRule(i + d); }
function delRule(i) { S.rulesList.splice(i, 1); save(); closeModal(); render(); toast('Norma borrada'); }
function resetRules() {
  modal(`<h2>¿Sustituir vuestras normas?</h2><p class="muted">Se cambiarán por las oficiales. Lo que hayas escrito se perderá.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">Cancelar</button>
    <button class="btn block" onclick="S.rulesList=officialCopy();save();rulesView='ours';closeModal();render()">Sustituir</button></div>`);
}

render();
checkRoomParam();
$('#version').textContent = 'v' + APP_VERSION + ' ↻';
// Botón discreto: tocar la versión fuerza una recarga limpia (borra cachés, no borra datos)
$('#version').onclick = () => modal(`<h2>Recargar la app</h2><p class="muted">Descarga de nuevo la última versión. Tus grupos, historial y normas no se borran.</p>
  <div class="row"><button class="btn ghost block" onclick="closeModal()">Cancelar</button><button id="btn-hard-reload" class="btn block" onclick="hardReload()">Recargar</button></div>`);
async function hardReload() {
  try {
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    if (navigator.serviceWorker) for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  } catch (e) {}
  location.replace(location.pathname + '?r=' + Date.now());
}

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
      toast('Actualizando a v' + version + '…');
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
