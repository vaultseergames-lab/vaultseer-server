'use strict';
// Liar's dice (2 to 9 players) with provably fair dice. The server commits to sha256(nonce); at the start of every round each player who still has dice
// shakes his cup (adds a seed); the dice are f(nonce, round, all seeds). Everybody sees only his own dice; every round ends with all dice shown.
// After the game the nonce is revealed and the browser recomputes every round (games6.js, VG.liars.verify).
const crypto = require('crypto');
const VG = require('./games1.js'); require('./games5.js'); require('./games6.js');
const LD = VG.liars, CH = VG.chance;
const LETTERS = 'abcdefghi';
const serverSeed = () => crypto.randomBytes(8).toString('hex');

function create(n) {
  if (n < 2 || n > 9) throw new Error("liar's dice is for 2 to 9 players");
  const nonce = crypto.randomBytes(16).toString('hex');
  const st = LD.init(n, LD.firstStart(nonce, n)); st.nonce = nonce; st.commit = CH.commit(nonce); st.first = st.start;
  return st;
}
const simul = (st) => st.phase === 'roll' && !st.over;
const actors = (st) => (st.over ? [] : st.phase === 'roll' ? LD.alive(st) : [st.turn]);
function find(st, mv) {
  if (!mv || st.over) return null;
  if (st.phase === 'roll') return mv.t === 'roll' && CH.okSeed(mv.seed) ? { t: 'roll', seed: mv.seed } : null;
  if (mv.t === 'liar') return LD.canLiar(st) ? { t: 'liar' } : null;
  return mv.t === 'bid' && LD.canBid(st, mv.q, mv.f) ? { t: 'bid', q: mv.q, f: mv.f } : null;
}
// roll phase: x = { seat letter: move } for every player who still has dice; the other moves: x = the move
function apply(st, x) {
  if (st.phase === 'roll') {
    const seeds = st.cnt.map((c, i) => (c > 0 ? (x[LETTERS[i]] && CH.okSeed(x[LETTERS[i]].seed) ? x[LETTERS[i]].seed : serverSeed()) : '-'));
    st.seeds = seeds; LD.begin(st, LD.diceFor(st.nonce, st.round + 1, seeds, st.cnt));
  } else if (x.t === 'liar') LD.liar(st); else LD.bid(st, x.q, x.f);
  return st;
}
function legal(st, who) {
  const s = LETTERS.indexOf(who);
  if (st.over) return [];
  if (st.phase === 'roll') return st.cnt[s] > 0 ? [{ t: 'roll' }] : [];
  if (st.turn !== s) return [];
  const out = [], total = LD.total(st); if (st.bid) out.push({ t: 'liar' });
  for (let q = 1; q <= total; q++) for (let f = 1; f <= 6; f++) if (LD.canBid(st, q, f)) out.push({ t: 'bid', q, f });
  return out;
}
function auto(st, who) {
  const s = LETTERS.indexOf(who);
  if (st.phase === 'roll') return { t: 'roll', seed: serverSeed() };
  return st.bid ? { t: 'liar' } : { t: 'bid', q: 1, f: 1 };
}
const rowView = (r) => ({ round: r.round, dice: r.dice, bid: r.bid, caller: LETTERS[r.caller], bidder: LETTERS[r.bidder], count: r.count, bidTrue: r.bidTrue, loser: LETTERS[r.loser], seeds: r.seeds });
function view(st, who) {
  const s = LETTERS.indexOf(who);
  return { n: st.n, phase: st.phase, round: st.round, cnt: st.cnt.slice(), total: LD.total(st), turn: LETTERS[st.turn], first: LETTERS[st.first],
    bid: st.bid ? { q: st.bid.q, f: st.bid.f, by: LETTERS[st.bid.by] } : null, mine: s >= 0 && st.phase === 'bid' && st.dice ? st.dice[s] : null, over: st.over,
    winner: st.winner == null ? null : LETTERS[st.winner], prev: st.prev ? rowView(st.prev) : null, rows: st.over ? st.rows.map(rowView) : null,
    commit: st.commit, nonce: st.over ? st.nonce : null };
}
const result = (st) => (st.over ? 1 << st.winner : null);
module.exports = { create, simul, actors, legal, find, apply, auto, view, result };
