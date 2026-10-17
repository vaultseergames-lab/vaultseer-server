/* ===== Game engines, part 6: Connect Four, Reversi, Ludo, Liar's Dice =====
   Pure logic, no DOM. The same file runs in the browser (demo against the computer, result checks) and on the game server.
   Players are numbered 1 and 2 (or seats 0..n-1). Dice in Ludo and Liar's Dice come from the same commit-and-reveal scheme as the slots:
   the server commits to sha256(nonce), every player adds a random seed when he rolls, die = f(nonce, number, seed). */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
if (!VG.chance && typeof require !== 'undefined') require('./games5.js');

function hex2int(h) { return parseInt(h.slice(0, 12), 16); }
function die6(key) { return hex2int(VG.sha256(key)) % 6 + 1; }

/* =====================================================================
   CONNECT FOUR. Board 7 columns x 6 rows, index = row*7+col, row 0 is the top. Cells: 0 empty, 1 and 2 = the two players.
   A disc falls to the lowest free cell of the column. Four in a row (any direction) wins; a full board is a draw.
   ===================================================================== */
var C4 = VG.connect4 = {};
C4.COLS = 7; C4.ROWS = 6;
C4.init = function (first) { var b = [], i; for (i = 0; i < 42; i++) b.push(0); return { b: b, turn: first === 2 ? 2 : 1, n: 0, at: -1, line: null, over: false, result: null }; };
C4.copy = function (st) { return { b: st.b.slice(), turn: st.turn, n: st.n, at: st.at, line: st.line, over: st.over, result: st.result }; };
C4.row = function (b, col) { var r; for (r = 5; r >= 0; r--) if (!b[r * 7 + col]) return r; return -1; };
C4.moves = function (st) { var out = [], c; if (st.over) return out; for (c = 0; c < 7; c++) if (!st.b[c]) out.push(c); return out; };
/* the cells of the winning line through cell i (4 or more in a row), or null */
C4.lineAt = function (b, i) {
  var p = b[i], r0 = (i / 7) | 0, c0 = i % 7, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], d, k, cells, r, c;
  if (!p) return null;
  for (d = 0; d < 4; d++) {
    cells = [i];
    for (k = 1; k < 7; k++) { r = r0 + dirs[d][0] * k; c = c0 + dirs[d][1] * k; if (r < 0 || r > 5 || c < 0 || c > 6 || b[r * 7 + c] !== p) break; cells.push(r * 7 + c); }
    for (k = 1; k < 7; k++) { r = r0 - dirs[d][0] * k; c = c0 - dirs[d][1] * k; if (r < 0 || r > 5 || c < 0 || c > 6 || b[r * 7 + c] !== p) break; cells.push(r * 7 + c); }
    if (cells.length >= 4) return cells.sort(function (x, y) { return x - y; });
  }
  return null;
};
/* drop a disc of the player whose turn it is; returns the cell index or -1 when the column is full or the game is over */
C4.drop = function (st, col) {
  if (st.over || col < 0 || col > 6 || col !== (col | 0)) return -1;
  var r = C4.row(st.b, col); if (r < 0) return -1;
  var i = r * 7 + col, p = st.turn;
  st.b[i] = p; st.n++; st.at = i;
  var ln = C4.lineAt(st.b, i);
  if (ln) { st.over = true; st.line = ln; st.result = p; } else if (st.n >= 42) { st.over = true; st.result = 3; } else st.turn = 3 - p;
  return i;
};
/* heuristic value of the board for player p (higher = better for p) */
C4.value = function (b, p) {
  var s = 0, q = 3 - p, r, c, d, k, mine, theirs, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], r2, c2;
  for (r = 0; r < 6; r++) if (b[r * 7 + 3] === p) s += 3; else if (b[r * 7 + 3] === q) s -= 3;
  for (r = 0; r < 6; r++) for (c = 0; c < 7; c++) for (d = 0; d < 4; d++) {
    r2 = r + dirs[d][0] * 3; c2 = c + dirs[d][1] * 3; if (r2 < 0 || r2 > 5 || c2 < 0 || c2 > 6) continue;
    mine = 0; theirs = 0;
    for (k = 0; k < 4; k++) { var v = b[(r + dirs[d][0] * k) * 7 + c + dirs[d][1] * k]; if (v === p) mine++; else if (v === q) theirs++; }
    if (mine && !theirs) s += mine === 3 ? 6 : mine === 2 ? 2 : 0; else if (theirs && !mine) s -= theirs === 3 ? 7 : theirs === 2 ? 2 : 0;
  }
  return s;
};
function c4neg(st, depth, alpha, beta, me) {
  if (st.over) return st.result === 3 ? 0 : (st.result === st.turn ? 1 : -1) * (100000 + depth);
  if (depth === 0) return C4.value(st.b, st.turn);
  var order = [3, 2, 4, 1, 5, 0, 6], best = -Infinity, i, col, ch, v;
  for (i = 0; i < 7; i++) {
    col = order[i]; if (st.b[col]) continue;
    ch = C4.copy(st); C4.drop(ch, col);
    v = ch.over ? (ch.result === 3 ? 0 : 100000 + depth) : -c4neg(ch, depth - 1, -beta, -alpha, me);
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
}
/* the computer: level 0 = weak, 1 = medium, 2+ = strong */
C4.bot = function (st, level, rnd) {
  var mv = C4.moves(st), depth = 2 + Math.min(level || 0, 3), scores = [], best = -Infinity, i, ch;
  if (!mv.length) return -1;
  for (i = 0; i < mv.length; i++) {
    ch = C4.copy(st); C4.drop(ch, mv[i]);
    scores.push(ch.over ? (ch.result === 3 ? 0 : 100000) : -c4neg(ch, depth - 1, -Infinity, Infinity, st.turn));
    if (scores[i] > best) best = scores[i];
  }
  var top = mv.filter(function (m, k) { return scores[k] >= best - (level ? 0 : 3); });
  return top[Math.floor((rnd || Math.random)() * top.length)];
};

/* =====================================================================
   REVERSI (Othello). Board 8x8, index = row*8+col. Cells: 0 empty, 1 and 2 = the two players.
   A move must flip at least one line of the opponent's discs between the new disc and one of your own.
   A player with no move is skipped; when nobody can move the player with more discs wins, equal = draw.
   ===================================================================== */
var RV = VG.reversi = {};
var RDIR = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
RV.init = function (first) {
  var b = [], i; for (i = 0; i < 64; i++) b.push(0);
  b[27] = 2; b[28] = 1; b[35] = 1; b[36] = 2;
  return { b: b, turn: first === 2 ? 2 : 1, n: 0, ev: null, skipped: 0, over: false, result: null };
};
RV.copy = function (st) { return { b: st.b.slice(), turn: st.turn, n: st.n, ev: st.ev, skipped: st.skipped, over: st.over, result: st.result }; };
RV.flips = function (b, i, p) {
  var out = [], r0 = (i / 8) | 0, c0 = i % 8, d, k, r, c, line;
  if (b[i]) return out;
  for (d = 0; d < 8; d++) {
    line = []; r = r0 + RDIR[d][0]; c = c0 + RDIR[d][1];
    while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === 3 - p) { line.push(r * 8 + c); r += RDIR[d][0]; c += RDIR[d][1]; }
    if (line.length && r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === p) for (k = 0; k < line.length; k++) out.push(line[k]);
  }
  return out;
};
RV.movesFor = function (b, p) { var out = [], i; for (i = 0; i < 64; i++) if (!b[i] && RV.flips(b, i, p).length) out.push(i); return out; };
RV.moves = function (st) { return st.over ? [] : RV.movesFor(st.b, st.turn); };
RV.counts = function (b) { var a = 0, w = 0, i; for (i = 0; i < 64; i++) { if (b[i] === 1) a++; else if (b[i] === 2) w++; } return [a, w]; };
/* play cell i for the player to move; returns the flipped cells, or null when the move is illegal */
RV.play = function (st, i) {
  if (st.over || i !== (i | 0) || i < 0 || i > 63) return null;
  var p = st.turn, fl = RV.flips(st.b, i, p), k; if (!fl.length) return null;
  st.b[i] = p; for (k = 0; k < fl.length; k++) st.b[fl[k]] = p;
  st.n++; st.ev = { i: i, p: p, flips: fl };
  var opp = 3 - p;
  if (RV.movesFor(st.b, opp).length) { st.turn = opp; st.skipped = 0; }
  else if (RV.movesFor(st.b, p).length) { st.turn = p; st.skipped = opp; }
  else { var c = RV.counts(st.b); st.over = true; st.skipped = 0; st.result = c[0] === c[1] ? 3 : c[0] > c[1] ? 1 : 2; }
  return fl;
};
var RW = [100, -20, 10, 5, 5, 10, -20, 100, -20, -50, -2, -2, -2, -2, -50, -20, 10, -2, -1, -1, -1, -1, -2, 10, 5, -2, -1, -1, -1, -1, -2, 5,
  5, -2, -1, -1, -1, -1, -2, 5, 10, -2, -1, -1, -1, -1, -2, 10, -20, -50, -2, -2, -2, -2, -50, -20, 100, -20, 10, 5, 5, 10, -20, 100];
RV.value = function (st, p) {
  var s = 0, i, q = 3 - p;
  for (i = 0; i < 64; i++) { if (st.b[i] === p) s += RW[i]; else if (st.b[i] === q) s -= RW[i]; }
  return s + 4 * (RV.movesFor(st.b, p).length - RV.movesFor(st.b, q).length);
};
function rvSearch(st, depth, alpha, beta, me) {
  if (st.over) { var c = RV.counts(st.b), d = (me === 1 ? c[0] - c[1] : c[1] - c[0]); return d === 0 ? 0 : d > 0 ? 10000 + d : -10000 + d; }
  if (depth === 0) return RV.value(st, me);
  var mv = RV.moves(st), maxing = st.turn === me, best = maxing ? -Infinity : Infinity, i, ch, v;
  for (i = 0; i < mv.length; i++) {
    ch = RV.copy(st); RV.play(ch, mv[i]); v = rvSearch(ch, depth - 1, alpha, beta, me);
    if (maxing) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}
RV.bot = function (st, level, rnd) {
  var mv = RV.moves(st), depth = 1 + Math.min(level || 0, 3), scores = [], best = -Infinity, i, ch;
  if (!mv.length) return -1;
  for (i = 0; i < mv.length; i++) { ch = RV.copy(st); RV.play(ch, mv[i]); scores.push(level === 0 && depth === 1 ? RV.value(ch, st.turn) : rvSearch(ch, depth - 1, -Infinity, Infinity, st.turn)); if (scores[i] > best) best = scores[i]; }
  var top = mv.filter(function (m, k) { return scores[k] >= best - (level ? 0 : 6); });
  return top[Math.floor((rnd || Math.random)() * top.length)];
};

/* =====================================================================
   LUDO. 2 to 4 players, 4 tokens each, a ring of 52 cells and a private lane of 5 cells to the centre.
   A token's position r: -1 = in the base, 0..51 = on the ring (cell (start + r) mod 52, start = 13 * colour), 52..56 = its lane, 57 = home.
   A 6 takes a token out of the base to its start cell and gives another roll (three sixes in a row void the third roll).
   Landing on a cell with enemy tokens sends them back to their base, except on the 8 safe cells. A token needs the exact roll to get home.
   The first player with all four tokens home wins. The game lasts at most 100 rolls per player; then the player who has gone furthest wins (equal = shared).
   ===================================================================== */
var LU = VG.ludo = {};
LU.RING = 52; LU.HOME = 57; LU.ROLLS_EACH = 100;
LU.maxRolls = function (n) { return LU.ROLLS_EACH * n; };
LU.colors = function (n) { return n === 2 ? [0, 2] : n === 3 ? [0, 1, 2] : [0, 1, 2, 3]; };
LU.safe = function (cell) { var m = cell % 13; return m === 0 || m === 8; };
LU.cell = function (st, seat, r) { return (st.colors[seat] * 13 + r) % 52; };
LU.init = function (n) {
  var tok = [], i; for (i = 0; i < n; i++) tok.push([-1, -1, -1, -1]);
  return { n: n, colors: LU.colors(n), tok: tok, turn: 0, phase: 'roll', die: 0, sixes: 0, rolls: 0, over: false, winners: null, ev: null };
};
LU.copy = function (st) { return JSON.parse(JSON.stringify(st)); };
/* the new position of token t of `seat` after rolling `die`, or null when it cannot move */
LU.dest = function (st, seat, t, die) {
  var r = st.tok[seat][t];
  if (r === -1) return die === 6 ? 0 : null;
  return r + die > LU.HOME ? null : r + die;
};
LU.movable = function (st, seat, die) { var out = [], t; for (t = 0; t < 4; t++) if (LU.dest(st, seat, t, die) !== null) out.push(t); return out; };
LU.legal = function (st) { return st.over || st.phase !== 'move' ? [] : LU.movable(st, st.turn, st.die); };
LU.progress = function (st, seat) { var s = 0, t; for (t = 0; t < 4; t++) s += st.tok[seat][t] + 1; return s; };
function luEnd(st) { st.sixes = 0; st.turn = (st.turn + 1) % st.n; st.phase = 'roll'; }
/* every token that can move stands on the same cell (for example all of them are still in the base): there is nothing to choose */
function luAlike(st, lg) { return lg.every(function (t) { return st.tok[st.turn][t] === st.tok[st.turn][lg[0]]; }); }
function luCap(st) {
  if (st.over || st.rolls < LU.maxRolls(st.n)) return;
  var best = -1, w = [], s, p;
  for (s = 0; s < st.n; s++) { p = LU.progress(st, s); if (p > best) { best = p; w = [s]; } else if (p === best) w.push(s); }
  st.over = true; st.winners = w; st.capped = true;
}
/* a roll with the value `die` (1..6) by the player to move; a move that is forced (only one token can go) is played at once */
LU.roll = function (st, die) {
  if (st.over || st.phase !== 'roll' || die < 1 || die > 6) return false;
  st.rolls++; st.die = die; st.ev = { seat: st.turn, die: die, tok: -1, from: 0, to: 0, caps: [] };
  if (die === 6) st.sixes++;
  if (die === 6 && st.sixes >= 3) { st.ev.void = true; luEnd(st); luCap(st); return true; }
  var lg = LU.movable(st, st.turn, die);
  if (!lg.length) { st.ev.pass = true; luEnd(st); }
  else if (luAlike(st, lg)) { st.phase = 'move'; LU.move(st, lg[0], true); }
  else st.phase = 'move';
  if (st.phase !== 'move') luCap(st);
  return true;
};
LU.move = function (st, t, auto) {
  if (st.over || st.phase !== 'move' || LU.legal(st).indexOf(t) < 0) return false;
  var seat = st.turn, r = st.tok[seat][t], nr = LU.dest(st, seat, t, st.die), caps = [], o, u, cell;
  st.tok[seat][t] = nr;
  if (nr >= 0 && nr <= 51) {
    cell = LU.cell(st, seat, nr);
    if (!LU.safe(cell)) for (o = 0; o < st.n; o++) if (o !== seat) for (u = 0; u < 4; u++) { var q = st.tok[o][u]; if (q >= 0 && q <= 51 && LU.cell(st, o, q) === cell) { st.tok[o][u] = -1; caps.push({ seat: o, tok: u }); } }
  }
  st.ev = { seat: seat, die: st.die, tok: t, from: r, to: nr, caps: caps, auto: !!auto };
  if (st.tok[seat].every(function (x) { return x === LU.HOME; })) { st.over = true; st.winners = [seat]; return true; }
  if (st.die === 6) st.phase = 'roll'; else luEnd(st);
  luCap(st);
  return true;
};
/* which token the computer (or the server for a player who is out) moves */
LU.choose = function (st, rnd) {
  var lg = LU.legal(st), seat = st.turn, best = -1, bi = lg[0], i;
  for (i = 0; i < lg.length; i++) {
    var t = lg[i], r = st.tok[seat][t], nr = LU.dest(st, seat, t, st.die), sc = nr / 57 * 20, cell, o, u;
    if (nr === LU.HOME) sc += 100;
    if (r === -1) sc += 35;
    if (nr >= 0 && nr <= 51) {
      cell = LU.cell(st, seat, nr);
      if (LU.safe(cell)) sc += 12; else for (o = 0; o < st.n; o++) if (o !== seat) for (u = 0; u < 4; u++) { var q = st.tok[o][u]; if (q >= 0 && q <= 51 && LU.cell(st, o, q) === cell) sc += 60; }
      if (r >= 0 && r <= 51 && !LU.safe(LU.cell(st, seat, r))) sc += 6;
    }
    if (r >= 52 && nr < LU.HOME) sc -= 4;
    sc += ((rnd || Math.random)()) * 3;
    if (sc > best) { best = sc; bi = t; }
  }
  return bi;
};
/* dice: die number i of the game, rolled with the seed that player added */
LU.die = function (nonce, i, seed) { return die6(nonce + '|ludo|' + i + '|' + seed); };
/* log = [{ i, seed, die }]; true when every die recomputes */
LU.verify = function (v) {
  if (!v || !v.nonce) return null;
  if (VG.chance.commit(v.nonce) !== v.commit) return false;
  return v.log.every(function (x, k) { return x.i === k + 1 && LU.die(v.nonce, x.i, x.seed) === x.die; });
};

/* =====================================================================
   LIAR'S DICE. 2 to 9 players. Everybody has a cup of dice (5, 4 or 3 each, by table size) and only sees his own.
   A round: everybody shakes (adds a seed), then in turn each player bids "at least q dice show f" (a higher q, or the same q with a higher f)
   or calls "liar". On a call all dice are shown and counted (no wild dice): if there are at least q dice showing f the caller loses a die, else the bidder does.
   The loser starts the next round. A player with no dice is out of the game; the last one with dice wins.
   ===================================================================== */
var LD = VG.liars = {};
LD.diceEach = function (n) { return n <= 3 ? 5 : n <= 5 ? 4 : 3; };
LD.init = function (n, start) {
  var cnt = [], i; for (i = 0; i < n; i++) cnt.push(LD.diceEach(n));
  return { n: n, cnt: cnt, round: 0, phase: 'roll', dice: null, bid: null, turn: start || 0, start: start || 0, over: false, winner: null, prev: null, rows: [] };
};
LD.total = function (st) { return st.cnt.reduce(function (a, b) { return a + b; }, 0); };
LD.alive = function (st) { var out = [], i; for (i = 0; i < st.n; i++) if (st.cnt[i] > 0) out.push(i); return out; };
LD.next = function (st, s) { var k; for (k = 1; k <= st.n; k++) { var x = (s + k) % st.n; if (st.cnt[x] > 0) return x; } return s; };
/* dice[s] = the dice of seat s (empty for a player with none) */
LD.begin = function (st, dice) { st.round++; st.dice = dice; st.phase = 'bid'; st.bid = null; st.turn = st.start; };
LD.canBid = function (st, q, f) {
  if (st.over || st.phase !== 'bid' || q !== (q | 0) || f !== (f | 0) || f < 1 || f > 6 || q < 1 || q > LD.total(st)) return false;
  return !st.bid || q > st.bid.q || (q === st.bid.q && f > st.bid.f);
};
LD.bid = function (st, q, f) { if (!LD.canBid(st, q, f)) return false; st.bid = { q: q, f: f, by: st.turn }; st.turn = LD.next(st, st.turn); return true; };
LD.count = function (st, f) { var c = 0; st.dice.forEach(function (d) { d.forEach(function (x) { if (x === f) c++; }); }); return c; };
LD.canLiar = function (st) { return !st.over && st.phase === 'bid' && !!st.bid; };
LD.liar = function (st) {
  if (!LD.canLiar(st)) return false;
  var cnt = LD.count(st, st.bid.f), bidTrue = cnt >= st.bid.q, loser = bidTrue ? st.turn : st.bid.by;
  var row = { round: st.round, dice: st.dice.map(function (d) { return d.slice(); }), bid: { q: st.bid.q, f: st.bid.f }, caller: st.turn, bidder: st.bid.by, count: cnt, bidTrue: bidTrue, loser: loser, seeds: st.seeds || null };
  st.cnt[loser]--; st.prev = row; st.rows.push(row);
  var alive = LD.alive(st);
  if (alive.length === 1) { st.over = true; st.winner = alive[0]; st.phase = 'over'; }
  else { st.start = st.cnt[loser] > 0 ? loser : LD.next(st, loser); st.phase = 'roll'; st.dice = null; st.bid = null; st.turn = st.start; }
  return true;
};
/* the chance that at least k of m unknown dice show a given face */
function binomTail(m, k) {
  if (k <= 0) return 1; if (k > m) return 0;
  var p = 1 / 6, s = 0, i, c;
  for (i = k; i <= m; i++) { c = 1; for (var j = 0; j < i; j++) c = c * (m - j) / (j + 1); s += c * Math.pow(p, i) * Math.pow(1 - p, m - i); }
  return s;
}
LD.chanceTrue = function (st, seat, q, f) {
  var mine = st.dice[seat].filter(function (x) { return x === f; }).length, unknown = LD.total(st) - st.dice[seat].length;
  return binomTail(unknown, q - mine);
};
/* the computer's move: { t:'liar' } or { t:'bid', q, f } */
LD.bot = function (st, seat, rnd) {
  var r = rnd || Math.random, total = LD.total(st), q, f, best = null, bestP = -1;
  if (st.bid) { var pb = LD.chanceTrue(st, seat, st.bid.q, st.bid.f); if (pb < 0.3 + r() * 0.1) return { t: 'liar' }; }
  for (q = 1; q <= total; q++) for (f = 1; f <= 6; f++) {
    if (!LD.canBid(st, q, f)) continue;
    var p = LD.chanceTrue(st, seat, q, f);
    if (p >= 0.42 && (!best || q < best.q || (q === best.q && p > bestP))) { best = { t: 'bid', q: q, f: f }; bestP = p; }
  }
  if (best) return best;
  if (st.bid) return { t: 'liar' };
  return { t: 'bid', q: 1, f: 1 };
};
/* fair dice: player seat s, die k of the round come from the shared mix of nonce, round and every seed (a seed is '-' for a player with no dice) */
LD.diceFor = function (nonce, round, seeds, cnt) {
  var mix = VG.chance.mix(nonce, round, seeds), out = [], s, k, d;
  for (s = 0; s < cnt.length; s++) { d = []; for (k = 0; k < cnt[s]; k++) d.push(die6(mix + ':' + s + ':' + k)); out.push(d); }
  return out;
};
LD.firstStart = function (nonce, n) { return hex2int(VG.sha256(nonce + ':start')) % n; };
/* v = { commit, nonce, n, rows } where every row has the dice counts before the round (cnt) as the engine knew them */
LD.verify = function (v) {
  if (!v || !v.nonce) return null;
  if (VG.chance.commit(v.nonce) !== v.commit) return false;
  var cnt = [], i; for (i = 0; i < v.n; i++) cnt.push(LD.diceEach(v.n));
  var start = LD.firstStart(v.nonce, v.n), ok = true;
  v.rows.forEach(function (r) {
    if (!ok) return;
    var d = LD.diceFor(v.nonce, r.round, r.seeds, cnt);
    if (JSON.stringify(d) !== JSON.stringify(r.dice) || r.caller === undefined) ok = false;
    var c = 0; d.forEach(function (x) { x.forEach(function (y) { if (y === r.bid.f) c++; }); });
    if (c !== r.count || (c >= r.bid.q) !== r.bidTrue || r.loser !== (r.bidTrue ? r.caller : r.bidder)) ok = false;
    cnt[r.loser]--;
  });
  return ok;
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
