'use strict';
// Contract bridge for exactly 4 players: seats a+c (North-South) play against b+d (East-West), seated a, b, c, d clockwise.
// A match is 4 deals (Chicago style). Higher total score wins the pool for BOTH partners; equal totals = draw.
//  - Cards: card = suit*13 + rank, suit 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades; rank 0 = deuce ... 12 = ace.
//  - Bidding: pass / bid (level 1-7 + strain: clubs, diamonds, hearts, spades, no-trump) / double / redouble. The auction ends after
//    three passes following a bid (four passes at the start = the deal is passed out, score 0).
//  - The declarer is the first player of the winning side who named the final strain. The player on declarer's left leads.
//    Then the dummy (declarer's partner) is shown to everybody and the declarer plays both hands.
//  - Scoring is standard duplicate-free "Chicago" scoring: trick score, game bonus 300/500 (part-score 50), small slam 500/750,
//    grand slam 1000/1500, overtricks, undertricks, doubled/redoubled and insult bonuses.
//    Vulnerability by deal: 1 nobody, 2 and 3 the dealer's side, 4 both sides. The dealer rotates a, b, c, d.
const crypto = require('crypto');
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const suit = (c) => Math.floor(c / 13), rank = (c) => c % 13;
const side = (s) => s % 2;                                  // 0 = a+c, 1 = b+d
const DEALS = 4;

function create(n, deckOverride) {
  if (n !== 4) throw new Error('bridge is for exactly 4 players');
  const st = { n: 4, deals: DEALS, deal: 0, dealer: -1, scores: [0, 0], history: [], lastDeal: null, over: false, winners: null, deckOverride: deckOverride || null };
  newDeal(st);
  return st;
}
function newDeal(st) {
  st.deal++; st.dealer = (st.dealer + 1) % 4;
  const ds = side(st.dealer);
  st.vul = st.deal === 1 ? [false, false] : st.deal === 4 ? [true, true] : (ds === 0 ? [true, false] : [false, true]);
  const deck = st.deckOverride ? st.deckOverride.slice() : secureShuffle(Array.from({ length: 52 }, (_, i) => i));
  st.hands = [0, 1, 2, 3].map((s) => deck.slice(s * 13, s * 13 + 13).sort((x, y) => suit(x) - suit(y) || rank(x) - rank(y)));
  st.phase = 'bid'; st.calls = []; st.turn = st.dealer; st.lastBid = null; st.doubled = 0; st.contract = null;
  st.trick = []; st.lastTrick = null; st.tricksWon = [0, 0]; st.played = 0; st.dummyShown = false; st.led = null;
}
const bidValue = (b) => b.level * 5 + b.strain;
const STRAINS = ['C', 'D', 'H', 'S', 'NT'];

function bidLegal(st, s) {
  const out = [{ t: 'pass' }];
  const min = st.lastBid ? bidValue(st.lastBid) + 1 : 5;    // 1C
  for (let v = min; v <= 7 * 5 + 4; v++) out.push({ t: 'bid', level: Math.floor(v / 5), strain: v % 5 });
  if (st.lastBid && side(st.lastBid.seat) !== side(s) && st.doubled === 0) out.push({ t: 'double' });
  if (st.lastBid && side(st.lastBid.seat) === side(s) && st.doubled === 1) out.push({ t: 'redouble' });
  return out;
}
function call(st, s, c) {
  st.calls.push({ seat: s, call: c });
  if (c.t === 'bid') { st.lastBid = { level: c.level, strain: c.strain, seat: s }; st.doubled = 0; }
  else if (c.t === 'double') st.doubled = 1; else if (c.t === 'redouble') st.doubled = 2;
  const n = st.calls.length, tail = st.calls.slice(-3);
  if (n === 4 && st.calls.every((x) => x.call.t === 'pass')) { endDeal(st, null); return; }
  if (st.lastBid && n >= 4 - 0 && tail.length === 3 && tail.every((x) => x.call.t === 'pass')) {
    const b = st.lastBid, decl = st.calls.find((x) => x.call.t === 'bid' && x.call.strain === b.strain && side(x.seat) === side(b.seat)).seat;
    st.contract = { level: b.level, strain: b.strain, doubled: st.doubled, declarer: decl, dummy: (decl + 2) % 4 };
    st.phase = 'play'; st.turn = (decl + 1) % 4; st.led = null; st.trick = [];
    return;
  }
  st.turn = (s + 1) % 4;
}
function playLegal(st, s) {
  const h = st.hands[s];
  if (!st.trick.length) return h.slice();
  const led = suit(st.trick[0].card), follow = h.filter((c) => suit(c) === led);
  return follow.length ? follow : h.slice();
}
function trickWinner(st) {
  const trump = st.contract.strain === 4 ? -1 : st.contract.strain, led = suit(st.trick[0].card);
  let best = st.trick[0];
  for (const p of st.trick.slice(1)) {
    const a = best.card, b = p.card;
    if (suit(b) === suit(a) ? rank(b) > rank(a) : suit(b) === trump) best = p;
  }
  return best.seat;
}
function play(st, s, card) {
  const i = st.hands[s].indexOf(card); st.hands[s].splice(i, 1);
  st.trick.push({ seat: s, card }); st.played++;
  st.dummyShown = true;
  if (st.trick.length < 4) { st.turn = (s + 1) % 4; return; }
  const w = trickWinner(st);
  st.tricksWon[side(w)]++; st.lastTrick = { cards: st.trick.map((p) => ({ seat: p.seat, card: p.card })), winner: w };
  st.trick = [];
  if (st.hands.every((h) => !h.length)) { endDeal(st, st.tricksWon[side(st.contract.declarer)]); return; }
  st.turn = w;
}
const minorOrMajor = (strain) => (strain >= 2 ? 30 : 20);
function scoreDeal(level, strain, doubled, vul, tricks) {
  const need = 6 + level;
  const perTrick = (k) => (strain === 4 ? (k === 0 ? 40 : 30) : minorOrMajor(strain));
  if (tricks >= need) {
    let base = 0; for (let k = 0; k < level; k++) base += perTrick(k);
    base *= doubled === 0 ? 1 : doubled === 1 ? 2 : 4;
    let total = base;
    total += base >= 100 ? (vul ? 500 : 300) : 50;
    if (level === 6) total += vul ? 750 : 500; if (level === 7) total += vul ? 1500 : 1000;
    const over = tricks - need;
    if (doubled === 0) total += over * (strain === 4 ? 30 : minorOrMajor(strain));
    else total += over * (vul ? 200 : 100) * (doubled === 2 ? 2 : 1);
    if (doubled === 1) total += 50; if (doubled === 2) total += 100;
    return total;
  }
  const down = need - tricks; let pen = 0;
  if (doubled === 0) pen = down * (vul ? 100 : 50);
  else {
    for (let k = 1; k <= down; k++) {
      let v;
      if (vul) v = k === 1 ? 200 : 300; else v = k === 1 ? 100 : k <= 3 ? 200 : 300;
      pen += v;
    }
    if (doubled === 2) pen *= 2;
  }
  return -pen;
}
function endDeal(st, tricks) {
  let entry;
  if (!st.contract) entry = { deal: st.deal, passedOut: true, delta: [0, 0], dealer: st.dealer };
  else {
    const c = st.contract, ds = side(c.declarer), pts = scoreDeal(c.level, c.strain, c.doubled, st.vul[ds], tricks);
    const delta = [0, 0]; if (pts >= 0) delta[ds] = pts; else delta[1 - ds] = -pts;
    entry = { deal: st.deal, contract: { ...c }, tricks, made: tricks >= 6 + c.level, delta, dealer: st.dealer, vul: st.vul.slice(), points: pts };
  }
  st.scores[0] += entry.delta[0]; st.scores[1] += entry.delta[1];
  st.history.push(entry); st.lastDeal = entry;
  if (st.deal >= st.deals) { st.over = true; st.phase = 'over'; st.winners = st.scores[0] > st.scores[1] ? [0, 2] : st.scores[1] > st.scores[0] ? [1, 3] : [0, 1, 2, 3]; return; }
  newDeal(st);
}
// who acts now: in the play the declarer also acts for the dummy
const actorSeat = (st) => (st.phase === 'play' && st.contract && st.turn === st.contract.dummy ? st.contract.declarer : st.turn);
const actors = (st) => (st.over ? [] : [actorSeat(st)]);
function legal(st, s) {
  if (st.over || actorSeat(st) !== s) return [];
  if (st.phase === 'bid') return bidLegal(st, s);
  return playLegal(st, st.turn).map((card) => ({ t: 'play', card }));
}
function find(st, mv, s) {
  if (!mv) return null;
  const l = legal(st, s);
  if (mv.t === 'pass' || mv.t === 'double' || mv.t === 'redouble') return l.find((x) => x.t === mv.t) || null;
  if (mv.t === 'bid') return l.find((x) => x.t === 'bid' && x.level === mv.level && x.strain === mv.strain) || null;
  if (mv.t === 'play') return l.find((x) => x.t === 'play' && x.card === mv.card) || null;
  return null;
}
function apply(st, mv) {
  if (st.phase === 'bid') { call(st, st.turn, mv); return st; }
  play(st, st.turn, mv.card); return st;
}
function auto(st, s) {
  const l = legal(st, s); if (!l.length) return null;
  if (st.phase === 'bid') return { t: 'pass' };
  return l.slice().sort((a, b) => rank(a.card) - rank(b.card))[0];
}
module.exports = { create, actors, legal, find, apply, auto, scoreDeal, trickWinner, STRAINS, suit, rank, side, DEALS };
