'use strict';
// Ludo (2 to 4 players) with provably fair dice. The server commits to sha256(nonce) before the first roll; every roll is
// die = f(nonce, roll number, the seed the player added), so the server cannot pick a die after it has seen the seed.
// The nonce and the whole log of rolls are shown after the game and the browser recomputes them (games6.js, VG.ludo.verify).
const crypto = require('crypto');
const VG = require('./games1.js'); require('./games5.js'); require('./games6.js');
const LU = VG.ludo, CH = VG.chance;
const LETTERS = 'abcdefghi';
const serverSeed = () => crypto.randomBytes(8).toString('hex');
const maskOf = (list) => list.reduce((a, i) => a | (1 << i), 0);

function create(n) {
  if (n < 2 || n > 4) throw new Error('ludo is for 2 to 4 players');
  const st = LU.init(n); st.nonce = crypto.randomBytes(16).toString('hex'); st.commit = CH.commit(st.nonce); st.log = [];
  return st;
}
const actors = (st) => (st.over ? [] : [st.turn]);
const legal = (st) => (st.over ? [] : st.phase === 'roll' ? [{ t: 'roll' }] : LU.legal(st).map((tok) => ({ t: 'move', tok })));
function find(st, mv) {
  if (!mv || st.over) return null;
  if (st.phase === 'roll') return mv.t === 'roll' && CH.okSeed(mv.seed) ? { t: 'roll', seed: mv.seed } : null;
  return mv.t === 'move' && Number.isInteger(mv.tok) && LU.legal(st).indexOf(mv.tok) >= 0 ? { t: 'move', tok: mv.tok } : null;
}
function apply(st, mv) {
  if (mv.t === 'roll') { const i = st.rolls + 1, die = LU.die(st.nonce, i, mv.seed); st.log.push({ i, seed: mv.seed, die, seat: LETTERS[st.turn] }); LU.roll(st, die); }
  else LU.move(st, mv.tok, false);
  return st;
}
const auto = (st) => (st.phase === 'roll' ? { t: 'roll', seed: serverSeed() } : { t: 'move', tok: LU.choose(st) });
function view(st) {
  return { n: st.n, colors: st.colors, tok: st.tok, turn: LETTERS[st.turn], phase: st.phase, die: st.die, sixes: st.sixes, rolls: st.rolls, max: LU.maxRolls(st.n), over: st.over,
    winners: st.winners ? st.winners.map((i) => LETTERS[i]) : null, capped: !!st.capped, progress: st.tok.map((_, s) => LU.progress(st, s)),
    ev: st.ev ? { seat: LETTERS[st.ev.seat], die: st.ev.die, tok: st.ev.tok, from: st.ev.from, to: st.ev.to, caps: st.ev.caps.map((c) => ({ seat: LETTERS[c.seat], tok: c.tok })), void: !!st.ev.void, pass: !!st.ev.pass, auto: !!st.ev.auto } : null,
    commit: st.commit, nonce: st.over ? st.nonce : null, log: st.over ? st.log : st.log.slice(-4) };
}
const result = (st) => (st.over ? maskOf(st.winners) : null);
module.exports = { create, actors, legal, find, apply, auto, view, result };
