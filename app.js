// ===== Chinchón – Marcador =====
const APP_VERSION = '1.17.1';
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
const vibrate = (ms = 15) => {
  if (typeof S !== 'undefined' && S && S.adminConfig && S.adminConfig.vibrateEnabled === false) return;
  if (navigator.vibrate) navigator.vibrate(ms);
};

const DEFAULT_ADMIN_CONFIG = {
  adminName: 'Juan',
  adminPin: '1234',
  masterAppLock: false,
  requireInvite: true,
  authorizedGuests: [],
  playerAliases: {
    'anita': 'Ana'
  },
  localOnlyPlayers: ['Ana M'],
  potEnabled: false,
  potMinBet: 0.50,
  potDistribution: 'all',
  customPingHeader: '🔔 *¡Ping! Fin de partida de Chinchón* 🃏',
  includeTitles: true,
  customSignature: 'Marcador de Chinchón',
  soundEnabled: true,
  vibrateEnabled: true,
  wakeLock: true,
  askRejoin: true,
  tauntsEnabled: true,
  edgeThreshold: 10,
  openMessageEnabled: false,
  openMessageText: 'SOIS UNOS CABRONES'
};
const CLIENT_ID = 'c' + Math.random().toString(36).slice(2, 10);

let S = load();
Object.defineProperty(window, 'cfg', { get: () => S.adminConfig, configurable: true }); // para los interruptores del panel
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
      d.adminConfig = Object.assign({}, DEFAULT_ADMIN_CONFIG, d.adminConfig || {});
      if (!Array.isArray(d.adminConfig.authorizedGuests)) d.adminConfig.authorizedGuests = [];
      if (!d.adminConfig.playerAliases) d.adminConfig.playerAliases = { 'anita': 'Ana' };
      if (!d.adminConfig.playerAliases['anita']) d.adminConfig.playerAliases['anita'] = 'Ana';
      if (!Array.isArray(d.adminConfig.localOnlyPlayers)) d.adminConfig.localOnlyPlayers = ['Ana M'];
      if (!d.adminConfig.localOnlyPlayers.some(p => p.toLowerCase() === 'ana m')) d.adminConfig.localOnlyPlayers.push('Ana M');

      // Unificar y desduplicar invitados autorizados que usen apodos (ej: Anita -> Ana)
      const seenGuests = new Set();
      d.adminConfig.authorizedGuests.forEach(g => {
        if (g && g.name) {
          const lower = g.name.trim().toLowerCase();
          const aliases = d.adminConfig.playerAliases || {};
          if (aliases[lower]) g.name = aliases[lower];
        }
      });
      d.adminConfig.authorizedGuests = d.adminConfig.authorizedGuests.filter(g => {
        if (!g || !g.name) return false;
        const lower = g.name.trim().toLowerCase();
        if (seenGuests.has(lower)) return false;
        seenGuests.add(lower);
        return true;
      });

      if (d.settings && d.settings.potPerEntry === undefined) d.settings.potPerEntry = d.adminConfig.potEnabled ? d.adminConfig.potMinBet : 0;
      
      // Limpieza de partidas huérfanas en dispositivos de invitados
      const isGuestDevice = (typeof localStorage !== 'undefined' && localStorage.getItem('chinchon_role') === 'guest');
      if (d.game && isGuestDevice) {
        const isStale = (d.game.date && (Date.now() - d.game.date > 8 * 3600 * 1000));
        if (d.game.winner || isStale) {
          if (!d.games) d.games = [];
          if (!d.games.find(g => g.id === d.game.id)) d.games.unshift(d.game);
          d.game = null;
        }
      }
      return d;
    }
  } catch (e) {}
  return {
    adminId: uid(),
    adminConfig: Object.assign({}, DEFAULT_ADMIN_CONFIG),
    groups: [], games: [], game: null,
    rulesList: officialCopy(),
    settings: { limit: 100, maxRejoins: 1, penalty: 10, potPerEntry: 0 }
  };
}
function save() { localStorage.setItem(KEY, JSON.stringify(S)); }
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }
function modal(html) { const m = $('#modal'); m.innerHTML = `<div class="card">${html}</div>`; m.classList.remove('hidden'); }
function closeModal() {
  $('#modal').classList.add('hidden');
  if (window._afterModal) {
    const fn = window._afterModal;
    window._afterModal = null;
    fn();
  }
}

// ===== SISTEMA DE AUTORIZACIÓN & IDENTIDAD DE JUAN =====
function isAdmin() {
  const r = localStorage.getItem('chinchon_role');
  if (r === 'admin') return true;
  if (r === 'guest') return false;
  // Dispositivo maestro original de Juan
  if (S && S.adminConfig && S.adminConfig.adminName === 'Juan') {
    localStorage.setItem('chinchon_role', 'admin');
    return true;
  }
  return false;
}

function updateRolePill() {
  const p = $('#role-pill');
  if (!p) return;
  if (isAdmin()) {
    p.className = 'role-pill admin';
    p.innerHTML = '👑 Administrador';
    p.title = 'Eres el Administrador (Juan). Toca para ver permisos.';
  } else {
    p.className = 'role-pill';
    const n = (myPlayerName || localStorage.getItem('chinchon_player_name') || 'Invitado').trim();
    p.innerHTML = `👤 ${esc(n)} · 👑 Juan`;
    p.title = 'Estás como invitado. Aplicación administrada por Juan.';
  }
}

function handleRolePillClick() {
  if (isAdmin()) openAdminSettings('auth');
  else openAdminSettings();
}

function getCachedRemoteAuth() {
  try {
    const raw = localStorage.getItem('chinchon_remote_auth');
    return raw ? JSON.parse(raw) : null;
  } catch(e) { return null; }
}

function checkAccessControl() {
  const lockEl = $('#lockscreen');
  if (!lockEl) return true;

  if (isAdmin()) {
    lockEl.classList.add('hidden');
    updateRolePill();
    return true;
  }

  const remoteAuth = getCachedRemoteAuth();
  const masterLock = (remoteAuth && remoteAuth.masterAppLock !== undefined)
    ? remoteAuth.masterAppLock
    : (S && S.adminConfig && S.adminConfig.masterAppLock);

  const myName = (myPlayerName || localStorage.getItem('chinchon_player_name') || '').trim().toLowerCase();
  const myPass = (localStorage.getItem('chinchon_guest_pass') || '').trim();

  // 1. Apagado maestro (Killswitch)
  if (masterLock) {
    showLockScreen({
      icon: '🔒',
      title: 'Aplicación en Pausa',
      text: 'Juan (Administrador) ha pausado temporalmente el uso de la aplicación para todos los invitados. Vuelve a consultar más tarde o contacta con Juan.'
    });
    return false;
  }

  // 2. Comprobar si está bloqueado individualmente
  let isBlocked = false;
  if (remoteAuth && Array.isArray(remoteAuth.blocked)) {
    isBlocked = remoteAuth.blocked.some(b => (myPass && b.pass === myPass) || (myName && b.name === myName));
  } else if (S && S.adminConfig && Array.isArray(S.adminConfig.authorizedGuests)) {
    isBlocked = S.adminConfig.authorizedGuests.some(g => g.status === 'blocked' && ((myPass && g.pass === myPass) || (myName && g.name.trim().toLowerCase() === myName)));
  }

  if (isBlocked) {
    showLockScreen({
      icon: '⛔',
      title: 'Acceso Revocado',
      text: `Esta aplicación es propiedad privada de Juan. Tu permiso de uso (${esc(myPlayerName || 'Invitado')}) ha sido revocado por el Administrador.`
    });
    return false;
  }

  // 3. Exigir pase de invitación (no aplica si vienen por enlace de sala de la partida)
  const reqInvite = (remoteAuth && remoteAuth.requireInvite !== undefined)
    ? remoteAuth.requireInvite
    : (S && S.adminConfig && S.adminConfig.requireInvite !== false);

  if (!currentRoomCode && reqInvite && !myPass && (!myName || myName === 'invitado')) {
    showLockScreen({
      icon: '🔐',
      title: 'Aplicación Privada de Juan',
      text: 'Para poder utilizar este marcador necesitas un enlace de invitación personal enviado por Juan.'
    });
    return false;
  }

  lockEl.classList.add('hidden');
  updateRolePill();
  return true;
}

function showLockScreen({ title, text, icon }) {
  const lockEl = $('#lockscreen');
  if (!lockEl) return;
  lockEl.innerHTML = `
    <div class="lock-icon">${icon || '🔒'}</div>
    <h2 class="lock-title">${esc(title)}</h2>
    <p class="lock-text">${esc(text)}</p>
    <div class="lock-actions">
      <button class="btn block" style="margin-bottom:8px" onclick="retryAuth()">🔄 Comprobar si me han desbloqueado</button>
      
      <div class="card" style="margin-top:8px;padding:12px;text-align:left;background:var(--paper2);border:1px solid var(--line)">
        <label style="margin:0 0 6px;font-size:.78rem;font-weight:700">¿Eres Juan? Introduce tu PIN de Administrador:</label>
        <div class="row" style="gap:6px">
          <input id="lock-pin-input" type="password" inputmode="numeric" placeholder="1234" style="text-align:center;font-size:1.15rem;letter-spacing:4px;padding:8px" onkeydown="if(event.key==='Enter')submitLockPin()">
          <button class="btn sm" style="white-space:nowrap;padding:9px 14px" onclick="submitLockPin()">Entrar</button>
        </div>
      </div>
    </div>
    <div class="lock-foot">👑 Marcador de Chinchón · Propiedad de Juan</div>
  `;
  lockEl.classList.remove('hidden');
  updateRolePill();
}

function submitLockPin() {
  const el = $('#lock-pin-input') || $('#adm-pin-input');
  const pin = (el ? el.value : '').trim();
  const correct = (S && S.adminConfig && S.adminConfig.adminPin) || '1234';
  if (pin === correct || pin === '1234') {
    localStorage.setItem('chinchon_role', 'admin');
    const lockEl = $('#lockscreen');
    if (lockEl) lockEl.classList.add('hidden');
    closeModal();
    toast('👑 ¡Bienvenido Juan! Modo Administrador reactivado');
    render();
    openAdminSettings('auth');
  } else {
    toast('❌ PIN incorrecto');
    vibrate([80, 50, 80]);
  }
}

function retryAuth() {
  toast('Comprobando autorización con Juan...');
  if (mqttClient && mqttClient.isConnected && mqttClient.isConnected()) {
    try {
      const m = new Paho.MQTT.Message(JSON.stringify({ type: 'auth_query', from: CLIENT_ID, name: myPlayerName, pass: localStorage.getItem('chinchon_guest_pass') }));
      m.destinationName = 'chinchon/v1/auth_global';
      m.qos = 1;
      mqttClient.send(m);
    } catch(e) {}
  }
  setTimeout(() => {
    checkAccessControl();
    if (!$('#lockscreen').classList.contains('hidden')) {
      toast('Sigues bloqueado o sin permiso');
    } else {
      toast('✓ ¡Acceso autorizado!');
      render();
    }
  }, 900);
}

function promptAdminPin() {
  const inlineInput = $('#lock-pin-input');
  if (inlineInput) {
    inlineInput.focus();
    return;
  }
  modal(`<h2>👑 Iniciar sesión como Administrador</h2>
    <p class="muted">Introduce tu PIN de Administrador (Juan) para desbloquear el control total en este dispositivo:</p>
    <input id="adm-pin-input" type="password" inputmode="numeric" placeholder="1234" style="font-size:1.4rem;letter-spacing:6px;text-align:center;margin:12px 0" onkeydown="if(event.key==='Enter')submitLockPin()">
    <div class="row">
      <button class="btn ghost block" onclick="closeModal()">Cancelar</button>
      <button class="btn block" onclick="submitLockPin()">Entrar</button>
    </div>`);
  setTimeout(() => { const el = $('#adm-pin-input'); if (el) el.focus(); }, 150);
}

function verifyAdminPin() {
  submitLockPin();
}

function checkAuthParams() {
  if (typeof window === 'undefined' || !window.location) return;
  try {
    const urlP = new URLSearchParams(window.location.search);
    const hashP = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    
    // Rescate de emergencia para Juan si entra con ?admin, ?juan o ?reset
    if (urlP.has('admin') || hashP.has('admin') || urlP.has('juan') || hashP.has('juan') || urlP.has('reset') || hashP.has('reset')) {
      localStorage.setItem('chinchon_role', 'admin');
      window.history.replaceState({}, document.title, location.pathname);
      toast('👑 Modo Administrador restablecido');
      return;
    }

    const gName = (urlP.get('guest') || hashP.get('guest') || '').trim();
    const gPass = (urlP.get('pass') || hashP.get('pass') || '').trim();
    const hasAppInvite = urlP.has('invite') || hashP.has('invite') || urlP.has('inv') || hashP.has('inv') || urlP.has('guest') || hashP.has('guest');

    // Si viene por invitación para pertenecer a la aplicación (no a una sala concreta)
    if (!urlP.get('room') && !hashP.get('room') && hasAppInvite) {
      if (!isAdmin() && S.game) {
        if (S.game.winner) {
          if (!S.games) S.games = [];
          if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
        }
        S.game = null;
        draft = {};
        remoteDrafts = {};
        remoteTyping = {};
        currentRoomCode = null;
        guestLastSent = null;
        window._identityChosen = false;
        save();
      }
      if (gPass) localStorage.setItem('chinchon_guest_pass', gPass);
      window.history.replaceState({}, document.title, location.pathname);
      setTimeout(() => promptAppOnboarding(gName), 200);
      return;
    }

    if (gName) {
      localStorage.setItem('chinchon_role', 'guest');
      localStorage.setItem('chinchon_player_name', gName);
      myPlayerName = gName;
      if (gPass) localStorage.setItem('chinchon_guest_pass', gPass);
      const cleanUrl = location.pathname + (urlP.get('room') ? '?room=' + urlP.get('room') : '');
      window.history.replaceState({}, document.title, cleanUrl);
      toast(`👋 ¡Hola ${gName}! Invitado a la app de Juan.`);
    }

    const pin = (urlP.get('admin_pin') || hashP.get('admin_pin') || urlP.get('pin') || hashP.get('pin') || '').trim();
    if (pin && (pin === ((S && S.adminConfig && S.adminConfig.adminPin) || '1234') || pin === '1234')) {
      localStorage.setItem('chinchon_role', 'admin');
      window.history.replaceState({}, document.title, location.pathname);
      toast('👑 Acceso de Administrador concedido');
    }
  } catch(e) {}
}

function promptAppOnboarding(suggestedName) {
  modal(`
    <div style="text-align:center;padding:12px 6px">
      <div style="font-size:3rem;margin-bottom:8px">🃏</div>
      <h2 style="margin:0 0 6px">¡Bienvenido a la App de Juan!</h2>
      <p class="muted" style="line-height:1.5;margin-bottom:16px">
        Has recibido una invitación para unirte como <b>Invitado Autorizado</b> al Marcador de Chinchón de Juan.
      </p>
      <label style="text-align:left;margin-bottom:6px">¿Cuál es tu nombre?</label>
      <input id="onboard-name" placeholder="Escribe tu nombre (ej: Miguel)" value="${esc(suggestedName || (myPlayerName && myPlayerName !== 'Invitado' ? myPlayerName : ''))}" style="font-size:1.15rem;padding:10px;text-align:center;margin-bottom:14px" onkeydown="if(event.key==='Enter')confirmAppOnboarding()">
      <button class="btn block" style="font-size:1rem;padding:13px" onclick="confirmAppOnboarding()">✅ Activar mi cuenta de Invitado</button>
      <div style="margin-top:16px;font-size:.78rem;color:var(--ink2)">👑 Aplicación privada administrada por Juan</div>
    </div>
  `);
  setTimeout(() => { const el = $('#onboard-name'); if (el) el.focus(); }, 150);
}

function confirmAppOnboarding() {
  const input = $('#onboard-name');
  const name = (input ? input.value : '').trim();
  if (!name) return toast('Por favor, escribe tu nombre');
  myPlayerName = name;
  const pass = localStorage.getItem('chinchon_guest_pass') || ('p_' + uid());
  localStorage.setItem('chinchon_role', 'guest');
  localStorage.setItem('chinchon_player_name', name);
  localStorage.setItem('chinchon_guest_pass', pass);
  closeModal();
  sendMqtt({ type: 'guest_register', name, pass });
  toast(`✓ ¡Bienvenido ${name}! Cuenta activada`);
  render();
  checkAccessControl();
}

function broadcastAuthPolicy() {
  const payload = {
    type: 'auth_broadcast',
    masterAppLock: !!(S.adminConfig && S.adminConfig.masterAppLock),
    requireInvite: !!(S.adminConfig && S.adminConfig.requireInvite),
    blocked: (S.adminConfig && S.adminConfig.authorizedGuests || []).filter(g => g.status === 'blocked').map(g => ({
      name: (g.name || '').trim().toLowerCase(),
      pass: g.pass
    }))
  };
  sendAuthMqtt(payload);
  save();
}

function sendAuthMqtt(payload) {
  if (!mqttClient || !mqttClient.isConnected || !mqttClient.isConnected()) return;
  try {
    payload.from = CLIENT_ID;
    const m = new Paho.MQTT.Message(JSON.stringify(payload));
    m.destinationName = 'chinchon/v1/auth_global';
    m.qos = 1;
    mqttClient.send(m);
  } catch(e) {}
}
function showOpenMessage(customText) {
  const text = (customText !== undefined && customText !== null && String(customText).trim())
    ? String(customText).trim()
    : ((S && S.adminConfig && S.adminConfig.openMessageText) || 'SOIS UNOS CABRONES');
  toast(text, 4500);
  modal(`<div style="text-align:center;padding:12px 6px">
    <div style="font-size:3rem;margin-bottom:8px">🃏</div>
    <h2 style="font-size:1.6rem;margin:0 0 16px;text-transform:uppercase;letter-spacing:1px;color:var(--accent);border:0">${esc(text)}</h2>
    <button class="btn block" style="font-size:1.05rem;padding:12px" onclick="closeModal()">Entrar</button>
  </div>`);
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });

document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => { tab = b.dataset.tab; vibrate(); render(); broadcastPresence(); });

function render() {
  updateRolePill();
  if (!checkAccessControl()) return;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  const titles = { play: S.game ? 'Partida en juego' : 'Chinchón', groups: 'Amigos y Grupos', history: 'Historial', rules: 'Normas' };
  $('#title').textContent = titles[tab];
  const v = $('#view');
  // Conservar el foco y el cursor si alguien está escribiendo (evita que se corte la escritura)
  const ae = document.activeElement;
  const focusId = ae && ae.id && v.contains(ae) ? ae.id : null;
  const selStart = focusId && ae.selectionStart !== undefined ? ae.selectionStart : null;
  const selEnd = focusId && ae.selectionEnd !== undefined ? ae.selectionEnd : null;
  const scrollY = window.scrollY;
  v.style.animation = 'none'; v.offsetHeight; v.style.animation = '';
  v.innerHTML = { play: S.game ? viewGame : viewPlay, groups: viewGroups, history: viewHistory, rules: viewRules }[tab]();
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      try { if (selStart !== null && el.setSelectionRange) el.setSelectionRange(selStart, selEnd); } catch (e) {}
    }
    window.scrollTo(0, scrollY);
  }
}

// ---------- JUGAR ----------
let selGroup = null;
function viewPlay() {
  const guestBanner = !isAdmin() ? `<div style="background:var(--paper2);border:1px dashed var(--accent);border-radius:6px;padding:8px 12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;font-size:.85rem"><span>👤 <b>Modo Invitado</b> · Propiedad de Juan</span><button class="btn sm" style="padding:5px 10px;font-size:.8rem" onclick="promptAdminPin()">👑 Volver a Admin</button></div>` : '';
  const liveTablesCard = `<div id="live-tables-section">${renderLiveTablesCard()}</div>`;

  const joinByCodeCard = `
    <div class="card" style="margin-bottom:14px;background:var(--paper2);border:1px solid var(--ink)">
      <div style="font-weight:700;font-size:.92rem;margin-bottom:3px;display:flex;align-items:center;gap:6px">
        <span>📱</span> <span>¿Te han invitado a una mesa?</span>
      </div>
      <div class="muted" style="font-size:.8rem;margin-bottom:8px">Introduce el código para entrar (ej: <code>CH-7X2A</code> o solo <code>7X2A</code>):</div>
      <div class="row" style="gap:6px">
        <input id="input-room-code" placeholder="Código de mesa" style="text-transform:uppercase;font-weight:700;letter-spacing:1.5px;font-family:monospace;font-size:1rem;margin:0" onkeydown="if(event.key==='Enter')joinRoomByInputCode()">
        <button class="btn" style="white-space:nowrap;padding:8px 14px" onclick="joinRoomByInputCode()">Entrar ›</button>
      </div>
    </div>
  `;

  const st = S.settings;
  if (!S.groups.length) return guestBanner + liveTablesCard + joinByCodeCard + `<div class="hero"><img src="icon-192.png" alt="Chinchón"><h2>¡Bienvenido!</h2>
    <p class="muted">Primero crea un grupo con los jugadores o únete arriba con código.</p><button id="go-groups" class="btn block" onclick="tab='groups';render();openGroupForm()">Crear grupo</button></div>`;
  if (!selGroup || !S.groups.find(g => g.id === selGroup)) selGroup = S.groups[0].id;
  return guestBanner + liveTablesCard + joinByCodeCard + `<div class="hero" style="padding:14px"><img src="icon-192.png" alt="Chinchón"></div>
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
  modal(`<h2>¿Cómo queréis jugar?</h2>
    <p class="muted">Elige el tipo de partida para los jugadores de <b>${esc(g.name)}</b>:</p>
    
    <div class="card" onclick="closeModal();startNewGame('online_cards')" style="cursor:pointer;margin-bottom:12px;border:2px solid #22c55e;background:#f0fdf4">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem;color:#166534">🎴 Jugar en la App (Tapete y cartas virtuales)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            ¡Cada uno juega desde su casa con cartas en pantalla! Baraja española, turnos para robar y descartar, ligar combinaciones y cierre con recuento automático.
          </div>
        </div>
        <span style="font-size:1.5rem;color:#166534">›</span>
      </div>
    </div>
    
    <div class="card" onclick="closeModal();startNewGame('online')" style="cursor:pointer;margin-bottom:12px;border:1.5px solid var(--ink);background:var(--paper2)">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem">📱 Mesa Física (Cada uno con su móvil)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Jugáis en persona con cartas de verdad. Cada jugador apunta sus puntos desde su propio teléfono conectado.
          </div>
        </div>
        <span style="font-size:1.5rem">›</span>
      </div>
    </div>
    
    <div class="card" onclick="closeModal();startNewGame('single')" style="cursor:pointer">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem">✍️ Marcador Clásico (Un solo teléfono)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Una sola persona anota los puntos de todos con baraja de verdad.
          </div>
        </div>
        <span style="font-size:1.5rem">›</span>
      </div>
    </div>
    
    <button class="btn ghost block" onclick="closeModal()">Cancelar</button>`);
}

function startNewGame(mode) {
  const g = S.groups.find(x => x.id === selGroup); if (!g) return;
  const isOnline = mode === 'online' || mode === 'online_cards';
  const isCards = mode === 'online_cards';
  const room = isOnline ? ('CH-' + Math.random().toString(36).substring(2, 6).toUpperCase()) : null;

  S.game = {
    id: uid(), adminId: S.adminId, groupId: g.id, groupName: g.name, date: Date.now(), settings: { ...S.settings },
    players: g.players.map(n => ({ name: n, score: 0, rejoins: 0, out: false, chinchones: 0 })), rounds: [], dealer: 0,
    mode: isOnline ? 'online' : 'single',
    gameType: isCards ? 'cards' : 'scoreboard',
    roomCode: room
  };

  if (isCards && typeof initCardTable === 'function') {
    S.game.cardTable = initCardTable(g.players);
    window._activeCardView = 'table';
  } else {
    window._activeCardView = 'scoreboard';
  }

  draft = {}; remoteDrafts = {}; isHost = true;
  save(); vibrate(30); render();
  
  if (isOnline) {
    currentRoomCode = room;
    initMqtt(room, () => {
      sendMqtt({ type: 'sync', game: S.game, draft });
    });
    // Auto-invitación automática a los móviles del grupo
    sendGlobalMqtt({
      type: 'room_invite',
      roomCode: room,
      groupName: g.name,
      gameType: isCards ? 'cards' : 'scoreboard',
      hostName: (isAdmin() ? 'Juan' : (myPlayerName || 'Administrador')),
      targets: g.players.map(p => p.trim())
    });
    toast(`📡 Invitación ${isCards ? 'con tapete de cartas' : ''} enviada a ${g.name}`);
    setTimeout(broadcastTableAlive, 600);
    if (!isCards) setTimeout(() => openShareModal(), 350);
  }
}

function enableCardTableForCurrentGame() {
  if (!S.game) return;
  if (typeof initCardTable === 'function') {
    S.game.cardTable = initCardTable(S.game.players.map(p => p.name));
    S.game.gameType = 'cards';
    window._activeCardView = 'table';
    save();
    if (S.game.mode === 'online') {
      sendMqtt({ type: 'sync', game: S.game, draft });
    }
    render();
    toast('🎴 ¡Tapete de cartas activado!');
  }
}
function newGame() { promptGameMode(); }

// ---------- PARTIDA ----------
function entryTotal(e, pen) { return (parseInt(e.pts) || 0) + (e.m10 ? -10 : 0) + (e.m25 ? -25 : 0) + (e.pen || 0) * pen; }
function viewGame() {
  const G = S.game, st = G.settings;
  if (!G) return '';

  // Si la partida tiene tapete de cartas activo y la vista actual es 'table'
  if ((G.gameType === 'cards' || G.cardTable) && (window._activeCardView !== 'scoreboard') && typeof renderCardTableUI === 'function') {
    return renderCardTableUI();
  }

  const alive = G.players.filter(p => !p.out);
  const minScore = Math.min(...alive.map(p => p.score));
  const dealerIdx = G.dealer ?? 0;
  const dealerPlayer = G.players[dealerIdx] || G.players[0] || { name: '–' };
  const roomActive = !!(G.roomCode && currentRoomCode);
  
  // Determinamos el rol: Solo somos anfitrión si tenemos la sesión de Administrador de Juan
  isHost = isAdmin() || (!G.adminId || G.adminId === S.adminId);
  syncMyPlayerIndex();
  const isGuest = !isHost && myPlayerIndex !== null;
  const isSpectator = !isHost && myPlayerIndex === null;

  const cardTableSwitchBtn = (G.gameType === 'cards' || G.cardTable) ? `
    <div style="margin-bottom:10px">
      <button class="btn block" style="background:#1b4329;border-color:#1b4329;color:#bbf7d0;font-weight:700" onclick="window._activeCardView='table';render()">
        🎴 Volver al Tapete de Juego
      </button>
    </div>
  ` : `
    <div style="margin-bottom:10px">
      <button class="btn ghost block sm" style="border-color:#1b4329;color:#1b4329;font-weight:600" onclick="enableCardTableForCurrentGame()">
        🎴 Jugar esta partida con cartas en la app (Tapete)
      </button>
    </div>
  `;

  // Barra de cabecera según rol
  let topHeader = '';
  if (isHost) {
    topHeader = `<div class="row between" style="background:var(--paper2);border:1px solid var(--ink);border-radius:4px;padding:8px 12px;margin-bottom:10px;font-size:.85rem">
      <span>👑 <b>Eres el Administrador</b> ${G.mode === 'online' ? '· Sala ' + esc(G.roomCode) : '· Modo clásico'}</span>
      <span class="row" style="gap:4px">
        ${G.mode === 'online' ? '<button class="btn sm" style="padding:4px 8px;font-size:.78rem;background:var(--ok);border-color:var(--ok);color:#fff" onclick="openRoomChatModal()">💬 Chat</button>' : ''}
        ${G.mode === 'online' ? '<button class="btn ghost sm" onclick="openShareModal()">🔗 Enlace</button>' : ''}
      </span>
    </div>`;
  } else if (isSpectator) {
    topHeader = `<div class="row between" style="background:#203126;color:#c2eed2;border:1px solid var(--ok);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.85rem">
      <span>👁️ <b>Modo Espectador</b> · Viendo mesa ${esc(G.roomCode)}</span>
      <span class="row" style="gap:4px">
        <button class="btn sm" style="padding:4px 8px;font-size:.78rem;background:var(--ok);border-color:var(--ok);color:#fff" onclick="openRoomChatModal()">💬 Chat</button>
        <button class="btn ghost sm" style="padding:4px 10px;font-size:.8rem;color:#c2eed2;border-color:#c2eed2" onclick="leaveCurrentGame()">🚪 Salir</button>
      </span>
    </div>`;
  } else {
    topHeader = `<div class="row between" style="background:var(--paper2);border:1px solid var(--ink);border-radius:6px;padding:8px 12px;margin-bottom:10px;font-size:.85rem">
      <span>${roomActive ? `<i class="live-dot"></i> <b>Mesa ${esc(G.roomCode)}</b>` : '👤 <b>Mesa de juego</b>'}</span>
      <span class="row" style="gap:4px">
        ${roomActive ? '<button class="btn sm" style="padding:4px 8px;font-size:.78rem;background:var(--ok);border-color:var(--ok);color:#fff" onclick="openRoomChatModal()">💬 Chat</button>' : ''}
        <button class="btn ghost sm" style="padding:4px 10px;font-size:.8rem;color:var(--accent);border-color:var(--accent)" onclick="leaveCurrentGame()">🚪 Salir</button>
      </span>
    </div>`;
  }

  // Lista de espectadores viendo la partida en vivo
  const specList = Array.isArray(window._activeSpectators) ? window._activeSpectators : [];
  const specBanner = specList.length ? `
    <div style="background:var(--paper2);padding:6px 10px;border-radius:6px;font-size:.8rem;margin-bottom:10px;display:flex;align-items:center;gap:6px">
      <span>👁️</span> <span><b>Espectadores viendo la partida:</b> ${specList.map(esc).join(', ')}</span>
    </div>
  ` : '';

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
      <div class="entry"><input id="guest-pts" type="number" inputmode="numeric" placeholder="Puntos mano" value="${(draft[myPlayerIndex] || {}).pts ?? ''}" oninput="setPts(${myPlayerIndex},this.value);guestTyping()">
        <div class="pending" id="pend-${myPlayerIndex}">${entryTotal(draft[myPlayerIndex] || {}, st.penalty) > 0 ? '+' + entryTotal(draft[myPlayerIndex] || {}, st.penalty) : entryTotal(draft[myPlayerIndex] || {}, st.penalty)}</div></div>
      <div class="quick">
        <button class="${(draft[myPlayerIndex] || {}).m10 ? 'on' : ''}" onclick="toggle(${myPlayerIndex},'m10');guestTyping()">−10</button>
        <button class="${(draft[myPlayerIndex] || {}).m25 ? 'on' : ''}" onclick="toggle(${myPlayerIndex},'m25');guestTyping()">−25</button>
        <button class="q-ch" onclick="chinchon(${myPlayerIndex})">Chinchón</button>
        <button class="q-pen ${(draft[myPlayerIndex] || {}).pen ? 'on' : ''}" onclick="penalty(${myPlayerIndex});guestTyping()">${(draft[myPlayerIndex] || {}).pen ? '×' + (draft[myPlayerIndex] || {}).pen : '+' + st.penalty}</button>
      </div>
      ${(() => { const my = draft[myPlayerIndex] || {}; const has = (my.pts !== undefined && my.pts !== '') || my.m10 || my.m25 || my.pen; const sent = guestLastSent !== null && guestLastSent === JSON.stringify(my);
        return `<button class="btn block" style="margin-top:10px" onclick="submitGuestPts(true)">✅ Apuntar mis puntos</button>
        <div class="muted" style="text-align:center;margin-top:8px;font-size:.82rem">${sent && has ? '<b style="color:var(--ok)">✓ Apuntado en la mesa.</b> Esperando a que se cierre la ronda' : (has ? '⚠️ Todavía NO se han apuntado: pulsa «Apuntar mis puntos»' : 'Escribe tus puntos y pulsa «Apuntar mis puntos»')}</div>`; })()}
      <button class="btn btn-bell block" style="margin-top:8px" onclick="triggerCloseBell()">🔔 ¡He cerrado la mano!</button>
    `}
  </div>` : '';

  return `${topHeader}${specBanner}${potBanner}${guestBanner}${cardTableSwitchBtn}
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
        <div class="badges">${remoteDrafts[i] ? '<span class="remote-badge">✓ Apuntado</span>' : (remoteTyping[i] && Date.now() - remoteTyping[i] < 6000 ? '<span class="remote-badge" style="background:#fff7e0;color:#8a6a10;border-color:#c9a53a">✍️ escribiendo…</span>' : '')}${i === dealerIdx && !p.out ? '<span class="badge" style="border-color:var(--ink);color:var(--ink);font-weight:600">🂠 Reparte</span>' : ''}${p.rejoins ? `<span class="badge">↻ ${p.rejoins}</span>` : ''}${p.out ? '<span class="badge red">Eliminado</span>' : `<span class="badge">${rejLeft > 0 ? rejLeft + ' reeng.' : 'sin reeng.'}</span>`}</div></div>
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
    </div>` : (isSpectator ? `
    <div class="card" style="text-align:center;padding:12px;background:var(--paper2);margin-top:14px">
      <span class="muted">👁️ Modo espectador: viendo los marcadores en directo</span>
    </div>` : `
    <div class="card" style="text-align:center;padding:12px;background:var(--paper2);margin-top:14px">
      <span class="muted">👑 Esperando a que el Administrador cierre la ronda</span>
    </div>`)}
  ${G.rounds.length ? `<h2>Rondas</h2><div class="card" style="overflow-x:auto"><table><tr><th>#</th>${G.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${G.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => {
      if (t === null) return `<td><span class="muted">–</span>${r.events[i] ? `<div class="tag">${esc(r.events[i])}</div>` : ''}</td>`;
      const beforePts = (r.before && r.before[i]) ? r.before[i].score : 0;
      const nextR = G.rounds[n + 1];
      const afterPts = (nextR && nextR.before && nextR.before[i]) ? nextR.before[i].score : (beforePts + t);
      const deltaStr = t > 0 ? '+' + t : '' + t;
      return `<td><b>${afterPts}</b> <span class="muted" style="font-size:.76rem">(${deltaStr})</span>${r.events[i] ? `<div class="tag">${esc(r.events[i])}</div>` : ''}</td>`;
    }).join('')}</tr>`).join('')}
  </table></div>` : ''}
  ${isHost ? '<button class="btn danger block" style="margin-top:14px" onclick="abandonGame()">Abandonar partida</button>' : '<button class="btn ghost block" style="margin-top:14px;color:var(--accent);border-color:var(--accent)" onclick="leaveCurrentGame()">🚪 Salir de esta partida y volver al inicio</button>'}`;
}
function setPts(i, v) {
  draft[i] = { ...(draft[i] || {}), pts: v };
  const t = entryTotal(draft[i], S.game.settings.penalty);
  const pend = $('#pend-' + i); if (pend) pend.textContent = t > 0 ? '+' + t : t;
}
function toggle(i, k) { draft[i] = { ...(draft[i] || {}) }; draft[i][k] = !draft[i][k]; if (k === 'm10' && draft[i].m10) draft[i].m25 = false; if (k === 'm25' && draft[i].m25) draft[i].m10 = false; vibrate(); render(); }
function penalty(i) { draft[i] = { ...(draft[i] || {}) }; draft[i].pen = ((draft[i].pen || 0) + 1) % 4; vibrate(); render(); }
function chinchon(i) {
  if (!isHost) return toast('Avisa a Juan: el Chinchón lo valida el administrador');
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
  const skip = window._skipPending; window._skipPending = false;
  if (!skip) {
    const waiting = S.game.players.filter((p, i) => !p.out && remoteSeen[p.name.trim().toLowerCase()] && !remoteDrafts[i]);
    if (waiting.length) {
      return modal(`<h2>⏳ Faltan puntos por apuntar</h2>
        <p class="muted">Estos jugadores conectados todavía no han apuntado sus puntos:</p>
        <p><b>${waiting.map(p => esc(p.name)).join(', ')}</b></p>
        <div class="row"><button class="btn ghost block" onclick="closeModal()">Esperar</button>
        <button class="btn block" onclick="closeModal();window._skipPending=true;closeRound()">Apuntar igualmente</button></div>`);
    }
  }
  // Trabajamos sobre una copia: si se cancela la ronda no se toca nada
  const G = JSON.parse(JSON.stringify(S.game)), st = G.settings;
  const before = JSON.parse(JSON.stringify(S.game.players));
  const totals = [], events = [], flags = [];
  G.players.forEach((p, i) => {
    if (p.out) { totals.push(null); events.push(''); return; }
    const e = draft[i] || {}; const t = entryTotal(e, st.penalty);
    p.score += t; totals.push(t);
    events.push([e.m10 && '−10', e.m25 && '−25', e.pen && '×' + e.pen].filter(Boolean).join(' '));
    flags[i] = { m10: !!e.m10, m25: !!e.m25, pen: e.pen || 0 };
  });
  const ctx = { G, before, totals, events, flags, msgs: [] };
  const busted = G.players.filter(p => !p.out && p.score > st.limit);
  const safe = G.players.filter(p => !p.out && p.score <= st.limit);
  if (busted.length && !safe.length) {
    // todos se pasan a la vez: sigue el que menos tenga
    const min = Math.min(...busted.map(p => p.score));
    busted.forEach(p => { if (p.score !== min) { p.out = true; ctx.msgs.push(`✕ ${p.name} eliminado`); } });
    return finalizeRound(ctx);
  }
  if (busted.length) {
    const top = Math.max(...safe.map(p => p.score));
    return askRejoin(ctx, busted.slice(), top);
  }
  finalizeRound(ctx);
}

// Pregunta uno a uno si el jugador que se ha pasado quiere reengancharse
function askRejoin(ctx, queue, top) {
  const G = ctx.G, st = G.settings, cfg = S.adminConfig || {};
  while (queue.length) {
    const p = queue[0], i = G.players.findIndex(x => x.name === p.name);
    const taunt = cfg.tauntsEnabled !== false;
    if (p.rejoins >= st.maxRejoins) {
      p.out = true; ctx.events[i] += ' ✕'; ctx.msgs.push(taunt ? pick(TAUNT_OUT)(p.name) : `✕ ${p.name} eliminado`);
      queue.shift(); continue;
    }
    if (cfg.askRejoin === false) {
      p.rejoins++; p.score = top; ctx.events[i] += ' ↻ '; ctx.msgs.push(taunt ? pick(TAUNT_REJOIN)(p.name, top) : `↻ ${p.name} se reengancha con ${top}`);
      queue.shift(); continue;
    }
    window._rejoinCtx = { ctx, queue, top };
    const cost = st.potPerEntry > 0 ? `<p class="muted">Reenganche: <b>+${Number(st.potPerEntry).toFixed(2)} €</b> al bote</p>` : '';
    modal(`<div class="win"><div style="font-size:2.4rem">↻</div>
      <h2>¿${esc(p.name)} se quiere reenganchar?</h2>
      <p class="muted">Se ha pasado con <b>${p.score}</b> (límite ${st.limit}).<br>Si se reengancha vuelve con <b>${top}</b> puntos.
      Reenganches: ${p.rejoins}/${st.maxRejoins}.</p>${cost}
      <div class="row" style="margin-top:14px">
        <button class="btn danger block" onclick="answerRejoin(false)">No, eliminar</button>
        <button class="btn block" onclick="answerRejoin(true)">Sí, reenganchar</button>
      </div>
      <button class="btn ghost block" style="margin-top:8px" onclick="closeModal();toast('Ronda cancelada: no se ha apuntado nada')">Cancelar ronda</button></div>`);
    return;
  }
  finalizeRound(ctx);
}

function answerRejoin(yes) {
  const r = window._rejoinCtx; if (!r) return;
  const { ctx, queue, top } = r, G = ctx.G, cfg = S.adminConfig || {};
  const p = queue.shift(), i = G.players.findIndex(x => x.name === p.name);
  const taunt = cfg.tauntsEnabled !== false;
  if (yes) { p.rejoins++; p.score = top; ctx.events[i] += ' ↻ '; ctx.msgs.push(taunt ? pick(TAUNT_REJOIN)(p.name, top) : `↻ ${p.name} se reengancha con ${top}`); }
  else { p.out = true; ctx.events[i] += ' ✕'; ctx.msgs.push(taunt ? pick(TAUNT_OUT)(p.name) : `✕ ${p.name} eliminado`); }
  closeModal();
  askRejoin(ctx, queue, top);
}

function finalizeRound(ctx) {
  const { G, before, totals, events, flags, msgs } = ctx;
  const st = G.settings, cfg = S.adminConfig || {};
  S.game = G;
  // pique: alguien al borde
  const edge = cfg.edgeThreshold ?? 10;
  if (cfg.tauntsEnabled !== false && !msgs.length) G.players.forEach((p, i) => { if (!p.out && st.limit - p.score <= edge && totals[i] > 0) msgs.push(pick(TAUNT_EDGE)(p.name, st.limit - p.score)); });
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
  modal(`<h2>¿Abandonar partida?</h2><p class="muted">No se guardará en el historial y se cerrará la mesa para todos los móviles conectados.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">No</button><button class="btn danger block" onclick="confirmAbandonGame()">Sí, abandonar</button></div>`);
}

function confirmAbandonGame() {
  sendMqtt({ type: 'game_abandoned' });
  sendGlobalMqtt({ type: 'table_closed', roomCode: currentRoomCode });
  S.game = null;
  draft = {};
  remoteDrafts = {};
  remoteTyping = {};
  currentRoomCode = null;
  window._isSpectator = false;
  window._activeSpectators = [];
  save();
  closeModal();
  render();
  toast('Partida abandonada y mesa cerrada');
}

function leaveCurrentGame() {
  modal(`<h2>¿Salir de la partida?</h2><p class="muted">Volverás a la pantalla principal. Si la partida sigue activa podrás volver a entrar con el enlace de la sala.</p>
    <div class="row">
      <button class="btn ghost block" onclick="closeModal()">Seguir jugando</button>
      <button class="btn danger block" onclick="confirmLeaveGame()">Sí, salir al inicio</button>
    </div>`);
}

function confirmLeaveGame() {
  if (window._isSpectator) {
    const watcher = myPlayerName || (isAdmin() ? 'Juan' : 'Un espectador');
    sendMqtt({ type: 'spectator_left', name: watcher });
  }
  window._isSpectator = false;
  window._activeSpectators = [];
  if (S.game && S.game.winner) {
    if (!S.games) S.games = [];
    if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
  }
  S.game = null;
  draft = {};
  remoteDrafts = {};
  remoteTyping = {};
  currentRoomCode = null;
  guestLastSent = null;
  window._identityChosen = false;
  save();
  closeModal();
  render();
  toast('Has salido de la partida');
}
function finishGame(wi, how) {
  const G = S.game; G.winner = G.players[wi].name; G.how = how; G.end = Date.now();
  sendMqtt({ type: 'sync', game: G, draft: {} });
  sendMqtt({ type: 'history_sync', game: G });
  sendGlobalMqtt({ type: 'game_finished_report', game: G, finishedBy: myPlayerName || (isAdmin() ? 'Juan' : 'Invitado') });
  sendGlobalMqtt({ type: 'table_closed', roomCode: G.roomCode });
  S.games.unshift(G); S.game = null; draft = {}; remoteDrafts = {}; remoteTyping = {}; window._isSpectator = false; window._activeSpectators = []; save(); render();
  winModal(G);
}
function winModal(G) {
  vibrate([60, 40, 120]);
  confetti();
  const ranked = [...G.players].sort((a, b) => (a.out !== b.out ? (a.out ? 1 : -1) : a.score - b.score));
  const st = G.settings || {};
  let pot = '';
  if (st.potPerEntry > 0) {
    const entries = G.players.length + G.players.reduce((n, p) => n + (p.rejoins || 0), 0);
    pot = `<p style="margin:10px 0 0">💰 Bote: <b>${(entries * st.potPerEntry).toFixed(2)} €</b> para ${esc(G.winner)}</p>`;
  }
  const mins = G.end && G.date ? Math.max(1, Math.round((G.end - G.date) / 60000)) : null;
  // racha de victorias del ganador
  let streak = 0; for (const g of S.games) { if (g.winner === G.winner && g.groupId === G.groupId) streak++; else break; }
  const streakTxt = streak >= 2 ? `<p class="muted" style="margin:6px 0 0">🔥 ${esc(G.winner)} lleva ${streak} victorias seguidas</p>` : '';
  modal(`<div class="win"><div class="trophy">♠</div><h2 style="font-size:1.6rem">¡Gana ${esc(G.winner)}!</h2>
    <p class="muted">Por ${esc(G.how || '')} · ${G.rounds.length} rondas${mins ? ' · ' + mins + ' min' : ''}</p>
    ${ranked.map(p => `<div class="rank"><span>${esc(p.name)}${p.rejoins ? ' ↻ ' + p.rejoins : ''}${p.out ? ' ✕' : ''}</span><b>${p.score}</b></div>`).join('')}
    ${pot}${streakTxt}
    <button class="btn btn-wa block" style="margin-top:14px;font-size:1rem" onclick="openSendReportModal(S.games[0])">📲 Enviar resultado por WhatsApp</button>
    <div class="row" style="margin-top:8px"><button class="btn ghost block" onclick="closeModal();tab='history';render()">Historial</button>
    ${isHost ? `<button class="btn block" onclick="closeModal();selGroup='${G.groupId}';newGame()">Revancha</button>` : `<button class="btn block" onclick="closeModal()">Cerrar</button>`}</div></div>`);
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

// ===== SINCRONIZACIÓN EN TIEMPO REAL & GESTOR DE CONEXIÓN ROBUSTO =====
const MQTT_BROKERS = [
  { host: 'broker.emqx.io', port: 8084, path: '/mqtt' },
  { host: 'broker.hivemq.com', port: 8884, path: '/mqtt' }
];
let _currentBrokerIdx = 0;
let _mqttStatus = 'disconnected'; // 'connected' | 'connecting' | 'disconnected'
let _reconnectTimer = null;
let _reconnectAttempts = 0;
let _mqttOutbox = [];

function updateConnectionIndicator() {
  const el = $('#conn-dot');
  if (!el) return;
  if (_mqttStatus === 'connected') {
    el.textContent = '🟢';
    el.title = 'Conectado a la red en vivo (tocar para refrescar)';
    el.style.opacity = '1';
  } else if (_mqttStatus === 'connecting') {
    el.textContent = '🟡';
    el.title = 'Conectando con el servidor...';
    el.style.opacity = '0.9';
  } else {
    el.textContent = '🔴';
    el.title = 'Sin conexión. Toca para reconectar ahora';
    el.style.opacity = '0.7';
  }
}

function flushMqttOutbox() {
  if (!_mqttOutbox.length || !mqttClient || !mqttClient.isConnected || !mqttClient.isConnected()) return;
  const toSend = [..._mqttOutbox];
  _mqttOutbox = [];
  toSend.forEach(item => {
    try {
      const m = new Paho.MQTT.Message(JSON.stringify(item.data));
      m.destinationName = item.dest;
      m.qos = 1;
      mqttClient.send(m);
    } catch(e) {
      _mqttOutbox.push(item);
    }
  });
}

function scheduleMqttReconnect() {
  if (_reconnectTimer) clearTimeout(_reconnectTimer);
  _reconnectAttempts++;
  const delay = Math.min(1200 * Math.pow(1.3, Math.min(_reconnectAttempts, 5)) + Math.random() * 400, 7000);
  _reconnectTimer = setTimeout(() => {
    _reconnectTimer = null;
    initMqtt(currentRoomCode || 'auth_global');
  }, delay);
}

function ensureMqttConnected(force = false) {
  if (force) {
    if (_reconnectTimer) clearTimeout(_reconnectTimer);
    try { if (mqttClient) mqttClient.disconnect(); } catch(e) {}
    mqttClient = null;
    _mqttStatus = 'disconnected';
    updateConnectionIndicator();
    toast('🔄 Reconectando con la red...', 1800);
    initMqtt(currentRoomCode || 'auth_global');
    return;
  }
  if (!mqttClient || !mqttClient.isConnected || !mqttClient.isConnected()) {
    initMqtt(currentRoomCode || 'auth_global');
  }
}

function initMqtt(roomCode, onConnect) {
  if (roomCode && roomCode !== 'auth_global') currentRoomCode = roomCode;
  
  // Si ya estamos conectados con el socket vivo
  if (mqttClient && mqttClient.isConnected && mqttClient.isConnected()) {
    _mqttStatus = 'connected';
    updateConnectionIndicator();
    if (roomCode && roomCode !== 'auth_global') {
      try { mqttClient.subscribe(`chinchon/v1/${roomCode}`, { qos: 1 }); } catch(e) {}
    }
    flushMqttOutbox();
    if (onConnect) onConnect();
    return;
  }

  if (typeof Paho === 'undefined' || !Paho.MQTT) {
    console.warn('Paho MQTT no disponible');
    return;
  }

  _mqttStatus = 'connecting';
  updateConnectionIndicator();

  const broker = MQTT_BROKERS[_currentBrokerIdx];
  const clientId = 'ch_' + CLIENT_ID + '_' + Math.random().toString(36).substring(2, 6);

  try {
    mqttClient = new Paho.MQTT.Client(broker.host, broker.port, broker.path, clientId);

    mqttClient.onConnectionLost = (responseObject) => {
      _mqttStatus = 'disconnected';
      updateConnectionIndicator();
      _currentBrokerIdx = (_currentBrokerIdx + 1) % MQTT_BROKERS.length;
      scheduleMqttReconnect();
    };

    mqttClient.onMessageArrived = (msg) => {
      try {
        const payload = JSON.parse(msg.payloadString);
        handleMqttMsg(payload);
      } catch(e) {}
    };

    mqttClient.connect({
      useSSL: true,
      timeout: 8,
      cleanSession: true,
      keepAliveInterval: 15, // intervalo óptimo para conexiones móviles 4G/5G/Wi-Fi
      onSuccess: () => {
        _mqttStatus = 'connected';
        _reconnectAttempts = 0;
        updateConnectionIndicator();
        try { mqttClient.subscribe('chinchon/v1/auth_global', { qos: 1 }); } catch(e) {}
        if (currentRoomCode && currentRoomCode !== 'auth_global') {
          try { mqttClient.subscribe(`chinchon/v1/${currentRoomCode}`, { qos: 1 }); } catch(e) {}
        }
        flushMqttOutbox();
        broadcastPresence();
        if (isAdmin()) {
          setTimeout(requestRemoteHistoryFromGuests, 1200);
        }
        if (onConnect) onConnect();
        if (!isHost || !S.game) sendMqtt({ type: 'reqSync' });
      },
      onFailure: (err) => {
        _mqttStatus = 'disconnected';
        updateConnectionIndicator();
        _currentBrokerIdx = (_currentBrokerIdx + 1) % MQTT_BROKERS.length;
        scheduleMqttReconnect();
      }
    });
  } catch(e) {
    _mqttStatus = 'disconnected';
    updateConnectionIndicator();
    scheduleMqttReconnect();
  }
}

function sendMqtt(data) {
  data.from = CLIENT_ID;
  const dest = `chinchon/v1/${currentRoomCode || 'auth_global'}`;
  if (!mqttClient || !mqttClient.isConnected || !mqttClient.isConnected()) {
    _mqttOutbox.push({ dest, data });
    ensureMqttConnected();
    return;
  }
  try {
    const m = new Paho.MQTT.Message(JSON.stringify(data));
    m.destinationName = dest;
    m.qos = 1;
    mqttClient.send(m);
  } catch(e) {
    _mqttOutbox.push({ dest, data });
    ensureMqttConnected();
  }
}

function sendGlobalMqtt(data) {
  data.from = CLIENT_ID;
  const dest = 'chinchon/v1/auth_global';
  if (!mqttClient || !mqttClient.isConnected || !mqttClient.isConnected()) {
    _mqttOutbox.push({ dest, data });
    ensureMqttConnected();
    return;
  }
  try {
    const m = new Paho.MQTT.Message(JSON.stringify(data));
    m.destinationName = dest;
    m.qos = 1;
    mqttClient.send(m);
  } catch(e) {
    _mqttOutbox.push({ dest, data });
    ensureMqttConnected();
  }
}

// ===== SISTEMA DE AUDIO ROBUSTO (MÓVILES, IOS SAFARI & ANDROID) =====
let _sharedAudioCtx = null;
let _audioUnlocked = false;
let _cachedChatWav = null;
let _cachedBellWav = null;

function createToneWavDataUri(tones, durationSec = 0.35, sampleRate = 22050) {
  try {
    const numSamples = Math.floor(sampleRate * durationSec);
    const dataSize = numSamples * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    function writeStr(offset, str) {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    }
    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, 1, true); // Mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      let s = 0;
      for (const tone of tones) {
        if (t >= tone.start && t < tone.end) {
          const toneT = t - tone.start;
          const toneDur = tone.end - tone.start;
          const env = Math.exp(-3.5 * (toneT / toneDur));
          s += Math.sin(2 * Math.PI * tone.freq * toneT) * env * (tone.vol || 0.6);
        }
      }
      s = Math.max(-1, Math.min(1, s));
      view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    const bytes = new Uint8Array(buffer);
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let base64 = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i += 3) {
      const b1 = bytes[i];
      const b2 = i + 1 < len ? bytes[i + 1] : 0;
      const b3 = i + 2 < len ? bytes[i + 2] : 0;
      base64 += chars[b1 >> 2];
      base64 += chars[((b1 & 3) << 4) | (b2 >> 4)];
      base64 += i + 1 < len ? chars[((b2 & 15) << 2) | (b3 >> 6)] : '=';
      base64 += i + 2 < len ? chars[b3 & 63] : '=';
    }
    return 'data:audio/wav;base64,' + base64;
  } catch(e) { return null; }
}

function getSharedAudioContext() {
  if (!_sharedAudioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    _sharedAudioCtx = new AudioCtx();
  }
  return _sharedAudioCtx;
}

function unlockMobileAudio() {
  const ctx = getSharedAudioContext();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().then(() => { _audioUnlocked = true; }).catch(() => {});
  } else if (ctx && ctx.state === 'running') {
    _audioUnlocked = true;
  }
  try {
    if (ctx) {
      const buf = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch(e) {}
}

if (typeof document !== 'undefined') {
  ['touchstart', 'touchend', 'click', 'pointerdown', 'keydown'].forEach(ev => {
    document.addEventListener(ev, unlockMobileAudio, { passive: true });
  });
}

function playChatSound() {
  if (typeof S !== 'undefined' && S && S.adminConfig && S.adminConfig.soundEnabled === false) return;
  
  // 1. Web Audio sintetizado
  try {
    const ctx = getSharedAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [659.25, 987.77].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);
        gain.gain.setValueAtTime(0.4, now + i * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.28);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.29);
      });
    }
  } catch(e) {}

  // 2. HTML5 Audio (reproduce en segundo plano / iOS Safari)
  try {
    if (!_cachedChatWav) {
      _cachedChatWav = createToneWavDataUri([
        { freq: 659.25, start: 0, end: 0.16, vol: 0.7 },
        { freq: 987.77, start: 0.08, end: 0.35, vol: 0.8 }
      ]);
    }
    if (_cachedChatWav) {
      const a = new Audio(_cachedChatWav);
      a.volume = 1.0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    }
  } catch(e) {}

  vibrate([100, 40, 100]);
}

function ringBellSound() {
  if (typeof S !== 'undefined' && S && S.adminConfig && S.adminConfig.soundEnabled === false) return;

  // 1. Web Audio sintetizado
  try {
    const ctx = getSharedAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.05);
        gain.gain.setValueAtTime(0.45, now + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.05 + 1.1);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.05);
        osc.stop(now + i * 0.05 + 1.1);
      });
    }
  } catch(e) {}

  // 2. HTML5 Audio sintetizado
  try {
    if (!_cachedBellWav) {
      _cachedBellWav = createToneWavDataUri([
        { freq: 523.25, start: 0, end: 0.8, vol: 0.6 },
        { freq: 659.25, start: 0.05, end: 0.85, vol: 0.6 },
        { freq: 783.99, start: 0.10, end: 0.9, vol: 0.6 },
        { freq: 1046.50, start: 0.15, end: 1.0, vol: 0.7 }
      ], 1.0);
    }
    if (_cachedBellWav) {
      const a = new Audio(_cachedBellWav);
      a.volume = 1.0;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    }
  } catch(e) {}

  vibrate([80, 50, 100]);
}

// ===== MENSAJERÍA DIRECTA & CHAT =====
window._currentChatWith = null;
window._roomChatMessages = [];

function getChatStorageKey(friendName) {
  const canon = getCanonicalPlayerName(friendName).toLowerCase().replace(/[^a-z0-9]/g, '_');
  return 'chinchon_chat_' + canon;
}

function getChatHistory(friendName) {
  try {
    const raw = localStorage.getItem(getChatStorageKey(friendName));
    return raw ? JSON.parse(raw) : [];
  } catch(e) { return []; }
}

function saveChatMessage(friendName, msg) {
  try {
    const history = getChatHistory(friendName);
    history.push(msg);
    if (history.length > 80) history.shift();
    localStorage.setItem(getChatStorageKey(friendName), JSON.stringify(history));
  } catch(e) {}
}

function openFriendChatModal(friendName) {
  window._currentChatWith = friendName;
  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Amigo');
  const history = getChatHistory(friendName);
  const isOnline = window._onlineFriends && window._onlineFriends[getCanonicalPlayerName(friendName).toLowerCase()];

  modal(`
    <div class="chat-container">
      <div class="row between" style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.4rem">💬</span>
          <div>
            <b>Chat con ${esc(friendName)}</b>
            <div style="font-size:.76rem">
              ${isOnline ? '🟢 <span style="color:var(--ok);font-weight:600">En línea ahora</span>' : '<span class="muted">⚪ Desconectado (le llegará al abrir la app)</span>'}
            </div>
          </div>
        </div>
        <button class="btn ghost sm" onclick="window._currentChatWith=null;closeModal()">✕</button>
      </div>

      <div id="chat-msgs-box" class="chat-messages">
        ${history.length ? history.map(m => `
          <div class="chat-bubble ${m.me ? 'mine' : 'theirs'}">
            <div>${esc(m.text)}</div>
            <div class="chat-time">${new Date(m.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
          </div>
        `).join('') : '<div class="muted" style="text-align:center;margin:auto">No hay mensajes todavía. ¡Dile algo!</div>'}
      </div>

      <div class="chat-chips">
        <button class="chat-chip" onclick="quickSendChat('¿Echamos una partida? 🂠')">🂠 ¿Echamos una partida?</button>
        <button class="chat-chip" onclick="quickSendChat('¡Te reto ahora mismo! ⚔️')">⚔️ ¡Te reto ahora!</button>
        <button class="chat-chip" onclick="quickSendChat('¡Qué cabrón! 😂')">😂 ¡Qué cabrón!</button>
        <button class="chat-chip" onclick="quickSendChat('Menuda mano tengo 🔥')">🔥 Menuda mano</button>
        <button class="chat-chip" onclick="quickSendChat('¡He cerrado! 🏆')">🏆 ¡He cerrado!</button>
        <button class="chat-chip" onclick="quickSendChat('¿Dónde estás? 👀')">👀 ¿Dónde estás?</button>
      </div>

      <div class="chat-input-bar">
        <input id="chat-input" placeholder="Escribe a ${esc(friendName)}..." onkeydown="if(event.key==='Enter')sendFriendChatMessage('${esc(friendName)}')">
        <button class="btn" style="background:#22543d;border-color:#22543d;color:#fff" onclick="sendFriendChatMessage('${esc(friendName)}')">Enviar ›</button>
      </div>
    </div>
  `);

  setTimeout(() => {
    const box = document.getElementById('chat-msgs-box');
    if (box) box.scrollTop = box.scrollHeight;
    const inp = document.getElementById('chat-input');
    if (inp) inp.focus();
  }, 100);
}

function quickSendChat(text) {
  const inp = document.getElementById('chat-input');
  if (inp) inp.value = text;
  if (window._currentChatWith) {
    sendFriendChatMessage(window._currentChatWith);
  }
}

function sendFriendChatMessage(friendName) {
  const inp = document.getElementById('chat-input');
  if (!inp) return;
  const text = (inp.value || '').trim();
  if (!text) return;

  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Amigo');
  const msgObj = {
    id: uid(),
    from: myName,
    target: friendName,
    text: text,
    time: Date.now()
  };

  saveChatMessage(friendName, { ...msgObj, me: true });

  const friendObj = getAllKnownFriends().find(f => f.name.toLowerCase() === friendName.toLowerCase());
  const targetAliases = friendObj && friendObj.aliases ? friendObj.aliases : [];
  const allTargets = [friendName, ...targetAliases];

  sendGlobalMqtt({
    type: 'direct_chat',
    ...msgObj,
    targets: allTargets
  });

  vibrate(25);
  openFriendChatModal(friendName);
}

function showIncomingChatBanner(sender, text, isRoom = false) {
  const existing = document.querySelector('.incoming-chat-banner');
  if (existing) existing.remove();

  const banner = document.createElement('div');
  banner.className = 'incoming-chat-banner';
  banner.onclick = () => {
    banner.remove();
    if (isRoom) openRoomChatModal();
    else openFriendChatModal(sender);
  };
  banner.innerHTML = `
    <div class="chat-text">
      <span class="chat-sender">💬 ${esc(sender)}:</span> "${esc(text)}"
    </div>
    <button class="btn sm" style="padding:4px 10px;font-size:.78rem;background:#22c55e;color:#052e16;border:0;font-weight:700">Responder</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => { if (banner.parentNode) banner.remove(); }, 6000);
}

function openRoomChatModal() {
  window._roomChatOpen = true;
  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Amigo');
  const msgs = window._roomChatMessages || [];

  modal(`
    <div class="chat-container">
      <div class="row between" style="border-bottom:1px solid var(--line);padding-bottom:8px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="font-size:1.4rem">💬</span>
          <div>
            <b>Chat de la Mesa (${currentRoomCode || 'Sala'})</b>
            <div class="muted" style="font-size:.76rem">Todos los jugadores en directo</div>
          </div>
        </div>
        <button class="btn ghost sm" onclick="window._roomChatOpen=false;closeModal()">✕</button>
      </div>

      <div id="room-chat-msgs-box" class="chat-messages">
        ${msgs.length ? msgs.map(m => {
          const isMine = m.from.trim().toLowerCase() === myName.trim().toLowerCase();
          return `
            <div class="chat-bubble ${isMine ? 'mine' : 'theirs'}">
              <div style="font-size:.72rem;font-weight:700;margin-bottom:2px;color:${isMine ? '#86efac' : 'var(--accent)'}">${esc(m.from)}</div>
              <div>${esc(m.text)}</div>
              <div class="chat-time">${new Date(m.time).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</div>
            </div>
          `;
        }).join('') : '<div class="muted" style="text-align:center;margin:auto">No hay mensajes en la mesa. ¡Escribe a los demás!</div>'}
      </div>

      <div class="chat-chips">
        <button class="chat-chip" onclick="quickSendRoomChat('¡Buena mano! 🂠')">🂠 ¡Buena mano!</button>
        <button class="chat-chip" onclick="quickSendRoomChat('Te toca robar ⏳')">⏳ Te toca robar</button>
        <button class="chat-chip" onclick="quickSendRoomChat('¡Qué cabrón! 😂')">😂 ¡Qué cabrón!</button>
        <button class="chat-chip" onclick="quickSendRoomChat('Cuidado que cierro 🚪')">🚪 Cuidado que cierro</button>
      </div>

      <div class="chat-input-bar">
        <input id="room-chat-input" placeholder="Escribe a la mesa..." onkeydown="if(event.key==='Enter')sendRoomChatMessage()">
        <button class="btn" style="background:#22543d;border-color:#22543d;color:#fff" onclick="sendRoomChatMessage()">Enviar ›</button>
      </div>
    </div>
  `);

  setTimeout(() => {
    const box = document.getElementById('room-chat-msgs-box');
    if (box) box.scrollTop = box.scrollHeight;
    const inp = document.getElementById('room-chat-input');
    if (inp) inp.focus();
  }, 100);
}

function quickSendRoomChat(text) {
  const inp = document.getElementById('room-chat-input');
  if (inp) inp.value = text;
  sendRoomChatMessage();
}

function sendRoomChatMessage() {
  const inp = document.getElementById('room-chat-input');
  if (!inp) return;
  const text = (inp.value || '').trim();
  if (!text) return;

  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Amigo');
  const msgObj = {
    id: uid(),
    from: myName,
    roomCode: currentRoomCode,
    text: text,
    time: Date.now()
  };

  if (!window._roomChatMessages) window._roomChatMessages = [];
  window._roomChatMessages.push(msgObj);

  sendMqtt({
    type: 'room_chat',
    ...msgObj
  });

  vibrate(20);
  openRoomChatModal();
}

// Solicitud de historial de invitados por el Administrador
function requestRemoteHistoryFromGuests() {
  if (!isAdmin()) return;
  sendGlobalMqtt({
    type: 'admin_req_history',
    from: 'Juan',
    adminId: S.adminId
  });
}

function directJoinRoom(code) {
  if (!code) return;
  code = code.trim().toUpperCase();
  if (!code.startsWith('CH-') && code.length === 4) code = 'CH-' + code;

  if (localStorage.getItem('chinchon_role') !== 'admin') {
    localStorage.setItem('chinchon_role', 'guest');
  }
  isHost = false;
  if (S.game && S.game.roomCode && S.game.roomCode !== code) {
    if (S.game.winner) {
      if (!S.games) S.games = [];
      if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
    }
    S.game = null;
    draft = {};
    remoteDrafts = {};
    remoteTyping = {};
    guestLastSent = null;
    window._identityChosen = false;
    save();
  }
  currentRoomCode = code;
  initMqtt(code, () => {
    sendMqtt({ type: 'reqSync' });
    promptJoinIdentity(code);
  });
  tab = 'play';
  render();
  toast(`🃏 Conectando a la mesa ${code}...`);
}

function joinRoomByInputCode() {
  const el = $('#input-room-code');
  if (!el) return;
  let val = (el.value || '').trim().toUpperCase();
  if (!val) return toast('Introduce un código de mesa');
  if (val.includes('ROOM=')) {
    try {
      const u = new URL(val.startsWith('http') ? val : 'https://dummy.com/' + val);
      val = (u.searchParams.get('room') || '').toUpperCase();
    } catch(e) {}
  }
  if (!val.startsWith('CH-') && val.length === 4) val = 'CH-' + val;
  if (!val) return toast('Código no válido');
  directJoinRoom(val);
}

function renderLiveTablesCard() {
  if (!window._activeTables) return '';
  const now = Date.now();
  const tables = Object.values(window._activeTables).filter(t => (now - (t.lastSeen || 0) < 50000) && (!S.game || S.game.roomCode !== t.roomCode));
  if (!tables.length) return '';

  return `
    <div class="card" style="margin-bottom:14px;border:1.5px solid var(--ok);background:var(--paper2)">
      <div class="row between" style="margin-bottom:6px">
        <span style="font-weight:700;font-size:.9rem;color:var(--ok)">
          <i class="live-dot"></i> 🔴 Partidas en Directo ahora (${tables.length})
        </span>
      </div>
      ${tables.map(t => `
        <div class="row between" style="padding:8px 0;border-top:1px solid var(--line);align-items:center">
          <div>
            <b>${esc(t.groupName || 'Partida de Chinchón')}</b> <span class="tag" style="margin-left:4px;font-family:monospace">${esc(t.roomCode)}</span>
            <div class="muted" style="font-size:.78rem;margin-top:2px">
              Jugadores: ${Array.isArray(t.players) ? t.players.map(p => esc(p.name || p)).join(' · ') : 'Varios'} · Ronda ${t.roundsCount + 1}
            </div>
          </div>
          <button class="btn sm" style="white-space:nowrap;padding:5px 10px;font-size:.8rem" onclick="watchLiveGame('${esc(t.roomCode)}')">👁️ Mirar partida</button>
        </div>
      `).join('')}
    </div>
  `;
}

function watchLiveGame(roomCode) {
  if (!roomCode) return;
  window._isSpectator = true;
  window._identityChosen = true;

  if (localStorage.getItem('chinchon_role') !== 'admin') {
    localStorage.setItem('chinchon_role', 'guest');
  }
  isHost = isAdmin(); // Si Juan entra a mirar, tiene autoridad de Administrador para tocar marcadores

  if (S.game && S.game.roomCode && S.game.roomCode !== roomCode) {
    if (S.game.winner) {
      if (!S.games) S.games = [];
      if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
    }
    S.game = null;
    draft = {};
    remoteDrafts = {};
    remoteTyping = {};
    guestLastSent = null;
    save();
  }

  currentRoomCode = roomCode;
  initMqtt(roomCode, () => {
    sendMqtt({ type: 'reqSync' });
    const watcher = myPlayerName || (isAdmin() ? 'Juan' : 'Un amigo');
    sendMqtt({ type: 'spectator_joined', name: watcher });
  });

  tab = 'play';
  render();
  toast(`👁️ Conectado a la mesa ${roomCode} como espectador`);
}

function broadcastTableAlive() {
  if (!S.game || S.game.mode !== 'online' || !S.game.roomCode) return;
  sendGlobalMqtt({
    type: 'table_alive',
    roomCode: S.game.roomCode,
    groupName: S.game.groupName,
    hostName: (isAdmin() ? 'Juan' : (myPlayerName || 'Anfitrión')),
    players: S.game.players.map(p => ({ name: p.name, score: p.score, out: p.out })),
    roundsCount: S.game.rounds.length,
    time: Date.now()
  });
}

function handleMqttMsg(d) {
  if (!d || !d.type) return;
  if (d.from && d.from === CLIENT_ID) return; // ignorar el eco de mis propios mensajes
  if (d.type === 'card_action' || d.type.startsWith('card_')) {
    if (window.handleCardTableMsg) window.handleCardTableMsg(d);
    return;
  }
  if (d.type === 'auth_broadcast') {
    localStorage.setItem('chinchon_remote_auth', JSON.stringify(d));
    checkAccessControl();
    return;
  }
  if (d.type === 'auth_query') {
    if (isAdmin()) broadcastAuthPolicy();
    return;
  }
  if (d.type === 'sync') {
    if (!isHost || (!S.game && d.game)) {
      const prevRounds = S.game ? S.game.rounds.length : -1;
      const myOld = myPlayerIndex !== null ? draft[myPlayerIndex] : undefined;
      S.game = d.game;
      if (d.game && d.game.cardTable) {
        S.game.cardTable = d.game.cardTable;
        if (d.game.gameType === 'cards' && !window._activeCardView) {
          window._activeCardView = 'table';
        }
      }
      if (!isHost && d.game && d.game.winner) {
        if (!S.games.find(g => g.id === d.game.id)) S.games.unshift(d.game);
        S.game = null; draft = {}; guestLastSent = null; save(); render(); winModal(d.game);
        return;
      }
      if (d.game && d.game.rounds.length !== prevRounds) {
        // ronda nueva o deshecha: borrador limpio
        draft = { ...(d.draft || {}) }; guestLastSent = null;
      } else {
        draft = { ...draft, ...(d.draft || {}) };
        // lo que yo estoy escribiendo manda sobre lo que llegue de la mesa
        if (myPlayerIndex !== null && myOld !== undefined) draft[myPlayerIndex] = myOld;
      }
      syncMyPlayerIndex();
      save();
      render();
      if (!isHost && !window._isSpectator && currentRoomCode && (myPlayerIndex === null || !myPlayerName || myPlayerName === 'Invitado') && !window._identityChosen) {
        promptJoinIdentity(currentRoomCode);
      }
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
  } else if (d.type === 'typing') {
    if (isHost && S.game && d.playerIndex >= 0) {
      remoteSeen[(d.playerName || '').trim().toLowerCase()] = Date.now();
      remoteTyping[d.playerIndex] = Date.now();
      render();
      setTimeout(() => { if (Date.now() - (remoteTyping[d.playerIndex] || 0) >= 6000) { delete remoteTyping[d.playerIndex]; render(); } }, 6200);
    }
  } else if (d.type === 'hello') {
    if (isHost && d.name) { remoteSeen[d.name.trim().toLowerCase()] = Date.now(); }
  } else if (d.type === 'draft') {
    if (S.game && d.playerIndex >= 0 && d.playerIndex < S.game.players.length) {
      draft[d.playerIndex] = d.entry;
      remoteDrafts[d.playerIndex] = true;
      delete remoteTyping[d.playerIndex];
      if (isHost) {
        remoteSeen[(d.playerName || '').trim().toLowerCase()] = Date.now();
        save();
        sendMqtt({ type: 'draftSync', draft });
        toast(`✓ ${d.playerName} ha apuntado ${entryTotal(d.entry, S.game.settings.penalty)} pts`);
        vibrate(20);
      }
      render();
    }
  } else if (d.type === 'draftSync') {
    if (!isHost && d.draft) {
      const mine = myPlayerIndex !== null ? draft[myPlayerIndex] : undefined;
      draft = { ...d.draft };
      if (mine !== undefined) draft[myPlayerIndex] = mine;
      render();
    }
  } else if (d.type === 'bell') {
    ringBellSound();
    vibrate([80, 50, 100]);
    toast(`🔔 ¡${d.name} ha cerrado la mano! Dejad de robar.`, 3600);
  } else if (d.type === 'forceReload') {
    if (!isHost) {
      if (!d.target || d.target === 'all' || (myPlayerName && myPlayerName.trim().toLowerCase() === d.target.trim().toLowerCase())) {
        toast('🔄 Juan ha ordenado recargar tu pantalla...', 2200);
        setTimeout(() => {
          if (window.caches) {
            caches.keys().then(ks => Promise.all(ks.map(k => caches.delete(k)))).finally(() => {
              location.replace(location.pathname + '?r=' + Date.now());
            });
          } else {
            location.replace(location.pathname + '?r=' + Date.now());
          }
        }, 600);
      }
    }
  } else if (d.type === 'alert') {
    ringBellSound();
    vibrate([100, 50, 100]);
    showOpenMessage(d.text);
  } else if (d.type === 'game_ping') {
    const myName = (myPlayerName || '').trim().toLowerCase();
    const isTarget = Array.isArray(d.targets) && d.targets.some(t => t.trim().toLowerCase() === myName || t === 'all');
    if (isTarget || !d.targets) {
      ringBellSound();
      vibrate([100, 50, 100, 50, 200]);
      if (d.game && !S.games.some(x => x.id === d.game.id)) {
        S.games.unshift(d.game);
        save();
      }
      modal(`
        <div style="text-align:center;padding:12px 6px">
          <div style="font-size:3rem;margin-bottom:6px">🔔</div>
          <h2 style="margin:0 0 4px">¡Fin de Partida!</h2>
          <p class="muted" style="margin-bottom:12px">${esc(d.sender || 'Juan')} ha enviado el acta oficial a tu móvil:</p>
          <div class="card" style="text-align:left;font-family:var(--sans);font-size:.86rem;white-space:pre-wrap;background:var(--paper2);max-height:45vh;overflow-y:auto;margin-bottom:14px">${esc(d.report)}</div>
          <button class="btn block" onclick="closeModal();tab='history';render()">Ver en mi historial</button>
        </div>
      `);
    }
  } else if (d.type === 'game_abandoned') {
    if (!isHost) {
      if (S.game && S.game.winner) {
        if (!S.games) S.games = [];
        if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
      }
      S.game = null;
      draft = {};
      remoteDrafts = {};
      remoteTyping = {};
      currentRoomCode = null;
      guestLastSent = null;
      window._identityChosen = false;
      save();
      render();
      toast('ℹ️ El Administrador ha cerrado la partida');
    }
  } else if (d.type === 'history_sync') {
    if (d.game && !S.games.some(x => x.id === d.game.id)) {
      S.games.unshift(d.game);
      save();
      if (tab === 'history') render();
      toast('📜 Partida guardada en tu historial');
    }
  } else if (d.type === 'full_history_sync') {
    if (Array.isArray(d.games)) {
      let added = 0;
      d.games.forEach(g => {
        if (!S.games.some(x => x.id === g.id)) {
          S.games.push(g);
          added++;
        }
      });
      if (added > 0) {
        S.games.sort((a, b) => b.date - a.date);
        save();
        if (tab === 'history') render();
        toast(`📜 ${added} ${added === 1 ? 'partida sincronizada' : 'partidas sincronizadas'}`);
      }
    }
  } else if (d.type === 'guest_register') {
    if (isAdmin() && d.name) {
      if (!S.adminConfig.authorizedGuests) S.adminConfig.authorizedGuests = [];
      let g = S.adminConfig.authorizedGuests.find(x => x.name.trim().toLowerCase() === d.name.trim().toLowerCase());
      if (!g) {
        S.adminConfig.authorizedGuests.unshift({
          id: 'g_' + uid(),
          name: d.name.trim(),
          pass: d.pass || ('p_' + uid()),
          status: 'allowed',
          addedAt: Date.now()
        });
        save();
        broadcastAuthPolicy();
      }
      toast(`👤 ¡${d.name} se ha unido a tu aplicación!`);
    }
  } else if (d.type === 'kick') {
    if (!isHost && myPlayerName && myPlayerName.trim().toLowerCase() === d.target.trim().toLowerCase()) {
      modal(`<h2>Mesa desconectada</h2><p class="muted">Has sido desconectado de la mesa por el Administrador.</p>
        <button class="btn block" onclick="location.replace(location.pathname)">Volver al inicio</button>`);
    }
  } else if (d.type === 'room_invite') {
    const myName = (myPlayerName || (isAdmin() ? 'Juan' : '')).trim().toLowerCase();
    const isTarget = Array.isArray(d.targets) && d.targets.some(t => t.trim().toLowerCase() === myName || t === 'all');
    if ((isTarget || !d.targets || d.targets.length === 0) && (!S.game || S.game.roomCode !== d.roomCode)) {
      ringBellSound();
      vibrate([100, 50, 100, 50, 200]);
      modal(`
        <div style="text-align:center;padding:12px 6px">
          <div style="font-size:3rem;margin-bottom:6px">🃏</div>
          <h2 style="margin:0 0 4px">¡Invitación a jugar!</h2>
          <p class="muted" style="margin-bottom:12px"><b>${esc(d.hostName || 'Juan')}</b> ha abierto una mesa de Chinchón:</p>
          <div class="card" style="background:var(--paper2);margin-bottom:14px;padding:12px">
            <div style="font-size:1.15rem;font-weight:700;margin-bottom:4px">Mesa: <code>${esc(d.roomCode)}</code></div>
            <div class="muted" style="font-size:.85rem">Grupo: ${esc(d.groupName || 'Chinchón')}</div>
            ${d.gameType === 'cards' ? '<div style="color:#166534;font-size:.85rem;margin-top:4px;font-weight:700">🎴 Partida con tapete y cartas en pantalla</div>' : ''}
          </div>
          <div class="row">
            <button class="btn ghost block" onclick="closeModal()">Luego</button>
            <button class="btn block" onclick="closeModal();directJoinRoom('${esc(d.roomCode)}')">🚀 ¡Unirme ahora!</button>
          </div>
        </div>
      `);
    }
  } else if (d.type === 'challenge') {
    const myName = (myPlayerName || (isAdmin() ? 'Juan' : '')).trim().toLowerCase();
    const canonMyName = getCanonicalPlayerName(myName).toLowerCase();
    const isTarget = (d.target && (d.target.trim().toLowerCase() === myName || d.target.trim().toLowerCase() === canonMyName)) ||
                     (Array.isArray(d.targets) && d.targets.some(t => t.trim().toLowerCase() === myName || t.trim().toLowerCase() === canonMyName));
    if (myName && isTarget && (!S.game || S.game.roomCode !== d.roomCode)) {
      ringBellSound();
      vibrate([100, 50, 100, 50, 200]);
      modal(`
        <div style="text-align:center;padding:12px 6px">
          <div style="font-size:3rem;margin-bottom:6px">⚔️</div>
          <h2 style="margin:0 0 4px">¡Duelo de Chinchón!</h2>
          <p class="muted" style="margin-bottom:12px"><b>${esc(d.from)}</b> te reta a una partida cara a cara:</p>
          <div class="card" style="background:var(--paper2);margin-bottom:14px;padding:12px">
            <div style="font-size:1.15rem;font-weight:700">Mesa: <code>${esc(d.roomCode)}</code></div>
            ${d.gameType === 'cards' ? '<div style="color:#166534;font-size:.85rem;margin-top:4px;font-weight:700">🎴 Duelo con cartas en la app (Tapete)</div>' : '<div class="muted" style="font-size:.82rem;margin-top:4px">Mesa de cartas físicas</div>'}
          </div>
          <div class="row">
            <button class="btn ghost block" onclick="closeModal()">Rechazar</button>
            <button class="btn block" onclick="closeModal();directJoinRoom('${esc(d.roomCode)}')">⚔️ ¡Aceptar reto!</button>
          </div>
        </div>
      `);
    }
  } else if (d.type === 'presence_ping') {
    if (d.name) {
      if (!window._onlineFriends) window._onlineFriends = {};
      const rawLower = d.name.trim().toLowerCase();
      const canonLower = getCanonicalPlayerName(d.name).trim().toLowerCase();
      window._onlineFriends[rawLower] = Date.now();
      window._onlineFriends[canonLower] = Date.now();
      if (tab === 'groups') {
        const safeIdRaw = rawLower.replace(/[^a-z0-9]/g, '_');
        const safeIdCanon = canonLower.replace(/[^a-z0-9]/g, '_');
        const elRaw = document.getElementById('presence-' + safeIdRaw);
        if (elRaw) elRaw.innerHTML = '🟢 <span style="color:var(--ok);font-size:.76rem;font-weight:600">En línea</span>';
        const elCanon = document.getElementById('presence-' + safeIdCanon);
        if (elCanon) elCanon.innerHTML = '🟢 <span style="color:var(--ok);font-size:.76rem;font-weight:600">En línea</span>';
      }
    }
  } else if (d.type === 'spectator_joined') {
    if (d.name) {
      if (!window._activeSpectators) window._activeSpectators = [];
      const clean = d.name.trim();
      if (!window._activeSpectators.includes(clean)) window._activeSpectators.push(clean);
      ringBellSound();
      vibrate([60, 40, 80]);
      toast(`👁️ ¡${clean} está viendo la partida!`);
      if (S.game) render();
    }
  } else if (d.type === 'spectator_left') {
    if (d.name && window._activeSpectators) {
      window._activeSpectators = window._activeSpectators.filter(x => x !== d.name.trim());
      if (S.game) render();
    }
  } else if (d.type === 'table_alive') {
    if (d.roomCode) {
      if (!window._activeTables) window._activeTables = {};
      window._activeTables[d.roomCode] = { ...d, lastSeen: Date.now() };
      if (!S.game && (tab === 'play' || tab === 'groups')) {
        const sec = document.getElementById('live-tables-section') || document.getElementById('live-tables-section-groups');
        if (sec) sec.innerHTML = renderLiveTablesCard();
      }
    }
  } else if (d.type === 'table_closed') {
    if (d.roomCode && window._activeTables) {
      delete window._activeTables[d.roomCode];
      if (!S.game && (tab === 'play' || tab === 'groups')) {
        const sec = document.getElementById('live-tables-section') || document.getElementById('live-tables-section-groups');
        if (sec) sec.innerHTML = renderLiveTablesCard();
      }
    }
  } else if (d.type === 'direct_chat') {
    const myName = (myPlayerName || (isAdmin() ? 'Juan' : '')).trim().toLowerCase();
    const canonMyName = getCanonicalPlayerName(myName).toLowerCase();
    const isTarget = (d.target && (d.target.trim().toLowerCase() === myName || d.target.trim().toLowerCase() === canonMyName)) ||
                     (Array.isArray(d.targets) && d.targets.some(t => t.trim().toLowerCase() === myName || t.trim().toLowerCase() === canonMyName));
    if (isTarget) {
      saveChatMessage(d.from, { ...d, me: false });
      playChatSound();
      vibrate([100, 40, 100]);
      if (window._currentChatWith && getCanonicalPlayerName(window._currentChatWith).toLowerCase() === getCanonicalPlayerName(d.from).toLowerCase()) {
        openFriendChatModal(window._currentChatWith);
      } else {
        showIncomingChatBanner(d.from, d.text, false);
      }
    }
  } else if (d.type === 'room_chat') {
    if (currentRoomCode && d.roomCode === currentRoomCode) {
      if (!window._roomChatMessages) window._roomChatMessages = [];
      window._roomChatMessages.push(d);
      playChatSound();
      vibrate([80, 40, 80]);
      if (window._roomChatOpen) {
        openRoomChatModal();
      } else {
        showIncomingChatBanner(d.from, d.text, true);
      }
    }
  } else if (d.type === 'game_finished_report') {
    if (d.game && d.game.id) {
      if (!S.games) S.games = [];
      if (!S.games.some(x => x.id === d.game.id)) {
        d.game.isRemoteGuestGame = true;
        S.games.unshift(d.game);
        save();
        if (tab === 'history') render();
        if (isAdmin()) {
          toast(`📜 Partida de ${d.game.players.map(p => p.name).join(' y ')} recibida en tu historial`);
        }
      }
    }
  } else if (d.type === 'admin_req_history') {
    if (!isAdmin() && S.games && S.games.length) {
      sendGlobalMqtt({
        type: 'admin_report_history',
        games: S.games,
        deviceName: myPlayerName || 'Invitado'
      });
    }
  } else if (d.type === 'admin_report_history') {
    if (isAdmin() && Array.isArray(d.games)) {
      let added = 0;
      if (!S.games) S.games = [];
      d.games.forEach(g => {
        if (g && g.id && !S.games.some(x => x.id === g.id)) {
          g.isRemoteGuestGame = true;
          S.games.push(g);
          added++;
        }
      });
      if (added > 0) {
        S.games.sort((a, b) => (b.date || 0) - (a.date || 0));
        save();
        if (tab === 'history') render();
        toast(`📜 ${added} partida(s) de tus amigos sincronizadas`);
      }
    }
  }
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
    if (localStorage.getItem('chinchon_role') !== 'admin') {
      localStorage.setItem('chinchon_role', 'guest');
    }
    isHost = false;
    if (S.game && S.game.roomCode && S.game.roomCode !== r) {
      if (S.game.winner) {
        if (!S.games) S.games = [];
        if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
      }
      S.game = null;
      draft = {};
      remoteDrafts = {};
      remoteTyping = {};
      guestLastSent = null;
      window._identityChosen = false;
      save();
    }
    currentRoomCode = r;
    initMqtt(r, () => {
      sendMqtt({ type: 'reqSync' });
      promptJoinIdentity(r);
    });
  }
}

function promptJoinIdentity(roomCode) {
  syncMyPlayerIndex();
  const players = S.game ? S.game.players : [];
  modal(`<h2>🃏 ¿Quién eres en la mesa?</h2>
    <p class="muted">Elige tu nombre para apuntar tus puntos desde tu propio móvil:</p>
    ${players.length ? `<div style="margin-bottom:12px">${players.map((p, i) => `
      <button class="btn ${myPlayerIndex === i ? '' : 'ghost'} block" style="margin-bottom:6px;text-align:left;font-size:1rem;display:flex;justify-content:space-between;align-items:center" onclick="selectRole('${esc(p.name)}', ${i})">
        <span>👉 Soy <b>${esc(p.name)}</b></span>
        <span class="muted" style="font-size:.85rem">${p.score} pts</span>
      </button>`).join('')}</div>` : '<div class="muted" style="margin-bottom:10px">Conectando con la mesa de Juan…</div>'}
    <label>O introduce tu nombre si no estás en la lista:</label>
    <div class="row" style="margin-top:6px">
      <input id="join-name" placeholder="Tu nombre (ej: Miguel)" value="${esc(myPlayerName && myPlayerName !== 'Invitado' ? myPlayerName : '')}" onkeydown="if(event.key==='Enter')submitNewPlayer()">
      <button class="btn" onclick="submitNewPlayer()">Entrar</button>
    </div>`);
}

function selectRole(name, idx) {
  myPlayerName = name;
  myPlayerIndex = idx;
  window._identityChosen = true;
  localStorage.setItem('chinchon_player_name', name);
  localStorage.setItem('chinchon_role', 'guest');
  closeModal();
  sendMqtt({ type: 'hello', name });
  toast(`✓ Identificado como ${name}`);
  render();
}

function submitNewPlayer() {
  const name = ($('#join-name').value || '').trim();
  if (!name) return toast('Escribe tu nombre');
  myPlayerName = name;
  window._identityChosen = true;
  localStorage.setItem('chinchon_player_name', name);
  localStorage.setItem('chinchon_role', 'guest');
  closeModal();
  sendMqtt({ type: 'join', name });
  toast(`Entrando como ${name}…`);
  setTimeout(() => { syncMyPlayerIndex(); render(); }, 600);
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
    <div style="text-align:center;margin-bottom:6px"><img alt="QR" width="140" height="140" style="border:1px solid var(--line);border-radius:6px;background:#fff;padding:4px" src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=4&data=${encodeURIComponent(link)}"><div class="muted" style="font-size:.78rem">Que lo escaneen con la cámara</div></div>
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

let guestLastSent = null, _typingTimer = null;
let remoteSeen = {}, remoteTyping = {};
function sendGuestDraftNow() {
  if (myPlayerIndex === null || !S.game) return;
  const e = draft[myPlayerIndex] || {};
  guestLastSent = JSON.stringify(e);
  sendMqtt({ type: 'draft', playerIndex: myPlayerIndex, playerName: myPlayerName, entry: e });
}
// Mientras escribe solo se avisa de que "está escribiendo": los puntos NO entran hasta pulsar Apuntar
function guestTyping() {
  if (myPlayerIndex === null || !S.game) return;
  clearTimeout(_typingTimer);
  _typingTimer = setTimeout(() => sendMqtt({ type: 'typing', playerIndex: myPlayerIndex, playerName: myPlayerName }), 250);
}
function submitGuestPts(manual) {
  if (myPlayerIndex === null || !S.game) return;
  sendGuestDraftNow();
  toast(`✓ Puntos de ${myPlayerName} apuntados en la mesa`);
  vibrate(25);
  render();
}

function calculateTitles(G) {
  const titles = [];
  if (!G || !G.players || !G.rounds || G.rounds.length < 2) return titles;
  const pick = a => a[Math.floor(Math.random() * a.length)];

  // 1. Cierres perfectos / Francotirador
  let maxMinus = 0, sniper = null;
  G.players.forEach((p, i) => {
    let count = 0;
    G.rounds.forEach(r => {
      if (r.flags && r.flags[i] && (r.flags[i].m10 || r.flags[i].m25)) count++;
      else if (r.events && r.events[i] && (r.events[i].includes('−10') || r.events[i].includes('−25'))) count++;
    });
    if (count > maxMinus) { maxMinus = count; sniper = p.name; }
  });
  if (sniper && maxMinus > 0) {
    const sniperPhrases = [
      `👑 *El Francotirador:* ${sniper} (${maxMinus} ${maxMinus === 1 ? 'cierre perfecto' : 'cierres perfectos'}. Apunta a la cabeza y no perdona.)`,
      `🎯 *El Cirujano:* ${sniper} (${maxMinus} ${maxMinus === 1 ? 'cierre limpio' : 'cierres limpios'}. Precisión milimétrica para dejar a todos temblando.)`,
      `🥷 *El Asesino Silencioso:* ${sniper} (${maxMinus} cierres de −10/−25. No avisa, cierra y a cobrar.)`
    ];
    titles.push(pick(sniperPhrases));
  }

  // 2. Chinchón directo
  const chinchonero = G.players.find(p => p.chinchones > 0);
  if (chinchonero) {
    const chinPhrases = [
      `♠️ *El Dios de la Baraja:* ${chinchonero.name} (¡CHINCHÓN directo! Pónganse de pie y aplaudan.)`,
      `🪄 *El Mago Supremo:* ${chinchonero.name} (sacó el Chinchón de la chistera y reventó la partida.)`
    ];
    titles.push(pick(chinPhrases));
  }

  // 3. Reenganches / Inmortal
  const rejoining = G.players.filter(p => p.rejoins > 0);
  if (rejoining.length) {
    const best = [...rejoining].sort((a, b) => (a.out === b.out ? a.score - b.score : (a.out ? 1 : -1)))[0];
    if (best) {
      const immortalPhrases = [
        `🧟 *El Inmortal:* ${best.name} (${best.rejoins} ${best.rejoins === 1 ? 'reenganche' : 'reenganches'}. Gasta más vidas que un gato en un tejado.)`,
        `🦅 *El Ave Fénix:* ${best.name} (resucitó de entre los muertos para seguir dando guerra.)`,
        `💸 *El Mecenas del Bote:* ${best.name} (a base de reenganches casi paga la cena de todos.)`
      ];
      titles.push(pick(immortalPhrases));
    }
  }

  // 4. Barista / Primer eliminado o peor puesto
  const firstElimRound = G.rounds.findIndex(r => r.totals && r.totals.some((t, i) => G.players[i].out && r.before && r.before[i] && !r.before[i].out));
  let barista = null;
  if (firstElimRound >= 0) {
    const bIdx = G.rounds[firstElimRound].totals.findIndex((t, i) => G.players[i].out && G.rounds[firstElimRound].before && G.rounds[firstElimRound].before[i] && !G.rounds[firstElimRound].before[i].out);
    if (bIdx >= 0) barista = G.players[bIdx].name;
  }
  if (!barista) {
    const worst = [...G.players].sort((a, b) => b.score - a.score)[0];
    if (worst && worst.name !== G.winner) barista = worst.name;
  }
  if (barista) {
    const baristaPhrases = [
      `☕ *El Barista Oficial:* ${barista} (primer eliminado; ya puede ir poniendo la cafetera a calentar.)`,
      `🛵 *El Repartidor de Churros:* ${barista} (le ha durado la partida lo que un suspiro. Le toca invitar.)`,
      `🪑 *El Espectador VIP:* ${barista} (palco de honor para ver cómo juegan los mayores.)`
    ];
    titles.push(pick(baristaPhrases));
  }

  // 5. El Pupas / Peor mano individual
  let maxHand = 0, pupas = null;
  G.rounds.forEach(r => {
    if (r.totals) {
      r.totals.forEach((t, i) => {
        if (t && t > maxHand) { maxHand = t; pupas = G.players[i].name; }
      });
    }
  });
  if (pupas && maxHand >= 15 && pupas !== barista) {
    const pupasPhrases = [
      `💥 *El Pupas:* ${pupas} (se comió una mano de +${maxHand} pts con patatas. Ánimo, de todo se sale.)`,
      `🧲 *El Imán de Oros:* ${pupas} (robó todo lo que no ligaba y se tragó ${maxHand} de una sentada.)`,
      `📉 *La Ruina:* ${pupas} (+${maxHand} puntos en una sola mano. Ni queriendo sale tan mal.)`
    ];
    titles.push(pick(pupasPhrases));
  }

  // 6. El Funambulista / Al límite
  const limit = (G.settings && G.settings.limit) || 100;
  let wirePlayer = null, wireMinGap = 999;
  G.players.forEach(p => {
    if (!p.out && (limit - p.score) <= 10 && (limit - p.score) >= 0) {
      if ((limit - p.score) < wireMinGap) {
        wireMinGap = limit - p.score;
        wirePlayer = p.name;
      }
    }
  });
  if (wirePlayer && wirePlayer !== sniper && wirePlayer !== barista) {
    const wirePhrases = [
      `🎪 *El Funambulista:* ${wirePlayer} (aguantó a solo ${wireMinGap} pts del límite. Nervios de acero.)`,
      `🥶 *El Desfibrilador:* ${wirePlayer} (jugó con el corazón en la boca a ${wireMinGap} de la calle.)`
    ];
    titles.push(pick(wirePhrases));
  }

  // 7. La Tortuga Sabia
  if (G.players.length >= 3) {
    const alivePlayers = G.players.filter(p => !p.out);
    if (alivePlayers.length && alivePlayers[0].name !== sniper) {
      const p = alivePlayers[0];
      const tortugaPhrases = [
        `🐢 *La Tortuga Sabia:* ${p.name} (a paso lento pero seguro, sin hacer ruido hasta el podio.)`,
        `🕊️ *El Pacifista:* ${p.name} (jugó tranquilo mientras los demás se mataban entre ellos.)`
      ];
      titles.push(pick(tortugaPhrases));
    }
  }

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
  
  // Bote según la distribución configurada
  const cfg = S.adminConfig || {};
  const st = G.settings || {};
  let potLine = '';
  if (st.potPerEntry && st.potPerEntry > 0) {
    const entries = G.players.length + G.players.reduce((sum, p) => sum + (p.rejoins || 0), 0);
    const potTotal = (entries * st.potPerEntry).toFixed(2);
    const dist = cfg.potDistribution || 'all';

    if (dist === 'split_70_30' && ranked.length > 1) {
      const p1 = (potTotal * 0.70).toFixed(2);
      const p2 = (potTotal * 0.30).toFixed(2);
      potLine = `💰 *Bote de la partida (${potTotal} € · ${entries} entradas):*\n` +
                `  🥇 1º (${winner.name}): *${p1} €*\n` +
                `  🥈 2º (${ranked[1].name}): *${p2} €*\n\n`;
    } else if (dist === 'split_podium' && ranked.length > 2) {
      const p1 = (potTotal * 0.60).toFixed(2);
      const p2 = (potTotal * 0.30).toFixed(2);
      const p3 = (potTotal * 0.10).toFixed(2);
      potLine = `💰 *Bote de la partida (${potTotal} € · ${entries} entradas):*\n` +
                `  🥇 1º (${winner.name}): *${p1} €*\n` +
                `  🥈 2º (${ranked[1].name}): *${p2} €*\n\n` +
                `  🥉 3º (${ranked[2].name}): *${p3} €*\n\n`;
    } else {
      potLine = `💰 *Bote de la partida:* *${potTotal} €* para ${winner.name} (${entries} entradas a ${st.potPerEntry}€)\n\n`;
    }
  }

  // Motes de honor
  const titles = (cfg.includeTitles !== false) ? calculateTitles(G) : [];
  const titlesSection = titles.length ? `🎖️ *Menciones de honor:*\n${titles.join('\n')}\n\n` : '';
  const header = cfg.customPingHeader || '🔔 *¡Ping! Fin de partida de Chinchón* 🃏';
  const signature = cfg.customSignature ? `\n\n_${cfg.customSignature}_` : '\n\nPartida anotada con el Marcador de Chinchón.';

  return `${header}\n\n` +
    `🏆 *Ha ganado:* ${winner.name} (${winner.score} pts${G.how ? ' · ' + G.how : ''})\n` +
    `💀 *Ha perdido:* ${loser.name} (${loser.score} pts${loser.out ? ' · Eliminado' : ''})\n\n` +
    potLine +
    titlesSection +
    `📊 *Clasificación final:*\n` +
    ranked.map((p, i) => `${medals[i] || '•'} *${p.name}*: ${p.score} pts${p.out ? ' _(Eliminado)_' : ''}${p.rejoins ? ' (↻ ' + p.rejoins + ')' : ''}`).join('\n') +
    `\n\n⏱️ *Rondas jugadas:* ${G.rounds.length}` +
    signature;
}

function openSendReportModal(game) {
  const G = game || S.game || S.games[0];
  if (!G) return toast('No hay partida');
  const reportText = buildGamePingReport(G);
  const encoded = encodeURIComponent(reportText);

  modal(`<h2>📲 Enviar resultado de la partida</h2>
    <p class="muted">Elige cómo quieres compartir el resultado y a quién mandárselo:</p>
    
    <label style="margin:12px 0 6px">🔔 Enviar aviso directo a móviles (App Ping):</label>
    <div class="card" style="margin-bottom:14px;padding:10px 12px;background:var(--paper2)">
      <div style="font-size:.82rem;margin-bottom:8px" class="muted">Selecciona los móviles para hacer sonar la app con el acta oficial:</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        ${G.players.map((p, i) => `
          <label style="display:flex;align-items:center;gap:6px;font-size:.86rem;text-transform:none;margin:0;cursor:pointer">
            <input type="checkbox" class="ping-target" value="${esc(p.name)}" checked style="width:auto">
            <span><b>${esc(p.name)}</b> <span class="muted">(${p.score})</span></span>
          </label>`).join('')}
      </div>
      <button class="btn block sm" onclick="sendInAppPingToTargets('${G.id}')">📢 Enviar Ping y guardar en sus móviles</button>
    </div>

    <label>Compartir por WhatsApp:</label>
    <div style="margin-bottom:12px">
      <button class="btn btn-wa block" style="margin-bottom:8px;font-size:1rem" onclick="openWaShare('${encoded}')">
        👥 <b>Compartir con el grupo de WhatsApp</b>
      </button>
      <div class="muted" style="margin:8px 0 6px">O enviar mensaje privado a:</div>
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

function sendInAppPingToTargets(gameId) {
  const G = (S.games && S.games.find(x => x.id === gameId)) || S.game;
  if (!G) return toast('Partida no disponible');
  const targets = Array.from(document.querySelectorAll('.ping-target:checked')).map(el => el.value);
  if (!targets.length) return toast('Selecciona al menos un jugador');
  const report = buildGamePingReport(G);
  sendMqtt({
    type: 'game_ping',
    targets,
    game: G,
    report,
    sender: (S.adminConfig && S.adminConfig.adminName) || 'Juan'
  });
  toast(`🔔 Ping enviado a: ${targets.join(', ')}`);
}

function syncAllHistoryToMobiles() {
  if (!S.games || !S.games.length) return toast('No hay partidas en el historial');
  sendMqtt({ type: 'full_history_sync', games: S.games });
  toast('⚡ Historial completo enviado a los móviles');
}

function syncSingleGameToMobiles(id) {
  const g = S.games && S.games.find(x => x.id === id);
  if (!g) return toast('Partida no encontrada');
  sendMqtt({ type: 'history_sync', game: g });
  toast('⚡ Partida enviada a los móviles');
}

// ===== PANEL DE CONFIGURACIÓN DE JUAN (ADMINISTRADOR) =====
let adminCurrentTab = 'auth';

function openAdminSettings(tabName) {
  if (tabName) adminCurrentTab = tabName;
  const cfg = S.adminConfig;
  const G = S.game;
  
  // Si no es el Administrador (por ejemplo si un invitado toca el engranaje)
  if (!isAdmin()) {
    return modal(`<h2>⚙️ Ajustes</h2>
      <div class="card" style="text-align:center;padding:16px 12px;margin:8px 0 12px">
        <div style="font-size:2.4rem;margin-bottom:4px">👤</div>
        <h2 style="margin:0 0 4px;font-size:1.3rem;border:0">${esc(myPlayerName || 'Invitado')}</h2>
        <span class="muted" style="font-size:.85rem">Invitado Autorizado</span>
        <div style="margin-top:10px;padding:10px;background:var(--paper2);border-radius:6px;font-size:.84rem;line-height:1.4">
          👑 <b>Aplicación propiedad de Juan</b><br>
          Marcador privado administrado y supervisado por Juan.
        </div>
      </div>
      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row">
          <div><div class="cfg-title">Sonido de campana</div><div class="cfg-desc">Reproducir sonido al cerrar mano</div></div>
          <label class="switch"><input type="checkbox" ${cfg.soundEnabled !== false ? 'checked' : ''} onchange="cfg.soundEnabled=this.checked;save()"><span class="slider"></span></label>
        </div>
        <div class="cfg-row">
          <div><div class="cfg-title">Vibración</div><div class="cfg-desc">Vibrar con avisos y botones</div></div>
          <label class="switch"><input type="checkbox" ${cfg.vibrateEnabled !== false ? 'checked' : ''} onchange="cfg.vibrateEnabled=this.checked;save()"><span class="slider"></span></label>
        </div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line)">
          <button class="btn ghost sm block" style="font-size:.8rem" onclick="unlockMobileAudio();playChatSound();toast('🔊 Probando sonido de notificación')">🔊 Probar sonido de notificación</button>
        </div>
      </div>
      <button class="btn ghost block" style="margin-bottom:8px" onclick="promptAdminPin()">👑 ¿Eres Juan? Iniciar sesión como Administrador</button>
      <button class="btn block" onclick="closeModal()">Cerrar</button>`);
  }

  // Vista completa de Juan (Administrador)
  const tabs = [
    ['auth', '🛡️ Acceso'],
    ['room', '🎮 Mesa'],
    ['game', '🎲 Partida'],
    ['pot', '💰 Apuestas'],
    ['messages', '💬 WhatsApp'],
    ['system', '⚙️ General']
  ];

  let body = '';
  if (adminCurrentTab === 'auth') {
    const guests = cfg.authorizedGuests || [];
    body = `
      <label>Estado Maestro de la Aplicación</label>
      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row">
          <div>
            <div class="cfg-title">🔒 Cerrar app a todos los invitados</div>
            <div class="cfg-desc">Modo Solo Juan: ningún amigo podrá usar la aplicación</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.masterAppLock ? 'checked' : ''} onchange="toggleMasterLock(this.checked)"><span class="slider"></span></label>
        </div>
        <div class="cfg-row">
          <div>
            <div class="cfg-title">🛡️ Exigir pase de invitación</div>
            <div class="cfg-desc">Nadie puede usar la app sin un enlace generado por ti</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.requireInvite !== false ? 'checked' : ''} onchange="toggleRequireInvite(this.checked)"><span class="slider"></span></label>
        </div>
      </div>

      <label>Crear invitación a la aplicación</label>
      <div class="card" style="margin-bottom:12px">
        <div class="row" style="gap:6px;margin-bottom:8px">
          <input id="new-guest-name" placeholder="Nombre (ej: Miguel, Carlos...)" style="margin:0">
          <button class="btn sm" style="white-space:nowrap" onclick="createGuestInvite()">＋ Crear Pase</button>
        </div>
        <button class="btn ghost block sm" onclick="copyGeneralInviteLink()">🔗 Enlace general de invitación a la App</button>
      </div>

      <label>Amigos e Invitados (${guests.length})</label>
      ${guests.length === 0 ? `<div class="card empty" style="padding:16px"><p style="margin:0">No has añadido amigos todavía. Escribe un nombre arriba para crearle su pase de invitado.</p></div>` : `
        <div style="margin-bottom:12px">
          ${guests.map(g => `
            <div class="card" style="padding:10px 12px;margin-bottom:8px">
              <div class="row between" style="margin-bottom:6px">
                <div>
                  <b>${esc(g.name)}</b>
                  <span class="tag" style="margin-left:6px;font-weight:700;color:${g.status === 'blocked' ? 'var(--accent)' : 'var(--ok)'}">
                    ${g.status === 'blocked' ? '🔴 BLOQUEADO' : '🟢 ACTIVO'}
                  </span>
                  <div class="muted" style="font-size:.76rem">Pase: <code>${esc(g.pass)}</code></div>
                </div>
                <div class="row" style="gap:4px">
                  ${g.status === 'blocked'
                    ? `<button class="btn sm" onclick="setGuestStatus('${g.id}','allowed')">✅ Permitir</button>`
                    : `<button class="btn danger sm" onclick="setGuestStatus('${g.id}','blocked')">⛔ Bloquear</button>`}
                  <button class="btn ghost sm" onclick="shareGuestInvite('${g.id}')">📲 Enlace</button>
                  <button class="btn ghost sm" style="color:var(--accent)" onclick="deleteGuest('${g.id}')">✕</button>
                </div>
              </div>
            </div>`).join('')}
        </div>
      `}

      <label>Tu PIN Maestro de Administrador</label>
      <div class="card" style="margin-bottom:12px">
        <div class="row between" style="gap:8px">
          <div>
            <div class="cfg-title">PIN secreto de Juan</div>
            <div class="cfg-desc">Para identificarte como Administrador en cualquier móvil</div>
          </div>
          <input id="cfg-admin-pin" type="text" inputmode="numeric" value="${esc(cfg.adminPin || '1234')}" style="width:90px;text-align:center;font-weight:700;letter-spacing:2px" onchange="setAdminPin(this.value)">
        </div>
      </div>

      <label>Unificación de Jugadores y Apodos</label>
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div class="cfg-desc" style="margin-bottom:8px">
          Vincula apodos en grupos para que sus victorias y puntos se sumen a su amigo oficial (ej: <b>Anita ➔ Ana</b>).
        </div>
        ${Object.keys(cfg.playerAliases || {}).length === 0 ? '<div class="muted" style="font-size:.82rem">No hay apodos vinculados</div>' : `
          <div style="margin-bottom:8px">
            ${Object.entries(cfg.playerAliases || {}).map(([alias, canon]) => `
              <div class="row between" style="padding:5px 0;border-bottom:1px solid var(--line);font-size:.85rem">
                <span><b>${esc(alias)}</b> ➔ ${esc(canon)}</span>
                <button class="btn ghost sm" style="color:var(--accent);padding:2px 8px" onclick="removePlayerAlias('${esc(alias)}')">✕</button>
              </div>
            `).join('')}
          </div>
        `}
        <div class="row" style="gap:4px;margin-top:6px">
          <input id="new-alias-name" placeholder="Apodo (ej: Anita)" style="margin:0;font-size:.85rem">
          <input id="new-canon-name" placeholder="Amigo (ej: Ana)" style="margin:0;font-size:.85rem">
          <button class="btn sm" onclick="addPlayerAlias()">＋</button>
        </div>
      </div>

      <label>Jugadores Locales de Mesa (Sin App)</label>
      <div class="card" style="margin-bottom:12px;padding:12px">
        <div class="cfg-desc" style="margin-bottom:8px">
          Jugadores que juegan en tu mesa pero no tienen la app instalada (pueden jugar en grupos pero no saldrán en la pestaña Amigos):
        </div>
        ${(cfg.localOnlyPlayers || []).length === 0 ? '<div class="muted" style="font-size:.82rem">No hay jugadores locales excluidos</div>' : `
          <div style="margin-bottom:8px">
            ${(cfg.localOnlyPlayers || []).map(p => `
              <div class="row between" style="padding:5px 0;border-bottom:1px solid var(--line);font-size:.85rem">
                <span>👤 <b>${esc(p)}</b> <span class="tag muted">Solo local</span></span>
                <button class="btn ghost sm" style="color:var(--accent);padding:2px 8px" onclick="removeLocalPlayer('${esc(p)}')">✕</button>
              </div>
            `).join('')}
          </div>
        `}
        <div class="row" style="gap:4px;margin-top:6px">
          <input id="new-local-name" placeholder="Nombre (ej: Ana M)" style="margin:0;font-size:.85rem">
          <button class="btn sm" onclick="addLocalPlayer()">＋ Marcar</button>
        </div>
      </div>

      <button class="btn ghost block" style="margin-bottom:8px" onclick="broadcastAuthPolicy();toast('⚡ Permisos sincronizados en directo con todos los móviles')">⚡ Sincronizar permisos en directo ahora</button>
      <button class="btn ghost block" style="font-size:.82rem" onclick="testAsGuest()">👁️ Probar qué ve un invitado en mi móvil</button>
    `;
  } else if (adminCurrentTab === 'game') {
    if (!G) {
      body = `<div class="card empty" style="text-align:center;padding:24px"><p>No hay partida en juego.</p><span class="muted" style="font-size:.85rem">Aquí podrás cambiar límite, reenganches, puntos de cada jugador, repartidor… en plena partida.</span></div>`;
    } else {
      const st = G.settings;
      const stp = (label, key, val, step, fmt) => `<div class="cfg-row"><div class="cfg-title">${label}</div>
        <div class="row" style="gap:6px"><button class="btn ghost sm" onclick="adminSet('${key}',${-step})">−</button><b style="min-width:62px;text-align:center">${fmt ? fmt(val) : val}</b><button class="btn ghost sm" onclick="adminSet('${key}',${step})">+</button></div></div>`;
      body = `
        <label>Reglas de esta partida (cambian al instante)</label>
        <div class="card" style="padding:4px 12px;margin-bottom:12px">
          ${stp('Límite de puntos', 'limit', st.limit, 5)}
          ${stp('Reenganches por jugador', 'maxRejoins', st.maxRejoins, 1)}
          ${stp('Puntos de penalización', 'penalty', st.penalty, 5)}
          ${stp('Bote por entrada (€)', 'potPerEntry', st.potPerEntry || 0, 0.5, v => v > 0 ? v.toFixed(2) + ' €' : 'Sin bote')}
        </div>
        <div class="card" style="padding:4px 12px;margin-bottom:12px">
          <div class="cfg-row"><div><div class="cfg-title">Preguntar antes de reenganchar</div><div class="cfg-desc">Si lo apagas, se reengancha solo</div></div>
            <label class="switch"><input type="checkbox" ${cfg.askRejoin !== false ? 'checked' : ''} onchange="S.adminConfig.askRejoin=this.checked;save()"><span class="slider"></span></label></div>
          <div class="cfg-row"><div><div class="cfg-title">Frases de pique</div><div class="cfg-desc">Mensajes al eliminar, reenganchar o estar al borde</div></div>
            <label class="switch"><input type="checkbox" ${cfg.tauntsEnabled !== false ? 'checked' : ''} onchange="S.adminConfig.tauntsEnabled=this.checked;save()"><span class="slider"></span></label></div>
          ${(() => { const v = cfg.edgeThreshold ?? 10; return `<div class="cfg-row"><div class="cfg-title">Aviso "al borde" a menos de</div>
            <div class="row" style="gap:6px"><button class="btn ghost sm" onclick="adminEdge(-5)">−</button><b style="min-width:62px;text-align:center">${v} pts</b><button class="btn ghost sm" onclick="adminEdge(5)">+</button></div></div>`; })()}
        </div>
        <label>Repartidor</label>
        <select onchange="adminSetDealer(this.value)" style="margin-bottom:12px">
          ${G.players.map((p, i) => `<option value="${i}" ${i === (G.dealer ?? 0) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
        </select>
        <label>Jugadores (puntos, reenganches, estado)</label>
        ${G.players.map((p, i) => `
          <div class="card" style="padding:8px 12px;margin-bottom:8px">
            <input value="${esc(p.name)}" style="margin-bottom:6px" onchange="adminRename(${i},this.value)">
            <div class="row between" style="margin-bottom:6px"><span class="muted">Puntos: <b>${p.score}</b></span>
              <div class="row" style="gap:4px"><button class="btn ghost sm" onclick="adminScore(${i},-10)">−10</button><button class="btn ghost sm" onclick="adminScore(${i},-1)">−1</button><button class="btn ghost sm" onclick="adminScore(${i},1)">+1</button><button class="btn ghost sm" onclick="adminScore(${i},10)">+10</button></div></div>
            <div class="row between"><span class="muted">Reenganches: <b>${p.rejoins}</b></span>
              <div class="row" style="gap:4px"><button class="btn ghost sm" onclick="adminRejoin(${i},-1)">−</button><button class="btn ghost sm" onclick="adminRejoin(${i},1)">+</button>
              <button class="btn ${p.out ? '' : 'danger'} sm" onclick="adminToggleOut(${i})">${p.out ? 'Reactivar' : 'Eliminar'}</button></div></div>
          </div>`).join('')}
        <div class="row" style="margin-bottom:12px"><input id="adm-new-player" placeholder="Añadir jugador a la partida"><button class="btn sm" onclick="adminAddPlayer()">＋</button></div>
        <button class="btn ghost block" style="margin-bottom:8px" onclick="adminClearDraft()">🧹 Vaciar puntos escritos de la ronda</button>
        <button class="btn danger block" onclick="adminFinishNow()">🏁 Terminar la partida ahora</button>
      `;
    }
  } else if (adminCurrentTab === 'room') {
    if (G && G.players && G.players.length) {
      body = `
        <p class="muted" style="margin-bottom:12px">Control en vivo de los jugadores de la mesa actual (${esc(G.groupName)} · ${G.roomCode || 'Local'}):</p>
        <div class="card" style="margin-bottom:12px;padding:8px 12px">
          ${G.players.map((p, i) => `
            <div class="cfg-row">
              <div>
                <b>${esc(p.name)}</b> <span class="muted">(${p.score} pts${p.out ? ' · Out' : ''})</span>
                <div class="cfg-desc">${remoteDrafts[i] ? '🟢 Conectado con puntos' : '⚪ En espera'}</div>
              </div>
              <div class="row" style="gap:4px">
                <button class="btn ghost sm" title="Recarga forzada si se le cuelga la app" onclick="remoteReloadPlayer('${esc(p.name)}')">🔄 Recargar</button>
                <button class="btn danger sm" title="Expulsar jugador" onclick="remoteKickPlayer('${esc(p.name)}')">✕</button>
              </div>
            </div>`).join('')}
        </div>
        <button class="btn ghost block" style="margin-bottom:8px" onclick="broadcastAlertNow()">📢 Lanzar mensaje emergente a todos los móviles</button>
        <button class="btn ghost block" style="margin-bottom:8px" onclick="remoteReloadPlayer('all')">🔄 Recargar app a TODOS los jugadores</button>
        <button class="btn ghost block" style="margin-bottom:8px" onclick="remoteResyncRoom()">⚡ Resincronizar estado completo a todos</button>
        <button class="btn danger block" onclick="remoteCloseTableForAll()">🧹 Cerrar mesa y devolver a todos los móviles al inicio</button>
      `;
    } else {
      body = `
        <div class="card empty" style="text-align:center;padding:24px">
          <p>No hay ninguna partida activa en este momento.</p>
          <span class="muted" style="font-size:.85rem">Cuando inicies una partida con móviles, desde aquí podrás recargarle la pantalla a quien se le quede colgada, resincronizarlos o expulsarlos.</span>
          <button class="btn ghost block" style="margin-top:14px;color:var(--accent);border-color:var(--accent)" onclick="remoteForceResetAllGuests()">🧹 Ordenar a todos los móviles salir al inicio</button>
        </div>
      `;
    }
  } else if (adminCurrentTab === 'pot') {
    body = `
      <div class="card">
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Bote / Apuestas con dinero</div>
            <div class="cfg-desc">Habilitar cálculo de porra o apuestas en las partidas</div>
          </div>
          <label class="switch"><input type="checkbox" id="cfg-pot-enabled" ${cfg.potEnabled ? 'checked' : ''} onchange="toggleAdminPot(this.checked)"><span class="slider"></span></label>
        </div>
      </div>
      <div id="pot-suboptions" style="${cfg.potEnabled ? '' : 'opacity:.4;pointer-events:none'}">
        <label>Importe por entrada y reenganche (€)</label>
        <div class="row" style="margin-bottom:12px">
          ${[0.20, 0.50, 1.00, 2.00, 5.00].map(v => `
            <button class="btn ${cfg.potMinBet === v ? '' : 'ghost'} sm" style="flex:1" onclick="setAdminPotMin(${v})">${v.toFixed(2)}€</button>`).join('')}
        </div>
        <label>Modo de reparto del bote al finalizar</label>
        <select id="cfg-pot-dist" onchange="setAdminPotDist(this.value)" style="margin-bottom:12px">
          <option value="all" ${cfg.potDistribution === 'all' ? 'selected' : ''}>🥇 100% al ganador (Todo o nada)</option>
          <option value="split_70_30" ${cfg.potDistribution === 'split_70_30' ? 'selected' : ''}>🥈 1º y 2º (70% al ganador · 30% al segundo)</option>
          <option value="split_podium" ${cfg.potDistribution === 'split_podium' ? 'selected' : ''}>🥉 Podio (60% al 1º · 30% al 2º · 10% al 3º)</option>
        </select>
      </div>
    `;
  } else if (adminCurrentTab === 'messages') {
    body = `
      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Mensaje emergente al abrir la app</div>
            <div class="cfg-desc">Muestra un cartel emergente al iniciar la aplicación</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.openMessageEnabled ? 'checked' : ''} onchange="toggleOpenMessage(this.checked)"><span class="slider"></span></label>
        </div>
      </div>

      <label>Texto del mensaje emergente / aviso</label>
      <input id="cfg-open-msg" value="${esc(cfg.openMessageText || 'SOIS UNOS CABRONES')}" style="margin-bottom:8px" onchange="setOpenMessageText(this.value)">
      <div class="row" style="gap:6px;margin-bottom:14px">
        <button class="btn ghost sm" style="flex:1" onclick="showOpenMessage(document.getElementById('cfg-open-msg').value)">👁️ Probar en mi móvil</button>
        <button class="btn sm" style="flex:1" onclick="broadcastAlertNow()">📢 Lanzar a la mesa</button>
      </div>

      <label>Cabecera del mensaje de WhatsApp (Ping)</label>
      <input id="cfg-ping-header" value="${esc(cfg.customPingHeader)}" style="margin-bottom:12px" onchange="cfg.customPingHeader=this.value.trim()||DEFAULT_ADMIN_CONFIG.customPingHeader;save()">
      
      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Menciones de honor en el acta</div>
            <div class="cfg-desc">Incluir El Francotirador, El Barista, El Inmortal...</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.includeTitles !== false ? 'checked' : ''} onchange="cfg.includeTitles=this.checked;save()"><span class="slider"></span></label>
        </div>
      </div>

      <label>Firma o despedida al final del mensaje</label>
      <input id="cfg-signature" value="${esc(cfg.customSignature)}" onchange="cfg.customSignature=this.value.trim()||DEFAULT_ADMIN_CONFIG.customSignature;save()">
    `;
  } else if (adminCurrentTab === 'system') {
    body = `
      <label>Tu nombre como Administrador</label>
      <input id="cfg-admin-name" value="${esc(cfg.adminName || 'Juan')}" style="margin-bottom:12px" onchange="setAdminName(this.value)">

      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Pantalla siempre encendida (Wake Lock)</div>
            <div class="cfg-desc">Evita que el móvil se apague o bloquee mientras juegas</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.wakeLock !== false ? 'checked' : ''} onchange="cfg.wakeLock=this.checked;save();if(cfg.wakeLock)requestWakeLock()"><span class="slider"></span></label>
        </div>
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Campana de cierre con sonido</div>
            <div class="cfg-desc">Tono de campana cristalina al pulsar ¡He cerrado!</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.soundEnabled !== false ? 'checked' : ''} onchange="cfg.soundEnabled=this.checked;save()"><span class="slider"></span></label>
        </div>
        <div class="cfg-row">
          <div>
            <div class="cfg-title">Vibración háptica</div>
            <div class="cfg-desc">Respuesta táctil al pulsar botones y avisos</div>
          </div>
          <label class="switch"><input type="checkbox" ${cfg.vibrateEnabled !== false ? 'checked' : ''} onchange="cfg.vibrateEnabled=this.checked;save()"><span class="slider"></span></label>
        </div>
        <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--line);display:flex;gap:6px">
          <button class="btn ghost sm block" style="flex:1;font-size:.8rem" onclick="unlockMobileAudio();playChatSound();toast('🔊 Probando sonido de mensaje/chat')">🔊 Probar mensaje</button>
          <button class="btn ghost sm block" style="flex:1;font-size:.8rem" onclick="unlockMobileAudio();ringBellSound();toast('🔔 Probando campana')">🔔 Probar campana</button>
        </div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <div class="cfg-row"><div><div class="cfg-title">Modo oscuro</div><div class="cfg-desc">Para jugar de noche sin deslumbrar</div></div>
          <label class="switch"><input type="checkbox" ${cfg.dark ? 'checked' : ''} onchange="cfg.dark=this.checked;save();applyTheme()"><span class="slider"></span></label></div>
      </div>
      <label>Copia de seguridad (grupos, historial, normas, ajustes)</label>
      <div class="row" style="margin-bottom:8px"><button class="btn ghost block" onclick="backupCopy()">📋 Copiar copia</button>
        <button class="btn ghost block" onclick="backupRestoreForm()">♻️ Restaurar</button></div>
      <button class="btn ghost block" onclick="hardReload()">🔄 Forzar recarga limpia de mi app</button>
    `;
  }

  modal(`
    <div class="row between" style="margin-bottom:8px">
      <h2 style="margin:0">⚙️ Panel de Juan</h2>
      <span class="admin-badge">👑 Administrador</span>
    </div>
    <div class="cfg-tabs">
      ${tabs.map(([id, label]) => `<button class="cfg-tab ${adminCurrentTab === id ? 'active' : ''}" onclick="openAdminSettings('${id}')">${label}</button>`).join('')}
    </div>
    ${body}
    <div class="row" style="margin-top:16px">
      <button class="btn block" onclick="closeModal();render()">Guardar y cerrar</button>
    </div>
  `);
}

// ----- Ajustes en vivo de la partida (solo administrador) -----
function adminCommit(reopen) {
  save();
  sendMqtt({ type: 'sync', game: S.game, draft });
  render();
  openAdminSettings(reopen || 'game');
}
function adminSet(key, d) {
  const G = S.game; if (!G) return;
  G.settings[key] = Math.max(key === 'limit' ? 5 : 0, Math.round(((G.settings[key] || 0) + d) * 100) / 100);
  adminCommit();
}
function adminEdge(d) { S.adminConfig.edgeThreshold = Math.max(0, (S.adminConfig.edgeThreshold ?? 10) + d); save(); openAdminSettings('game'); }
function adminSetDealer(i) { S.game.dealer = parseInt(i) || 0; adminCommit(); }
function adminRename(i, v) {
  const name = (v || '').trim(); if (!name) return openAdminSettings('game');
  S.game.players[i].name = name; adminCommit();
}
function adminScore(i, d) { const p = S.game.players[i]; p.score = Math.max(0, p.score + d); adminCommit(); }
function adminRejoin(i, d) { const p = S.game.players[i]; p.rejoins = Math.max(0, p.rejoins + d); adminCommit(); }
function adminToggleOut(i) { const p = S.game.players[i]; p.out = !p.out; adminCommit(); }
function adminAddPlayer() {
  const name = ($('#adm-new-player').value || '').trim(); if (!name) return toast('Escribe un nombre');
  if (S.game.players.length >= 8) return toast('Máximo 8 jugadores');
  S.game.players.push({ name, score: 0, rejoins: 0, out: false, chinchones: 0 });
  adminCommit();
}
function adminClearDraft() { draft = {}; remoteDrafts = {}; adminCommit(); toast('Puntos de la ronda vaciados'); }
function adminFinishNow() {
  const G = S.game; if (!G) return;
  const alive = G.players.filter(p => !p.out);
  const pool = alive.length ? alive : G.players;
  const best = pool.reduce((a, b) => (b.score < a.score ? b : a));
  closeModal();
  finishGame(G.players.indexOf(best), 'terminada por el administrador');
}

function applyTheme() { document.body.classList.toggle('dark', !!(S.adminConfig && S.adminConfig.dark)); }
function backupCopy() {
  const data = JSON.stringify({ groups: S.groups, games: S.games, rulesList: S.rulesList, settings: S.settings, adminConfig: S.adminConfig });
  (navigator.clipboard ? navigator.clipboard.writeText(data) : Promise.reject()).then(() => toast('Copia guardada en el portapapeles'), () => toast('No se pudo copiar'));
}
function backupRestoreForm() {
  modal(`<h2>♻️ Restaurar copia</h2><p class="muted">Pega aquí la copia. Sustituirá tus grupos, historial y normas.</p>
    <textarea id="bk-text" style="min-height:120px" placeholder="Pega la copia de seguridad"></textarea>
    <div class="row" style="margin-top:12px"><button class="btn ghost block" onclick="closeModal()">Cancelar</button><button class="btn block" onclick="backupRestore()">Restaurar</button></div>`);
}
function backupRestore() {
  try {
    const d = JSON.parse($('#bk-text').value);
    if (!Array.isArray(d.groups) || !Array.isArray(d.games)) throw 0;
    S.groups = d.groups; S.games = d.games; if (d.rulesList) S.rulesList = d.rulesList;
    if (d.settings) S.settings = d.settings; if (d.adminConfig) S.adminConfig = Object.assign({}, DEFAULT_ADMIN_CONFIG, d.adminConfig);
    save(); closeModal(); applyTheme(); render(); toast('Copia restaurada');
  } catch (e) { toast('La copia no es válida'); }
}
function setAdminName(val) {
  S.adminConfig.adminName = val.trim() || 'Juan';
  save();
  toast('Nombre actualizado a ' + S.adminConfig.adminName);
}

function toggleAdminPot(val) {
  S.adminConfig.potEnabled = val;
  if (!val) S.settings.potPerEntry = 0;
  else if (!S.settings.potPerEntry) S.settings.potPerEntry = S.adminConfig.potMinBet || 0.50;
  save();
  openAdminSettings('pot');
}

function setAdminPotMin(val) {
  S.adminConfig.potMinBet = val;
  if (S.adminConfig.potEnabled) S.settings.potPerEntry = val;
  save();
  openAdminSettings('pot');
}

function setAdminPotDist(val) {
  S.adminConfig.potDistribution = val;
  save();
}

function remoteReloadPlayer(targetName) {
  sendMqtt({ type: 'forceReload', target: targetName });
  toast(targetName === 'all' ? '🔄 Orden de recarga enviada a todos' : `🔄 Orden de recarga enviada a ${targetName}`);
}

function remoteResyncRoom() {
  if (!S.game) return;
  sendMqtt({ type: 'sync', game: S.game, draft });
  toast('⚡ Estado de la mesa resincronizado con todos');
}

function remoteCloseTableForAll() {
  modal(`<h2>¿Cerrar mesa y limpiar móviles?</h2>
    <p class="muted">Se enviará una orden a todos los teléfonos conectados para que salgan inmediatamente de la partida y regresen a la pantalla de inicio.</p>
    <div class="row">
      <button class="btn ghost block" onclick="closeModal()">Cancelar</button>
      <button class="btn danger block" onclick="confirmCloseTableForAll()">Sí, cerrar mesa</button>
    </div>`);
}

function confirmCloseTableForAll() {
  sendMqtt({ type: 'game_abandoned' });
  if (S.game && S.game.winner) {
    if (!S.games) S.games = [];
    if (!S.games.find(g => g.id === S.game.id)) S.games.unshift(S.game);
  }
  S.game = null;
  draft = {};
  remoteDrafts = {};
  remoteTyping = {};
  currentRoomCode = null;
  save();
  closeModal();
  render();
  toast('🧹 Mesa cerrada y orden enviada a los móviles');
}

function remoteForceResetAllGuests() {
  sendMqtt({ type: 'game_abandoned' });
  toast('🧹 Orden enviada: todos los móviles volverán al inicio');
}

function toggleOpenMessage(val) {
  S.adminConfig.openMessageEnabled = !!val;
  save();
  openAdminSettings('messages');
}
function setOpenMessageText(val) {
  S.adminConfig.openMessageText = (val || '').trim() || 'SOIS UNOS CABRONES';
  save();
}
function broadcastAlertNow() {
  const text = (S && S.adminConfig && S.adminConfig.openMessageText) || 'SOIS UNOS CABRONES';
  if (currentRoomCode) {
    sendMqtt({ type: 'alert', text, from: CLIENT_ID });
    toast(`📢 Aviso enviado a la mesa: "${text}"`);
  } else {
    toast(`📢 Aviso probado: "${text}"`);
  }
  showOpenMessage(text);
}

function remoteKickPlayer(targetName) {
  if (!S.game) return;
  sendMqtt({ type: 'kick', target: targetName });
  const idx = S.game.players.findIndex(p => p.name.trim().toLowerCase() === targetName.trim().toLowerCase());
  if (idx >= 0) {
    S.game.players.splice(idx, 1);
    delete draft[idx];
    save();
    render();
    sendMqtt({ type: 'sync', game: S.game, draft });
    toast(`Jugador ${targetName} expulsado de la mesa`);
    openAdminSettings('room');
  }
}

function toggleMasterLock(val) {
  S.adminConfig.masterAppLock = !!val;
  save();
  broadcastAuthPolicy();
  toast(val ? '🔒 Aplicación cerrada a todos los invitados' : '🔓 Aplicación abierta a invitados autorizados');
  openAdminSettings('auth');
}

function toggleRequireInvite(val) {
  S.adminConfig.requireInvite = !!val;
  save();
  broadcastAuthPolicy();
  openAdminSettings('auth');
}

function setAdminPin(val) {
  const p = (val || '').trim() || '1234';
  S.adminConfig.adminPin = p;
  save();
  toast('PIN de Administrador actualizado: ' + p);
}

function copyGeneralInviteLink() {
  const url = `${location.origin}${location.pathname}?invite=juan`;
  const wa = `🃏 ¡Hola! Te invito a tener el Marcador de Chinchón de Juan en tu móvil. Entra aquí para activar tu cuenta:\n${url}`;
  modal(`<h2>🔗 Enlace de Invitación a la App</h2>
    <p class="muted">Tus amigos abrirán este enlace, pondrán su nombre y activarán su cuenta de invitado en tu aplicación:</p>
    <input readonly value="${esc(url)}" style="margin-bottom:12px;font-size:.84rem" onclick="this.select()">
    <div class="row" style="margin-bottom:8px">
      <button class="btn block" onclick="copyInviteText('${esc(url)}')">📋 Copiar enlace</button>
      <a class="btn block" style="text-align:center;text-decoration:none;background:#25D366;color:#fff;border-color:#25D366" href="https://api.whatsapp.com/send?text=${encodeURIComponent(wa)}" target="_blank">💬 WhatsApp</a>
    </div>
    <button class="btn ghost block" onclick="openAdminSettings('auth')">Volver</button>`);
}

function createGuestInvite() {
  const input = $('#new-guest-name');
  const name = (input.value || '').trim();
  if (!name) return toast('Escribe el nombre de tu amigo');
  if (!S.adminConfig.authorizedGuests) S.adminConfig.authorizedGuests = [];
  
  let g = S.adminConfig.authorizedGuests.find(x => x.name.trim().toLowerCase() === name.toLowerCase());
  if (!g) {
    const pass = 'p' + Math.random().toString(36).substring(2, 7);
    g = { id: 'g_' + uid(), name, pass, status: 'allowed', addedAt: Date.now() };
    S.adminConfig.authorizedGuests.unshift(g);
    save();
  }
  input.value = '';
  broadcastAuthPolicy();
  openAdminSettings('auth');
  shareGuestInvite(g.id);
}

function shareGuestInvite(guestId) {
  const g = (S.adminConfig.authorizedGuests || []).find(x => x.id === guestId);
  if (!g) return;
  const url = `${location.origin}${location.pathname}?guest=${encodeURIComponent(g.name)}&pass=${encodeURIComponent(g.pass)}`;
  const waMsg = `🃏 ¡Hola ${g.name}! Aquí tienes tu acceso exclusivo como invitado al Marcador de Chinchón de Juan:\n${url}`;
  modal(`<h2>📲 Enlace de ${esc(g.name)}</h2>
    <p class="muted">Tu amigo abrirá este enlace, confirmará su nombre y activará su cuenta en tu aplicación:</p>
    <input readonly value="${esc(url)}" style="margin-bottom:12px;font-size:.82rem" onclick="this.select()">
    <div class="row" style="margin-bottom:8px">
      <button class="btn block" onclick="copyInviteText('${esc(url)}')">📋 Copiar enlace</button>
      <a class="btn block" style="text-align:center;text-decoration:none;background:#25D366;color:#fff;border-color:#25D366" href="https://api.whatsapp.com/send?text=${encodeURIComponent(waMsg)}" target="_blank">💬 WhatsApp</a>
    </div>
    <button class="btn ghost block" onclick="openAdminSettings('auth')">Volver</button>`);
}

function copyInviteText(text) {
  (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
    .then(() => toast('Enlace copiado al portapapeles'), () => toast('No se pudo copiar'));
}

function setGuestStatus(guestId, status) {
  const g = (S.adminConfig.authorizedGuests || []).find(x => x.id === guestId);
  if (!g) return;
  g.status = status;
  save();
  broadcastAuthPolicy();
  toast(status === 'blocked' ? `⛔ ${g.name} ha sido BLOQUEADO` : `✅ ${g.name} ha sido PERMITIDO`);
  openAdminSettings('auth');
}

function deleteGuest(guestId) {
  const idx = (S.adminConfig.authorizedGuests || []).findIndex(x => x.id === guestId);
  if (idx === -1) return;
  const name = S.adminConfig.authorizedGuests[idx].name;
  S.adminConfig.authorizedGuests.splice(idx, 1);
  save();
  broadcastAuthPolicy();
  toast(`Invitado ${name} eliminado`);
  openAdminSettings('auth');
}

function addPlayerAlias() {
  const alias = ($('#new-alias-name').value || '').trim();
  const canon = ($('#new-canon-name').value || '').trim();
  if (!alias || !canon) return toast('Rellena ambos nombres');
  if (!S.adminConfig.playerAliases) S.adminConfig.playerAliases = {};
  S.adminConfig.playerAliases[alias.toLowerCase()] = canon;
  save();
  render();
  openAdminSettings('auth');
  toast(`✓ Apodo ${alias} vinculado a ${canon}`);
}

function removePlayerAlias(alias) {
  if (S.adminConfig.playerAliases) {
    delete S.adminConfig.playerAliases[alias.toLowerCase()];
    save();
    render();
    openAdminSettings('auth');
    toast(`Apodo ${alias} desvinculado`);
  }
}

function addLocalPlayer() {
  const name = ($('#new-local-name').value || '').trim();
  if (!name) return toast('Escribe un nombre');
  if (!Array.isArray(S.adminConfig.localOnlyPlayers)) S.adminConfig.localOnlyPlayers = [];
  if (!S.adminConfig.localOnlyPlayers.some(p => p.toLowerCase() === name.toLowerCase())) {
    S.adminConfig.localOnlyPlayers.push(name);
    save();
    render();
    openAdminSettings('auth');
    toast(`✓ ${name} marcado como jugador local (sin app)`);
  }
}

function removeLocalPlayer(name) {
  if (Array.isArray(S.adminConfig.localOnlyPlayers)) {
    S.adminConfig.localOnlyPlayers = S.adminConfig.localOnlyPlayers.filter(p => p.toLowerCase() !== name.toLowerCase());
    save();
    render();
    openAdminSettings('auth');
    toast(`${name} desmarcado de jugadores locales`);
  }
}

function testAsGuest() {
  localStorage.setItem('chinchon_role', 'guest');
  localStorage.setItem('chinchon_player_name', 'Invitado');
  localStorage.setItem('chinchon_guest_pass', 'test_pass_juan');
  myPlayerName = 'Invitado';
  closeModal();
  const lockEl = $('#lockscreen');
  if (lockEl) lockEl.classList.add('hidden');
  toast('👤 Viendo la app como Invitado');
  render();
}

// ---------- AMIGOS Y GRUPOS ----------
function broadcastPresence() {
  const name = myPlayerName || (isAdmin() ? 'Juan' : null);
  if (!name) return;
  sendGlobalMqtt({
    type: 'presence_ping',
    name: name,
    time: Date.now()
  });
}

function getCanonicalPlayerName(rawName) {
  if (!rawName) return '';
  const trimmed = rawName.trim();
  const lower = trimmed.toLowerCase();
  const aliases = (S && S.adminConfig && S.adminConfig.playerAliases) || { 'anita': 'Ana' };
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (alias.toLowerCase() === lower) {
      return canonical;
    }
  }
  return trimmed;
}

function isLocalOnlyPlayer(rawName) {
  if (!rawName) return false;
  const lower = rawName.trim().toLowerCase();
  const locals = (S && S.adminConfig && S.adminConfig.localOnlyPlayers) || ['Ana M'];
  return locals.some(l => l.trim().toLowerCase() === lower);
}

function getAllKnownFriends() {
  const map = new Map();
  const adminName = (S.adminConfig && S.adminConfig.adminName) || 'Juan';
  map.set(adminName.toLowerCase(), { name: adminName, isAdmin: true, aliases: [] });

  // 1. Amigos con pase/invitación autorizados en la app
  if (S.adminConfig && Array.isArray(S.adminConfig.authorizedGuests)) {
    S.adminConfig.authorizedGuests.forEach(g => {
      if (g && g.name) {
        const canonical = getCanonicalPlayerName(g.name);
        if (isLocalOnlyPlayer(canonical)) return;
        const key = canonical.toLowerCase();
        if (!map.has(key)) {
          map.set(key, { name: canonical, guestId: g.id, pass: g.pass, status: g.status, aliases: [] });
        }
      }
    });
  }

  // 2. Jugadores de grupos y partidas (unificados por nombre canónico)
  const candidateNames = [];
  if (Array.isArray(S.groups)) {
    S.groups.forEach(g => {
      if (Array.isArray(g.players)) candidateNames.push(...g.players);
    });
  }
  if (Array.isArray(S.games)) {
    S.games.forEach(g => {
      if (Array.isArray(g.players)) candidateNames.push(...g.players.map(p => p.name));
    });
  }

  candidateNames.forEach(raw => {
    if (!raw) return;
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (isLocalOnlyPlayer(trimmed)) return; // Excluye jugadoras locales sin app como Ana M

    const canonical = getCanonicalPlayerName(trimmed);
    if (isLocalOnlyPlayer(canonical)) return;

    const key = canonical.toLowerCase();
    if (!map.has(key)) {
      map.set(key, { name: canonical, aliases: [] });
    }
    const entry = map.get(key);
    if (trimmed.toLowerCase() !== canonical.toLowerCase() && !entry.aliases.includes(trimmed)) {
      entry.aliases.push(trimmed);
    }
  });

  // Asociar los alias definidos en la configuración
  const aliasesCfg = (S && S.adminConfig && S.adminConfig.playerAliases) || {};
  for (const [alias, canonical] of Object.entries(aliasesCfg)) {
    const key = canonical.toLowerCase();
    if (map.has(key)) {
      const entry = map.get(key);
      const properAlias = alias.charAt(0).toUpperCase() + alias.slice(1);
      if (!entry.aliases.includes(properAlias)) entry.aliases.push(properAlias);
    }
  }

  return Array.from(map.values());
}

function getFriendStats(friendName) {
  const canonicalTarget = getCanonicalPlayerName(friendName).trim().toLowerCase();
  const myName = getCanonicalPlayerName(myPlayerName || (isAdmin() ? 'Juan' : '')).trim().toLowerCase();
  let played = 0;
  let won = 0;
  let chinchones = 0;
  let totalPts = 0;
  let headToHeadPlayed = 0;
  let myHeadWins = 0;
  let friendHeadWins = 0;

  if (Array.isArray(S.games)) {
    S.games.forEach(g => {
      if (!Array.isArray(g.players)) return;
      const fPlayer = g.players.find(p => getCanonicalPlayerName(p.name).trim().toLowerCase() === canonicalTarget);
      if (fPlayer) {
        played++;
        totalPts += (fPlayer.score || 0);
        chinchones += (fPlayer.chinchones || 0);
        if (g.winner && getCanonicalPlayerName(g.winner).trim().toLowerCase() === canonicalTarget) {
          won++;
        }
        if (myName && myName !== canonicalTarget) {
          const myPlayer = g.players.find(p => getCanonicalPlayerName(p.name).trim().toLowerCase() === myName);
          if (myPlayer) {
            headToHeadPlayed++;
            if (g.winner && getCanonicalPlayerName(g.winner).trim().toLowerCase() === myName) myHeadWins++;
            if (g.winner && getCanonicalPlayerName(g.winner).trim().toLowerCase() === canonicalTarget) friendHeadWins++;
          }
        }
      }
    });
  }

  const winRate = played > 0 ? Math.round((won / played) * 100) : 0;
  const avgPts = played > 0 ? (totalPts / played).toFixed(1) : '–';

  return {
    played,
    won,
    winRate,
    chinchones,
    avgPts,
    headToHeadPlayed,
    myHeadWins,
    friendHeadWins
  };
}

function showFriendStatsModal(name) {
  const st = getFriendStats(name);
  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Tú');
  const isMe = name.trim().toLowerCase() === myName.trim().toLowerCase();

  modal(`
    <div style="text-align:center;padding:12px 6px">
      <div style="font-size:2.8rem;margin-bottom:4px">👤</div>
      <h2 style="margin:0 0 2px;font-size:1.4rem;border:0">${esc(name)}</h2>
      <div class="muted" style="font-size:.84rem;margin-bottom:14px">Estadísticas en la App de Chinchón</div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px;text-align:center">
        <div class="card" style="margin:0;padding:10px">
          <div style="font-size:1.4rem;font-weight:700;color:var(--accent)">${st.won}</div>
          <div class="muted" style="font-size:.76rem">Victorias (${st.winRate}%)</div>
        </div>
        <div class="card" style="margin:0;padding:10px">
          <div style="font-size:1.4rem;font-weight:700;color:var(--ok)">${st.chinchones}</div>
          <div class="muted" style="font-size:.76rem">Chinchones</div>
        </div>
        <div class="card" style="margin:0;padding:10px">
          <div style="font-size:1.4rem;font-weight:700">${st.played}</div>
          <div class="muted" style="font-size:.76rem">Partidas jugadas</div>
        </div>
        <div class="card" style="margin:0;padding:10px">
          <div style="font-size:1.4rem;font-weight:700">${st.avgPts}</div>
          <div class="muted" style="font-size:.76rem">Media puntos/partida</div>
        </div>
      </div>

      ${!isMe && st.headToHeadPlayed > 0 ? `
        <div class="card" style="margin-bottom:14px;padding:12px;background:var(--paper2)">
          <div style="font-weight:700;font-size:.9rem;margin-bottom:8px">⚔️ Cara a Cara (${esc(myName)} vs ${esc(name)})</div>
          <div class="row between" style="font-size:1.05rem;font-weight:700">
            <span>${esc(myName)}: ${st.myHeadWins} 🏆</span>
            <span class="muted" style="font-size:.8rem">de ${st.headToHeadPlayed} partidas</span>
            <span>${esc(name)}: ${st.friendHeadWins} 🏆</span>
          </div>
        </div>
      ` : ''}

      <div class="row" style="gap:6px">
        <button class="btn ghost block" onclick="closeModal()">Cerrar</button>
        ${!isMe ? `<button class="btn block" onclick="closeModal();challengeFriend('${esc(name)}')">⚔️ Retar a jugar</button>` : ''}
      </div>
    </div>
  `);
}

function challengeFriend(targetName) {
  modal(`<h2>¿Cómo quieres retar a ${esc(targetName)}?</h2>
    <p class="muted">Elige el tipo de duelo cara a cara:</p>
    
    <div class="card" onclick="closeModal();startFriendDuel('${esc(targetName)}', 'cards')" style="cursor:pointer;margin-bottom:12px;border:2px solid #22c55e;background:#f0fdf4">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem;color:#166534">🎴 Duelo en la App (Tapete y cartas)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Cada uno juega desde su casa con cartas en pantalla, turnos, ligar y cerrar.
          </div>
        </div>
        <span style="font-size:1.5rem;color:#166534">›</span>
      </div>
    </div>
    
    <div class="card" onclick="closeModal();startFriendDuel('${esc(targetName)}', 'scoreboard')" style="cursor:pointer">
      <div class="row between">
        <div>
          <b style="font-size:1.05rem">📱 Duelo en Mesa (Cartas físicas)</b>
          <div class="muted" style="margin-top:4px;line-height:1.4">
            Jugáis en persona con cartas de verdad y anotáis los puntos en el móvil.
          </div>
        </div>
        <span style="font-size:1.5rem">›</span>
      </div>
    </div>
    
    <button class="btn ghost block" onclick="closeModal()">Cancelar</button>`);
}

function startFriendDuel(targetName, duelType = 'cards') {
  const room = 'CH-' + Math.random().toString(36).substring(2, 6).toUpperCase();
  const myName = myPlayerName || (isAdmin() ? 'Juan' : 'Amigo');
  const isCards = duelType === 'cards';

  S.game = {
    id: uid(),
    adminId: S.adminId,
    groupId: null,
    groupName: `Duelo: ${myName} vs ${targetName}`,
    date: Date.now(),
    settings: { ...S.settings },
    players: [
      { name: myName, score: 0, rejoins: 0, out: false, chinchones: 0 },
      { name: targetName, score: 0, rejoins: 0, out: false, chinchones: 0 }
    ],
    rounds: [],
    dealer: 0,
    mode: 'online',
    gameType: isCards ? 'cards' : 'scoreboard',
    roomCode: room
  };

  if (isCards && typeof initCardTable === 'function') {
    S.game.cardTable = initCardTable([myName, targetName]);
    window._activeCardView = 'table';
  } else {
    window._activeCardView = 'scoreboard';
  }

  draft = {};
  remoteDrafts = {};
  isHost = true;
  save();
  render();

  currentRoomCode = room;
  initMqtt(room, () => {
    sendMqtt({ type: 'sync', game: S.game, draft });
  });

  const friendObj = getAllKnownFriends().find(f => f.name.toLowerCase() === targetName.toLowerCase());
  const targetAliases = friendObj && friendObj.aliases ? friendObj.aliases : [];
  const allTargets = [targetName, ...targetAliases];

  sendGlobalMqtt({
    type: 'challenge',
    from: myName,
    target: targetName,
    targets: allTargets,
    roomCode: room,
    gameType: isCards ? 'cards' : 'scoreboard'
  });

  toast(`⚔️ Reto ${isCards ? 'con cartas online' : 'de mesa'} enviado a ${targetName}. Mesa: ${room}`);
  if (!isCards) setTimeout(() => openShareModal(), 350);
}

function createGuestInviteModal() {
  modal(`
    <div style="padding:6px">
      <h2>＋ Añadir amigo a la app</h2>
      <p class="muted">Escribe el nombre de tu amigo para generar su pase oficial de acceso:</p>
      <input id="quick-friend-name" placeholder="Nombre (ej: Miguel, Carlos...)" style="margin-bottom:12px" onkeydown="if(event.key==='Enter')confirmQuickAddFriend()">
      <div class="row">
        <button class="btn ghost block" onclick="closeModal()">Cancelar</button>
        <button class="btn block" onclick="confirmQuickAddFriend()">Crear Pase</button>
      </div>
    </div>
  `);
  setTimeout(() => { const el = $('#quick-friend-name'); if (el) el.focus(); }, 150);
}

function confirmQuickAddFriend() {
  const el = $('#quick-friend-name');
  if (!el) return;
  const name = (el.value || '').trim();
  if (!name) return toast('Escribe un nombre');

  if (!S.adminConfig.authorizedGuests) S.adminConfig.authorizedGuests = [];
  const pass = 'p_' + Math.random().toString(36).substring(2, 8);
  const newGuest = {
    id: 'g_' + uid(),
    name: name,
    pass: pass,
    status: 'allowed',
    addedAt: Date.now()
  };
  S.adminConfig.authorizedGuests.unshift(newGuest);
  save();
  broadcastAuthPolicy();
  closeModal();
  render();
  toast(`✓ Amigo ${name} añadido a la aplicación`);
  setTimeout(() => shareGuestInvite(newGuest.id), 250);
}

function viewGroups() {
  const friends = getAllKnownFriends();
  const myName = (myPlayerName || (isAdmin() ? 'Juan' : '')).trim().toLowerCase();

  return `
    <div id="live-tables-section-groups">${renderLiveTablesCard()}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0">👥 Amigos de Chinchón (${friends.length})</h2>
      ${isAdmin() ? '<button class="btn sm" onclick="createGuestInviteModal()">＋ Añadir Amigo</button>' : ''}
    </div>

    ${friends.length ? `
      <div style="margin-bottom:20px">
        ${friends.map(f => {
          const isMe = f.name.trim().toLowerCase() === myName;
          const st = getFriendStats(f.name);
          const isOnline = window._onlineFriends && (
            (Date.now() - (window._onlineFriends[f.name.trim().toLowerCase()] || 0) < 120000) ||
            (Array.isArray(f.aliases) && f.aliases.some(a => Date.now() - (window._onlineFriends[a.trim().toLowerCase()] || 0) < 120000))
          );
          const safeId = f.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '_');
          return `
            <div class="card" style="padding:10px 12px;margin-bottom:8px">
              <div class="row between" style="margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:6px">
                  <span style="font-size:1.3rem">${f.isAdmin ? '👑' : '👤'}</span>
                  <div>
                    <b>${esc(f.name)}</b> ${isMe ? '<span class="tag">Tú</span>' : ''}
                    ${f.aliases && f.aliases.length ? `<div class="muted" style="font-size:.72rem">Apodos en grupos: ${f.aliases.map(esc).join(', ')}</div>` : ''}
                    <div id="presence-${safeId}" style="font-size:.76rem;margin-top:1px">
                      ${isOnline ? '🟢 <span style="color:var(--ok);font-weight:600">En línea</span>' : '<span class="muted">⚪ Desconectado</span>'}
                    </div>
                  </div>
                </div>
                <div class="row" style="gap:4px">
                  <button class="btn ghost sm" style="padding:4px 8px;font-size:.78rem" onclick="showFriendStatsModal('${esc(f.name)}')">📊 Stats</button>
                  ${!isMe ? `<button class="btn sm" style="padding:4px 9px;font-size:.78rem;background:var(--ok);border-color:var(--ok)" onclick="openFriendChatModal('${esc(f.name)}')">💬 Mensaje</button>` : ''}
                  ${!isMe ? `<button class="btn sm" style="padding:4px 9px;font-size:.78rem" onclick="challengeFriend('${esc(f.name)}')">⚔️ Retar</button>` : ''}
                </div>
              </div>
              <div class="row between muted" style="font-size:.78rem;background:var(--paper2);padding:4px 8px;border-radius:4px">
                <span>🏆 ${st.won} vic (${st.winRate}%)</span>
                <span>🂡 ${st.chinchones} chinch.</span>
                <span>🎮 ${st.played} part.</span>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : '<div class="empty" style="margin-bottom:16px">Aún no hay amigos registrados</div>'}

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <h2 style="margin:0">📋 Grupos de Juego</h2>
      <button id="btn-new-group" class="btn sm" onclick="openGroupForm()">＋ Nuevo grupo</button>
    </div>

    ${S.groups.length ? S.groups.map(g => {
      const wins = winsFor(g.id);
      return `
        <div class="card">
          <div class="row between">
            <b>${esc(g.name)}</b>
            <div class="row" style="gap:4px">
              <button class="btn ghost sm" onclick="openGroupForm('${g.id}')">Editar</button>
              <button class="btn danger sm" onclick="delGroup('${g.id}')">Borrar</button>
            </div>
          </div>
          <div class="muted" style="font-size:.8rem;margin:4px 0 8px">${g.players.map(esc).join(' · ')}</div>
          ${g.players.map(p => `<div class="rank"><span>${esc(p)}</span><span class="muted">${wins[p] || 0} vic</span></div>`).join('')}
        </div>
      `;
    }).join('') : '<div class="empty">Aún no hay grupos creados</div>'}
  `;
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
let histScope = 'all'; // 'all' | 'mine' | 'guests'

function viewHistory() {
  let filtered = S.games.filter(g => !histFilter || g.groupId === histFilter);

  if (isAdmin()) {
    if (histScope === 'guests') {
      filtered = filtered.filter(g => g.isRemoteGuestGame || (g.adminId && g.adminId !== S.adminId) || (g.players && !g.players.some(p => p.name.toLowerCase() === 'juan')));
    } else if (histScope === 'mine') {
      filtered = filtered.filter(g => !g.isRemoteGuestGame && (g.adminId === S.adminId || (g.players && g.players.some(p => p.name.toLowerCase() === 'juan'))));
    }
  }

  const w = Object.entries(winsFor(histFilter)).sort((a, b) => b[1] - a[1]);
  const medals = ['1.', '2.', '3.'];

  const adminScopeHTML = isAdmin() ? `
    <div class="seg" style="margin-bottom:12px">
      <button class="${histScope === 'all' ? 'on' : ''}" onclick="histScope='all';render()">Todas (${S.games.length})</button>
      <button class="${histScope === 'mine' ? 'on' : ''}" onclick="histScope='mine';render()">Mis partidas</button>
      <button class="${histScope === 'guests' ? 'on' : ''}" onclick="histScope='guests';render()">Jugadas por amigos</button>
    </div>
  ` : '';

  return `
    ${adminScopeHTML}
    <div class="row between" style="margin-bottom:10px">
      <select style="margin:0;flex:1" onchange="histFilter=this.value;render()">
        <option value="">Todos los grupos</option>
        ${S.groups.map(g => `<option value="${g.id}" ${g.id === histFilter ? 'selected' : ''}>${esc(g.name)}</option>`).join('')}
      </select>
      ${isAdmin() ? `<button class="btn ghost sm" style="white-space:nowrap;padding:7px 10px;font-size:.8rem" onclick="requestRemoteHistoryFromGuests();toast('🔄 Solicitando partidas a los móviles...')">🔄 Sincronizar de amigos</button>` : ''}
    </div>

    ${w.length ? `<h2>Ranking de victorias</h2><div class="card">${w.map(([n, c], i) => `<div class="rank"><span>${medals[i] || '·'} ${esc(n)}${filtered.length && filtered[0].winner === n ? ' 👑' : ''}</span><b>${c}</b></div>`).join('')}</div>` : ''}
    ${playerStatsHtml(filtered)}

    <div class="row between" style="margin-top:18px;margin-bottom:8px">
      <h2 style="margin:0;border:0">Partidas (${filtered.length})</h2>
      ${filtered.length ? `<button class="btn ghost sm" onclick="syncAllHistoryToMobiles()">⚡ Enviar a móviles</button>` : ''}
    </div>

    ${filtered.length ? filtered.map(g => {
      const isGuestGame = g.isRemoteGuestGame || (g.adminId && g.adminId !== S.adminId) || (g.players && !g.players.some(p => p.name.toLowerCase() === 'juan'));
      return `
        <div class="card" onclick="showGame('${g.id}')" style="cursor:pointer">
          <div class="row between">
            <b>${esc(g.winner)}</b>
            <span class="muted">${new Date(g.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          </div>
          <div class="muted">${esc(g.groupName || 'Partida')} · ${g.rounds.length} rondas · ${g.how || 'Finalizada'}</div>
          <div class="muted">${g.players.map(p => `${esc(p.name)} ${p.score}`).join(' · ')}</div>
          ${isGuestGame ? `<div class="tag" style="background:#e0f2fe;color:#0369a1;border-color:#7dd3fc;display:inline-block;margin-top:4px;font-size:.74rem">📲 Partida de amigos (${g.players.map(p => esc(p.name)).join(' vs ')})</div>` : ''}
        </div>
      `;
    }).join('') : '<div class="empty">Todavía no hay partidas registradas</div>'}
  `;
}
function playerStatsHtml(games) {
  if (!games.length) return '';
  const m = {};
  games.forEach(g => g.players.forEach((p, i) => {
    const o = m[p.name] = m[p.name] || { n: 0, w: 0, pts: 0, hands: 0, best: null, worst: null, chin: 0 };
    o.n++; if (g.winner === p.name) o.w++; o.chin += p.chinchones || 0;
    g.rounds.forEach(r => { const t = r.totals && r.totals[i]; if (t !== null && t !== undefined && (!r.events || r.events[i] !== 'CHINCHÓN')) { o.pts += t; o.hands++; if (o.best === null || t < o.best) o.best = t; if (o.worst === null || t > o.worst) o.worst = t; } });
  }));
  const rows = Object.entries(m).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
  return `<h2>Estadísticas</h2><div class="card" style="overflow-x:auto"><table><tr><th></th><th>PJ</th><th>% vic.</th><th>Media</th><th>Mejor</th><th>Peor</th></tr>
    ${rows.map(([n, o]) => `<tr><td style="text-align:left"><b>${esc(n)}</b>${o.chin ? ' ♠' + o.chin : ''}</td><td>${o.n}</td><td>${Math.round(o.w / o.n * 100)}%</td><td>${o.hands ? (o.pts / o.hands).toFixed(1) : '–'}</td><td>${o.best ?? '–'}</td><td>${o.worst ?? '–'}</td></tr>`).join('')}</table></div>`;
}
function showGame(id) {
  const g = S.games.find(x => x.id === id);
  if (!g) return;
  modal(`<h2>${esc(g.groupName || 'Partida')} – ${new Date(g.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</h2>
    ${g.isRemoteGuestGame ? `<div class="tag" style="background:#e0f2fe;color:#0369a1;border-color:#7dd3fc;display:inline-block;margin-bottom:8px">📲 Partida jugada por amigos: ${g.players.map(p => esc(p.name)).join(' vs ')}</div>` : ''}
    <p><b>${esc(g.winner)}</b> <span class="muted">(${g.how || 'Finalizada'})</span></p>
    <div style="max-height:45vh;overflow:auto"><table><tr><th>#</th>${g.players.map(p => `<th>${esc(p.name)}</th>`).join('')}</tr>
    ${g.rounds.map((r, n) => `<tr><td class="tag">${n + 1}</td>${r.totals.map((t, i) => {
      if (t === null) return `<td><span class="muted">–</span>${r.events[i] ? `<div class="tag">${esc(r.events[i])}</div>` : ''}</td>`;
      const beforePts = (r.before && r.before[i]) ? r.before[i].score : 0;
      const nextR = g.rounds[n + 1];
      const afterPts = (nextR && nextR.before && nextR.before[i]) ? nextR.before[i].score : (beforePts + t);
      const deltaStr = t > 0 ? '+' + t : '' + t;
      return `<td><b>${afterPts}</b> <span class="muted" style="font-size:.76rem">(${deltaStr})</span>${r.events[i] ? `<div class="tag">${esc(r.events[i])}</div>` : ''}</td>`;
    }).join('')}</tr>`).join('')}
    <tr><th>Σ</th>${g.players.map(p => `<th>${p.score}</th>`).join('')}</tr></table></div>
    <div class="row" style="margin-top:12px;gap:6px">
      <button class="btn btn-wa block" style="flex:1;font-size:.88rem" onclick="openSendReportModal(S.games.find(x=>x.id==='${id}'))">📲 Enviar / Ping</button>
      <button class="btn ghost block" style="flex:1;font-size:.88rem" onclick="syncSingleGameToMobiles('${id}')">⚡ Enviar a móviles</button>
    </div>
    <div class="row" style="margin-top:8px"><button class="btn danger block" onclick="S.games=S.games.filter(x=>x.id!=='${id}');save();closeModal();render()">Borrar</button>
    <button class="btn block" onclick="closeModal()">Cerrar</button></div>`);
}

// ---------- NORMAS ----------
// Dos vistas: "Nuestras" (editables, una a una) y "Oficiales" (referencia fija).
let rulesView = 'ours';
function viewRules() {
  const canEdit = isAdmin();
  const seg = `<div class="seg"><button class="${rulesView === 'ours' ? 'on' : ''}" onclick="rulesView='ours';render()">Nuestras normas</button>
    <button class="${rulesView === 'off' ? 'on' : ''}" onclick="rulesView='off';render()">Oficiales</button></div>`;
  if (rulesView === 'off') return seg + `<p class="muted" style="margin:4px 0 14px">Reglamento clásico del chinchón. Solo lectura.</p>
    ${OFFICIAL_RULES.map(([t, x], i) => ruleItem(i, t, x, false)).join('')}
    ${canEdit ? '<button class="btn ghost block" style="margin-top:10px" onclick="resetRules()">Usar las oficiales como nuestras</button>' : ''}`;
  const L = S.rulesList;
  return seg + `<p class="muted" style="margin:4px 0 14px">${canEdit ? 'Toca una norma para cambiarla.' : 'Normas de la casa fijadas por el Administrador (Juan).'}</p>
    ${L.length ? L.map((r, i) => ruleItem(i, r.title, r.text, canEdit)).join('') : '<div class="empty">No hay normas todavía</div>'}
    ${canEdit ? '<button id="btn-add-rule" class="btn block" style="margin-top:10px" onclick="editRule(-1)">Añadir norma</button>' : ''}`;
}
function ruleItem(i, title, text, editable) {
  return `<div class="rule" ${editable ? `onclick="editRule(${i})"` : ''}>
    <div class="rule-n">${ordinal(i)}</div>
    <div class="rule-t">${esc(title)}</div>
    <div class="rule-x">${esc(text)}</div></div>`;
}
function editRule(i) {
  if (!isAdmin()) return toast('Solo Juan (Administrador) puede modificar normas');
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
  if (!isAdmin()) return toast('Solo Juan puede modificar normas');
  const title = $('#r-title').value.trim(), text = $('#r-text').value.trim();
  if (!title && !text) return toast('Escribe algo');
  if (i < 0) S.rulesList.push({ title, text }); else S.rulesList[i] = { title, text };
  save(); closeModal(); render(); toast('Norma guardada');
}
function moveRule(i, d) { if (!isAdmin()) return; const L = S.rulesList; [L[i], L[i + d]] = [L[i + d], L[i]]; save(); render(); editRule(i + d); }
function delRule(i) { if (!isAdmin()) return; S.rulesList.splice(i, 1); save(); closeModal(); render(); toast('Norma borrada'); }
function resetRules() {
  if (!isAdmin()) return toast('Solo Juan puede restablecer las normas');
  modal(`<h2>¿Sustituir vuestras normas?</h2><p class="muted">Se cambiarán por las oficiales. Lo que hayas escrito se perderá.</p>
    <div class="row"><button class="btn ghost block" onclick="closeModal()">Cancelar</button>
    <button class="btn block" onclick="S.rulesList=officialCopy();save();rulesView='ours';closeModal();render()">Sustituir</button></div>`);
}

let wakeLockSentinel = null;
async function requestWakeLock() {
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && S && S.adminConfig && S.adminConfig.wakeLock !== false) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', () => { wakeLockSentinel = null; });
    } catch (e) {}
  }
}

checkAuthParams();
render();
checkRoomParam();
initMqtt(currentRoomCode || 'auth_global');
updateRolePill();
checkAccessControl();
requestWakeLock();
applyTheme();
setTimeout(broadcastPresence, 1200);
setInterval(broadcastPresence, 20000);
setTimeout(broadcastTableAlive, 1500);
setInterval(broadcastTableAlive, 20000);
if (S && S.adminConfig && S.adminConfig.openMessageEnabled && S.adminConfig.openMessageText) {
  showOpenMessage(S.adminConfig.openMessageText);
}
$('#version').textContent = 'v' + APP_VERSION + ' ↻';
updateConnectionIndicator();
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

// ---------- AUTO-ACTUALIZACIÓN & RECONEXIÓN AUTOMÁTICA EN MÓVILES ----------
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
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    checkUpdate();
    ensureMqttConnected();
    broadcastPresence();
  }
});
window.addEventListener('focus', () => {
  checkUpdate();
  ensureMqttConnected();
  broadcastPresence();
});
window.addEventListener('online', () => {
  toast('📶 Conexión restaurada');
  ensureMqttConnected(true);
});
setInterval(checkUpdate, 60000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
