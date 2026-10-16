'use strict';
// Scopa (Italian 40-card deck) for 2 to 4 players. card = suit*10 + (value-1); suit 2 = coins (denari).
//  - 2 or 3 players play for themselves; 4 players play as two teams, seats a+c against b+d (partners sit opposite).
//  - Three cards each, four cards face up on the table. A card that matches a table card in value must take that card
//    (if there are several, you choose); otherwise it may take any set of table cards adding up to its value; otherwise it stays on the table.
//  - Clearing the table is a scopa (1 point), except with the very last card of the deal.
//  - At the end of a deal (deck and hands empty): left-over table cards go to the last player who captured.
//    Points: most cards, most coins, the seven of coins, the best primiera, and every scopa. Ties give no point.
//  - Deals go on until someone has 11 or more points (and leads alone), or after 12 deals; the highest score wins, equal top scores share.
const crypto = require('crypto');
const TARGET = 11, MAXDEALS = 12;
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const suit = (c) => Math.floor(c / 10), val = (c) => (c % 10) + 1;
const isSeven = (c) => suit(c) === 2 && val(c) === 7;
const prim = (c) => [16, 12, 13, 14, 15, 18, 21, 10, 10, 10][c % 10];

const entitiesOf = (n) => (n === 4 ? [[0, 2], [1, 3]] : Array.from({ length: n }, (_, i) => [i]));
const entOf = (n, s) => (n === 4 ? s % 2 : s);

function create(n, deckOverride) {
  if (n < 2 || n > 4) throw new Error('scopa is for 2 to 4 players');
  const st = { n, ents: entitiesOf(n), scores: Array(entitiesOf(n).length).fill(0), deal: 0, dealer: n - 1, over: false, winners: null, lastDeal: null, deckOverride: deckOverride || null };
  deal(st);
  return st;
}
function deal(st) {
  let deck, tries = 0;
  do {
    deck = st.deckOverride ? st.deckOverride.slice() : secureShuffle(Array.from({ length: 40 }, (_, i) => i)); tries++;
  } while (!st.deckOverride && deck.slice(0, 4).filter((c) => val(c) === 10).length >= 3 && tries < 20);   // never start with 3+ kings on the table
  st.table = deck.slice(0, 4); st.hands = []; st.deck = deck.slice(4);
  for (let i = 0; i < st.n; i++) st.hands.push(st.deck.splice(0, 3));
  st.cap = Array.from({ length: st.n }, () => []); st.scopas = Array(st.ents.length).fill(0); st.lastCap = -1;
  st.deal++; st.dealer = (st.dealer + 1) % st.n; st.turn = (st.dealer + 1) % st.n; st.event = null;
}
// all ways the card in hand slot hi can take cards: list of arrays of table indexes ([] = leave it on the table)
function options(st, s, hi) {
  const c = st.hands[s][hi]; if (c == null || st.over || st.turn !== s) return [];
  const v = val(c), same = [];
  st.table.forEach((t, i) => { if (val(t) === v) same.push([i]); });
  if (same.length) return same;
  const out = [], vs = st.table.map(val);
  (function dfs(i, sum, picked) {
    if (sum === v) { out.push(picked.slice()); return; }
    if (sum > v || i >= vs.length) return;
    for (let k = i; k < vs.length; k++) { picked.push(k); dfs(k + 1, sum + vs[k], picked); picked.pop(); }
  })(0, 0, []);
  return out.length ? out : [[]];
}
function play(st, s, card, cap) {
  const hi = st.hands[s].indexOf(card); if (hi < 0) return false;
  const key = cap.slice().sort((a, b) => a - b).join(',');
  if (!options(st, s, hi).some((o) => o.join(',') === key)) return false;
  st.hands[s].splice(hi, 1);
  const taken = cap.map((i) => st.table[i]);
  st.event = { seat: s, played: card, taken: taken.slice(), scopa: false };
  if (cap.length) {
    st.table = st.table.filter((_, i) => !cap.includes(i));
    st.cap[s].push(card, ...taken); st.lastCap = s;
    const lastPlay = st.hands.every((h) => !h.length) && !st.deck.length;
    if (!st.table.length && !lastPlay) { st.scopas[entOf(st.n, s)]++; st.event.scopa = true; }
  } else st.table.push(card);
  if (st.hands.every((h) => !h.length)) {
    if (st.deck.length) { for (let i = 0; i < st.n; i++) st.hands[i] = st.deck.splice(0, 3); }
    else { endDeal(st); return true; }
  }
  st.turn = (s + 1) % st.n;
  return true;
}
function bestOf(vals) { const top = Math.max(...vals); const w = vals.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0); return w.length === 1 ? w[0] : -1; }
function endDeal(st) {
  if (st.table.length && st.lastCap >= 0) { st.cap[st.lastCap].push(...st.table); st.table = []; }
  const E = st.ents.length;
  const pile = st.ents.map((m) => m.flatMap((s) => st.cap[s]));
  const counts = pile.map((p) => p.length), coins = pile.map((p) => p.filter((c) => suit(c) === 2).length);
  const prims = pile.map((p) => { let sum = 0; for (let su = 0; su < 4; su++) { let m = 0; p.forEach((c) => { if (suit(c) === su) m = Math.max(m, prim(c)); }); sum += m; } return sum; });
  const rows = { cards: bestOf(counts), coins: bestOf(coins), seven: pile.findIndex((p) => p.some(isSeven)), prim: bestOf(prims) };
  const gain = Array(E).fill(0);
  ['cards', 'coins', 'seven', 'prim'].forEach((k) => { if (rows[k] >= 0) gain[rows[k]]++; });
  for (let e = 0; e < E; e++) { gain[e] += st.scopas[e]; st.scores[e] += gain[e]; }
  st.lastDeal = { deal: st.deal, rows, counts, coins, prims, scopas: st.scopas.slice(), gain, scores: st.scores.slice() };
  const top = Math.max(...st.scores), leaders = st.scores.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
  if ((top >= TARGET && leaders.length === 1) || st.deal >= MAXDEALS) {
    st.over = true; st.winners = leaders.flatMap((e) => st.ents[e]).sort((a, b) => a - b);
    return;
  }
  deal(st);
}
const actors = (st) => (st.over ? [] : [st.turn]);
function legal(st, s) {
  if (st.over || st.turn !== s) return [];
  const out = [], seen = new Set();
  st.hands[s].forEach((card, hi) => options(st, s, hi).forEach((cap) => { const k = card + ':' + cap.join(','); if (!seen.has(k)) { seen.add(k); out.push({ t: 'play', card, cap }); } }));
  return out;
}
function find(st, mv, s) {
  if (!mv || mv.t !== 'play' || !Array.isArray(mv.cap) || !mv.cap.every((i) => Number.isInteger(i))) return null;
  const key = mv.cap.slice().sort((a, b) => a - b).join(',');
  return legal(st, s).find((m) => m.card === mv.card && m.cap.slice().sort((a, b) => a - b).join(',') === key) || null;
}
function apply(st, mv) { play(st, st.turn, mv.card, mv.cap); return st; }
function auto(st, s) {   // take the most cards, else drop the lowest card
  const l = legal(st, s); if (!l.length) return null;
  const taking = l.filter((m) => m.cap.length).sort((a, b) => b.cap.length - a.cap.length);
  if (taking.length) return taking[0];
  return l.slice().sort((a, b) => val(a.card) - val(b.card))[0];
}
module.exports = { create, actors, legal, find, apply, auto, options, entOf, TARGET, MAXDEALS, val, suit };
