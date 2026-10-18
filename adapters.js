'use strict';
// One adapter per game. The server never trusts the client: every move is looked up in the engine's own list of legal moves.
// Sides: 'a' = first player, 'b' = second. Every adapter says:
//   actors(st)      who must act now: ['a'] or ['b'], or ['a','b'] when both choose at the same time
//   find(st,mv,who) the engine move for what the client sent, or null when it is illegal
//   apply(st,x)     x = the engine move (one actor) or { a: move, b: move } (both)
//   result(st)      null while playing, else 1 (a wins) / 2 (b wins) / 3 (draw)
//   view(st,who)    what that player may see (hidden cards stay hidden)
//   legal(st,who)   the moves that player may make now
const crypto = require('crypto');
const VG = require('./games1.js');
require('./games2.js'); require('./games3.js'); require('./games4.js');
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const seed = () => crypto.randomBytes(4).readUInt32BE(0);
const idx = (who) => (who === 'a' ? 0 : 1);
const sideOf = (n) => (n === 0 ? 'a' : 'b');
const fromSide = (r) => (r === 'w' ? 1 : r === 'b' ? 2 : r === 'draw' ? 3 : null);

const chess = {
  id: 'chess', clock: { total: 180000, perMove: 0 },
  init: () => VG.chess.init(),
  actors: (st) => [st.turn === 'w' ? 'a' : 'b'],
  find(st, mv) {
    if (!mv || !Number.isInteger(mv.from) || !Number.isInteger(mv.to)) return null;
    const list = VG.chess.moves(st).filter((m) => m.from === mv.from && m.to === mv.to);
    if (!list.length) return null;
    if (list.length === 1) return list[0];
    const want = String(mv.promo || 'q').toLowerCase();
    return list.find((m) => m.promo === want) || list.find((m) => m.promo === 'q') || null;
  },
  apply: (st, m) => VG.chess.make(st, m),
  result(st) { const r = VG.chess.result(st); return r ? fromSide(r.r) : null; },
  view: (st) => ({ b: st.b, turn: st.turn, ep: st.ep, n: st.n, last: st.last || null }),
  legal: (st, who) => (chess.actors(st)[0] === who ? VG.chess.moves(st).map((m) => ({ from: m.from, to: m.to, promo: m.promo || undefined })) : []),
};

const checkers = {
  id: 'checkers', clock: { total: 0, perMove: 60000 },
  init: () => VG.checkers.init(),
  actors: (st) => [st.turn === 'w' ? 'a' : 'b'],
  find: (st, mv) => (mv && Array.isArray(mv.path) ? VG.checkers.moves(st).find((m) => same(m.path, mv.path)) || null : null),
  apply: (st, m) => VG.checkers.apply(st, m),
  result: (st) => fromSide(VG.checkers.result(st)),
  view: (st) => ({ b: st.b, turn: st.turn, quiet: st.quiet, n: st.n, last: st.last || null }),
  legal: (st, who) => (checkers.actors(st)[0] === who ? VG.checkers.moves(st).map((m) => ({ path: m.path })) : []),
};

// Dominoes: the starting tile is placed by the engine. Moves: {t:'play',i,end} | {t:'draw'} | {t:'pass'}
const DM = VG.domino;
const domino = {
  id: 'domino', clock: { total: 0, perMove: 60000 },
  init: () => DM.new(VG.rng(seed())),
  actors: (st) => [sideOf(st.turn)],
  find(st, mv, who) {
    const s = idx(who); if (!mv) return null;
    if (mv.t === 'play') return DM.playable(st, s).find((p) => p.i === mv.i && p.end === mv.end) ? { t: 'play', i: mv.i, end: mv.end } : null;
    if (mv.t === 'draw') return DM.canDraw(st, s) ? { t: 'draw' } : null;
    if (mv.t === 'pass') return DM.canPass(st, s) ? { t: 'pass' } : null;
    return null;
  },
  apply(st, m) {
    const s = st.turn;
    if (m.t === 'play') DM.play(st, s, m.i, m.end); else if (m.t === 'draw') DM.draw(st, s); else DM.pass(st, s);
    return st;
  },
  result: (st) => (!st.over ? null : st.result === 'draw' ? 3 : st.result === 0 ? 1 : 2),
  view(st, who) {
    const s = who === 'a' ? 0 : who === 'b' ? 1 : -1;
    return { hand: s >= 0 ? st.hands[s] : null, oppCount: s >= 0 ? st.hands[1 - s].length : null, counts: st.hands.map((h) => h.length), yard: st.yard.length, chain: st.chain, ends: st.ends, turn: sideOf(st.turn), passes: st.passes, over: st.over, why: st.why,
      pips: st.over ? st.hands.map((h) => h.slice()) : null };
  },
  legal(st, who) {
    if (st.over || sideOf(st.turn) !== who) return [];
    const s = idx(who), pl = DM.playable(st, s).map((p) => ({ t: 'play', i: p.i, end: p.end }));
    if (pl.length) return pl;
    return DM.canDraw(st, s) ? [{ t: 'draw' }] : DM.canPass(st, s) ? [{ t: 'pass' }] : [];
  },
};

// Penalty shootout: shooter and keeper choose a zone at the same moment. Neither sees the other's choice until both are in.
const PN = VG.penalty;
const penalty = {
  id: 'penalty', clock: { total: 0, perMove: 20000 }, simultaneous: true,
  init: () => PN.new({ kicks: 5 }),
  actors: () => ['a', 'b'],
  find: (st, mv) => (mv && Number.isInteger(mv.zone) && mv.zone >= 0 && mv.zone < PN.zones ? { zone: mv.zone } : null),
  apply(st, both) {
    const shooter = sideOf(st.phase), keeper = shooter === 'a' ? 'b' : 'a';
    PN.kick(st, both[shooter].zone, both[keeper].zone);
    return st;
  },
  result: (st) => (!st.over ? null : st.result === 0 ? 1 : 2),
  view: (st) => ({ kicks: st.kicks, round: st.round, score: st.score, shooter: sideOf(st.phase), shot: st.shot, log: st.log }),
  legal: (st) => (st.over ? [] : Array.from({ length: PN.zones }, (_, z) => ({ zone: z }))),
};


// Battleship: both players place their fleet at the same time (setup), then shoot in turns. A hit gives another shot.
const BS = VG.battleship;
function fleetOk(fleet) {
  if (!Array.isArray(fleet) || fleet.length !== BS.FLEET.length) return false;
  const lens = fleet.map((f) => (Array.isArray(f) ? f.length : -1)).sort((x, y) => y - x);
  if (JSON.stringify(lens) !== JSON.stringify(BS.FLEET.slice().sort((x, y) => y - x))) return false;
  const owner = {};
  for (let k = 0; k < fleet.length; k++) {
    const cells = fleet[k];
    if (!cells.every((c) => Number.isInteger(c) && c >= 0 && c < 100) || new Set(cells).size !== cells.length) return false;
    const s = cells.slice().sort((x, y) => x - y), row = Math.floor(s[0] / 10), col = s[0] % 10;
    const horiz = s.length > 1 ? s[1] - s[0] === 1 : true, step = horiz ? 1 : 10;
    for (let i = 0; i < s.length; i++) {
      if (s[i] !== s[0] + i * step) return false;
      if (horiz && Math.floor(s[i] / 10) !== row) return false;                // may not wrap to the next row
    }
    if (!horiz && col + 0 !== s[0] % 10) return false;
    for (const c of cells) { if (owner[c] !== undefined) return false; owner[c] = k; }
  }
  for (const c of Object.keys(owner).map(Number)) {                          // ships may not touch, not even at the corners
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const r = Math.floor(c / 10) + dr, cc = (c % 10) + dc;
      if (r < 0 || r > 9 || cc < 0 || cc > 9) continue;
      const o = owner[r * 10 + cc]; if (o !== undefined && o !== owner[c]) return false;
    }
  }
  return true;
}
const battleship = {
  id: 'battleship', clock: { total: 0, perMove: 60000 },
  init: () => ({ phase: 'setup', boards: { a: null, b: null }, turn: 'a', over: false, winner: null, log: [] }),
  simul: (st) => st.phase === 'setup',
  actors: (st) => (st.over ? [] : st.phase === 'setup' ? ['a', 'b'] : [st.turn]),
  find(st, mv) {
    if (!mv) return null;
    if (st.phase === 'setup') return fleetOk(mv.fleet) ? { fleet: mv.fleet.map((f) => f.slice()) } : null;
    return Number.isInteger(mv.cell) && mv.cell >= 0 && mv.cell < 100 && !st.boards[st.turn === 'a' ? 'b' : 'a'].shots[mv.cell] ? { cell: mv.cell } : null;
  },
  apply(st, x) {
    if (st.phase === 'setup') {
      for (const s of ['a', 'b']) st.boards[s] = { ships: x[s].fleet.map((cells) => ({ cells, hits: 0 })), shots: {}, sunkCells: {} };
      st.phase = 'play'; st.turn = 'a'; return st;
    }
    const me = st.turn, opp = me === 'a' ? 'b' : 'a', res = BS.shoot(st.boards[opp], x.cell);
    st.log.push({ by: me, cell: x.cell, hit: res.hit, sunk: res.sunk });
    if (BS.allSunk(st.boards[opp])) { st.over = true; st.winner = me; } else if (!res.hit) st.turn = opp;
    return st;
  },
  result: (st) => (!st.over ? null : st.winner === 'a' ? 1 : 2),
  view(st, who) {
    const v = { phase: st.phase, turn: st.turn, log: st.log, over: st.over, placed: st.phase === 'setup' ? undefined : true };
    if (st.phase === 'setup' || !who) return v;
    const opp = who === 'a' ? 'b' : 'a', mine = st.boards[who], theirs = st.boards[opp];
    v.mine = { ships: mine.ships.map((s) => s.cells), shots: mine.shots };
    v.theirs = { shots: theirs.shots, sunk: theirs.ships.filter((s) => s.hits === s.cells.length).map((s) => s.cells), left: BS.remaining(theirs) };
    if (st.over) v.theirs.ships = theirs.ships.map((s) => s.cells);
    return v;
  },
  legal(st, who) {
    if (st.over || st.phase === 'setup') return [];
    if (st.turn !== who) return [];
    const opp = st.boards[who === 'a' ? 'b' : 'a'], out = [];
    for (let i = 0; i < 100; i++) if (!opp.shots[i]) out.push({ cell: i });
    return out;
  },
};


// Backgammon: the server rolls the dice (secure random), so nobody can pick their roll. Moves: {t:'move',o,d} | {t:'skip'} (no legal move)
const BG = VG.backgammon;
const rnd = () => crypto.randomInt(0, 2 ** 30) / 2 ** 30;
const bgRollNext = (st) => { if (!st.over && !st.rolled) BG.roll(st, rnd); return st; };
const backgammon = {
  id: 'backgammon', clock: { total: 0, perMove: 60000 },
  init: () => BG.new(rnd),
  actors: (st) => (st.over ? [] : [sideOf(st.turn)]),
  find(st, mv, who) {
    const s = idx(who); if (!mv) return null;
    if (mv.t === 'skip') return BG.noMoves(st) && st.turn === s ? { t: 'skip' } : null;
    if (mv.t === 'move') return BG.options(st, s).find((o) => o.o === mv.o && o.d === mv.d) ? { t: 'move', o: mv.o, d: mv.d } : null;
    return null;
  },
  apply(st, m) {
    if (m.t === 'skip') BG.skip(st); else BG.move(st, st.turn, m.o, m.d);
    return bgRollNext(st);
  },
  result: (st) => (!st.over ? null : st.result === 0 ? 1 : 2),
  view: (st) => ({ a: st.a, bar: st.bar, off: st.off, turn: sideOf(st.turn), dice: st.dice, rem: st.rem, done: st.done, over: st.over, opening: st.opening }),
  legal(st, who) {
    const s = idx(who); if (st.over || st.turn !== s) return [];
    const o = BG.options(st, s).map((x) => ({ t: 'move', o: x.o, d: x.d, to: x.t }));
    return o.length ? o : BG.noMoves(st) ? [{ t: 'skip' }] : [];
  },
};


// Durak: hidden hands. Moves: {t:'attack',card} | {t:'finish'} | {t:'defend',idx,card} | {t:'take'}
const DK = VG.durak;
const durak = {
  id: 'durak', clock: { total: 0, perMove: 60000 },
  init: () => DK.new(rnd),
  actors: (st) => (st.over ? [] : [sideOf(st.stage === 'defend' ? DK.def(st) : st.att)]),
  find(st, mv, who) {
    const s = idx(who); if (!mv) return null;
    if (mv.t === 'attack') return st.stage === 'attack' && st.att === s && DK.canAttackCards(st).includes(mv.card) ? { t: 'attack', card: mv.card } : null;
    if (mv.t === 'finish') return st.att === s && DK.canFinish(st) ? { t: 'finish' } : null;
    if (mv.t === 'take') return st.stage === 'defend' && DK.def(st) === s ? { t: 'take' } : null;
    if (mv.t === 'defend') {
      if (st.stage !== 'defend' || DK.def(st) !== s || !DK.undefended(st).includes(mv.idx)) return null;
      return st.hands[s].includes(mv.card) && DK.beats(st, mv.card, st.table[mv.idx].a) ? { t: 'defend', idx: mv.idx, card: mv.card } : null;
    }
    return null;
  },
  apply(st, m) {
    if (m.t === 'attack') DK.attack(st, m.card); else if (m.t === 'finish') DK.finish(st);
    else if (m.t === 'take') DK.take(st); else DK.defend(st, m.idx, m.card);
    return st;
  },
  result: (st) => (!st.over ? null : st.result === 'draw' ? 3 : st.result === 0 ? 1 : 2),
  view(st, who) {
    const s = who === 'a' ? 0 : who === 'b' ? 1 : -1;
    return { hand: s >= 0 ? st.hands[s] : null, oppCount: s >= 0 ? st.hands[1 - s].length : null, deck: st.deck.length, trump: st.trump, trumpCard: st.trumpCard,
      table: st.table, attacker: sideOf(st.att), stage: st.stage, taking: st.taking, limit: st.limit, over: st.over };
  },
  legal(st, who) {
    const s = idx(who); if (st.over) return [];
    if (st.stage === 'attack' && st.att === s) {
      const out = DK.canAttackCards(st).map((card) => ({ t: 'attack', card }));
      if (DK.canFinish(st)) out.push({ t: 'finish' });
      return out;
    }
    if (st.stage === 'defend' && DK.def(st) === s) {
      const out = [{ t: 'take' }];
      for (const i of DK.undefended(st)) for (const card of st.hands[s]) if (DK.beats(st, card, st.table[i].a)) out.push({ t: 'defend', idx: i, card });
      return out;
    }
    return [];
  },
};


// Poker (heads-up hold'em, 10 hands, blinds 10/20). The deck is shuffled with secure random numbers, not with a 32-bit seed
// (a 32-bit seed could be brute-forced from your own cards). After each hand the deck order is revealed so the SHA-256 commitment can be checked.
const PK = VG.poker;
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function pkDeal(pm, fn) {                                  // run an engine call that deals a hand, with the secure shuffle plugged in
  const orig = VG.shuffle; VG.shuffle = (r, arr) => secureShuffle(arr);
  try { return fn(); } finally { VG.shuffle = orig; }
}
function pkSnapshot(pm) {
  const h = pm.h;
  return { hand: pm.hand, winner: h.winner, showdown: h.showdown, won: h.won, board: h.board.slice(), seedStr: h.seedStr, deck: h.deck.slice(), commit: h.commit,
    hole: h.showdown ? h.hole.map((x) => x.slice()) : null, pot: h.pot, folded: h.folded, stacks: pm.stacks.slice() };
}
const poker = {
  id: 'poker', clock: { total: 0, perMove: 60000 },
  init() {
    const pm = PK.newMatch(crypto.randomBytes(6).readUIntBE(0, 6), { hands: 10 });
    pkDeal(pm, () => PK.startHand(pm));
    pm.lastHand = null; return pm;
  },
  actors: (pm) => (pm.over ? [] : [sideOf(pm.h.turn)]),
  find(pm, mv, who) {
    const i = idx(who), h = pm.h; if (!mv || pm.over || h.done || h.turn !== i) return null;
    if (!PK.legal(h, i).includes(mv.t)) return null;
    if (mv.t !== 'raise') return { t: mv.t };
    const rg = PK.raiseRange(h, i);
    return Number.isInteger(mv.to) && mv.to >= rg.min && mv.to <= rg.max ? { t: 'raise', to: mv.to } : null;
  },
  apply(pm, m) {
    PK.act(pm, pm.h.turn, m);
    // a hand can end at once when a blind puts someone all-in, so keep dealing until a hand is really waiting for an action
    for (let guard = 0; pm.h.done && guard < 30; guard++) {
      pm.lastHand = pkSnapshot(pm);
      if (pm.over) break;
      pkDeal(pm, () => PK.nextHand(pm));
    }
    return pm;
  },
  result: (pm) => (!pm.over ? null : pm.result === 'draw' ? 3 : pm.result === 0 ? 1 : 2),
  view(pm, who) {
    const i = who === 'a' ? 0 : who === 'b' ? 1 : -1, h = pm.h;
    const live = !pm.over || !h.done ? h : h;
    const v = { hand: Math.min(pm.hand + (h.done ? 0 : 1), pm.hands), hands: pm.hands, stacks: pm.stacks, dealer: sideOf(pm.dealer), over: pm.over, lastHand: pm.lastHand,
      history: pm.history.map((x) => ({ hand: x.hand, winner: x.winner === 'split' ? 'split' : sideOf(x.winner), won: x.won })) };
    v.table = { board: live.board, street: live.street, bets: live.bets, pot: live.pot, stk: live.stk, turn: sideOf(live.turn), allin: live.allin, lastRaise: live.lastRaise,
      commit: live.commit, log: live.log.map((e) => [sideOf(e[0]), e[1], e[2]]) };
    if (i >= 0) {
      v.hole = live.hole[i];
      v.toCall = PK.toCall(live, i); v.raiseRange = live.done ? null : PK.raiseRange(live, i);
    }
    return v;
  },
  legal(pm, who) {
    const i = idx(who), h = pm.h; if (pm.over || h.done || h.turn !== i) return [];
    const out = PK.legal(h, i).map((t) => ({ t }));
    const rg = PK.raiseRange(h, i); if (rg) { const o = out.find((x) => x.t === 'raise'); if (o) { o.min = rg.min; o.max = rg.max; } }
    return out;
  },
};


// ---- Card series games (gin rummy, sixty-six, scopa): several deals in a row. The server deals the next deal by itself and
// keeps a copy of the finished one (st.lastDeal) so both players can see how it ended.
const clone = (x) => JSON.parse(JSON.stringify(x));
const resOf = (st) => (!st.over ? null : st.result === 'draw' ? 3 : st.result === 0 ? 1 : 2);
function nextDeals(st, eng, scoreKey) {
  for (let g = 0; st.phase === 'show' && !st.over && g < 3; g++) {
    st.lastDeal = { deal: st.deal, last: clone(st.last), score: clone(st[scoreKey]) };
    eng.next(st);
  }
  return st;
}

const GR = VG.ginrummy;
const gin = {
  id: 'gin', clock: { total: 0, perMove: 60000 },
  init() { const st = GR.new(rnd); st.lastDeal = null; return st; },
  actors: (st) => (st.over ? [] : [sideOf(st.turn)]),
  find(st, mv, who) {
    const s = idx(who); if (!mv || st.over || st.turn !== s) return null;
    if (mv.t === 'draw') return st.phase === 'draw' && ((mv.from === 'stock' && st.stock.length) || (mv.from === 'disc' && st.disc.length)) ? { t: 'draw', from: mv.from } : null;
    if (st.phase !== 'discard') return null;
    if (mv.t === 'discard') return GR.discardable(st, s).includes(mv.card) ? { t: 'discard', card: mv.card } : null;
    if (mv.t === 'knock') return GR.knockable(st, s).includes(mv.card) ? { t: 'knock', card: mv.card } : null;
    return null;
  },
  apply(st, m) {
    const s = st.turn;
    if (m.t === 'draw') GR.draw(st, s, m.from); else if (m.t === 'discard') GR.discard(st, s, m.card); else GR.knock(st, s, m.card);
    return nextDeals(st, GR, 'scores');
  },
  result: resOf,
  view(st, who) {
    const s = who === 'a' ? 0 : who === 'b' ? 1 : -1;
    return { hand: s >= 0 ? st.hands[s] : null, oppCount: s >= 0 ? st.hands[1 - s].length : null, stock: st.stock.length, disc: st.disc, took: st.took, phase: st.phase, turn: sideOf(st.turn),
      scores: st.scores, deal: st.deal, dealer: sideOf(st.dealer), over: st.over, lastDeal: st.lastDeal, target: GR.TARGET };
  },
  legal(st, who) {
    const s = idx(who); if (st.over || st.turn !== s) return [];
    if (st.phase === 'draw') { const o = []; if (st.stock.length) o.push({ t: 'draw', from: 'stock' }); if (st.disc.length) o.push({ t: 'draw', from: 'disc' }); return o; }
    const k = GR.knockable(st, s);
    return GR.discardable(st, s).map((card) => ({ t: 'discard', card })).concat(k.map((card) => ({ t: 'knock', card })));
  },
};

const SS = VG.sixtysix;
const sixtysix = {
  id: 'sixtysix', clock: { total: 0, perMove: 60000 },
  init() { const st = SS.new(rnd); st.lastDeal = null; return st; },
  actors: (st) => (st.over ? [] : [sideOf(st.turn)]),
  find(st, mv, who) {
    const s = idx(who); if (!mv || st.over || st.phase !== 'play' || st.turn !== s) return null;
    if (mv.t === 'swap') return SS.canExchange(st, s) ? { t: 'swap' } : null;
    if (mv.t === 'close') return SS.canClose(st, s) ? { t: 'close' } : null;
    if (mv.t === 'play') {
      if (!SS.legal(st, s).includes(mv.card)) return null;
      if (mv.marry && !(st.led < 0 && SS.canMarry(st, s, mv.card))) return null;
      return { t: 'play', card: mv.card, marry: !!mv.marry };
    }
    return null;
  },
  apply(st, m) {
    const s = st.turn;
    if (m.t === 'swap') SS.exchange(st, s); else if (m.t === 'close') SS.close(st, s); else SS.play(st, s, m.card, m.marry);
    return nextDeals(st, SS, 'games');
  },
  result: resOf,
  view(st, who) {
    const s = who === 'a' ? 0 : who === 'b' ? 1 : -1;
    return { hand: s >= 0 ? st.hands[s] : null, oppCount: s >= 0 ? st.hands[1 - s].length : null, stock: st.stock.length, trumpCard: st.trumpCard, trump: st.trump,
      closed: st.closed >= 0 ? sideOf(st.closed) : null, led: st.led, trick: st.trick ? { lead: sideOf(st.trick.lead), a: st.trick.a, b: st.trick.b } : null,
      tricks: st.tricks, pts: s >= 0 ? st.pts[s] : null, turn: sideOf(st.turn), games: st.games, deal: st.deal, dealer: sideOf(st.dealer), over: st.over, lastDeal: st.lastDeal,
      said: st.said.map((e) => ({ ...e, side: sideOf(e.side) })), target: SS.TARGET };
  },
  legal(st, who) {
    const s = idx(who); if (st.over || st.phase !== 'play' || st.turn !== s) return [];
    const out = SS.legal(st, s).map((card) => ({ t: 'play', card }));
    if (st.led < 0) for (const card of SS.legal(st, s)) if (SS.canMarry(st, s, card)) out.push({ t: 'play', card, marry: true });
    if (SS.canExchange(st, s)) out.push({ t: 'swap' });
    if (SS.canClose(st, s)) out.push({ t: 'close' });
    return out;
  },
};

const SC = VG.scopa;
const scopa = {
  id: 'scopa', clock: { total: 0, perMove: 60000 },
  init() { const st = SC.new(rnd); st.lastDeal = null; return st; },
  actors: (st) => (st.over ? [] : [sideOf(st.turn)]),
  find(st, mv, who) {
    const s = idx(who); if (!mv || st.over || st.phase !== 'play' || st.turn !== s || mv.t !== 'play') return null;
    const hi = st.hands[s].indexOf(mv.card); if (hi < 0 || !Array.isArray(mv.cap) || !mv.cap.every((i) => Number.isInteger(i))) return null;
    const key = mv.cap.slice().sort((x, y) => x - y).join(',');
    return SC.options(st, s, hi).some((o) => o.join(',') === key) ? { t: 'play', card: mv.card, cap: mv.cap.slice() } : null;
  },
  apply(st, m) {
    const s = st.turn; SC.play(st, s, st.hands[s].indexOf(m.card), m.cap);
    return nextDeals(st, SC, 'scores');
  },
  result: resOf,
  view(st, who) {
    const s = who === 'a' ? 0 : who === 'b' ? 1 : -1;
    return { hand: s >= 0 ? st.hands[s] : null, oppCount: s >= 0 ? st.hands[1 - s].length : null, table: st.table, deck: st.deck.length, captured: st.cap.map((c) => c.length),
      mine: s >= 0 ? st.cap[s] : null, scopas: st.scopas, event: st.event ? { ...st.event, side: sideOf(st.event.side) } : null, turn: sideOf(st.turn), scores: st.scores, deal: st.deal,
      dealer: sideOf(st.dealer), over: st.over, lastDeal: st.lastDeal, target: SC.TARGET };
  },
  legal(st, who) {
    const s = idx(who); if (st.over || st.phase !== 'play' || st.turn !== s) return [];
    const out = [];
    st.hands[s].forEach((card, hi) => SC.options(st, s, hi).forEach((cap) => out.push({ t: 'play', card, cap })));
    return out;
  },
};

const multi = require('./adapters_multi.js');
const multiIds = new Set(multi.list.map((a) => a.id));
// the games that have an N-seat version are served by that version only
const skill = require('./adapters_skill.js');
const list = [chess, checkers, domino, penalty, battleship, backgammon, durak, poker, gin, sixtysix, scopa].filter((a) => !multiIds.has(a.id)).concat(multi.list, skill.list);
for (const a of list) if (!a.seats) a.seats = [2, 2];
module.exports.fleetOk = fleetOk;


module.exports.byId = Object.fromEntries(list.map((a) => [a.id, a]));
