'use strict';
// Texas hold'em for 2 to 9 players, played as a small tournament: everybody starts with 1000 chips, the blinds go up
// as the game goes on, and the player who ends with the most chips takes the whole prize pool.
//  - It ends when only one player still has chips, or after `maxHands` hands (then the biggest stack wins; equal stacks share).
//  - Normal betting rules: blinds, check / call / raise, all-in, side pots, split pots (odd chip to the first seat left of the button),
//    a short all-in does not re-open the betting for players who already acted, heads-up: the button posts the small blind.
//  - The deck is shuffled with secure random numbers. At the start of each hand a SHA-256 commitment of (nonce|deck) is shown;
//    when the hand ends the nonce and the deck are revealed so every player can check that the deck was not changed.
//  - Cards: card = suit*13 + rank, rank 0 = deuce ... 12 = ace.
const crypto = require('crypto');
const VG = require('./games1.js'); require('./games2.js');
const best = VG.poker.best;
const START = 1000;
const BLINDS = [[10, 20], [15, 30], [25, 50], [40, 80], [60, 120], [100, 200], [150, 300], [250, 500], [400, 800]];
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const sha = (s) => VG.sha256(s);

function create(n, opts = {}) {
  if (n < 2 || n > 9) throw new Error('poker is for 2 to 9 players');
  const st = { n, stacks: opts.stacks ? opts.stacks.slice() : Array(n).fill(START), hand: opts.hand0 || 0, maxHands: opts.hands || Math.max(10, 3 * n + 4), levelLen: Math.max(3, n), dealer: opts.dealer != null ? opts.dealer : crypto.randomInt(0, n),
    over: false, winners: null, history: [], lastHand: null, h: null, deckOverride: opts.deck || null, fixedDealer: opts.dealer != null ? opts.dealer : null, total: 0 };
  st.total = st.stacks.reduce((a, b) => a + b, 0);
  startHand(st);
  return st;
}
function nextWhere(st, from, pred) { for (let k = 1; k <= st.n; k++) { const s = (from + k) % st.n; if (pred(s)) return s; } return -1; }

function startHand(st) {
  st.hand++;
  const level = Math.min(BLINDS.length - 1, Math.floor((st.hand - 1) / st.levelLen));
  const [sbAmt, bbAmt] = BLINDS[level];
  const inHand = st.stacks.map((x) => x > 0);
  const activeCount = inHand.filter(Boolean).length;
  st.dealer = st.fixedDealer != null ? st.fixedDealer : nextWhere(st, st.dealer, (s) => inHand[s]);
  st.fixedDealer = null;
  let sb, bb;
  if (activeCount === 2) { sb = st.dealer; bb = nextWhere(st, sb, (s) => inHand[s]); }
  else { sb = nextWhere(st, st.dealer, (s) => inHand[s]); bb = nextWhere(st, sb, (s) => inHand[s]); }
  const deck = st.deckOverride ? st.deckOverride.slice() : secureShuffle(Array.from({ length: 52 }, (_, i) => i));
  const nonce = crypto.randomBytes(12).toString('hex');
  const h = { level, sbAmt, bbAmt, sb, bb, deck, nonce, commit: sha(nonce + '|' + deck.join(',')), pos: 0,
    hole: Array.from({ length: st.n }, () => []), board: [], inHand, folded: Array(st.n).fill(false), allin: Array(st.n).fill(false),
    bets: Array(st.n).fill(0), committed: Array(st.n).fill(0), street: 'pre', currentBet: 0, lastRaise: bbAmt, acted: [], fullPending: [],
    pot: 0, turn: -1, log: [], done: false };
  st.h = h;
  for (let r = 0; r < 2; r++) for (let s = 0; s < st.n; s++) if (inHand[s]) h.hole[s].push(h.deck[h.pos++]);
  post(st, sb, sbAmt); post(st, bb, bbAmt);
  h.currentBet = Math.max(h.bets[sb], h.bets[bb]);
  h.log.push([sb, 'sb', h.bets[sb]], [bb, 'bb', h.bets[bb]]);
  h.fullPending = h.inHand.map((x, s) => (x && !h.allin[s] ? s : -1)).filter((s) => s >= 0);
  h.turn = bb;                                              // advance() picks the next player after the big blind: with 3+ players the one left of it, heads-up the button (small blind)
  advance(st);
}
function post(st, s, amt) {
  const h = st.h, a = Math.min(amt, st.stacks[s]);
  st.stacks[s] -= a; h.bets[s] += a; h.committed[s] += a; if (st.stacks[s] === 0) h.allin[s] = true;
}
const notFolded = (h) => h.inHand.map((x, s) => (x && !h.folded[s] ? s : -1)).filter((s) => s >= 0);
const canActNow = (h) => notFolded(h).filter((s) => !h.allin[s]);
const toCall = (st, s) => Math.max(0, st.h.currentBet - st.h.bets[s]);

function deal(st, k) { const h = st.h; for (let i = 0; i < k; i++) h.board.push(h.deck[h.pos++]); }

// Move the hand forward until somebody has to act, or the hand is over.
function advance(st) {
  const h = st.h;
  for (let guard = 0; guard < 20 && !h.done; guard++) {
    const nf = notFolded(h);
    if (nf.length === 1) { endHand(st, false); return; }
    const can = canActNow(h);
    const pending = can.filter((s) => !h.acted.includes(s) || h.bets[s] < h.currentBet);
    if (pending.length) {
      let t = h.turn; for (let k = 1; k <= st.n; k++) { const s = (t + k) % st.n; if (pending.includes(s)) { h.turn = s; return; } }
    }
    // the street is closed
    h.pot += h.bets.reduce((a, b) => a + b, 0); h.bets.fill(0); h.currentBet = 0; h.lastRaise = h.bbAmt; h.acted = [];
    if (h.street === 'river') { endHand(st, true); return; }
    if (h.street === 'pre') { h.street = 'flop'; deal(st, 3); } else if (h.street === 'flop') { h.street = 'turn'; deal(st, 1); } else { h.street = 'river'; deal(st, 1); }
    const can2 = canActNow(h);
    h.fullPending = can2.slice();
    h.turn = st.dealer;                                     // after the flop the first player left of the button acts
    if (can2.length <= 1) { h.acted = can2.slice(); }       // nobody to bet against: run the board out
  }
}

function endHand(st, showdown) {
  const h = st.h; h.done = true;
  // run the board out if the hand ended early by all-ins
  if (showdown) while (h.board.length < 5) deal(st, 1);
  const nf = notFolded(h);
  // side pots
  const levels = [...new Set(nf.map((s) => h.committed[s]))].sort((a, b) => a - b);
  const pots = []; let prev = 0;
  levels.forEach((L, i) => {
    let amount = 0; for (let s = 0; s < st.n; s++) amount += Math.min(h.committed[s], L) - Math.min(h.committed[s], prev);
    if (i === levels.length - 1) for (let s = 0; s < st.n; s++) if (h.folded[s] || !h.inHand[s]) amount += Math.max(0, h.committed[s] - L);   // chips of folded players above the top level
    const eligible = nf.filter((s) => h.committed[s] >= L);
    if (amount > 0) pots.push({ amount, eligible, winners: [] });
    prev = L;
  });
  const score = {}; if (nf.length > 1) nf.forEach((s) => { score[s] = best(h.hole[s].concat(h.board)); });
  const won = Array(st.n).fill(0);
  const order = []; for (let k = 1; k <= st.n; k++) order.push((st.dealer + k) % st.n);
  for (const p of pots) {
    let w = p.eligible;
    if (w.length > 1) { const top = Math.max(...w.map((s) => score[s])); w = w.filter((s) => score[s] === top); }
    p.winners = w;
    const each = Math.floor(p.amount / w.length); let rest = p.amount - each * w.length;
    for (const s of order) if (w.includes(s)) { won[s] += each + (rest > 0 ? 1 : 0); if (rest > 0) rest--; }
  }
  for (let s = 0; s < st.n; s++) st.stacks[s] += won[s];
  const winners = won.map((x, s) => (x > 0 && nf.includes(s) ? s : -1)).filter((s) => s >= 0);
  const reveal = nf.length > 1;
  st.lastHand = { hand: st.hand, showdown: reveal, board: h.board.slice(), hole: reveal ? h.hole.map((c, s) => (nf.includes(s) ? c.slice() : null)) : null,
    names: reveal ? Object.fromEntries(nf.map((s) => [s, VG.poker.handName(score[s])])) : null,
    pots: pots.map((p) => ({ amount: p.amount, winners: p.winners.slice() })), won: won.slice(), folded: h.folded.slice(), nonce: h.nonce, deck: h.deck.slice(), commit: h.commit, stacks: st.stacks.slice(), level: h.level };
  st.history.push({ hand: st.hand, winners, won: won.slice() });
  if (st.history.length > 60) st.history.shift();
  const active = st.stacks.filter((x) => x > 0).length;
  if (active <= 1 || st.hand >= st.maxHands) {
    st.over = true; const top = Math.max(...st.stacks); st.winners = st.stacks.map((x, s) => (x === top ? s : -1)).filter((s) => s >= 0);
    return;
  }
  startHand(st);
}

function raiseRange(st, s) {
  const h = st.h; if (st.over || h.done || h.turn !== s || h.folded[s] || h.allin[s]) return null;
  const stack = st.stacks[s]; if (stack <= toCall(st, s)) return null;
  if (!h.fullPending.includes(s)) return null;               // betting was not re-opened for this player (short all-in)
  const max = h.bets[s] + stack, min = Math.min(h.currentBet + h.lastRaise, max);
  return { min, max };
}
function legal(st, s) {
  const h = st.h; if (st.over || h.done || h.turn !== s) return [];
  const out = [], tc = toCall(st, s);
  if (tc > 0) out.push({ t: 'fold' }); else out.push({ t: 'check' });
  if (tc > 0) out.push({ t: 'call', amount: Math.min(tc, st.stacks[s]) });
  const rg = raiseRange(st, s); if (rg) out.push({ t: 'raise', min: rg.min, max: rg.max });
  return out;
}
function find(st, mv, s) {
  if (!mv) return null;
  const l = legal(st, s);
  if (mv.t === 'fold' || mv.t === 'check' || mv.t === 'call') { const x = l.find((m) => m.t === mv.t); return x ? { t: mv.t } : null; }
  if (mv.t === 'raise') { const x = l.find((m) => m.t === 'raise'); return x && Number.isInteger(mv.to) && mv.to >= x.min && mv.to <= x.max ? { t: 'raise', to: mv.to } : null; }
  return null;
}
function apply(st, mv) {
  const h = st.h, s = h.turn;
  if (mv.t === 'fold') { h.folded[s] = true; h.log.push([s, 'fold', 0]); }
  else if (mv.t === 'check') { h.log.push([s, 'check', 0]); }
  else if (mv.t === 'call') { const a = Math.min(toCall(st, s), st.stacks[s]); post(st, s, a); h.log.push([s, 'call', a]); }
  else {
    const to = mv.to, raiseSize = to - h.currentBet;
    post(st, s, to - h.bets[s]);
    h.log.push([s, h.currentBet === 0 ? 'bet' : 'raise', to]);
    if (to > h.currentBet) {
      if (raiseSize >= h.lastRaise) { h.lastRaise = raiseSize; h.fullPending = canActNow(h).filter((x) => x !== s); }
      h.currentBet = to;
    }
  }
  if (!h.acted.includes(s)) h.acted.push(s);
  h.fullPending = h.fullPending.filter((x) => x !== s);
  advance(st);
  return st;
}
const actors = (st) => (st.over || st.h.done ? [] : [st.h.turn]);
function auto(st, s) { const l = legal(st, s); return l.find((m) => m.t === 'check') || l.find((m) => m.t === 'fold') || l[0] || null; }

module.exports = { create, actors, legal, find, apply, auto, raiseRange, toCall, BLINDS, START };
