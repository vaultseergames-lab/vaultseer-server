'use strict';
// Slot duel (2 players) and roulette (2 to 9 players). Everybody presses "spin" at the same time; the result is provably fair:
//  - the server commits to a secret nonce before anybody spins (sha256(nonce) is in the view, the nonce itself is shown after the game),
//  - every player adds a random seed when he spins, the server adds nothing after it has seen them,
//  - result = function(nonce, round, seeds). Anybody can recompute it (see games5.js, the browser uses the same file).
// Nobody can type "spin" twice, and a player who does not spin in time is out and loses the stake (core.js).
const crypto = require('crypto');
const VG = require('./games1.js'); require('./games5.js');
const CH = VG.chance;
const LETTERS = 'abcdefghi';
const newNonce = () => crypto.randomBytes(16).toString('hex');
const serverSeed = () => crypto.randomBytes(8).toString('hex');

function create(kind, n) {
  if (kind === 'slots' && n !== 2) throw new Error('slots is for 2 players');
  if (kind === 'roulette' && (n < 2 || n > 9)) throw new Error('roulette is for 2 to 9 players');
  const nonce = newNonce();
  return { kind, n, nonce, commit: CH.commit(nonce), round: 1, wins: Array(n).fill(0), rows: [], over: false, winners: null };
}
const actors = (st) => (st.over ? [] : Array.from({ length: st.n }, (_, i) => i));
const legal = (st) => (st.over ? [] : [{ t: 'spin' }]);
function find(st, mv) { return mv && !st.over && mv.t === 'spin' && CH.okSeed(mv.seed) ? { t: 'spin', seed: mv.seed } : null; }
const auto = () => ({ t: 'spin', seed: serverSeed() });

// `both` = { seat letter or index: move } for every actor
function apply(st, both) {
  const seeds = [];
  for (let i = 0; i < st.n; i++) { const m = both[i] || both[LETTERS[i]]; seeds.push(m && CH.okSeed(m.seed) ? m.seed : serverSeed()); }
  if (st.kind === 'roulette') {
    const row = CH.rouletteRow(st.nonce, st.round, seeds, st.n);
    st.rows.push(row); st.over = true; st.winners = [row.owner]; return st;
  }
  const row = CH.slotRow(st.nonce, st.round, seeds), w = row.winner;
  st.rows.push(row);
  if (w >= 0) st.wins[w]++;
  if (st.wins[0] >= CH.SLOT_WINS || st.wins[1] >= CH.SLOT_WINS) { st.over = true; st.winners = [st.wins[0] > st.wins[1] ? 0 : 1]; }
  else if (st.rows.length >= CH.SLOT_MAX_ROUNDS) { st.over = true; st.winners = st.wins[0] === st.wins[1] ? [0, 1] : [st.wins[0] > st.wins[1] ? 0 : 1]; }
  if (!st.over) st.round++;
  return st;
}
const maskOf = (list) => list.reduce((a, i) => a | (1 << i), 0);
function view(st) {
  return { kind: st.kind, n: st.n, round: st.round, wins: st.wins.slice(), rows: st.rows.slice(-CH.SLOT_MAX_ROUNDS), commit: st.commit, nonce: st.over ? st.nonce : null, over: st.over,
    winners: st.winners ? st.winners.map((i) => LETTERS[i]) : null, pockets: st.kind === 'roulette' ? CH.pockets(st.n) : null };
}
const result = (st) => (st.over ? maskOf(st.winners) : null);
module.exports = { create, actors, legal, find, apply, auto, view, result, maskOf };
