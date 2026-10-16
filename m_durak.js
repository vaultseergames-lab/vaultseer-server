'use strict';
// Durak (throw-in version) for 2 to 6 players. 36 cards, 6..A. card = suit*9 + rank (rank 0 = six, 8 = ace).
//
// Rules used here
//  - Everybody gets 6 cards. The card under the deck sets the trump. The holder of the lowest trump attacks first.
//  - The attacker leads one card, the defender (the player on his left, i.e. the next seat) beats it or takes the cards.
//  - Every other player (not only the attacker) may throw in a card of a rank that is already on the table, in seat order
//    starting from the attacker. A player who passes may not throw again until a new attack card appears.
//  - At most 6 cards can be thrown in a round, and never more than the defender holds.
//  - When a round ends everybody draws up to 6, the attacker first, the defender last.
//  - After the deck is empty, whoever has no cards at the end of a round WINS. If several players run out in the same round they
//    share the prize. The game never leaves a "fool" standing: the first to get rid of the cards wins everything.
//  - If the defender beat everything he becomes the next attacker. If he took the cards, the next player on his left attacks.
const crypto = require('crypto');
const RANKS = 9;
const rank = (c) => c % RANKS;
const suit = (c) => Math.floor(c / RANKS);
const beats = (st, def, att) => (suit(def) === suit(att) ? rank(def) > rank(att) : suit(def) === st.trump && suit(att) !== st.trump);
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function create(n, deckOverride) {
  if (n < 2 || n > 6) throw new Error('durak is for 2 to 6 players');
  const deck = deckOverride ? deckOverride.slice() : secureShuffle(Array.from({ length: 36 }, (_, i) => i));
  const st = { n, deck, trumpCard: deck[deck.length - 1], trump: suit(deck[deck.length - 1]), hands: [], table: [], att: 0, def: 1, stage: 'attack', taking: false, thrower: 0, passed: [],
    startHand: 6, limit: 6, over: false, winners: null, round: 1, lastRound: null, discarded: 0 };
  for (let i = 0; i < n; i++) st.hands.push([]);
  for (let k = 0; k < 6; k++) for (let i = 0; i < n; i++) st.hands[i].push(st.deck.shift());
  let low = 99, who = 0;
  st.hands.forEach((h, i) => h.forEach((c) => { if (suit(c) === st.trump && rank(c) < low) { low = rank(c); who = i; } }));
  if (low === 99) who = crypto.randomInt(0, n);
  st.att = who;
  startRound(st);
  return st;
}
const nextSeat = (st, s) => (s + 1) % st.n;
function startRound(st) {
  st.def = nextSeat(st, st.att);
  st.table = []; st.taking = false; st.stage = 'attack'; st.thrower = st.att; st.passed = [];
  st.startHand = st.hands[st.def].length; st.limit = Math.min(6, st.startHand);
}
// throwers in order: the attacker first, then clockwise, never the defender, only players who still hold cards
function throwers(st) {
  const out = []; for (let k = 0, s = st.att; k < st.n; k++, s = nextSeat(st, s)) if (s !== st.def && st.hands[s].length) out.push(s);
  return out;
}
const undefended = (st) => st.table.map((p, i) => (p.d == null ? i : -1)).filter((i) => i >= 0);
function ranksOnTable(st) { const r = new Set(); st.table.forEach((p) => { r.add(rank(p.a)); if (p.d != null) r.add(rank(p.d)); }); return r; }
// cards the given seat may throw/lead now
function attackCards(st, s) {
  if (st.over || st.stage !== 'attack' || st.thrower !== s || s === st.def) return [];
  if (st.table.length >= st.limit) return [];
  if (!st.taking && undefended(st).length + 1 > st.hands[st.def].length) return [];
  if (!st.table.length) return s === st.att ? st.hands[s].slice() : [];
  const r = ranksOnTable(st); return st.hands[s].filter((c) => r.has(rank(c)));
}
const canPass = (st, s) => !st.over && st.stage === 'attack' && st.thrower === s && st.table.length > 0;

function endRound(st) {
  const taken = st.taking;
  const cards = []; st.table.forEach((p) => { cards.push(p.a); if (p.d != null) cards.push(p.d); });
  if (taken) st.hands[st.def].push(...cards); else st.discarded += cards.length;
  st.lastRound = { round: st.round, att: st.att, def: st.def, taken, cards: st.table.map((p) => ({ a: p.a, d: p.d })) };
  st.table = [];
  // draw up to 6: attacker first, then clockwise, defender last
  const order = []; for (let k = 0, s = st.att; k < st.n; k++, s = nextSeat(st, s)) if (s !== st.def) order.push(s);
  order.push(st.def);
  for (const s of order) while (st.hands[s].length < 6 && st.deck.length) st.hands[s].push(st.deck.shift());
  if (!st.deck.length) {
    const empty = []; st.hands.forEach((h, i) => { if (!h.length) empty.push(i); });
    if (empty.length) { st.over = true; st.winners = empty; st.stage = 'over'; return; }
  }
  st.att = taken ? nextSeat(st, st.def) : st.def;
  st.round++;
  startRound(st);
  skipIdle(st);
}
// Players who cannot throw anything pass by themselves, so nobody has to press "pass" with no choice.
function skipIdle(st) {
  for (let guard = 0; guard < 40 && !st.over; guard++) {
    if (st.stage === 'defend') return;
    const defDone = !st.taking && !undefended(st).length;
    if (st.table.length && (st.table.length >= st.limit || (defDone && !st.hands[st.def].length))) { endRound(st); return; }
    if (!st.table.length) return;                          // the attacker must lead
    if (attackCards(st, st.thrower).length) return;        // the thrower has a real choice
    st.passed.push(st.thrower);
    const rest = throwers(st).filter((s) => !st.passed.includes(s));
    if (!rest.length) { endRound(st); return; }
    st.thrower = rest[0];
  }
}

function attack(st, s, card) {
  if (!attackCards(st, s).includes(card)) return false;
  const h = st.hands[s]; h.splice(h.indexOf(card), 1);
  st.table.push({ a: card, d: null }); st.passed = [];
  if (!st.taking) st.stage = 'defend';
  skipIdle(st);
  return true;
}
function defend(st, s, idx, card) {
  const p = st.table[idx];
  if (st.over || st.stage !== 'defend' || s !== st.def || !p || p.d != null || !st.hands[s].includes(card) || !beats(st, card, p.a)) return false;
  st.hands[s].splice(st.hands[s].indexOf(card), 1); p.d = card;
  if (!undefended(st).length) { st.stage = 'attack'; st.thrower = st.att; st.passed = []; }
  skipIdle(st);
  return true;
}
function take(st, s) {
  if (st.over || st.stage !== 'defend' || s !== st.def) return false;
  st.taking = true; st.stage = 'attack'; st.thrower = st.att; st.passed = [];
  skipIdle(st);
  return true;
}
function pass(st, s) {
  if (!canPass(st, s)) return false;
  st.passed.push(s);
  const rest = throwers(st).filter((x) => !st.passed.includes(x));
  if (!rest.length) { endRound(st); return true; }
  st.thrower = rest[0];
  skipIdle(st);
  return true;
}

const actors = (st) => (st.over ? [] : st.stage === 'defend' ? [st.def] : [st.thrower]);
function legal(st, s) {
  if (st.over) return [];
  const out = [];
  if (st.stage === 'defend' && s === st.def) {
    out.push({ t: 'take' });
    for (const i of undefended(st)) for (const card of st.hands[s]) if (beats(st, card, st.table[i].a)) out.push({ t: 'defend', idx: i, card });
    return out;
  }
  for (const card of attackCards(st, s)) out.push({ t: 'attack', card });
  if (canPass(st, s)) out.push({ t: 'finish' });
  return out;
}
function find(st, mv, s) {
  if (!mv || st.over) return null;
  const l = legal(st, s);
  if (mv.t === 'take' || mv.t === 'finish') return l.find((x) => x.t === mv.t) || null;
  if (mv.t === 'attack') return l.find((x) => x.t === 'attack' && x.card === mv.card) || null;
  if (mv.t === 'defend') return l.find((x) => x.t === 'defend' && x.idx === mv.idx && x.card === mv.card) || null;
  return null;
}
function apply(st, mv, s) {
  if (mv.t === 'attack') return attack(st, s, mv.card);
  if (mv.t === 'finish') return pass(st, s);
  if (mv.t === 'take') return take(st, s);
  return defend(st, s, mv.idx, mv.card);
}
// What the server plays for a player who left or ran out of time: the cheapest sensible move.
function auto(st, s) {
  const l = legal(st, s); if (!l.length) return null;
  const take_ = l.find((x) => x.t === 'take'); if (take_) return take_;
  const fin = l.find((x) => x.t === 'finish'); if (fin) return fin;
  const cost = (c) => (suit(c) === st.trump ? 20 : 0) + rank(c);
  return l.slice().sort((x, y) => cost(x.card) - cost(y.card))[0];
}

module.exports = { create, actors, legal, find, apply, auto, attackCards, undefended, beats, rank, suit };
