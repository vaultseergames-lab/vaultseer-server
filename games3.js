/* ===== Game engines, part 3: dominoes, durak, backgammon ===== */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);

/* =====================================================================
   DOMINOES. Double-six, 28 tiles, 7 each, 14 in the boneyard. The holder of the highest double
   starts. Win by emptying your hand; if the game is blocked, the lower pip count wins.
   Side 0 = the player, side 1 = the bot.
   ===================================================================== */
var DM = VG.domino = {};
DM.new = function (r) {
  var tiles = [], a, b;
  for (a = 0; a <= 6; a++) for (b = a; b <= 6; b++) tiles.push([a, b]);
  tiles = VG.shuffle(r, tiles);
  var st = { hands: [tiles.slice(0, 7), tiles.slice(7, 14)], yard: tiles.slice(14), chain: [], ends: [null, null], turn: 0, passes: 0, over: false, result: null, why: '', log: [] };
  // starter: the highest double, otherwise the heaviest tile
  var best = null, i, s;
  for (s = 0; s < 2; s++) for (i = 0; i < 7; i++) { var t = st.hands[s][i], key = (t[0] === t[1] ? 100 : 0) + t[0] + t[1]; if (!best || key > best.key) best = { key: key, s: s, i: i }; }
  st.turn = best.s;
  DM.play(st, best.s, best.i, 'R');
  return st;
};
DM.pips = function (hand) { return hand.reduce(function (a, t) { return a + t[0] + t[1]; }, 0); };
DM.playable = function (st, side) {
  var out = [];
  if (st.over || st.turn !== side) return out;
  if (!st.chain.length) { st.hands[side].forEach(function (t, i) { out.push({ i: i, end: 'R' }); }); return out; }
  st.hands[side].forEach(function (t, i) {
    if (t[0] === st.ends[0] || t[1] === st.ends[0]) out.push({ i: i, end: 'L' });
    if (t[0] === st.ends[1] || t[1] === st.ends[1]) out.push({ i: i, end: 'R' });
  });
  return out;
};
DM.play = function (st, side, i, end) {
  var t = st.hands[side][i];
  if (!t) return false;
  if (st.chain.length) {
    var e = end === 'L' ? st.ends[0] : st.ends[1];
    if (t[0] !== e && t[1] !== e) return false;
  }
  st.hands[side].splice(i, 1);
  var placed;
  if (!st.chain.length) { placed = { t: [t[0], t[1]], by: side }; st.chain.push(placed); st.ends = [t[0], t[1]]; }
  else if (end === 'L') { var o = t[0] === st.ends[0] ? [t[1], t[0]] : [t[0], t[1]]; placed = { t: o, by: side }; st.chain.unshift(placed); st.ends[0] = o[0]; }
  else { var o2 = t[0] === st.ends[1] ? [t[0], t[1]] : [t[1], t[0]]; placed = { t: o2, by: side }; st.chain.push(placed); st.ends[1] = o2[1]; }
  st.passes = 0; st.log.push([side, 'play']);
  if (!st.hands[side].length) { st.over = true; st.result = side; st.why = 'empty'; return true; }
  st.turn = 1 - side;
  return true;
};
DM.canDraw = function (st, side) { return !st.over && st.turn === side && st.yard.length > 0 && DM.playable(st, side).length === 0; };
DM.draw = function (st, side) { if (!DM.canDraw(st, side)) return false; st.hands[side].push(st.yard.pop()); st.log.push([side, 'draw']); return true; };
DM.canPass = function (st, side) { return !st.over && st.turn === side && st.yard.length === 0 && DM.playable(st, side).length === 0; };
DM.pass = function (st, side) {
  if (!DM.canPass(st, side)) return false;
  st.passes++; st.log.push([side, 'pass']); st.turn = 1 - side;
  if (st.passes >= 2) {
    st.over = true; st.why = 'blocked';
    var a = DM.pips(st.hands[0]), b = DM.pips(st.hands[1]);
    st.result = a < b ? 0 : b < a ? 1 : 'draw';
  }
  return true;
};
DM.bot = function (st, level, r) {
  var pl = DM.playable(st, 1);
  if (!pl.length) return DM.canDraw(st, 1) ? { t: 'draw' } : { t: 'pass' };
  var best = null, bv = -1e9;
  pl.forEach(function (m) {
    var t = st.hands[1][m.i], other = (m.end === 'L' ? (t[0] === st.ends[0] ? t[1] : t[0]) : (t[0] === st.ends[1] ? t[1] : t[0]));
    if (!st.chain.length) other = t[0];
    // prefer heavy tiles, doubles, and leaving an end number the bot also holds
    var v = t[0] + t[1] + (t[0] === t[1] ? 3 : 0), held = 0;
    st.hands[1].forEach(function (h, k) { if (k !== m.i && (h[0] === other || h[1] === other)) held++; });
    v += held * 1.5 + (level >= 1 ? 0 : 0) + r() * 0.5;
    if (v > bv) { bv = v; best = m; }
  });
  return { t: 'play', i: best.i, end: best.end };
};

/* =====================================================================
   DURAK (throw-in version), 2 players, 36 cards 6..A. card = suit*9 + rank (rank 0 = six, 8 = ace).
   The attacker leads, the defender beats or takes, the attacker may add cards of a rank on the table.
   Side 0 = the player, side 1 = the bot. Whoever runs out of cards once the deck is empty wins.
   ===================================================================== */
var DK = VG.durak = {};
var DR = '6789TJQKA', DS = ['♠', '♥', '♦', '♣'];
DK.name = function (c) { return DR.charAt(c % 9).replace('T', '10') + DS[Math.floor(c / 9)]; };
DK.rank = function (c) { return c % 9; };
DK.suit = function (c) { return Math.floor(c / 9); };
DK.red = function (c) { var s = DK.suit(c); return s === 1 || s === 2; };
DK.beats = function (st, def, att) {
  if (DK.suit(def) === DK.suit(att)) return DK.rank(def) > DK.rank(att);
  return DK.suit(def) === st.trump && DK.suit(att) !== st.trump;
};
DK.new = function (r) {
  var deck = VG.shuffle(r, Array.apply(null, Array(36)).map(function (_, i) { return i; }));
  var st = { deck: deck, trumpCard: deck[deck.length - 1], trump: DK.suit(deck[deck.length - 1]), hands: [[], []], table: [], att: 0, stage: 'attack', taking: false, limit: 6, over: false, result: null, log: [] };
  var i; for (i = 0; i < 6; i++) { st.hands[0].push(st.deck.shift()); st.hands[1].push(st.deck.shift()); }
  // the lowest trump leads
  var low = [99, 99];
  for (i = 0; i < 2; i++) st.hands[i].forEach(function (c) { if (DK.suit(c) === st.trump) low[i] = Math.min(low[i], DK.rank(c)); });
  st.att = low[0] === low[1] ? (r() < 0.5 ? 0 : 1) : low[0] < low[1] ? 0 : 1;
  DK._startBout(st);
  return st;
};
DK._startBout = function (st) { st.table = []; st.taking = false; st.stage = 'attack'; st.limit = Math.min(6, st.hands[1 - st.att].length); };
DK.def = function (st) { return 1 - st.att; };
DK.canAttackCards = function (st) {
  var h = st.hands[st.att], out = [];
  if (st.stage !== 'attack' || st.over) return out;
  if (st.table.length >= st.limit) return out;
  if (!st.table.length) return h.slice();
  var ranks = {}; st.table.forEach(function (p) { ranks[DK.rank(p.a)] = 1; if (p.d != null) ranks[DK.rank(p.d)] = 1; });
  return h.filter(function (c) { return ranks[DK.rank(c)]; });
};
DK.attack = function (st, card) {
  if (DK.canAttackCards(st).indexOf(card) < 0) return false;
  var h = st.hands[st.att]; h.splice(h.indexOf(card), 1);
  st.table.push({ a: card, d: null });
  if (!st.taking) st.stage = 'defend';
  st.log.push([st.att, 'attack', card]);
  return true;
};
DK.undefended = function (st) { return st.table.map(function (p, i) { return p.d == null ? i : -1; }).filter(function (i) { return i >= 0; }); };
DK.defend = function (st, idx, card) {
  var d = DK.def(st), h = st.hands[d], p = st.table[idx];
  if (st.stage !== 'defend' || !p || p.d != null || h.indexOf(card) < 0 || !DK.beats(st, card, p.a)) return false;
  h.splice(h.indexOf(card), 1); p.d = card; st.log.push([d, 'defend', card]);
  if (!DK.undefended(st).length) st.stage = 'attack';
  return true;
};
DK.take = function (st) { if (st.stage !== 'defend') return false; st.taking = true; st.stage = 'attack'; st.log.push([DK.def(st), 'take']); return true; };
DK.canFinish = function (st) { return !st.over && st.stage === 'attack' && st.table.length > 0 && (st.taking || !DK.undefended(st).length); };
DK.finish = function (st) {
  if (!DK.canFinish(st)) return false;
  var a = st.att, d = 1 - a;
  if (st.taking) { st.table.forEach(function (p) { st.hands[d].push(p.a); if (p.d != null) st.hands[d].push(p.d); }); }
  st.table = [];
  [a, d].forEach(function (s) { while (st.hands[s].length < 6 && st.deck.length) st.hands[s].push(st.deck.shift()); });
  var left = [st.hands[0].length > 0, st.hands[1].length > 0];
  if (!st.deck.length && (!left[0] || !left[1])) {
    st.over = true;
    st.result = !left[0] && !left[1] ? 'draw' : !left[0] ? 0 : 1;
    return true;
  }
  if (!st.taking) st.att = d;
  DK._startBout(st);
  return true;
};
/* the bot takes one action; returns a description */
DK.bot = function (st, level, r) {
  var me = 1;
  if (st.att === me) {
    if (st.stage !== 'attack') return null;
    var opts = DK.canAttackCards(st);
    if (!opts.length) return DK.canFinish(st) ? { t: 'finish' } : null;
    opts = opts.slice().sort(function (x, y) { var tx = DK.suit(x) === st.trump ? 20 : 0, ty = DK.suit(y) === st.trump ? 20 : 0; return (tx + DK.rank(x)) - (ty + DK.rank(y)); });
    var c = opts[0];
    if (st.table.length) {
      // throw in only cheap cards, keep the trumps while the deck is long
      if (DK.suit(c) === st.trump && st.deck.length > 4) return DK.canFinish(st) ? { t: 'finish' } : { t: 'attack', c: c };
      if (!st.taking && DK.rank(c) >= 6 && r() < 0.5 && DK.canFinish(st)) return { t: 'finish' };
    }
    return { t: 'attack', c: c };
  }
  if (st.stage === 'defend') {
    var un = DK.undefended(st), idx = un[0], p = st.table[idx];
    var cand = st.hands[me].filter(function (c2) { return DK.beats(st, c2, p.a); }).sort(function (x, y) { var tx = DK.suit(x) === st.trump ? 20 : 0, ty = DK.suit(y) === st.trump ? 20 : 0; return (tx + DK.rank(x)) - (ty + DK.rank(y)); });
    if (!cand.length) return { t: 'take' };
    var c3 = cand[0];
    // do not burn a high trump on a low card while the deck is still long
    if (DK.suit(c3) === st.trump && DK.suit(p.a) !== st.trump && DK.rank(c3) >= 5 && st.deck.length > 6 && DK.rank(p.a) < 4) return { t: 'take' };
    return { t: 'defend', idx: idx, c: c3 };
  }
  return null;
};

/* =====================================================================
   BACKGAMMON (short). Each side is stored in its own coordinates: point 24 is the farthest from home,
   points 1..6 are home, and checkers move down to 0 (bear off). The opponent's checkers on my point o are a[1-s][25-o].
   Side 0 = the player (white), side 1 = the bot. No doubling cube, a win counts as one game.
   ===================================================================== */
var BG = VG.backgammon = {};
BG.new = function (r) {
  var a = [[], []], s, o;
  for (s = 0; s < 2; s++) for (o = 0; o <= 25; o++) a[s][o] = 0;
  for (s = 0; s < 2; s++) { a[s][24] = 2; a[s][13] = 5; a[s][8] = 3; a[s][6] = 5; }
  var st = { a: a, bar: [0, 0], off: [0, 0], turn: 0, dice: [], rem: [], seqs: [], done: [], over: false, result: null, rolled: false, log: [] };
  var d0, d1; do { d0 = 1 + Math.floor(r() * 6); d1 = 1 + Math.floor(r() * 6); } while (d0 === d1);
  st.turn = d0 > d1 ? 0 : 1; st.opening = [d0, d1];
  BG._setDice(st, [d0, d1]);
  return st;
};
BG.roll = function (st, r) { if (st.rolled || st.over) return false; BG._setDice(st, [1 + Math.floor(r() * 6), 1 + Math.floor(r() * 6)]); return true; };
BG._setDice = function (st, d) {
  st.dice = d.slice(); st.rolled = true; st.done = [];
  st.rem = d[0] === d[1] ? [d[0], d[0], d[0], d[0]] : d.slice();
  st.seqs = BG._sequences(st, st.turn, st.rem);
  if (!st.seqs.length) st.seqs = [];
};
function bgCopy(st) { return { a: [st.a[0].slice(), st.a[1].slice()], bar: st.bar.slice(), off: st.off.slice() }; }
function bgAllHome(g, s) { if (g.bar[s]) return false; var o; for (o = 7; o <= 24; o++) if (g.a[s][o]) return false; return true; }
BG._moves = function (g, s, die) {
  var out = [], o;
  if (g.bar[s] > 0) { var t = 25 - die; if (g.a[1 - s][die] <= 1) out.push({ o: 25, d: die, t: t }); return out; }
  var home = bgAllHome(g, s);
  for (o = 24; o >= 1; o--) {
    if (!g.a[s][o]) continue;
    var tt = o - die;
    if (tt >= 1) { if (g.a[1 - s][25 - tt] <= 1) out.push({ o: o, d: die, t: tt }); }
    else if (home) {
      if (tt === 0) out.push({ o: o, d: die, t: 0 });
      else { var higher = false, k; for (k = o + 1; k <= 6; k++) if (g.a[s][k]) higher = true; if (!higher) out.push({ o: o, d: die, t: 0 }); }
    }
  }
  return out;
};
BG._apply = function (g, s, m) {
  if (m.o === 25) g.bar[s]--; else g.a[s][m.o]--;
  if (m.t === 0) g.off[s]++;
  else { g.a[s][m.t]++; var op = 25 - m.t; if (g.a[1 - s][op] === 1) { g.a[1 - s][op] = 0; g.bar[1 - s]++; m.hit = true; } }
};
BG._sequences = function (st, s, dice) {
  var res = [], best = 0;
  function dfs(g, rem, seq) {
    var any = false, tried = {}, i;
    for (i = 0; i < rem.length; i++) {
      var die = rem[i]; if (tried[die]) continue; tried[die] = 1;
      var mv = BG._moves(g, s, die);
      mv.forEach(function (m) {
        any = true;
        var g2 = { a: [g.a[0].slice(), g.a[1].slice()], bar: g.bar.slice(), off: g.off.slice() }, mm = { o: m.o, d: m.d, t: m.t };
        BG._apply(g2, s, mm);
        var r2 = rem.slice(); r2.splice(i, 1);
        dfs(g2, r2, seq.concat([mm]));
      });
    }
    if (!any || !rem.length) { if (seq.length >= best) { if (seq.length > best) { best = seq.length; res = []; } res.push(seq); } }
  }
  dfs(bgCopy(st), dice.slice(), []);
  res = res.filter(function (q) { return q.length === best; });
  if (best === 0) return [];
  // only one die can be played: the larger one must be used if possible
  if (best === 1 && dice.length === 2 && dice[0] !== dice[1]) {
    var big = Math.max(dice[0], dice[1]), withBig = res.filter(function (q) { return q[0].d === big; });
    if (withBig.length) res = withBig;
  }
  // drop duplicates
  var seen = {}, uniq = [];
  res.forEach(function (q) { var k = q.map(function (m) { return m.o + '-' + m.d; }).join(','); if (!seen[k]) { seen[k] = 1; uniq.push(q); } });
  return uniq;
};
/* the legal next single moves, given the moves already made this turn */
BG.options = function (st, side) {
  if (st.over || st.turn !== side || !st.rolled) return [];
  var n = st.done.length, seen = {}, out = [];
  st.seqs.forEach(function (q) { if (q.length > n) { var m = q[n], k = m.o + '-' + m.d; if (!seen[k]) { seen[k] = 1; out.push({ o: m.o, d: m.d, t: m.t }); } } });
  return out;
};
BG.move = function (st, side, o, d) {
  var opts = BG.options(st, side), m = null, i;
  for (i = 0; i < opts.length; i++) if (opts[i].o === o && opts[i].d === d) m = opts[i];
  if (!m) return false;
  var mm = { o: m.o, d: m.d, t: m.t }; BG._apply({ a: st.a, bar: st.bar, off: st.off }, side, mm);
  var n = st.done.length;
  st.seqs = st.seqs.filter(function (q) { return q.length > n && q[n].o === o && q[n].d === d; });
  st.done.push(mm);
  var ri = st.rem.indexOf(d); if (ri > -1) st.rem.splice(ri, 1);
  if (st.off[side] === 15) { st.over = true; st.result = side; st.rolled = false; return true; }
  if (!BG.options(st, side).length) BG._endTurn(st);
  return true;
};
BG._endTurn = function (st) { st.turn = 1 - st.turn; st.rolled = false; st.dice = []; st.rem = []; st.seqs = []; st.done = []; };
/* a turn that has no legal move at all */
BG.noMoves = function (st) { return !st.over && st.rolled && BG.options(st, st.turn).length === 0 && !st.done.length; };
BG.skip = function (st) { if (!BG.noMoves(st)) return false; BG._endTurn(st); return true; };
BG.pips = function (st, s) { var p = 0, o; for (o = 1; o <= 24; o++) p += st.a[s][o] * o; return p + st.bar[s] * 25; };
BG.count = function (st, s) { var n = st.bar[s] + st.off[s], o; for (o = 1; o <= 24; o++) n += st.a[s][o]; return n; };
/* the bot picks the whole turn by scoring every legal sequence */
BG.bot = function (st, level, r) {
  if (!st.seqs.length) return [];
  var best = null, bv = -1e9;
  st.seqs.forEach(function (q) {
    var g = bgCopy(st), hits = 0;
    q.forEach(function (m) { var mm = { o: m.o, d: m.d, t: m.t }; BG._apply(g, 1, mm); if (mm.hit) hits++; });
    var v = hits * 14 + g.off[1] * 8 - g.bar[0] * -10;
    var pipsMe = 0, pipsOp = 0, o, blots = 0, points = 0, home = 0;
    for (o = 1; o <= 24; o++) {
      pipsMe += g.a[1][o] * o; pipsOp += g.a[0][o] * o;
      if (g.a[1][o] === 1) { var exposed = 0, k; for (k = 1; k <= 24; k++) if (g.a[0][k]) { var dist = k - (25 - o); if (dist >= 1 && dist <= 12) exposed = 1; } blots += exposed ? 1 : 0.2; }
      if (g.a[1][o] >= 2) points += o <= 12 ? 1 : 0.6;
      if (o <= 6) home += g.a[1][o];
    }
    pipsOp += g.bar[0] * 25; pipsMe += g.bar[1] * 25;
    v += (pipsOp - pipsMe) * 0.35 - blots * 6 + points * 2.5 + home * 0.5 - g.bar[1] * 12 + (level >= 1 ? 0 : 0) + r() * 1.5;
    if (v > bv) { bv = v; best = q; }
  });
  return best.map(function (m) { return { o: m.o, d: m.d }; });
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
