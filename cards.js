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
  window._selectedHandCardId = null; // el jugador elige qué tirar (o usa 💡)
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
  if (S.game.mode === 'online' && !window._soloPracticeMode && typeof pushToTargets === 'function') pushToTargets({ target: nextPlayer });

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
    try {
      const T2 = S.game.cardTable;
      const key = T2 && (T2.turn + ':' + T2.phase + ':' + (S.game.rounds ? S.game.rounds.length : 0) + ':' + (T2.discard ? T2.discard.length : 0));
      if (T2 && T2.phase === 'draw' && isMyCardTurn() && window._lastTurnKey !== key) {
        window._lastTurnKey = key;
        toast('🟢 ¡Te toca jugar!', 2500);
        vibrate([60, 40, 60]);
        if (typeof playChatSound === 'function') playChatSound();
        if (document.hidden && typeof notifyChatMessage === 'function') notifyChatMessage('Chinchón', '¡Te toca jugar!');
      }
    } catch (e) {}
    if (d.action === 'close') {
      playCardAudio('close');
      vibrate([80, 50, 100]);
    } else if (d.action === 'draw' || d.action === 'discard') {
      playCardAudio(d.action);
    }
  }
};

// ==========================================
// 9. BARAJA ESPAÑOLA ESTILO FOURNIER (SVG) Y TAPETE
// ==========================================
const FC_PAL = {
  oros:    { main: '#c9971c', alt: '#b3261e', ink: '#7a5200', text: '#8a5a00', light: '#fbf1cf' },
  copas:   { main: '#c8322b', alt: '#e8b923', ink: '#6e130f', text: '#b3261e', light: '#fbe3df' },
  espadas: { main: '#2b5d9b', alt: '#e8b923', ink: '#1d3557', text: '#1d4e89', light: '#dfe9f5' },
  bastos:  { main: '#3f7f3a', alt: '#b3261e', ink: '#1f4a1b', text: '#2f6b2b', light: '#e1f0dc' }
};

function ensureCardDefs() {
  try {
    if (document.getElementById('fc-defs')) return;
    const holder = document.createElement('div');
    holder.id = 'fc-defs';
    holder.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    holder.innerHTML = `<svg width="0" height="0" xmlns="http://www.w3.org/2000/svg"><defs>
      <radialGradient id="gOro" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff3b0"/><stop offset="1" stop-color="#e0a81c"/></radialGradient>
      <pattern id="fcbk" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M6 0 L12 6 L6 12 L0 6 Z" fill="none" stroke="#e8b923" stroke-width="1"/></pattern>
      <symbol id="fp-oros" viewBox="0 0 40 40" overflow="visible">
        <circle cx="20" cy="20" r="18" fill="url(#gOro)" stroke="#6b4a00" stroke-width="2"/>
        <circle cx="20" cy="20" r="13" fill="none" stroke="#6b4a00" stroke-width="1.4"/>
        <circle cx="20" cy="20" r="7" fill="#f3cf5a" stroke="#6b4a00" stroke-width="1.4"/>
        <circle cx="20" cy="20" r="2.2" fill="#6b4a00"/>
        <g fill="#6b4a00"><circle cx="35.5" cy="20" r="1.2"/><circle cx="30.96" cy="30.96" r="1.2"/><circle cx="20" cy="35.5" r="1.2"/><circle cx="9.04" cy="30.96" r="1.2"/><circle cx="4.5" cy="20" r="1.2"/><circle cx="9.04" cy="9.04" r="1.2"/><circle cx="20" cy="4.5" r="1.2"/><circle cx="30.96" cy="9.04" r="1.2"/></g>
      </symbol>
      <symbol id="fp-copas" viewBox="0 0 40 40" overflow="visible">
        <path d="M7 5 H33 C33 19 27 25 20 25 C13 25 7 19 7 5 Z" fill="#c8322b" stroke="#6e130f" stroke-width="2" stroke-linejoin="round"/>
        <path d="M7 5 H33" stroke="#e8b923" stroke-width="3"/>
        <path d="M12 9 C12 16 15 20 19 21" fill="none" stroke="#f4a09b" stroke-width="1.6" stroke-linecap="round"/>
        <rect x="18" y="25" width="4" height="8" fill="#e8b923" stroke="#6e130f" stroke-width="1.4"/>
        <ellipse cx="20" cy="35" rx="9" ry="3" fill="#e8b923" stroke="#6e130f" stroke-width="1.6"/>
      </symbol>
      <symbol id="fp-espadas" viewBox="0 0 40 40" overflow="visible">
        <path d="M20 1 C27 9 26 20 23.5 27 H16.5 C14 20 13 9 20 1 Z" fill="#dfe6ec" stroke="#1d3557" stroke-width="1.8" stroke-linejoin="round"/>
        <path d="M20 4 V26" stroke="#8aa0b4" stroke-width="1.2"/>
        <path d="M8 28 Q20 24 32 28 L31 31 H9 Z" fill="#2b5d9b" stroke="#1d3557" stroke-width="1.6" stroke-linejoin="round"/>
        <rect x="18" y="31" width="4" height="6" fill="#7a4a1d" stroke="#1d3557" stroke-width="1.2"/>
        <circle cx="20" cy="38" r="2.2" fill="#e8b923" stroke="#1d3557" stroke-width="1"/>
      </symbol>
      <symbol id="fp-bastos" viewBox="0 0 40 40" overflow="visible">
        <g transform="rotate(18 20 20)">
          <path d="M14 8 C14 2 26 2 26 8 L25 30 C25 37 15 37 15 30 Z" fill="#4c9a43" stroke="#1f4a1b" stroke-width="2" stroke-linejoin="round"/>
          <circle cx="14.5" cy="14" r="3.4" fill="#3b7d34" stroke="#1f4a1b" stroke-width="1.4"/>
          <circle cx="25.5" cy="21" r="3.4" fill="#3b7d34" stroke="#1f4a1b" stroke-width="1.4"/>
          <circle cx="14.8" cy="27" r="3" fill="#3b7d34" stroke="#1f4a1b" stroke-width="1.4"/>
          <path d="M19 6 V31" stroke="#8ccf82" stroke-width="1.4" stroke-linecap="round"/>
        </g>
      </symbol>
    </defs></svg>`;
    document.body.appendChild(holder);
  } catch (e) {}
}

const FC_PIPS = {
  1: { s: 62, p: [[50, 75]] },
  2: { s: 38, p: [[50, 42], [50, 108]] },
  3: { s: 34, p: [[50, 38], [50, 75], [50, 112]] },
  4: { s: 34, p: [[33, 44], [67, 44], [33, 106], [67, 106]] },
  5: { s: 32, p: [[33, 44], [67, 44], [50, 75], [33, 106], [67, 106]] },
  6: { s: 30, p: [[33, 38], [67, 38], [33, 75], [67, 75], [33, 112], [67, 112]] },
  7: { s: 29, p: [[33, 38], [67, 38], [50, 56], [33, 75], [67, 75], [33, 112], [67, 112]] }
};

function fcCourt(card) {
  const pal = FC_PAL[card.suit];
  const sym = `#fp-${card.suit}`;
  const frame = `<rect x="17" y="24" width="66" height="102" rx="4" fill="${pal.light}" stroke="${pal.ink}" stroke-width="1.4"/>
    <rect x="17" y="24" width="66" height="10" fill="${pal.main}"/><rect x="17" y="116" width="66" height="10" fill="${pal.alt}"/>`;
  const skin = '#f1c9a0';
  if (card.num === 10) { // Sota
    return frame + `
      <rect x="40" y="96" width="8" height="20" fill="#2b2118"/><rect x="52" y="96" width="8" height="20" fill="#2b2118"/>
      <path d="M36 62 L64 62 L68 100 L32 100 Z" fill="${pal.main}" stroke="${pal.ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M35 80 H66" stroke="${pal.alt}" stroke-width="5"/>
      <use href="${sym}" x="63" y="64" width="18" height="18"/>
      <circle cx="50" cy="52" r="9" fill="${skin}" stroke="${pal.ink}" stroke-width="1.3"/>
      <path d="M40 50 Q50 33 60 50 Z" fill="${pal.alt}" stroke="${pal.ink}" stroke-width="1.3"/>
      <path d="M58 43 Q71 36 67 27" stroke="#b3261e" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  }
  if (card.num === 11) { // Caballo
    return frame + `
      <rect x="29" y="106" width="5" height="12" fill="#e9e2d0" stroke="${pal.ink}" stroke-width="1"/><rect x="38" y="106" width="5" height="12" fill="#e9e2d0" stroke="${pal.ink}" stroke-width="1"/>
      <rect x="52" y="106" width="5" height="12" fill="#e9e2d0" stroke="${pal.ink}" stroke-width="1"/><rect x="61" y="106" width="5" height="12" fill="#e9e2d0" stroke="${pal.ink}" stroke-width="1"/>
      <path d="M24 96 Q18 108 24 112" stroke="#6b4a2b" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <ellipse cx="46" cy="98" rx="24" ry="13" fill="#f3efe6" stroke="${pal.ink}" stroke-width="1.4"/>
      <path d="M62 92 L71 70 L82 73 L80 85 L72 87 L68 102 Z" fill="#f3efe6" stroke="${pal.ink}" stroke-width="1.4" stroke-linejoin="round"/>
      <path d="M71 70 Q64 76 66 90" stroke="#6b4a2b" stroke-width="3" fill="none"/>
      <rect x="34" y="92" width="24" height="8" fill="${pal.alt}" stroke="${pal.ink}" stroke-width="1"/>
      <rect x="40" y="66" width="16" height="26" rx="3" fill="${pal.main}" stroke="${pal.ink}" stroke-width="1.3"/>
      <circle cx="48" cy="57" r="7.5" fill="${skin}" stroke="${pal.ink}" stroke-width="1.2"/>
      <path d="M40 55 Q48 40 56 55 Z" fill="${pal.alt}" stroke="${pal.ink}" stroke-width="1.2"/>
      <use href="${sym}" x="18" y="60" width="16" height="16"/>`;
  }
  // Rey
  return frame + `
    <path d="M30 72 L70 72 L78 116 L22 116 Z" fill="${pal.main}" stroke="${pal.ink}" stroke-width="1.4" stroke-linejoin="round"/>
    <path d="M40 72 L60 72 L63 116 L37 116 Z" fill="${pal.alt}" opacity=".85"/>
    <path d="M34 66 H66 L62 79 H38 Z" fill="#fff" stroke="${pal.ink}" stroke-width="1.2"/>
    <g fill="#2b2118"><circle cx="42" cy="72" r="1.3"/><circle cx="50" cy="75" r="1.3"/><circle cx="58" cy="72" r="1.3"/></g>
    <rect x="73" y="58" width="3" height="52" fill="#e8b923" stroke="${pal.ink}" stroke-width=".8"/><circle cx="74.5" cy="56" r="4" fill="#e8b923" stroke="${pal.ink}" stroke-width="1"/>
    <circle cx="50" cy="54" r="10" fill="${skin}" stroke="${pal.ink}" stroke-width="1.3"/>
    <path d="M41 56 Q50 76 59 56 Q50 62 41 56 Z" fill="#e9e2d0" stroke="${pal.ink}" stroke-width="1.1"/>
    <path d="M39 48 L41 33 L46 41 L50 31 L54 41 L59 33 L61 48 Z" fill="#e8b923" stroke="${pal.ink}" stroke-width="1.3" stroke-linejoin="round"/>
    <use href="${sym}" x="24" y="94" width="18" height="18"/>`;
}

function fcFace(card) {
  if (card.isJoker) {
    return `<rect x="1.5" y="1.5" width="97" height="147" rx="8" fill="#f7f0dc" stroke="#2b2118" stroke-width="2"/>
      <rect x="8" y="8" width="84" height="134" rx="4" fill="#efe3f7" stroke="#6b2d8a" stroke-width="1.4"/>
      <path d="M26 66 L38 28 L50 56 L62 28 L74 66 Z" fill="#8e44ad" stroke="#4a1d63" stroke-width="1.6" stroke-linejoin="round"/>
      <circle cx="38" cy="26" r="4.5" fill="#e8b923" stroke="#4a1d63"/><circle cx="62" cy="26" r="4.5" fill="#e8b923" stroke="#4a1d63"/><circle cx="50" cy="54" r="4" fill="#e8b923" stroke="#4a1d63"/>
      <circle cx="50" cy="82" r="18" fill="#f1c9a0" stroke="#4a1d63" stroke-width="1.5"/>
      <circle cx="44" cy="78" r="2.2" fill="#2b2118"/><circle cx="56" cy="78" r="2.2" fill="#2b2118"/>
      <path d="M42 88 Q50 97 58 88" stroke="#b3261e" stroke-width="2.4" fill="none" stroke-linecap="round"/>
      <path d="M26 102 L50 118 L74 102 L68 128 H32 Z" fill="#c8322b" stroke="#6e130f" stroke-width="1.4" stroke-linejoin="round"/>
      <text x="50" y="140" font-size="9.5" font-weight="800" text-anchor="middle" fill="#4a1d63" font-family="Georgia,serif" letter-spacing="1">COMODÍN</text>`;
  }
  const pal = FC_PAL[card.suit];
  const sym = `#fp-${card.suit}`;
  const n = card.num;
  let body = '';
  if (n >= 10) body = fcCourt(card);
  else {
    const L = FC_PIPS[n];
    body = L.p.map(([x, y]) => `<use href="${sym}" x="${x - L.s / 2}" y="${y - L.s / 2}" width="${L.s}" height="${L.s}"/>`).join('');
  }
  const idx = `<text x="11" y="19" font-size="15" font-weight="800" text-anchor="middle" fill="${pal.text}" font-family="Georgia,serif">${n}</text>
    <use href="${sym}" x="4.5" y="21" width="13" height="13"/>`;
  return `<rect x="1.5" y="1.5" width="97" height="147" rx="8" fill="#f7f0dc" stroke="#2b2118" stroke-width="2"/>
    <rect x="5" y="5" width="90" height="140" rx="5" fill="none" stroke="${pal.ink}" stroke-width=".6" opacity=".5"/>
    ${body}${idx}<g transform="rotate(180 50 75)">${idx}</g>`;
}

function fcBack() {
  return `<rect x="1.5" y="1.5" width="97" height="147" rx="8" fill="#f7f0dc" stroke="#2b2118" stroke-width="2"/>
    <rect x="7" y="7" width="86" height="136" rx="4" fill="#1f3b73"/><rect x="7" y="7" width="86" height="136" rx="4" fill="url(#fcbk)"/>
    <rect x="7" y="7" width="86" height="136" rx="4" fill="none" stroke="#e8b923" stroke-width="1.2"/>
    <circle cx="50" cy="75" r="19" fill="#f7f0dc" stroke="#e8b923" stroke-width="2"/><use href="#fp-oros" x="37" y="62" width="26" height="26"/>`;
}

function cardLabel(card) {
  if (!card) return '';
  if (card.isJoker) return 'el Comodín';
  return `${(NUM_NAMES[card.num] || card.num)} de ${SUIT_INFOS[card.suit].name}`;
}

window.fcTap = function (id) {
  window._selectedHandCardId = (window._selectedHandCardId === id) ? null : id;
  playCardAudio('draw');
  render();
};

// opts: { mini, noClick, back }
function renderCardSVG(card, isBack = false, isSelected = false, isDrawn = false, opts = {}) {
  ensureCardDefs();
  const cls = `fc ${opts.mini ? 'mini' : ''} ${isSelected ? 'selected' : ''} ${isDrawn ? 'new-draw' : ''}`;
  if (isBack) return `<div class="fc ${opts.mini ? 'mini' : ''} fc-back"><svg viewBox="0 0 100 150">${fcBack()}</svg></div>`;
  if (!card) return '';
  const click = (opts.mini || opts.noClick) ? '' : `onclick="fcTap('${card.id}')"`;
  return `<div class="${cls}" ${click} data-id="${card.id}" title="${esc(cardLabel(card))}"><svg viewBox="0 0 100 150">${fcFace(card)}</svg></div>`;
}

// ---------- Orden de la mano ----------
window._handMode = 'auto'; // 'auto' (combinaciones agrupadas) | 'suit' | 'num'
const _suitOrder = { oros: 0, copas: 1, espadas: 2, bastos: 3, comodin: 4 };
function _cmpSuit(a, b) { if (a.isJoker) return 1; if (b.isJoker) return -1; return (_suitOrder[a.suit] - _suitOrder[b.suit]) || (NUM_INDEX[a.num] - NUM_INDEX[b.num]); }
function _cmpNum(a, b) { if (a.isJoker) return 1; if (b.isJoker) return -1; return (NUM_INDEX[a.num] - NUM_INDEX[b.num]) || (_suitOrder[a.suit] - _suitOrder[b.suit]); }

function sortHandCards(by) {
  window._handMode = by || 'auto';
  playCardAudio('draw');
  render();
}

function handGroups(hand, ev) {
  if (window._handMode === 'suit') return [{ type: 'free', cards: [...hand].sort(_cmpSuit) }];
  if (window._handMode === 'num') return [{ type: 'free', cards: [...hand].sort(_cmpNum) }];
  const groups = (ev.melds || []).map(m => ({ type: 'meld', cards: [...m].sort(isValidStraight(m) ? _cmpNum : _cmpSuit) }));
  const loose = [...(ev.unmelded || [])].sort(_cmpSuit);
  if (loose.length) groups.push({ type: 'loose', cards: loose });
  return groups;
}

// Mejor carta para tirar (menos puntos sueltos; a igualdad, la más alta)
function bestDiscardChoice(hand) {
  let best = null;
  hand.forEach((c, i) => {
    const rem = hand.filter((_, k) => k !== i);
    const ev = evaluateHand(rem);
    const better = !best || ev.unmeldedScore < best.score || (ev.unmeldedScore === best.score && c.val > best.card.val);
    if (better) best = { card: c, score: ev.unmeldedScore, canClose: ev.canClose, ev };
  });
  return best;
}

function hintDiscard() {
  const T = getCardTable();
  if (!T || T.phase !== 'discard') return;
  const myName = (isAdmin() ? 'Juan' : myPlayerName) || S.game.players[0].name;
  const hand = T.hands[myName] || [];
  if (hand.length !== 8) return;
  const b = bestDiscardChoice(hand);
  window._selectedHandCardId = b.card.id;
  toast(`💡 Te sobra ${cardLabel(b.card)}${b.canClose ? ' · ¡y puedes cerrar!' : ''}`);
  render();
}

function closeHandSmart() {
  const T = getCardTable();
  if (!T || T.phase !== 'discard') return;
  const myName = (isAdmin() ? 'Juan' : myPlayerName) || S.game.players[0].name;
  const hand = T.hands[myName] || [];
  let pick = null;
  if (window._selectedHandCardId) {
    const rem = hand.filter(c => c.id !== window._selectedHandCardId);
    if (evaluateHand(rem).canClose) pick = window._selectedHandCardId;
  }
  if (!pick) {
    const b = bestDiscardChoice(hand);
    if (b && b.canClose) pick = b.card.id;
  }
  if (!pick) return toast('⚠️ Todavía no puedes cerrar: te sobran demasiados puntos (máximo 5)');
  window._selectedHandCardId = pick;
  handleCardDiscard(true);
}

function discardOnPile() {
  if (!window._selectedHandCardId) return toast('Toca primero la carta de tu mano que quieres tirar');
  handleCardDiscard(false);
}

function renderOppCards(n) {
  const k = Math.min(n, 9);
  let s = '';
  for (let i = 0; i < k; i++) s += `<span class="opp-back" style="left:${i * 7}px"></span>`;
  return `<div class="opp-fan" style="width:${k * 7 + 14}px">${s}</div>`;
}

function renderCardTableUI() {
  ensureCardDefs();
  const G = S.game;
  if (!G) return '';
  const T = getCardTable();
  if (!T) return '';

  const rawName = (isAdmin() ? 'Juan' : myPlayerName) || '';
  let me = G.players.find(p => p.name.toLowerCase() === rawName.toLowerCase());
  if (!me && isHost) me = G.players[0];
  const myName = me ? me.name : rawName;
  const amPlayer = !!me;
  const myHand = amPlayer ? (T.hands[myName] || []) : [];
  const curPlayer = G.players[T.turn]?.name;
  const isMyTurn = amPlayer && isMyCardTurn();
  const phase = T.phase;
  const canDraw = isMyTurn && phase === 'draw';
  const canDiscard = isMyTurn && phase === 'discard';

  const ev = amPlayer ? evaluateHand(myHand.length === 8 ? myHand : myHand) : evaluateHand([]);
  const best = (canDiscard && myHand.length === 8) ? bestDiscardChoice(myHand) : null;
  const selCard = myHand.find(c => c.id === window._selectedHandCardId) || null;
  if (!selCard) window._selectedHandCardId = null;

  // Rivales
  const opponents = G.players.filter(p => !me || p.name !== me.name);
  const opponentsHTML = opponents.map(p => {
    const pHand = T.hands[p.name] || [];
    const theirTurn = curPlayer === p.name && phase !== 'round_ended';
    return `<div class="opp-chip ${theirTurn ? 'active-turn' : ''} ${p.out ? 'out' : ''}">
      ${p.out ? '<div class="opp-avatar">💀</div>' : renderOppCards(pHand.length)}
      <div class="opp-info">
        <div class="opp-name">${esc(p.name)}</div>
        <div class="opp-cards-count">${p.out ? 'Eliminado' : `${p.score} pts${theirTurn ? (phase === 'draw' ? ' · robando…' : ' · tirando…') : ''}`}</div>
      </div>
    </div>`;
  }).join('');

  // Mazo y descarte
  const top = T.discard[T.discard.length - 1];
  const under = T.discard.slice(-3, -1);
  const deckHTML = `<div class="pile ${canDraw ? 'pile-glow' : ''}" onclick="${canDraw ? "handleCardDraw('deck')" : ''}">
      <div class="pile-cards"><div class="pile-shadow"></div>${renderCardSVG(null, true)}<span class="deck-count">${T.deck.length}</span></div>
      <div class="pile-label">${canDraw ? '👆 ROBAR' : 'Mazo'}</div>
    </div>`;
  const discardClick = canDraw && top ? "handleCardDraw('discard')" : (canDiscard ? 'discardOnPile()' : '');
  const discardHTML = `<div class="pile ${(canDraw && top) || canDiscard ? 'pile-glow' : ''} ${canDiscard ? 'pile-drop' : ''}" onclick="${discardClick}">
      <div class="pile-cards">
        ${under.map((c, i) => `<div class="pile-under" style="transform:translate(${(i - 1) * 6 - 4}px,0) rotate(${(i - 1) * 9 - 4}deg)">${renderCardSVG(c, false, false, false, { noClick: true })}</div>`).join('')}
        ${top ? renderCardSVG(top, false, false, false, { noClick: true }) : '<div class="empty-pile">Vacío</div>'}
      </div>
      <div class="pile-label">${canDraw && top ? '👆 COGER' : (canDiscard ? '👇 TIRAR AQUÍ' : 'Descarte')}</div>
    </div>`;

  // Instrucciones claras por paso
  let step = '';
  if (phase === 'round_ended') step = '🏁 Mano terminada';
  else if (canDraw) step = '<span class="step on">① Roba</span><span class="step">② Tira</span>';
  else if (canDiscard) step = '<span class="step done">① Roba ✓</span><span class="step on">② Tira o cierra</span>';
  else step = `⏳ Juega <b>${esc(curPlayer || '')}</b>`;

  let helpTxt = '';
  if (canDraw) helpTxt = 'Toca el <b>mazo</b> (carta nueva) o el <b>descarte</b> (la última carta tirada).';
  else if (canDiscard) helpTxt = selCard ? `Has elegido <b>${esc(cardLabel(selCard))}</b>. Toca «Tirar» o el montón de descarte.` : 'Toca la carta de tu mano que quieres <b>tirar</b>. ¿Dudas? Pulsa 💡.';
  else if (phase !== 'round_ended') helpTxt = 'Mientras esperas puedes ordenar tu mano.';

  const bannerHTML = `<div class="ft-banner ${isMyTurn ? 'mine' : ''}">
      <div class="ft-steps">${step}</div>
      ${helpTxt ? `<div class="ft-help">${helpTxt}</div>` : ''}
      ${T.lastMsg ? `<div class="ft-last">${esc(T.lastMsg)}</div>` : ''}
    </div>`;

  // Mi mano agrupada
  let handHTML = '';
  if (amPlayer) {
    const groups = handGroups(myHand, ev);
    handHTML = groups.map(g => `<div class="hgroup ${g.type}">
        <div class="hgroup-cards">${g.cards.map(c => renderCardSVG(c, false, c.id === window._selectedHandCardId, c.id === T.drawnCard?.id && phase === 'discard')).join('')}</div>
        ${g.type === 'meld' ? '<div class="hgroup-tag ok">✔ ligadas</div>' : (g.type === 'loose' ? '<div class="hgroup-tag">sueltas</div>' : '')}
      </div>`).join('');
  }

  // Acciones
  let actions = '';
  if (amPlayer && canDiscard) {
    actions = `<div class="ft-actions">
        <button class="ft-btn primary ${selCard ? '' : 'off'}" onclick="discardOnPile()">📤 ${selCard ? 'Tirar ' + esc(cardLabel(selCard)) : 'Elige una carta para tirar'}</button>
        ${best && best.canClose ? `<button class="ft-btn close" onclick="closeHandSmart()">🚪 CERRAR LA MANO · quedan ${best.score} pts</button>` : ''}
        <button class="ft-btn ghost" onclick="hintDiscard()">💡 Pista</button>
      </div>`;
  } else if (amPlayer && canDraw) {
    actions = `<div class="ft-actions">
        <button class="ft-btn primary" onclick="handleCardDraw('deck')">🂠 Robar del mazo</button>
        <button class="ft-btn ${top ? 'primary alt' : 'off'}" onclick="handleCardDraw('discard')">📥 Coger ${top ? esc(cardLabel(top)) : 'descarte'}</button>
      </div>`;
  }

  const sortBar = amPlayer ? `<div class="ft-sort">
      <button class="${window._handMode === 'auto' ? 'on' : ''}" onclick="sortHandCards('auto')">✨ Agrupar</button>
      <button class="${window._handMode === 'suit' ? 'on' : ''}" onclick="sortHandCards('suit')">Por palo</button>
      <button class="${window._handMode === 'num' ? 'on' : ''}" onclick="sortHandCards('num')">Por número</button>
    </div>` : '';

  const handSection = amPlayer ? `
    <div class="my-hand-section">
      <div class="hand-header">
        <div class="hand-owner">Tu mano · ${esc(myName)}</div>
        <div class="hand-score-pill ${ev.canClose && myHand.length === 7 ? 'can-close' : ''}">
          ${myHand.length === 7 ? `Sueltas: <b>${ev.unmeldedScore} pts</b>${ev.canClose ? ' · ¡podrías cerrar!' : ''}` : `${myHand.length} cartas`}
        </div>
      </div>
      <div class="ft-hand">${handHTML}</div>
      ${actions}
      ${sortBar}
    </div>` : `<div class="my-hand-section"><div class="ft-help" style="text-align:center">👁️ Estás viendo la mesa. Puedes seguir la partida y el chat.</div></div>`;

  const roundEndModalHTML = (phase === 'round_ended' && T.roundSummary) ? renderRoundEndModal(T.roundSummary) : '';

  return `
    <div class="felt-table">
      <div class="table-top-bar">
        <div class="view-switcher">
          <button class="switcher-btn active" onclick="window._activeCardView='table';render()">🎴 Tapete</button>
          <button class="switcher-btn" onclick="window._activeCardView='scoreboard';render()">📊 Marcador</button>
        </div>
        <div class="table-header-info" style="display:flex;gap:4px;align-items:center">
          <span class="room-code-badge">${G.mode === 'online' ? 'Sala ' + G.roomCode : 'Mesa'}</span>
          <button class="btn ghost sm" style="color:#f8fafc;border-color:#94a3b8;padding:4px 8px;font-size:.78rem" onclick="openRoomChatModal()">💬</button>
          <button class="btn ghost sm" style="color:#f8fafc;border-color:#94a3b8;padding:4px 8px;font-size:.78rem" onclick="toggleSoloPracticeMode()">${window._soloPracticeMode ? '🤖 Bots ON' : '🤖 Bots'}</button>
        </div>
      </div>

      <div class="opponents-strip">${opponentsHTML}</div>

      <div class="table-center-felt">
        <div class="piles-wrapper">${deckHTML}${discardHTML}</div>
        ${bannerHTML}
      </div>

      ${handSection}
      ${roundEndModalHTML}
    </div>
  `;
}

function renderRoundEndModal(summary) {
  const evals = summary.evals || {};
  const mini = c => renderCardSVG(c, false, false, false, { mini: true });
  return `
    <div class="round-end-overlay">
      <div class="round-end-card">
        <div class="round-end-title"><span>🏆 ¡${esc(summary.closer)} ha cerrado la mano!</span></div>
        <p class="muted" style="margin:4px 0 14px">Puntos calculados automáticamente para el marcador:</p>
        <div class="round-end-players">
          ${Object.keys(evals).map(name => {
            const ev = evals[name];
            const isCloser = name === summary.closer;
            return `
              <div class="round-player-row ${isCloser ? 'closer-row' : ''}">
                <div class="row between">
                  <b>${esc(name)} ${isCloser ? '🚪 (cerró)' : ''}</b>
                  <b style="font-size:1.15rem;color:${ev.finalScore <= 0 ? 'var(--ok)' : 'var(--accent)'}">${ev.finalScore > 0 ? '+' + ev.finalScore : ev.finalScore} pts</b>
                </div>
                <div class="round-cards-preview">
                  ${(ev.melds || []).map(m => `<div class="meld-group">${m.map(mini).join('')}</div>`).join(' ')}
                  ${ev.unmelded.length ? `<div class="unmelded-group"><span class="muted" style="font-size:.72rem">Sueltas:</span>${ev.unmelded.map(mini).join('')}</div>` : '<span style="color:var(--ok);font-size:.78rem">¡Todas ligadas!</span>'}
                </div>
                ${ev.penalized ? '<div style="color:var(--accent);font-size:.78rem;font-weight:700">⚠️ Penalizado por no superar a los rivales</div>' : ''}
              </div>`;
          }).join('')}
        </div>
        <button class="btn block" style="margin-top:14px;background:#1e4620;border-color:#1e4620" onclick="handleNextCardRound()">🂠 Siguiente mano ›</button>
      </div>
    </div>
  `;
}
