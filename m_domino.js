'use strict';
// Dominoes (double-six, 28 tiles) for 2 to 4 players.
//  - Everybody gets 7 tiles; what is left (14 tiles for 2 players, 7 for 3, none for 4) is the boneyard.
//  - The holder of the highest double starts (otherwise the heaviest tile); that tile is placed automatically.
//  - On your turn play a tile that matches one end of the chain. If you cannot, draw from the boneyard one tile at a time until you
//    can play; with an empty boneyard you pass.
//  - The first player with no tiles wins. If nobody can move (all pass in a row) the blocked game is won by the lowest pip count;
//    players with the same lowest count share the prize.
const crypto = require('crypto');
const secureShuffle = (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pips = (hand) => hand.reduce((a, t) => a + t[0] + t[1], 0);

function create(n, tilesOverride) {
  if (n < 2 || n > 4) throw new Error('dominoes is for 2 to 4 players');
  let tiles = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) tiles.push([a, b]);
  tiles = tilesOverride ? tilesOverride.map((t) => t.slice()) : secureShuffle(tiles);
  const st = { n, hands: [], yard: tiles.slice(7 * n), chain: [], ends: [null, null], turn: 0, passes: 0, over: false, winners: null, why: '', starter: 0, drawn: 0 };
  for (let i = 0; i < n; i++) st.hands.push(tiles.slice(i * 7, i * 7 + 7));
  let best = null;
  st.hands.forEach((h, s) => h.forEach((t, i) => { const key = (t[0] === t[1] ? 100 : 0) + t[0] + t[1]; if (!best || key > best.key) best = { key, s, i }; }));
  st.starter = best.s; st.turn = best.s;
  play(st, best.s, best.i, 'R');
  return st;
}
function playable(st, s) {
  const out = [];
  if (st.over || st.turn !== s) return out;
  st.hands[s].forEach((t, i) => {
    if (t[0] === st.ends[0] || t[1] === st.ends[0]) out.push({ i, end: 'L' });
    if (t[0] === st.ends[1] || t[1] === st.ends[1]) out.push({ i, end: 'R' });
  });
  return out;
}
function play(st, s, i, end) {
  const t = st.hands[s][i]; if (!t) return false;
  if (st.chain.length) { const e = end === 'L' ? st.ends[0] : st.ends[1]; if (t[0] !== e && t[1] !== e) return false; }
  st.hands[s].splice(i, 1);
  if (!st.chain.length) { st.chain.push({ t: [t[0], t[1]], by: s }); st.ends = [t[0], t[1]]; }
  else if (end === 'L') { const o = t[0] === st.ends[0] ? [t[1], t[0]] : [t[0], t[1]]; st.chain.unshift({ t: o, by: s }); st.ends[0] = o[0]; }
  else { const o = t[0] === st.ends[1] ? [t[0], t[1]] : [t[1], t[0]]; st.chain.push({ t: o, by: s }); st.ends[1] = o[1]; }
  st.passes = 0;
  if (!st.hands[s].length) { st.over = true; st.winners = [s]; st.why = 'empty'; return true; }
  st.turn = (s + 1) % st.n;
  return true;
}
const canDraw = (st, s) => !st.over && st.turn === s && st.yard.length > 0 && playable(st, s).length === 0;
const canPass = (st, s) => !st.over && st.turn === s && st.yard.length === 0 && playable(st, s).length === 0;
function draw(st, s) { if (!canDraw(st, s)) return false; st.hands[s].push(st.yard.pop()); st.drawn++; return true; }
function pass(st, s) {
  if (!canPass(st, s)) return false;
  st.passes++; st.turn = (s + 1) % st.n;
  if (st.passes >= st.n) {
    st.over = true; st.why = 'blocked';
    const p = st.hands.map(pips), low = Math.min(...p); st.winners = p.map((x, i) => (x === low ? i : -1)).filter((i) => i >= 0);
  }
  return true;
}
const actors = (st) => (st.over ? [] : [st.turn]);
function legal(st, s) {
  if (st.over || st.turn !== s) return [];
  const pl = playable(st, s).map((p) => ({ t: 'play', i: p.i, end: p.end }));
  if (pl.length) return pl;
  return canDraw(st, s) ? [{ t: 'draw' }] : canPass(st, s) ? [{ t: 'pass' }] : [];
}
function find(st, mv, s) {
  if (!mv) return null;
  const l = legal(st, s);
  if (mv.t === 'play') return l.find((x) => x.t === 'play' && x.i === mv.i && x.end === mv.end) || null;
  if (mv.t === 'draw' || mv.t === 'pass') return l.find((x) => x.t === mv.t) || null;
  return null;
}
function apply(st, mv) {
  const s = st.turn;
  if (mv.t === 'play') return play(st, s, mv.i, mv.end);
  if (mv.t === 'draw') return draw(st, s);
  return pass(st, s);
}
function auto(st, s) {
  const l = legal(st, s); if (!l.length) return null;
  const pl = l.filter((x) => x.t === 'play'); if (!pl.length) return l[0];
  return pl.slice().sort((x, y) => (st.hands[s][y.i][0] + st.hands[s][y.i][1]) - (st.hands[s][x.i][0] + st.hands[s][x.i][1]))[0];   // dump the heaviest tile
}
module.exports = { create, actors, legal, find, apply, auto, pips, playable };
