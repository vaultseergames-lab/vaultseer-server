'use strict';
// Adapters for the games with more than two seats. Same interface as adapters.js, plus:
//   seats: [min, max]     table sizes allowed
//   init(n)               n = number of players
//   team(seat, n)         optional: seats on the same team (bridge)
//   auto(st, seat)        the move the server plays for a player who is out
//   result(st, outMask)   null while playing, else the winners as a bit mask over the seats
// Seats are letters: 'a' = first player ... 'i' = ninth.
const SEATS = 'abcdefghi';
const sideOf = (i) => SEATS[i];
const idx = (s) => SEATS.indexOf(s);
const maskOf = (list) => list.reduce((a, i) => a | (1 << i), 0);

const DKE = require('./m_durak.js');
const durak = {
  id: 'durak', seats: [2, 6], clock: { total: 0, perMove: 60000 },
  init: (n) => DKE.create(n),
  actors: (st) => DKE.actors(st).map(sideOf),
  find: (st, mv, who) => DKE.find(st, mv, idx(who)),
  apply(st, mv) { DKE.apply(st, mv, DKE.actors(st)[0]); return st; },
  result: (st) => (st.over ? maskOf(st.winners) : null),
  auto: (st, who) => DKE.auto(st, idx(who)),
  view(st, who) {
    const s = idx(who), lr = st.lastRound;
    return {
      n: st.n, hand: s >= 0 ? st.hands[s] : null, counts: st.hands.map((h) => h.length), deck: st.deck.length, trump: st.trump,
      trumpCard: st.deck.length ? st.trumpCard : null, discarded: st.discarded, table: st.table, att: sideOf(st.att), def: sideOf(st.def), thrower: sideOf(st.thrower),
      stage: st.stage, taking: st.taking, limit: st.limit, passed: st.passed.map(sideOf), over: st.over, round: st.round,
      winners: st.winners ? st.winners.map(sideOf) : null,
      lastRound: lr ? { round: lr.round, att: sideOf(lr.att), def: sideOf(lr.def), taken: lr.taken, cards: lr.cards } : null,
    };
  },
  legal: (st, who) => DKE.legal(st, idx(who)),
};

// ---------------- poker ----------------
const PKE = require('./m_poker.js');
const poker = {
  id: 'poker', seats: [2, 9], clock: { total: 0, perMove: 45000 }, hidden: true,
  init: (n) => PKE.create(n),
  actors: (st) => PKE.actors(st).map(sideOf),
  find: (st, mv, who) => PKE.find(st, mv, idx(who)),
  apply: (st, mv) => PKE.apply(st, mv),
  // the chip leader among the players who are still in wins; equal stacks share
  result(st, out) {
    if (!st.over) return null;
    const cand = st.stacks.map((x, i) => i).filter((i) => !((out >> i) & 1));
    if (!cand.length) return (1 << st.n) - 1;
    const top = Math.max(...cand.map((i) => st.stacks[i]));
    return maskOf(cand.filter((i) => st.stacks[i] === top));
  },
  auto: (st, who) => PKE.auto(st, idx(who)),
  view(st, who) {
    const s = idx(who), h = st.h, sd = (x) => sideOf(x);
    const showAll = st.over && h.done;
    const v = {
      n: st.n, hand: st.hand, hands: st.maxHands, level: h.level, sb: h.sbAmt, bb: h.bbAmt, dealer: sd(st.dealer), stacks: st.stacks.slice(), over: st.over,
      winners: st.winners ? st.winners.map(sd) : null, lastHand: st.lastHand ? { ...st.lastHand, winnersByPot: undefined, pots: st.lastHand.pots.map((p) => ({ amount: p.amount, winners: p.winners.map(sd) })) } : null,
      history: st.history.slice(-12).map((x) => ({ hand: x.hand, winners: x.winners.map(sd), won: x.won })),
    };
    v.table = { board: h.board, street: h.street, bets: h.bets.slice(), pot: h.pot, turn: h.done ? null : sd(h.turn), folded: h.folded.slice(), allin: h.allin.slice(), inHand: h.inHand.slice(),
      currentBet: h.currentBet, lastRaise: h.lastRaise, commit: h.commit, sbSeat: sd(h.sb), bbSeat: sd(h.bb), log: h.log.slice(-14).map((e) => [sd(e[0]), e[1], e[2]]) };
    if (s >= 0 && h.inHand[s] && !h.folded[s]) v.hole = h.hole[s];
    if (s >= 0 && !h.done) { v.toCall = PKE.toCall(st, s); v.raiseRange = PKE.raiseRange(st, s); }
    return v;
  },
  legal: (st, who) => PKE.legal(st, idx(who)),
};

// ---------------- dominoes ----------------
const DME = require('./m_domino.js');
const domino = {
  id: 'domino', seats: [2, 4], clock: { total: 0, perMove: 60000 },
  init: (n) => DME.create(n),
  actors: (st) => DME.actors(st).map(sideOf),
  find: (st, mv, who) => DME.find(st, mv, idx(who)),
  apply: (st, mv) => { DME.apply(st, mv); return st; },
  result: (st) => (st.over ? maskOf(st.winners) : null),
  auto: (st, who) => DME.auto(st, idx(who)),
  view(st, who) {
    const s = idx(who);
    return { n: st.n, hand: s >= 0 ? st.hands[s] : null, counts: st.hands.map((h) => h.length), yard: st.yard.length, chain: st.chain.map((c) => ({ t: c.t, by: sideOf(c.by) })), ends: st.ends,
      turn: sideOf(st.turn), passes: st.passes, over: st.over, why: st.why, winners: st.winners ? st.winners.map(sideOf) : null,
      pips: st.over ? st.hands.map((h) => h.map((t) => t.slice())) : null, starter: sideOf(st.starter) };
  },
  legal: (st, who) => DME.legal(st, idx(who)),
};

// ---------------- scopa ----------------
const SCE = require('./m_scopa.js');
const scopa = {
  id: 'scopa', seats: [2, 4], clock: { total: 0, perMove: 60000 },
  team: (seat, n) => (n === 4 ? 'ab'[SEATS.indexOf(seat) % 2] : seat),
  init: (n) => SCE.create(n),
  actors: (st) => SCE.actors(st).map(sideOf),
  find: (st, mv, who) => SCE.find(st, mv, idx(who)),
  apply: (st, mv) => SCE.apply(st, mv),
  result: (st) => (st.over ? maskOf(st.winners) : null),
  auto: (st, who) => SCE.auto(st, idx(who)),
  view(st, who) {
    const s = idx(who);
    return { n: st.n, hand: s >= 0 ? st.hands[s] : null, counts: st.hands.map((h) => h.length), table: st.table, deck: st.deck.length, captured: st.cap.map((c) => c.length),
      mine: s >= 0 ? st.cap[s] : null, scopas: st.scopas, scores: st.scores, entities: st.ents.map((m) => m.map(sideOf)), deal: st.deal, dealer: sideOf(st.dealer), turn: sideOf(st.turn),
      event: st.event ? { ...st.event, seat: sideOf(st.event.seat) } : null, over: st.over, winners: st.winners ? st.winners.map(sideOf) : null, lastDeal: st.lastDeal, target: SCE.TARGET };
  },
  legal: (st, who) => SCE.legal(st, idx(who)),
};

// ---------------- memory ----------------
const MEE = require('./m_memory.js');
const memory = {
  id: 'memory', seats: [2, 9], clock: { total: 0, perMove: 90000 }, simultaneous: true, hidden: true,
  init: (n, now) => MEE.create(n, now),
  actors: (st) => MEE.actors(st).map(sideOf),
  find: (st, mv, who, now) => MEE.find(st, mv, idx(who), now),
  apply: (st, both, now) => MEE.apply(st, both, now),
  result: (st) => (st.over ? maskOf(st.winners) : null),
  auto: (st, who) => MEE.auto(st, idx(who)),
  // the row is only sent while it can be seen
  view(st, who, now) {
    const s = idx(who), showing = st.phase === 'play' && now != null && now < st.showUntil + 400;
    return { n: st.n, phase: st.phase, round: st.round, len: st.len, startAt: st.startAt, showUntil: st.showUntil, showMs: MEE.showMs(st.len || 5), seq: showing ? st.seq : null,
      ready: st.ready, answered: st.answers.map((a) => a != null), rows: st.rows, totals: st.totals, extra: Math.max(0, st.round - MEE.LENS.length), over: st.over, winners: st.winners ? st.winners.map(sideOf) : null };
  },
  legal: (st, who, now) => MEE.legal(st, idx(who), now),
};

// ---------------- bridge ----------------
const BRE = require('./m_bridge.js');
const bridge = {
  id: 'bridge', seats: [4, 4], clock: { total: 0, perMove: 60000 },
  team: (seat) => 'ab'[SEATS.indexOf(seat) % 2],
  init: (n) => BRE.create(n),
  actors: (st) => BRE.actors(st).map(sideOf),
  find: (st, mv, who) => BRE.find(st, mv, idx(who)),
  apply: (st, mv) => BRE.apply(st, mv),
  result: (st) => (st.over ? maskOf(st.winners) : null),
  auto: (st, who) => BRE.auto(st, idx(who)),
  view(st, who) {
    const s = idx(who), c = st.contract, sd = sideOf;
    const counts = st.hands.map((h) => h.length);
    const dummyHand = c && st.dummyShown ? st.hands[c.dummy] : null;
    return {
      n: 4, phase: st.phase, deal: st.deal, deals: st.deals, dealer: sd(st.dealer), vul: st.vul, scores: st.scores, turn: sd(st.turn), actor: BRE.actors(st).map(sd)[0] || null,
      calls: st.calls.map((x) => ({ seat: sd(x.seat), call: x.call })), lastBid: st.lastBid ? { ...st.lastBid, seat: sd(st.lastBid.seat) } : null, doubled: st.doubled,
      contract: c ? { level: c.level, strain: c.strain, doubled: c.doubled, declarer: sd(c.declarer), dummy: sd(c.dummy) } : null,
      hand: s >= 0 ? st.hands[s] : null, counts, dummy: dummyHand, trick: st.trick.map((p) => ({ seat: sd(p.seat), card: p.card })),
      lastTrick: st.lastTrick ? { cards: st.lastTrick.cards.map((p) => ({ seat: sd(p.seat), card: p.card })), winner: sd(st.lastTrick.winner) } : null,
      tricksWon: st.tricksWon, over: st.over, winners: st.winners ? st.winners.map(sd) : null,
      lastDeal: st.lastDeal ? { ...st.lastDeal, dealer: sd(st.lastDeal.dealer), contract: st.lastDeal.contract ? { ...st.lastDeal.contract, declarer: sd(st.lastDeal.contract.declarer), dummy: sd(st.lastDeal.contract.dummy) } : undefined } : null,
      history: st.history.map((e) => ({ deal: e.deal, delta: e.delta, passedOut: !!e.passedOut })),
    };
  },
  legal: (st, who) => BRE.legal(st, idx(who)),
};

module.exports = { list: [durak, poker, domino, scopa, memory, bridge], SEATS, sideOf, idx, maskOf };
