/**
 * CHINCHÓN - MOTOR DE JUEGO DE CARTAS VIRTUAL (MODO ONLINE / TAPETE)
 * Baraja española, detector de combinaciones, turnos, cierre, bots y sincronización MQTT.
 */

// ==========================================
// 1. CONSTANTES Y DEFINICIONES DE LA BARAJA
// ==========================================
const SUIT_INFOS = {
  oros:    { name: 'Oros',    symbol: '🪙', color: '#b8860b', bg: '#fffdf0' },
  copas:   { name: 'Copas',   symbol: '🍷', color: '#c0292b', bg: '#fff5f5' },
  espadas: { name: 'Espadas', symbol: '⚔️', color: '#1a5276', bg: '#f0f7ff' },
  bastos:  { name: 'Bastos',  symbol: '🪵', color: '#27ae60', bg: '#f2fcf4' },
  comodin: { name: 'Comodín', symbol: '🃏', color: '#8e44ad', bg: '#faf0ff' }
};

const NUM_LABELS = {
  1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7',
  10: '10', 11: '11', 12: '12'
};

const NUM_NAMES = {
  1: 'As', 2: 'Dos', 3: 'Tres', 4: 'Cuatro', 5: 'Cinco', 6: 'Seis', 7: 'Siete',
  10: 'Sota', 11: 'Caballo', 12: 'Rey'
};

const NUM_INDEX = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 10: 7, 11: 8, 12: 9 };
const CARD_PTS = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 10: 10, 11: 10, 12: 10 };

function createDeck(withJoker = true) {
  const suits = ['oros', 'copas', 'espadas', 'bastos'];
  const nums = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];
  const deck = [];
  for (const s of suits) {
    for (const n of nums) {
      deck.push({ id: `${s}_${n}`, suit: s, num: n, val: CARD_PTS[n], isJoker: false });
    }
  }
  if (withJoker) {
    deck.push({ id: 'joker_1', suit: 'comodin', num: 0, val: 25, isJoker: true });
  }
  return deck;
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ==========================================
// 2. EFECTOS DE SONIDO SINTETIZADOS (Web Audio)
// ==========================================
let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx && (window.AudioContext || window.webkitAudioContext)) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    _audioCtx = new AudioCtx();
  }
  if (_audioCtx && _audioCtx.state === 'suspended') {
    _audioCtx.resume();
  }
  return _audioCtx;
}

function playCardAudio(type) {
  try {
    const ctx = getAudioCtx();
    if (!ctx) return;
    const now = ctx.currentTime;
    
    if (type === 'deal' || type === 'draw') {
      // Sonido de deslizamiento de carta (flick suave)
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.08);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } else if (type === 'discard') {
      // Toque suave sobre tapete
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(70, now + 0.1);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    } else if (type === 'close') {
      // Doble toque de cierre en madera (toc-toc)
      [0, 0.12].forEach(delay => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(260, now + delay);
        osc.frequency.exponentialRampToValueAtTime(110, now + delay + 0.09);
        gain.gain.setValueAtTime(0.35, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.09);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.1);
      });
    } else if (type === 'win') {
      // Fanfarria alegre de victoria
      const notes = [261.63, 329.63, 392.00, 523.25];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.2, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.26);
      });
    }
  } catch (e) {
    // Si el navegador bloquea audio antes de interacción, se ignora limpiamente
  }
}

// ==========================================
// 3. MOTOR DE REGLAS Y COMBINACIONES
// ==========================================
function isValidGroup(cards) {
  if (cards.length < 3 || cards.length > 4) return false;
  const jokers = cards.filter(c => c.isJoker);
  if (jokers.length > 1) return false;
  const regular = cards.filter(c => !c.isJoker);
  if (!regular.length) return false;
  const targetNum = regular[0].num;
  const suits = new Set();
  for (const c of regular) {
    if (c.num !== targetNum) return false;
    if (suits.has(c.suit)) return false;
    suits.add(c.suit);
  }
  return true;
}

function isValidStraight(cards) {
  if (cards.length < 3) return false;
  const jokers = cards.filter(c => c.isJoker);
  if (jokers.length > 1) return false;
  const regular = cards.filter(c => !c.isJoker);
  if (!regular.length) return false;
  const suit = regular[0].suit;
  if (!regular.every(c => c.suit === suit)) return false;

  const indices = regular.map(c => NUM_INDEX[c.num]).sort((a, b) => a - b);
  for (let i = 0; i < indices.length - 1; i++) {
    if (indices[i] === indices[i + 1]) return false;
  }
  
  const span = indices[indices.length - 1] - indices[0] + 1;
  const missing = span - regular.length;
  if (missing === 0 && jokers.length === 0) return true;
  if (missing === 1 && jokers.length === 1) return true;
  if (missing === 0 && jokers.length === 1) {
    return indices[0] > 0 || indices[indices.length - 1] < 9;
  }
  return false;
}

function isMeld(cards) {
  return isValidGroup(cards) || isValidStraight(cards);
}

function getSubsetsOfCards(arr, minSize = 3, maxSize = 7) {
  const result = [];
  function fork(idx, current) {
    if (current.length >= minSize && current.length <= maxSize) {
      if (isMeld(current)) result.push([...current]);
    }
    if (current.length === maxSize || idx === arr.length) return;
    for (let i = idx; i < arr.length; i++) {
      current.push(arr[i]);
      fork(i + 1, current);
      current.pop();
    }
  }
  fork(0, []);
  return result;
}

/**
 * Evalúa una mano de cartas y devuelve la mejor combinación posible
 * buscando minimizar los puntos de las cartas sueltas.
 */
function evaluateHand(cards) {
  if (!cards || !cards.length) {
    return { melds: [], unmelded: [], unmeldedScore: 0, canClose: false, isChinchon: false, isZero: false };
  }
  
  const validMelds = getSubsetsOfCards(cards);
  let best = {
    melds: [],
    unmelded: [...cards],
    unmeldedScore: cards.reduce((acc, c) => acc + c.val, 0),
    canClose: false,
    isChinchon: false,
    isZero: false
  };

  // 1. Evaluar si hay un meld de 7 cartas (Chinchón directo)
  for (const m of validMelds) {
    if (m.length === 7 && isValidStraight(m)) {
      const hasJoker = m.some(c => c.isJoker);
      return {
        melds: [m],
        unmelded: [],
        unmeldedScore: 0,
        canClose: true,
        isChinchon: true,
        isChinchonLimpio: !hasJoker,
        isZero: true
      };
    }
  }

  // 2. Evaluar 1 meld individual
  for (const m1 of validMelds) {
    const m1Ids = new Set(m1.map(c => c.id));
    const rem = cards.filter(c => !m1Ids.has(c.id));
    const score = rem.reduce((acc, c) => acc + c.val, 0);
    if (score < best.unmeldedScore) {
      best = {
        melds: [m1],
        unmelded: rem,
        unmeldedScore: score,
        canClose: score <= 5,
        isChinchon: false,
        isZero: score === 0
      };
    }

    // 3. Evaluar 2 melds disjuntos (ej: 3+3, 3+4, 4+3)
    if (rem.length >= 3) {
      const secondMelds = getSubsetsOfCards(rem, 3, 4);
      for (const m2 of secondMelds) {
        const m2Ids = new Set(m2.map(c => c.id));
        const rem2 = rem.filter(c => !m2Ids.has(c.id));
        const score2 = rem2.reduce((acc, c) => acc + c.val, 0);
        if (score2 < best.unmeldedScore) {
          best = {
            melds: [m1, m2],
            unmelded: rem2,
            unmeldedScore: score2,
            canClose: score2 <= 5,
            isChinchon: false,
            isZero: score2 === 0
          };
        }
      }
    }
  }

  best.canClose = best.unmeldedScore <= 5 || best.isChinchon;
  best.isZero = best.unmeldedScore === 0;
  return best;
}

/**
 * Comprueba si una carta suelta puede colocarse en una combinación ya cerrada.
 */
function canAttachCardToMeld(card, meld) {
  const candidate = [...meld, card];
  return isValidGroup(candidate) || isValidStraight(candidate);
}

/**
 * Descarte automático de cartas sueltas de los rivales en los juegos del que cerró.
 */
function autoLayOff(unmeldedCards, allMelds) {
  const placed = [];
  let remaining = [...unmeldedCards];
  let changed = true;

  while (changed) {
    changed = false;
    for (let i = remaining.length - 1; i >= 0; i--) {
      const card = remaining[i];
      for (const meld of allMelds) {
        if (canAttachCardToMeld(card, meld)) {
          meld.push(card);
          placed.push({ card, meld });
          remaining.splice(i, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }
  return { remaining, placed };
}

// ==========================================
// 4. ESTADO GLOBAL DE LA MESA DE CARTAS
// ==========================================
window._cardTable = null;
window._activeCardView = 'table'; // 'table' | 'scoreboard'
window._selectedHandCardId = null;

function getCardTable() {
  if (!S.game) return null;
  if (!S.game.cardTable) {
    S.game.cardTable = initCardTable(S.game.players.map(p => (typeof p === 'string' ? p : p.name)));
    save();
  }
  return S.game.cardTable;
}

function initCardTable(playerNames) {
  const fullDeck = shuffle(createDeck(true));
  const hands = {};
  
  // Normalizar nombres a string
  const cleanNames = (playerNames || []).map(p => (typeof p === 'string' ? p : (p && p.name ? p.name : 'Jugador')));
  cleanNames.forEach(name => {
    hands[name] = fullDeck.splice(0, 7);
  });
  
  // Dejar la primera carta en el pozo boca arriba
  const discard = [fullDeck.pop()];
  const dealerIdx = S.game ? (S.game.dealer || 0) : 0;
  const startTurn = cleanNames.length ? ((dealerIdx + 1) % cleanNames.length) : 0;

  return {
    deck: fullDeck,
    discard: discard,
    hands: hands,
    turn: startTurn,
    phase: 'draw', // 'draw' | 'discard' | 'round_ended'
    drawnCard: null,
    closer: null,
    roundSummary: null,
    lastMsg: `Partida iniciada. Le toca a ${cleanNames[startTurn]} robar carta.`,
    isOnline: S.game ? S.game.mode === 'online' : false
  };
}

// ==========================================
// 5. ACCIONES DEL JUGADOR
// ==========================================
function isMyCardTurn() {
  const T = getCardTable();
  if (!T || T.phase === 'round_ended') return false;
  const curPlayerName = S.game.players[T.turn]?.name;
  if (!curPlayerName) return false;
  
  // Si soy Juan / Admin
  if (isAdmin()) {
    return curPlayerName.toLowerCase() === 'juan' || curPlayerName.toLowerCase() === (myPlayerName || '').toLowerCase();
  }
  // Si soy un invitado
  return curPlayerName.toLowerCase() === (myPlayerName || '').toLowerCase();
}

function handleCardDraw(source) {
  const T = getCardTable();
  if (!T || T.phase !== 'draw') return;
  if (!isMyCardTurn() && !window._soloPracticeMode) {
    return toast('⚠️ No es tu turno de robar');
  }

  const curPlayerName = S.game.players[T.turn].name;
  let card = null;

  if (source === 'deck') {
    if (T.deck.length === 0) {
      // Si el mazo se acaba, se baraja el pozo dejando la superior
      if (T.discard.length <= 1) return toast('No quedan cartas en el mazo ni en el pozo');
      const topDiscard = T.discard.pop();
      T.deck = shuffle(T.discard);
      T.discard = [topDiscard];
      toast('🂠 Se ha vuelto a barajar el pozo');
    }
    card = T.deck.pop();
    T.lastMsg = `${curPlayerName} ha robado del mazo.`;
  } else if (source === 'discard') {
    if (T.discard.length === 0) return toast('El pozo está vacío');
    card = T.discard.pop();
    T.lastMsg = `${curPlayerName} ha robado del pozo (${card.isJoker ? '🃏 Comodín' : card.num + ' ' + SUIT_INFOS[card.suit].symbol}).`;
  }

  if (!card) return;

  // Añadir la carta a la mano del jugador
  T.hands[curPlayerName].push(card);
  T.phase = 'discard';
  T.drawnCard = card;
  window._selectedHandCardId = card.id; // preseleccionar la robada para facilidad
  playCardAudio('draw');
  vibrate(25);

  save();
  broadcastCardTable('draw', { source, player: curPlayerName });
  render();

  // Comprobar si puede cerrar directamente
  const evalResult = evaluateHand(T.hands[curPlayerName]);
  if (evalResult.canClose) {
    vibrate([40, 60, 40]);
  }
}

function handleCardDiscard(closeMode = false) {
  const T = getCardTable();
  if (!T || T.phase !== 'discard') return;
  if (!isMyCardTurn() && !window._soloPracticeMode) {
    return toast('⚠️ No es tu turno de tirar');
  }

  const curPlayerName = S.game.players[T.turn].name;
  const hand = T.hands[curPlayerName] || [];
  const cardId = window._selectedHandCardId;

  if (!cardId) return toast('Selecciona la carta que quieres tirar');
  const cardIndex = hand.findIndex(c => c.id === cardId);
  if (cardIndex === -1) return toast('Carta no encontrada en tu mano');

  // Si intenta cerrar, validar que con las 7 cartas restantes la mano sea válida para cierre
  if (closeMode) {
    const remainingCards = hand.filter((_, idx) => idx !== cardIndex);
    const evalRes = evaluateHand(remainingCards);
    if (!evalRes.canClose) {
      return toast(`⚠️ No puedes cerrar: te quedan ${evalRes.unmeldedScore} pts (máximo 5 pts)`);
    }
    // Cerrar la mano
    executeRoundClose(curPlayerName, cardIndex, evalRes);
    return;
  }

  // Descarte normal
  const discardedCard = hand.splice(cardIndex, 1)[0];
  T.discard.push(discardedCard);
  T.phase = 'draw';
  T.drawnCard = null;
  window._selectedHandCardId = null;
  playCardAudio('discard');
  vibrate(20);

  // Pasar el turno al siguiente jugador no eliminado
  let nextTurn = (T.turn + 1) % S.game.players.length;
  let attempts = 0;
  while (S.game.players[nextTurn].out && attempts < S.game.players.length) {
    nextTurn = (nextTurn + 1) % S.game.players.length;
    attempts++;
  }
  T.turn = nextTurn;
  const nextPlayer = S.game.players[T.turn].name;
  T.lastMsg = `${curPlayerName} tiró ${discardedCard.isJoker ? '🃏 Comodín' : discardedCard.num + ' ' + SUIT_INFOS[discardedCard.suit].symbol}. Turno de ${nextPlayer}.`;

  save();
  broadcastCardTable('discard', { player: curPlayerName, card: discardedCard });
  render();

  // Si le toca a un bot o jugador no conectado en modo práctica, activar IA
  checkAndTriggerBot();
}

/**
 * Cierre de la ronda y recuento de puntos automático.
 */
function executeRoundClose(closerName, discardedIdx, evalRes) {
  const T = getCardTable();
  const hand = T.hands[closerName];
  const discardedCard = hand.splice(discardedIdx, 1)[0];
  T.discard.push(discardedCard);

  T.phase = 'round_ended';
  T.closer = closerName;
  playCardAudio('close');
  vibrate([80, 50, 100]);

  // Recoger combinaciones del que cerró
  const closerMelds = evalRes.melds;
  const closerUnmelded = evalRes.unmelded;
  let closerScore = evalRes.unmeldedScore;

  // Evaluar manos de todos los rivales
  const playerScores = {};
  const playerEvals = {};
  
  // Guardar evaluación del closer
  playerEvals[closerName] = {
    melds: closerMelds,
    unmelded: closerUnmelded,
    initialScore: closerScore,
    finalScore: closerScore,
    isChinchon: evalRes.isChinchon,
    isChinchonLimpio: evalRes.isChinchonLimpio,
    isZero: evalRes.isZero
  };

  // Si cerró con 0 o Chinchón, resta -10 o -25
  if (evalRes.isChinchon) {
    closerScore = evalRes.isChinchonLimpio ? -25 : -10;
    playerEvals[closerName].finalScore = closerScore;
  } else if (evalRes.isZero) {
    closerScore = -10;
    playerEvals[closerName].finalScore = -10;
  }

  // Evaluar a los demás jugadores
  for (const p of S.game.players) {
    if (p.name === closerName || p.out) continue;
    const pHand = T.hands[p.name] || [];
    const pEval = evaluateHand(pHand);
    let pRemaining = [...pEval.unmelded];

    // Si el que cerró no hizo 0 ni Chinchón, los rivales pueden colocar cartas en sus combinaciones
    let placedOnCloser = [];
    if (!evalRes.isZero && !evalRes.isChinchon && closerMelds.length) {
      const layOffRes = autoLayOff(pRemaining, closerMelds);
      pRemaining = layOffRes.remaining;
      placedOnCloser = layOffRes.placed;
    }

    const pFinalPts = pRemaining.reduce((sum, c) => sum + c.val, 0);
    playerEvals[p.name] = {
      melds: pEval.melds,
      unmelded: pRemaining,
      placed: placedOnCloser,
      initialScore: pEval.unmeldedScore,
      finalScore: pFinalPts,
      isZero: pFinalPts === 0
    };
  }

  // REGLA DE CHINCHÓN: Si un rival empata o saca menos puntos que el que cerró (y este cerró con >0 puntos)
  // El que cerró se lleva penalización (+25 puntos) y el rival que lo superó se lleva 0 puntos.
  let closerPenalized = false;
  if (!evalRes.isZero && !evalRes.isChinchon) {
    for (const p of S.game.players) {
      if (p.name === closerName || p.out) continue;
      const rScore = playerEvals[p.name].finalScore;
      if (rScore <= closerScore) {
        closerPenalized = true;
        playerEvals[p.name].finalScore = 0; // Se lleva 0
      }
    }
    if (closerPenalized) {
      playerEvals[closerName].finalScore = (S.game.settings.penalty || 25);
      playerEvals[closerName].penalized = true;
    }
  }

  // Construir resumen de la ronda
  T.roundSummary = {
    closer: closerName,
    evals: playerEvals,
    closerPenalized: closerPenalized,
    discardedCard: discardedCard
  };

  // Aplicar puntos directamente a la partida de Chinchón
  const roundEntries = S.game.players.map((p, i) => {
    if (p.out) return { pts: 0, out: true };
    const res = playerEvals[p.name];
    const scoreVal = res ? res.finalScore : 0;
    return {
      pts: scoreVal > 0 ? scoreVal : 0,
      m10: scoreVal === -10,
      m25: scoreVal === -25,
      pen: res?.penalized ? 1 : 0
    };
  });

  // Anotar la ronda al marcador oficial
  applyRoundToGame(roundEntries);

  T.lastMsg = `¡${closerName} ha cerrado la mano!`;
  save();
  broadcastCardTable('close', { closer: closerName, summary: T.roundSummary });
  render();
}

/**
 * Traslada el resultado de la mano al marcador general de rondas y jugadores.
 */
function applyRoundToGame(entries) {
  const st = S.game.settings;
  const round = {
    dealer: S.game.dealer ?? 0,
    entries: entries
  };
  S.game.rounds.push(round);

  // Recalcular puntuaciones acumuladas
  S.game.players.forEach((p, i) => {
    if (p.out) return;
    const e = entries[i] || {};
    let pts = (parseInt(e.pts) || 0);
    if (e.m10) pts = -10;
    if (e.m25) pts = -25;
    if (e.pen) pts += (st.penalty || 25);
    p.score += pts;
    if (e.m10 || e.m25) p.chinchones = (p.chinchones || 0) + 1;

    // Comprobar eliminación
    if (p.score > st.limit) {
      if (p.rejoins < st.maxRejoins) {
        // Reenganche automático al máximo de los que quedan
        const aliveOthers = S.game.players.filter((op, oi) => oi !== i && !op.out && op.score <= st.limit);
        const maxScore = aliveOthers.length ? Math.max(...aliveOthers.map(o => o.score)) : st.limit;
        p.score = maxScore;
        p.rejoins++;
        toast(`🔄 ${p.name} se ha reenganchado con ${p.score} pts`);
      } else {
        p.out = true;
        toast(`💀 ${p.name} ha sido eliminado`);
      }
    }
  });

  // Comprobar si hay un ganador único
  const alive = S.game.players.filter(p => !p.out);
  if (alive.length === 1) {
    S.game.winner = alive[0].name;
    playCardAudio('win');
    if (typeof finishGame === 'function') {
      const winnerIdx = S.game.players.findIndex(p => p.name === alive[0].name);
      setTimeout(() => finishGame(winnerIdx >= 0 ? winnerIdx : 0, 'eliminación'), 1200);
    }
  }

  // Rotar el repartidor
  S.game.dealer = ((S.game.dealer ?? 0) + 1) % S.game.players.length;
}

/**
 * Inicia la siguiente mano de cartas.
 */
function handleNextCardRound() {
  if (S.game.winner) return toast('La partida ya ha finalizado');
  S.game.cardTable = initCardTable(S.game.players.map(p => p.name));
  window._selectedHandCardId = null;
  save();
  broadcastCardTable('new_round', { cardTable: S.game.cardTable });
  render();
  toast('🂠 ¡Mano repartida! Mucha suerte.');
}

// ==========================================
// 6. INTELIGENCIA ARTIFICIAL DE BOTS
// ==========================================
window._soloPracticeMode = false;

function toggleSoloPracticeMode() {
  window._soloPracticeMode = !window._soloPracticeMode;
  toast(window._soloPracticeMode ? '🤖 Modo Práctica Activado: los demás jugadores jugarán automáticamente como bots' : '👤 Modo Práctica Desactivado');
  render();
  if (window._soloPracticeMode) {
    checkAndTriggerBot();
  }
}

function checkAndTriggerBot() {
  const T = getCardTable();
  if (!T || T.phase === 'round_ended') return;
  const curPlayer = S.game.players[T.turn]?.name;
  if (!curPlayer) return;

  // Si no es el turno de un bot y no está el modo práctica activado, nada que hacer
  const isHumanTurn = curPlayer.toLowerCase() === 'juan' || (myPlayerName && curPlayer.toLowerCase() === myPlayerName.toLowerCase());
  if (isHumanTurn && !window._soloPracticeMode) return;

  // En modo práctica, o si es un rival no conectado, la IA toma el relevo con pausas naturales
  setTimeout(() => {
    runBotTurn(curPlayer);
  }, 1000);
}

function runBotTurn(botName) {
  const T = getCardTable();
  if (!T || T.phase === 'round_ended') return;
  if (S.game.players[T.turn]?.name !== botName) return;

  const hand = T.hands[botName] || [];
  if (!hand.length) return;

  // PASO 1: ROBAR CARTA
  if (T.phase === 'draw') {
    const topDiscard = T.discard[T.discard.length - 1];
    let drawFromDiscard = false;

    if (topDiscard) {
      // Simular si coger la carta del pozo mejora la mano
      const currentEval = evaluateHand(hand);
      const testHand = [...hand, topDiscard];
      // Probar cuál de las 8 cartas descartaría y qué puntuación le quedaría
      let bestTestScore = 999;
      for (let i = 0; i < testHand.length; i++) {
        const sub = testHand.filter((_, idx) => idx !== i);
        const ev = evaluateHand(sub);
        if (ev.unmeldedScore < bestTestScore) bestTestScore = ev.unmeldedScore;
      }
      if (bestTestScore < currentEval.unmeldedScore) {
        drawFromDiscard = true;
      }
    }

    handleCardDraw(drawFromDiscard ? 'discard' : 'deck');

    // PASO 2: ELEGIR DESCARTE O CERRAR TRAS 1 SEGUNDO
    setTimeout(() => {
      runBotDiscard(botName);
    }, 1100);
  }
}

function runBotDiscard(botName) {
  const T = getCardTable();
  if (!T || T.phase !== 'discard') return;
  if (S.game.players[T.turn]?.name !== botName) return;

  const hand = T.hands[botName] || [];
  if (hand.length !== 8) return;

  // Evaluar cuál de las 8 cartas descartar para conseguir el menor número de puntos sueltos
  let bestCardIdx = 0;
  let lowestScore = 999;
  let canCloseWithBest = false;

  for (let i = 0; i < hand.length; i++) {
    const candidateHand = hand.filter((_, idx) => idx !== i);
    const ev = evaluateHand(candidateHand);
    if (ev.unmeldedScore < lowestScore) {
      lowestScore = ev.unmeldedScore;
      bestCardIdx = i;
      canCloseWithBest = ev.canClose;
    }
  }

  window._selectedHandCardId = hand[bestCardIdx].id;

  // Si puede cerrar, el bot cierra
  if (canCloseWithBest) {
    handleCardDiscard(true);
  } else {
    handleCardDiscard(false);
  }
}

// ==========================================
// 7. ORDENAR CARTAS DE LA MANO
// ==========================================
function sortHandCards(by = 'suit') {
  const T = getCardTable();
  if (!T) return;
  const myName = (isAdmin() ? 'Juan' : myPlayerName) || S.game.players[0].name;
  const hand = T.hands[myName];
  if (!hand || !hand.length) return;

  if (by === 'suit') {
    hand.sort((a, b) => {
      if (a.isJoker) return 1;
      if (b.isJoker) return -1;
      if (a.suit !== b.suit) return a.suit.localeCompare(b.suit);
      return NUM_INDEX[a.num] - NUM_INDEX[b.num];
    });
  } else if (by === 'num') {
    hand.sort((a, b) => {
      if (a.isJoker) return 1;
      if (b.isJoker) return -1;
      if (NUM_INDEX[a.num] !== NUM_INDEX[b.num]) return NUM_INDEX[a.num] - NUM_INDEX[b.num];
      return a.suit.localeCompare(b.suit);
    });
  }
  playCardAudio('draw');
  save();
  render();
}

// ==========================================
// 8. SINCRONIZACIÓN MQTT DE LA MESA
// ==========================================
function broadcastCardTable(action, payload = {}) {
  if (!S.game || S.game.mode !== 'online') return;
  sendMqtt({
    type: 'card_action',
    action: action,
    payload: payload,
    cardTable: S.game.cardTable,
    game: S.game
  });
}

window.handleCardTableMsg = function(d) {
  if (!d || d.type !== 'card_action') return;
  if (!S.game) return;

  if (d.cardTable) {
    S.game.cardTable = d.cardTable;
    if (d.game) {
      S.game.rounds = d.game.rounds;
      S.game.players = d.game.players;
      S.game.dealer = d.game.dealer;
      S.game.winner = d.game.winner;
    }
    save();
    render();
    if (d.action === 'close') {
      playCardAudio('close');
      vibrate([80, 50, 100]);
    } else if (d.action === 'draw' || d.action === 'discard') {
      playCardAudio(d.action);
    }
  }
};

// ==========================================
// 9. RENDERIZADO VISUAL DEL TAPETE Y CARTAS
// ==========================================
function renderCardSVG(card, isBack = false, isSelected = false, isDrawn = false) {
  if (isBack) {
    return `<div class="p-card card-back"></div>`;
  }
  if (!card) return '';
  const info = SUIT_INFOS[card.suit] || SUIT_INFOS.oros;
  const isRed = card.suit === 'copas';
  const isJoker = card.isJoker;

  const numLabel = isJoker ? '★' : NUM_LABELS[card.num];
  const symbol = info.symbol;

  return `
    <div class="p-card ${card.suit} ${isSelected ? 'selected' : ''} ${isDrawn ? 'new-draw' : ''}"
         onclick="window._selectedHandCardId='${card.id}';render();"
         data-id="${card.id}"
         style="--suit-color:${info.color};--suit-bg:${info.bg}">
      <div class="card-corner top-left">
        <span class="card-num">${numLabel}</span>
        <span class="card-sym">${symbol}</span>
      </div>
      <div class="card-center">
        <span class="card-large-sym">${symbol}</span>
        ${isJoker ? '<div class="joker-tag">COMODÍN</div>' : ''}
      </div>
      <div class="card-corner bottom-right">
        <span class="card-num">${numLabel}</span>
        <span class="card-sym">${symbol}</span>
      </div>
    </div>
  `;
}

function renderCardTableUI() {
  const G = S.game;
  if (!G) return '';
  const T = getCardTable();
  if (!T) return '';

  const myName = (isAdmin() ? 'Juan' : myPlayerName) || G.players[0].name;
  const myHand = T.hands[myName] || [];
  const curPlayer = G.players[T.turn]?.name;
  const isMyTurn = isMyCardTurn();
  const evalHand = evaluateHand(myHand);

  // Rivales (arriba de la mesa)
  const opponents = G.players.filter(p => p.name.toLowerCase() !== myName.toLowerCase());

  const opponentsHTML = opponents.map(p => {
    const pHand = T.hands[p.name] || [];
    const isTheirTurn = G.players[T.turn]?.name === p.name;
    const isOut = p.out;
    return `
      <div class="opp-chip ${isTheirTurn ? 'active-turn' : ''} ${isOut ? 'out' : ''}">
        <div class="opp-avatar">${isTheirTurn ? '🟢' : '👤'}</div>
        <div class="opp-info">
          <div class="opp-name">${esc(p.name)} ${isTheirTurn ? '<b style="color:#4ade80">(Turno)</b>' : ''}</div>
          <div class="opp-cards-count">${isOut ? '💀 Eliminado' : `🂠 ${pHand.length} cartas · ${p.score} pts`}</div>
        </div>
      </div>
    `;
  }).join('');

  // Centro de la mesa: Mazo y Pozo
  const topDiscard = T.discard[T.discard.length - 1];
  const canDraw = isMyTurn && T.phase === 'draw';
  const canDiscard = isMyTurn && T.phase === 'discard';

  const deckHTML = `
    <div class="deck-pile ${canDraw ? 'clickable-glow' : ''}" onclick="${canDraw ? `handleCardDraw('deck')` : ''}" title="Robar del mazo">
      <div class="card-stack-effect"></div>
      <div class="p-card card-back">
        <div class="deck-count">${T.deck.length}</div>
      </div>
      <div class="pile-label">Mazo (${T.deck.length})</div>
    </div>
  `;

  const discardHTML = `
    <div class="discard-pile ${canDraw && topDiscard ? 'clickable-glow' : ''}" onclick="${canDraw && topDiscard ? `handleCardDraw('discard')` : ''}" title="Robar del pozo">
      ${topDiscard ? renderCardSVG(topDiscard) : '<div class="empty-pile">Vacío</div>'}
      <div class="pile-label">Pozo (Descartes)</div>
    </div>
  `;

  // Combinaciones detectadas en mi mano
  let meldsBadgeHTML = '';
  if (evalHand.melds.length) {
    meldsBadgeHTML = evalHand.melds.map(m => {
      const isStr = isValidStraight(m);
      const label = isStr ? `Escalera (${m[0].suit})` : `Trío de ${m.find(c => !c.isJoker)?.num || ''}s`;
      return `<span class="badge" style="background:#1b4329;color:#bbf7d0;border-color:#4ade80">🟢 ${label}</span>`;
    }).join(' ');
  }

  // Resumen de puntos sueltos
  const pointsBadge = `
    <div class="hand-score-pill ${evalHand.canClose ? 'can-close' : ''}">
      <span>Cartas sueltas: <b>${evalHand.unmeldedScore} pts</b></span>
      ${evalHand.canClose ? '<span class="can-close-tag">¡PUEDES CERRAR!</span>' : '<span class="muted" style="color:#d1fae5">(máx 5 para cerrar)</span>'}
    </div>
  `;

  // Botones de acción
  const actionsHTML = `
    <div class="table-action-bar">
      ${T.phase === 'draw' ? `
        <button class="btn ${canDraw ? 'btn-gold' : 'disabled'}" onclick="handleCardDraw('deck')">🃏 Robar Mazo</button>
        <button class="btn ${canDraw && topDiscard ? 'btn-gold' : 'disabled'}" onclick="handleCardDraw('discard')">📥 Robar Pozo</button>
      ` : `
        <button class="btn btn-discard ${window._selectedHandCardId ? '' : 'disabled'}" onclick="handleCardDiscard(false)">📤 Tirar carta</button>
        ${evalHand.canClose ? `
          <button class="btn btn-close-round" onclick="handleCardDiscard(true)">🚪 ¡CERRAR MANO! (${evalHand.unmeldedScore} pts)</button>
        ` : ''}
      `}
      <div class="sort-buttons">
        <button class="btn ghost sm" style="color:#e2e8f0;border-color:#64748b;padding:5px 8px" onclick="sortHandCards('suit')">Palo</button>
        <button class="btn ghost sm" style="color:#e2e8f0;border-color:#64748b;padding:5px 8px" onclick="sortHandCards('num')">Número</button>
      </div>
    </div>
  `;

  // Si la ronda ha terminado, modal de recuento
  let roundEndModalHTML = '';
  if (T.phase === 'round_ended' && T.roundSummary) {
    roundEndModalHTML = renderRoundEndModal(T.roundSummary);
  }

  return `
    <div class="felt-table">
      <!-- Barra superior de alternancia Tapete / Marcador -->
      <div class="table-top-bar">
        <div class="view-switcher">
          <button class="switcher-btn active" onclick="window._activeCardView='table';render()">🎴 Tapete</button>
          <button class="switcher-btn" onclick="window._activeCardView='scoreboard';render()">📊 Marcador</button>
        </div>
        <div class="table-header-info" style="display:flex;gap:4px;align-items:center">
          <span class="room-code-badge">${G.mode === 'online' ? 'Sala ' + G.roomCode : 'Mesa Virtual'}</span>
          <button class="btn ghost sm" style="color:#f8fafc;border-color:#94a3b8;padding:4px 8px;font-size:.78rem" onclick="openRoomChatModal()">💬 Chat</button>
          <button class="btn ghost sm" style="color:#f8fafc;border-color:#94a3b8;padding:4px 8px;font-size:.78rem" onclick="toggleSoloPracticeMode()">${window._soloPracticeMode ? '🤖 Bots ON' : '👤 Bots OFF'}</button>
        </div>
      </div>

      <!-- Rivales -->
      <div class="opponents-strip">
        ${opponentsHTML}
      </div>

      <!-- Centro de la mesa: Tapete con Mazo y Pozo -->
      <div class="table-center-felt">
        <div class="piles-wrapper">
          ${deckHTML}
          ${discardHTML}
        </div>
        <div class="table-banner">
          <div class="banner-text">${isMyTurn ? (T.phase === 'draw' ? '🟢 <b>Tu turno:</b> Roba una carta del mazo o del pozo' : '🟢 <b>Tu turno:</b> Selecciona una carta y pulsa «Tirar carta» o «Cerrar»') : `⏳ Turno de <b>${curPlayer}</b> (${T.phase === 'draw' ? 'robando...' : 'descartando...'})`}</div>
          ${T.lastMsg ? `<div class="banner-subtext">${esc(T.lastMsg)}</div>` : ''}
        </div>
      </div>

      <!-- Mi Mano de Cartas -->
      <div class="my-hand-section">
        <div class="hand-header">
          <div class="hand-owner">Tu Mano (${esc(myName)})</div>
          <div class="hand-badges">${meldsBadgeHTML}</div>
          ${pointsBadge}
        </div>
        
        <div class="cards-fan">
          ${myHand.map(c => renderCardSVG(c, false, c.id === window._selectedHandCardId, c.id === T.drawnCard?.id)).join('')}
        </div>

        ${actionsHTML}
      </div>

      ${roundEndModalHTML}
    </div>
  `;
}

function renderRoundEndModal(summary) {
  const evals = summary.evals || {};
  return `
    <div class="round-end-overlay">
      <div class="round-end-card">
        <div class="round-end-title">
          <span>🏆 ¡Mano cerrada por ${esc(summary.closer)}!</span>
        </div>
        <p class="muted" style="margin:4px 0 14px">Resultado y puntos calculados automáticamente para el marcador:</p>
        
        <div class="round-end-players">
          ${Object.keys(evals).map(name => {
            const ev = evals[name];
            const isCloser = name === summary.closer;
            return `
              <div class="round-player-row ${isCloser ? 'closer-row' : ''}">
                <div class="row between">
                  <b>${esc(name)} ${isCloser ? '🚪 (Cerró)' : ''}</b>
                  <b style="font-size:1.15rem;color:${ev.finalScore <= 0 ? 'var(--ok)' : 'var(--accent)'}">${ev.finalScore > 0 ? '+' + ev.finalScore : ev.finalScore} pts</b>
                </div>
                <div class="round-cards-preview">
                  ${(ev.melds || []).map(m => `
                    <div class="meld-group">
                      ${m.map(c => `<span class="mini-card ${c.suit}">${c.isJoker ? '🃏' : c.num + SUIT_INFOS[c.suit].symbol}</span>`).join('')}
                    </div>
                  `).join(' ')}
                  ${ev.unmelded.length ? `
                    <div class="unmelded-group">
                      <span class="muted" style="font-size:.72rem">Sueltas:</span>
                      ${ev.unmelded.map(c => `<span class="mini-card loose ${c.suit}">${c.isJoker ? '🃏' : c.num + SUIT_INFOS[c.suit].symbol}</span>`).join('')}
                    </div>
                  ` : '<span style="color:var(--ok);font-size:.78rem">¡Todas ligadas!</span>'}
                </div>
                ${ev.penalized ? '<div style="color:var(--accent);font-size:.78rem;font-weight:700">⚠️ Penalizado con +25 pts por no superar a los rivales</div>' : ''}
              </div>
            `;
          }).join('')}
        </div>

        <button class="btn block" style="margin-top:14px;background:#1e4620;border-color:#1e4620" onclick="handleNextCardRound()">🂠 Siguiente Mano ›</button>
      </div>
    </div>
  `;
}
