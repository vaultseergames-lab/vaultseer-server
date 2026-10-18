/* ===== Game engines, part 10: skill games for many players =====
   Chinese Checkers (2-6), Blokus (2-4), Quoridor (2-4), Light Cycles (2-8). Same interface as games7.js, but the state holds n players and `turn`
   is the index of the player to move. No randomness; every move is public. Pure logic, no DOM. */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
if (typeof require !== 'undefined' && !VG.sk) require('./games7.js');
var SK = VG.sk;
var ZERO = function (n) { var a = [], i; for (i = 0; i < n; i++) a.push(0); return a; };

/* =====================================================================
   CHINESE CHECKERS, 2 to 6 players. The 121-hole star. Each player has 10 marbles in one corner and has to bring all of them to the opposite corner.
   A move: step one marble to a free neighbouring hole, OR jump over a neighbouring marble (any colour) into the free hole right behind it, and keep jumping
   with the same marble as long as you like (every jump over one marble into a free hole). Move = { f, t } (the hole the marble leaves, the hole it ends in).
   The first player to fill the opposite corner with his own 10 marbles wins. If nobody has done it after 150 moves each, the player who is
   furthest along wins (several players share when equal).
   Holes are numbered row by row from the top (17 rows).
   ===================================================================== */
var CC = SK.def({ id: 'chinese', seats: [2, 6], perMove: 45000, CAPMOVES: 150 });
CC.ROWS = [[12], [11, 13], [10, 12, 14], [9, 11, 13, 15], [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24], [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23], [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], [3, 5, 7, 9, 11, 13, 15, 17, 19, 21], [4, 6, 8, 10, 12, 14, 16, 18, 20],
  [3, 5, 7, 9, 11, 13, 15, 17, 19, 21], [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22], [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23], [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24], [9, 11, 13, 15], [10, 12, 14], [11, 13], [12]];
CC.XY = []; CC.AT = {};
(function () { var r, k, i = 0; for (r = 0; r < CC.ROWS.length; r++) for (k = 0; k < CC.ROWS[r].length; k++) { CC.XY.push([r, CC.ROWS[r][k]]); CC.AT[r + ',' + CC.ROWS[r][k]] = i; i++; } })();
CC.N = CC.XY.length;
CC.DIRS = [[0, -2], [0, 2], [-1, -1], [-1, 1], [1, -1], [1, 1]];
CC.NB = []; CC.JUMP = [];
(function () { var i, d, r, x, a, j; for (i = 0; i < CC.N; i++) { var nb = [], jp = []; r = CC.XY[i][0]; x = CC.XY[i][1]; for (d = 0; d < 6; d++) { a = CC.AT[(r + CC.DIRS[d][0]) + ',' + (x + CC.DIRS[d][1])]; j = CC.AT[(r + 2 * CC.DIRS[d][0]) + ',' + (x + 2 * CC.DIRS[d][1])]; nb.push(a === undefined ? -1 : a); jp.push(j === undefined ? -1 : j); } CC.NB.push(nb); CC.JUMP.push(jp); } })();
/* the six corner triangles, in circular order: top, upper right, lower right, bottom, lower left, upper left */
CC.CORNERS = (function () {
  var c = [[], [], [], [], [], []], i, r, x;
  for (i = 0; i < CC.N; i++) {
    r = CC.XY[i][0]; x = CC.XY[i][1];
    if (r <= 3) c[0].push(i);
    else if (r >= 13) c[3].push(i);
    else if (r <= 7 && x <= 6 - (r - 4)) c[5].push(i);
    else if (r <= 7 && x >= 18 + (r - 4)) c[1].push(i);
    else if (r >= 9 && r <= 12 && x <= 6 - (12 - r)) c[4].push(i);
    else if (r >= 9 && r <= 12 && x >= 18 + (12 - r)) c[2].push(i);
  }
  return c;
})();
CC.START = { 2: [0, 3], 3: [0, 2, 4], 4: [1, 2, 4, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
CC.init = function (n, first) {
  var b = ZERO(CC.N), cs = CC.START[n], i, k, corners = [], goal = [];
  for (i = 0; i < n; i++) { CC.CORNERS[cs[i]].forEach(function (c) { b[c] = i + 1; }); corners.push(cs[i]); }
  var st = SK.base(n, first, { b: b, home: corners });
  st.moves_by = ZERO(n);
  return st;
};
CC.copy = function (st) { return { n: st.n, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), home: st.home.slice(), moves_by: st.moves_by.slice() }; };
/* the holes of the goal corner of player p */
CC.goalOf = function (st, p) { return CC.CORNERS[(st.home[p] + 3) % 6]; };
/* a step is one move; a jump chain starts with a jump, so the reach of a marble is either [one step] or [the jump chain's holes] */
CC.reachMoves = function (b, f) {
  var steps = [], jumps = [], seen = {}, stack = [f], d, a, j, x;
  for (d = 0; d < 6; d++) { a = CC.NB[f][d]; if (a >= 0 && b[a] === 0) steps.push(a); }
  seen[f] = 1;
  while (stack.length) {
    x = stack.pop();
    for (d = 0; d < 6; d++) { a = CC.NB[x][d]; j = CC.JUMP[x][d]; if (a >= 0 && j >= 0 && b[a] !== 0 && b[j] === 0 && !seen[j]) { seen[j] = 1; stack.push(j); jumps.push(j); } }
  }
  steps.forEach(function (s) { if (!seen[s]) { seen[s] = 1; jumps.push(s); } });
  return jumps;
};
CC.moves = function (st) {
  var out = [], p = st.turn + 1, i, r, k; if (st.over) return out;
  for (i = 0; i < CC.N; i++) if (st.b[i] === p) { r = CC.reachMoves(st.b, i); for (k = 0; k < r.length; k++) out.push({ f: i, t: r[k] }); }
  return out;
};
CC.find = function (st, mv) {
  var r, k;
  if (!mv || st.over || typeof mv !== 'object' || Object.keys(mv).length !== 2 || typeof mv.f !== 'number' || typeof mv.t !== 'number' || mv.f !== (mv.f | 0) || mv.t !== (mv.t | 0) || mv.f < 0 || mv.f >= CC.N || mv.t < 0 || mv.t >= CC.N) return null;
  if (st.b[mv.f] !== st.turn + 1 || st.b[mv.t] !== 0) return null;
  r = CC.reachMoves(st.b, mv.f);
  return r.indexOf(mv.t) >= 0 ? { f: mv.f, t: mv.t } : null;
};
/* progress of player p: sum over his marbles of (distance from home to goal) minus current remaining distance; larger is better */
CC.dist = function (st, p, hole) { var g = CC.GOALPT(st.home[p]), xy = CC.XY[hole]; return CC.hexDist(xy, g); };
CC.GOALPT = function (home) { var tri = CC.CORNERS[(home + 3) % 6], i, r = 0, x = 0; for (i = 0; i < tri.length; i++) { r += CC.XY[tri[i]][0]; x += CC.XY[tri[i]][1]; } return [r / tri.length, x / tri.length]; };
CC.hexDist = function (a, b) { var dr = Math.abs(a[0] - b[0]), dx = Math.abs(a[1] - b[1]); return dr + Math.max(0, (dx - dr) / 2); };
CC.remaining = function (st, p) { var i, s = 0, g = CC.GOALPT(st.home[p]); for (i = 0; i < CC.N; i++) if (st.b[i] === p + 1) s += CC.hexDist(CC.XY[i], g); return s; };
CC.inGoal = function (st, p) { var g = CC.goalOf(st, p), i, n = 0; for (i = 0; i < g.length; i++) if (st.b[g[i]] === p + 1) n++; return n; };
CC.apply = function (st, mv) {
  var p = st.turn, k, best, bv, i, all = [];
  st.b[mv.t] = st.b[mv.f]; st.b[mv.f] = 0; st.plies++; st.moves_by[p]++; st.last = { f: mv.f, t: mv.t, by: p };
  if (CC.inGoal(st, p) === 10) { SK.end(st, [p]); return st; }
  if (st.plies >= CC.CAPMOVES * st.n) {
    bv = 1e9; best = [];
    for (i = 0; i < st.n; i++) { var v = CC.remaining(st, i); if (v < bv - 1e-9) { bv = v; best = [i]; } else if (Math.abs(v - bv) < 1e-9) best.push(i); }
    SK.end(st, best.length === st.n ? null : best); return st;
  }
  st.turn = (st.turn + 1) % st.n;
  return st;
};
CC.bot = function (st, level, rng) {
  var p = st.turn, list = CC.moves(st), g = CC.GOALPT(st.home[p]), i, best = null, bv = -1e9, v, mv, d0, d1, back, k, sc;
  if (!list.length) return null;
  if (level === 0) {                                       /* a random move that does not go backwards, mostly */
    var fw = list.filter(function (m) { return CC.hexDist(CC.XY[m.t], g) < CC.hexDist(CC.XY[m.f], g); });
    return SK.pick(rng, fw.length && rng() < 0.85 ? fw : list);
  }
  for (i = 0; i < list.length; i++) {
    mv = list[i]; d0 = CC.hexDist(CC.XY[mv.f], g); d1 = CC.hexDist(CC.XY[mv.t], g);
    v = d0 - d1;
    if (level >= 2) {                                      /* bring the stragglers: moving a marble that is far from the goal is worth more; stay out of the goal's corner until it is done */
      v += d0 * 0.12 + (d1 < 1.5 ? 0.3 : 0);
      var inGoalNow = CC.goalOf(st, p).indexOf(mv.f) >= 0; if (inGoalNow && d1 >= d0) v -= 3;
    }
    v += rng() * 0.4;
    if (v > bv) { bv = v; best = mv; }
  }
  return best;
};

/* =====================================================================
   BLOKUS, 2 to 4 players. 20 x 20 board, every player has the 21 pieces made of 1 to 5 squares (all polyominoes up to five squares), 89 squares in all.
   Cell index = row * 20 + col. The first piece of a player must cover his start corner (top-left, bottom-right, top-right, bottom-left for players 1-4).
   Every later piece must touch one of your own pieces at a corner, and must never touch your own pieces along an edge. Touching other players' pieces is fine.
   A player who cannot place a piece passes; when nobody can place any piece, the game ends. Score: the player with the fewest squares left in hand wins
   (-1 per square left; +15 for placing all pieces, +5 more if the last piece placed was the single square). Players with equal scores share.
   Move = { p, o, c }: piece number, orientation number, the board cell where the top-left cell of the orientation's frame is put.
   ===================================================================== */
var BK = SK.def({ id: 'blokus', seats: [2, 4], perMove: 60000, W: 20 });
BK.TABLE = [
  [[0, 0]],
  [[0, 0], [0, 1]],
  [[0, 0], [0, 1], [0, 2]],
  [[0, 0], [0, 1], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3]],
  [[0, 0], [0, 1], [0, 2], [1, 0]],
  [[0, 0], [0, 1], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 0]],
  [[0, 0], [0, 1], [0, 2], [0, 3], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 2]],
  [[0, 0], [0, 1], [0, 2], [1, 0], [2, 0]],
  [[0, 0], [0, 1], [0, 2], [1, 1], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [1, 3]],
  [[0, 0], [0, 1], [1, 1], [1, 2], [2, 2]],
  [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]],
  [[0, 0], [0, 1], [1, 1], [2, 1], [2, 2]]
];
/* every distinct orientation (turned and mirrored) of every piece, normalised to start at (0,0): BK.ORI[piece] = [ [ [r,c], ... ], ... ] */
BK.ORI = (function () {
  var all = [], p, o, cells, seen, key, rot, k, r, c, minr, minc, list, t;
  var norm = function (cs) { var mr = 99, mc = 99, i, o2 = []; for (i = 0; i < cs.length; i++) { mr = Math.min(mr, cs[i][0]); mc = Math.min(mc, cs[i][1]); } for (i = 0; i < cs.length; i++) o2.push([cs[i][0] - mr, cs[i][1] - mc]); o2.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }); return o2; };
  for (p = 0; p < BK.TABLE.length; p++) {
    seen = {}; list = [];
    cells = BK.TABLE[p];
    for (t = 0; t < 2; t++) {
      for (rot = 0; rot < 4; rot++) {
        cells = cells.map(function (x) { return [x[1], -x[0]]; });
        var nm = norm(cells), kk = JSON.stringify(nm);
        if (!seen[kk]) { seen[kk] = 1; list.push(nm); }
      }
      cells = cells.map(function (x) { return [x[0], -x[1]]; });
    }
    all.push(list);
  }
  return all;
})();
BK.SIZE = BK.TABLE.map(function (t) { return t.length; });
BK.CORNER = [0, 399, 19, 380];
BK.init = function (n, first) {
  var b = ZERO(400), used = [], i;
  for (i = 0; i < n; i++) used.push(ZERO(21));
  var st = SK.base(n, first, { b: b, used: used, placed: ZERO(n), lastSingle: ZERO(n), out: ZERO(n), score: null });
  return st;
};
BK.copy = function (st) { return { n: st.n, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), used: st.used.map(function (u) { return u.slice(); }), placed: st.placed.slice(), lastSingle: st.lastSingle.slice(), out: st.out.slice(), score: st.score }; };
/* can the shape (cells) with its frame origin at (r0,c0) be placed legally for player p? returns true/false */
BK.fits = function (st, p, cells, r0, c0) {
  var b = st.b, pl = p + 1, k, r, c, touchesCorner = false, first = st.placed[p] === 0, dr, dc, nr, nc, w = 20;
  for (k = 0; k < cells.length; k++) {
    r = r0 + cells[k][0]; c = c0 + cells[k][1];
    if (r < 0 || r >= w || c < 0 || c >= w || b[r * w + c] !== 0) return false;
    if (r > 0 && b[(r - 1) * w + c] === pl) return false;
    if (r < w - 1 && b[(r + 1) * w + c] === pl) return false;
    if (c > 0 && b[r * w + c - 1] === pl) return false;
    if (c < w - 1 && b[r * w + c + 1] === pl) return false;
    if (first) { if (r * w + c === BK.CORNER[p]) touchesCorner = true; }
    else {
      if (r > 0 && c > 0 && b[(r - 1) * w + c - 1] === pl) touchesCorner = true;
      else if (r > 0 && c < w - 1 && b[(r - 1) * w + c + 1] === pl) touchesCorner = true;
      else if (r < w - 1 && c > 0 && b[(r + 1) * w + c - 1] === pl) touchesCorner = true;
      else if (r < w - 1 && c < w - 1 && b[(r + 1) * w + c + 1] === pl) touchesCorner = true;
    }
  }
  return touchesCorner;
};
/* cells of the board where a new piece of player p may touch with one of its squares */
BK.anchors = function (st, p) {
  var out = [], b = st.b, pl = p + 1, w = 20, i, r, c, seen = {};
  if (st.placed[p] === 0) return [BK.CORNER[p]];
  for (i = 0; i < 400; i++) {
    if (b[i] !== 0) continue;
    r = (i / w) | 0; c = i % w;
    if (r > 0 && b[i - w] === pl) continue; if (r < w - 1 && b[i + w] === pl) continue; if (c > 0 && b[i - 1] === pl) continue; if (c < w - 1 && b[i + 1] === pl) continue;
    if ((r > 0 && c > 0 && b[i - w - 1] === pl) || (r > 0 && c < w - 1 && b[i - w + 1] === pl) || (r < w - 1 && c > 0 && b[i + w - 1] === pl) || (r < w - 1 && c < w - 1 && b[i + w + 1] === pl)) out.push(i);
  }
  return out;
};
/* all legal moves of player p (can be a few thousand); stop after `limit` when limit > 0 */
BK.listFor = function (st, p, limit) {
  var out = [], anchors = BK.anchors(st, p), pc, oi, k, a, cells, r0, c0, seen = {}, key, ar, ac;
  for (pc = 20; pc >= 0; pc--) {
    if (st.used[p][pc]) continue;
    for (oi = 0; oi < BK.ORI[pc].length; oi++) {
      cells = BK.ORI[pc][oi];
      for (a = 0; a < anchors.length; a++) {
        ar = (anchors[a] / 20) | 0; ac = anchors[a] % 20;
        for (k = 0; k < cells.length; k++) {
          r0 = ar - cells[k][0]; c0 = ac - cells[k][1];
          if (r0 < 0 || c0 < 0 || r0 > 19 || c0 > 19) continue;
          key = pc * 100000 + oi * 10000 + r0 * 100 + c0; if (seen[key]) continue; seen[key] = 1;
          if (BK.fits(st, p, cells, r0, c0)) { out.push({ p: pc, o: oi, c: r0 * 20 + c0 }); if (limit && out.length >= limit) return out; }
        }
      }
    }
  }
  return out;
};
BK.moves = function (st) { return st.over ? [] : BK.listFor(st, st.turn, 0); };
BK.find = function (st, mv) {
  var cells, r0, c0;
  if (!mv || st.over || typeof mv !== 'object' || Object.keys(mv).length !== 3) return null;
  if (typeof mv.p !== 'number' || typeof mv.o !== 'number' || typeof mv.c !== 'number' || mv.p !== (mv.p | 0) || mv.o !== (mv.o | 0) || mv.c !== (mv.c | 0)) return null;
  if (mv.p < 0 || mv.p > 20 || mv.c < 0 || mv.c > 399 || mv.o < 0 || mv.o >= BK.ORI[mv.p].length) return null;
  if (st.used[st.turn][mv.p]) return null;
  cells = BK.ORI[mv.p][mv.o]; r0 = (mv.c / 20) | 0; c0 = mv.c % 20;
  return BK.fits(st, st.turn, cells, r0, c0) ? { p: mv.p, o: mv.o, c: mv.c } : null;
};
BK.leftSquares = function (st, p) { var s = 0, i; for (i = 0; i < 21; i++) if (!st.used[p][i]) s += BK.SIZE[i]; return s; };
BK.scoreOf = function (st, p) { var left = BK.leftSquares(st, p), s = -left; if (left === 0) { s += 15; if (st.lastSingle[p]) s += 5; } return s; };
BK.finish = function (st) {
  var i, best = -1e9, w = [], sc = [];
  for (i = 0; i < st.n; i++) { sc.push(BK.scoreOf(st, i)); if (sc[i] > best) best = sc[i]; }
  for (i = 0; i < st.n; i++) if (sc[i] === best) w.push(i);
  st.score = sc;
  SK.end(st, w.length === st.n ? null : w);
};
BK.apply = function (st, mv) {
  var p = st.turn, cells = BK.ORI[mv.p][mv.o], r0 = (mv.c / 20) | 0, c0 = mv.c % 20, k, i, nxt, guard;
  for (k = 0; k < cells.length; k++) st.b[(r0 + cells[k][0]) * 20 + c0 + cells[k][1]] = p + 1;
  st.used[p][mv.p] = 1; st.placed[p]++; st.lastSingle[p] = mv.p === 0 ? 1 : 0; st.plies++; st.last = { p: mv.p, o: mv.o, c: mv.c, by: p };
  /* next player who can still place a piece; players without a move are out for good */
  for (guard = 1; guard <= st.n; guard++) {
    nxt = (p + guard) % st.n;
    if (st.out[nxt]) continue;
    if (BK.listFor(st, nxt, 1).length) { st.turn = nxt; return st; }
    st.out[nxt] = 1;
  }
  BK.finish(st);
  return st;
};
BK.bot = function (st, level, rng) {
  var p = st.turn, list, i, best = null, bv = -1e9, v, mv, lim = level === 0 ? 60 : level === 1 ? 400 : 1500, cells, sizeScore, k, corners;
  list = BK.listFor(st, p, lim);
  if (!list.length) return null;
  if (level === 0) { /* biggest of a handful of random legal moves */
    var s = 0; for (i = 0; i < 6; i++) { var m = SK.pick(rng, list); if (BK.SIZE[m.p] > s) { s = BK.SIZE[m.p]; best = m; } } return best;
  }
  for (i = 0; i < list.length; i++) {
    mv = list[i]; cells = BK.ORI[mv.p][mv.o];
    v = BK.SIZE[mv.p] * 3;
    /* new corners opened for me, and closeness to the centre early in the game */
    var r0 = (mv.c / 20) | 0, c0 = mv.c % 20, cr = 0, cc = 0;
    for (k = 0; k < cells.length; k++) { cr += r0 + cells[k][0]; cc += c0 + cells[k][1]; }
    cr /= cells.length; cc /= cells.length;
    v += (st.placed[p] < 8 ? (14 - (Math.abs(cr - 9.5) + Math.abs(cc - 9.5))) * 0.35 : 0);
    if (level >= 2) {
      var s2 = BK.copy(st); var cl = cells; for (k = 0; k < cl.length; k++) s2.b[(r0 + cl[k][0]) * 20 + c0 + cl[k][1]] = p + 1; s2.placed[p]++;
      v += BK.anchors(s2, p).length * 0.55;
      var q, blocked = 0; for (q = 0; q < st.n; q++) if (q !== p) blocked += BK.anchors(s2, q).length; v -= blocked * 0.12;
    }
    v += rng() * 0.6;
    if (v > bv) { bv = v; best = mv; }
  }
  return best;
};

/* =====================================================================
   QUORIDOR, 2 to 4 players. 9 x 9 board. Every player has a pawn on the middle of one edge and must reach the opposite edge first.
   On your turn you EITHER move your pawn one step (up, down, left, right; a pawn standing right in front of you can be jumped, or passed diagonally when the
   jump is blocked) OR put down one of your walls (each wall blocks two squares of edge). Walls may not cross or overlap, and a wall may never close the last
   path to the goal of any player. 2 players have 10 walls each, 3 players 7, 4 players 5.
   Cell index = row * 9 + col. Moves: { m } = move the pawn to cell m; { h } / { v } = a horizontal / vertical wall with its anchor in the corner at
   (row, col) = (h / 8, h % 8): it lies on the lower (h) or right (v) side of cell (row, col) and the cell next to it.
   First to reach the goal edge wins. After 300 moves the player with the shortest way left wins (equal: shared).
   ===================================================================== */
var QD = SK.def({ id: 'quoridor', seats: [2, 4], perMove: 45000, CAP: 300 });
QD.START = [76, 4, 36, 44];                                         /* bottom, top, left, right (cell index of the start square) */
QD.WALLS = { 2: 10, 3: 7, 4: 5 };
QD.goalCell = function (p, cell) { var r = (cell / 9) | 0, c = cell % 9; return p === 0 ? r === 0 : p === 1 ? r === 8 : p === 2 ? c === 8 : c === 0; };
QD.init = function (n, first) {
  var st = SK.base(n, first, { pos: QD.START.slice(0, n), left: [], hw: ZERO(64), vw: ZERO(64), lastBy: -1 }), i;
  for (i = 0; i < n; i++) st.left.push(QD.WALLS[n]);
  return st;
};
QD.copy = function (st) { return { n: st.n, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, pos: st.pos.slice(), left: st.left.slice(), hw: st.hw.slice(), vw: st.vw.slice(), lastBy: st.lastBy }; };
/* is there a wall between cell a and its neighbour in direction d (0 up, 1 down, 2 left, 3 right)? */
QD.blocked = function (st, a, d) {
  var r = (a / 9) | 0, c = a % 9;
  if (d === 0) { if (r === 0) return true; return (c < 8 && st.hw[(r - 1) * 8 + c]) || (c > 0 && st.hw[(r - 1) * 8 + c - 1]); }
  if (d === 1) { if (r === 8) return true; return (c < 8 && st.hw[r * 8 + c]) || (c > 0 && st.hw[r * 8 + c - 1]); }
  if (d === 2) { if (c === 0) return true; return (r < 8 && st.vw[r * 8 + c - 1]) || (r > 0 && st.vw[(r - 1) * 8 + c - 1]); }
  if (c === 8) return true; return (r < 8 && st.vw[r * 8 + c]) || (r > 0 && st.vw[(r - 1) * 8 + c]);
};
QD.DR = [-1, 1, 0, 0]; QD.DC = [0, 0, -1, 1];
QD.step = function (a, d) { return a + QD.DR[d] * 9 + QD.DC[d]; };
QD.occupied = function (st, cell) { return st.pos.indexOf(cell) >= 0; };
QD.pawnMoves = function (st, p) {
  var out = [], a = st.pos[p], d, nb, j, sd, side;
  for (d = 0; d < 4; d++) {
    if (QD.blocked(st, a, d)) continue;
    nb = QD.step(a, d);
    if (!QD.occupied(st, nb)) { out.push(nb); continue; }
    if (!QD.blocked(st, nb, d)) { j = QD.step(nb, d); if (!QD.occupied(st, j)) { out.push(j); continue; } }
    side = d < 2 ? [2, 3] : [0, 1];                                   /* the jump is blocked: step diagonally past the pawn */
    for (sd = 0; sd < 2; sd++) { if (!QD.blocked(st, nb, side[sd])) { j = QD.step(nb, side[sd]); if (!QD.occupied(st, j)) out.push(j); } }
  }
  return out;
};
/* shortest number of steps for player p to a goal cell, ignoring pawns; 999 when there is no way */
QD.pathLen = function (st, p) {
  var dist = {}, queue = [st.pos[p]], head = 0, a, d, nb;
  dist[st.pos[p]] = 0;
  while (head < queue.length) {
    a = queue[head++]; if (QD.goalCell(p, a)) return dist[a];
    for (d = 0; d < 4; d++) { if (QD.blocked(st, a, d)) continue; nb = QD.step(a, d); if (dist[nb] === undefined) { dist[nb] = dist[a] + 1; queue.push(nb); } }
  }
  return 999;
};
QD.wallOk = function (st, kind, idx) {
  var r = (idx / 8) | 0, c = idx % 8, i, ok = true;
  if (idx < 0 || idx > 63) return false;
  if (st.hw[idx] || st.vw[idx]) return false;                         /* same anchor: crossing or overlapping */
  if (kind === 'h') { if (c > 0 && st.hw[idx - 1]) return false; if (c < 7 && st.hw[idx + 1]) return false; }
  else { if (r > 0 && st.vw[idx - 8]) return false; if (r < 7 && st.vw[idx + 8]) return false; }
  if (kind === 'h') st.hw[idx] = 1; else st.vw[idx] = 1;
  for (i = 0; i < st.n; i++) if (QD.pathLen(st, i) >= 999) { ok = false; break; }
  if (kind === 'h') st.hw[idx] = 0; else st.vw[idx] = 0;
  return ok;
};
QD.moves = function (st) {
  var out = [], p = st.turn, i, pm; if (st.over) return out;
  pm = QD.pawnMoves(st, p); for (i = 0; i < pm.length; i++) out.push({ m: pm[i] });
  if (st.left[p] > 0) for (i = 0; i < 64; i++) { if (QD.wallOk(st, 'h', i)) out.push({ h: i }); if (QD.wallOk(st, 'v', i)) out.push({ v: i }); }
  return out;
};
QD.find = function (st, mv) {
  var keys, k, v;
  if (!mv || st.over || typeof mv !== 'object') return null;
  keys = Object.keys(mv); if (keys.length !== 1) return null;
  k = keys[0]; v = mv[k]; if (typeof v !== 'number' || v !== (v | 0)) return null;
  if (k === 'm') { return v >= 0 && v < 81 && QD.pawnMoves(st, st.turn).indexOf(v) >= 0 ? { m: v } : null; }
  if ((k === 'h' || k === 'v') && st.left[st.turn] > 0 && v >= 0 && v < 64 && QD.wallOk(st, k, v)) { var o = {}; o[k] = v; return o; }
  return null;
};
QD.apply = function (st, mv) {
  var p = st.turn, i, best, bv, v;
  st.plies++; st.last = mv; st.lastBy = p;
  if (mv.m !== undefined) { st.pos[p] = mv.m; if (QD.goalCell(p, mv.m)) { SK.end(st, [p]); return st; } }
  else { if (mv.h !== undefined) st.hw[mv.h] = 1; else st.vw[mv.v] = 1; st.left[p]--; }
  if (st.plies >= QD.CAP) {
    bv = 1e9; best = [];
    for (i = 0; i < st.n; i++) { v = QD.pathLen(st, i); if (v < bv) { bv = v; best = [i]; } else if (v === bv) best.push(i); }
    SK.end(st, best.length === st.n ? null : best); return st;
  }
  st.turn = (p + 1) % st.n;
  return st;
};
QD.bot = function (st, level, rng) {
  var p = st.turn, pm = QD.pawnMoves(st, p), i, best = null, bv = -1e9, s, v, my, others, list, mv, cands, k, opp;
  /* the pawn move that shortens my path the most */
  var bestStep = null, bs = 1e9;
  for (i = 0; i < pm.length; i++) { s = QD.copy(st); s.pos[p] = pm[i]; v = QD.pathLen(s, p); if (v < bs || (v === bs && rng() < 0.4)) { bs = v; bestStep = { m: pm[i] }; } }
  if (level === 0) { if (st.left[p] > 0 && rng() < 0.12) { var w = QD.wallsNear(st, (p + 1) % st.n, rng); if (w) return w; } return bestStep; }
  /* level 1 and 2: compare my way with the shortest way of the opponent that is closest to winning; put a wall where it costs him the most */
  var myNow = QD.pathLen(st, p), worst = -1, wo = -1;
  for (i = 0; i < st.n; i++) if (i !== p) { v = QD.pathLen(st, i); if (wo < 0 || v < worst) { worst = v; wo = i; } }
  if (st.left[p] > 0 && (worst <= myNow + (level >= 2 ? 1 : 0) || rng() < 0.05)) {
    cands = QD.wallsNear(st, wo, rng, level >= 2 ? 40 : 18, true); var bw = null, bgain = 0;
    for (i = 0; i < cands.length; i++) { s = QD.copy(st); if (cands[i].h !== undefined) s.hw[cands[i].h] = 1; else s.vw[cands[i].v] = 1; var gain = (QD.pathLen(s, wo) - worst) - (QD.pathLen(s, p) - myNow) * 1.3; if (gain > bgain) { bgain = gain; bw = cands[i]; } }
    if (bw && bgain >= (level >= 2 ? 2 : 3)) return bw;
  }
  return bestStep;
};
/* some legal walls near the pawn of player q (or all of them with `all`) */
QD.wallsNear = function (st, q, rng, limit, all) {
  var out = [], a = st.pos[q], r = (a / 9) | 0, c = a % 9, dr, dc, i, rr, cc, idx;
  for (dr = -3; dr <= 3; dr++) for (dc = -3; dc <= 3; dc++) {
    rr = r + dr; cc = c + dc; if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue; idx = rr * 8 + cc;
    if (QD.wallOk(st, 'h', idx)) out.push({ h: idx }); if (QD.wallOk(st, 'v', idx)) out.push({ v: idx });
  }
  if (all) { if (limit && out.length > limit) { out.sort(function () { return rng() - 0.5; }); out.length = limit; } return out; }
  return out.length ? SK.pick(rng, out) : null;
};

/* =====================================================================
   LIGHT CYCLES, 2 to 8 players (turn by turn). 24 x 24 field. Every player has a cycle that leaves a wall behind it. On your turn your cycle moves one
   square: straight on, or turning left or right (it cannot turn back). A cycle that runs into a wall, a trail or the edge is out, and its trail stays.
   The last cycle still running wins. Move = { d } with d = 0 up, 1 right, 2 down, 3 left.
   ===================================================================== */
var LC = SK.def({ id: 'tron', seats: [2, 8], perMove: 12000, W: 24 });
LC.DR = [-1, 0, 1, 0]; LC.DC = [0, 1, 0, -1];
LC.STARTS = [[21, 12, 0], [2, 11, 2], [12, 21, 3], [11, 2, 1], [21, 4, 0], [2, 19, 2], [19, 2, 1], [4, 21, 3]];   /* row, col, direction */
LC.init = function (n, first) {
  var b = ZERO(576), pos = [], dir = [], alive = [], i;
  for (i = 0; i < n; i++) { var s = LC.STARTS[i]; pos.push(s[0] * 24 + s[1]); dir.push(s[2]); alive.push(1); b[s[0] * 24 + s[1]] = i + 1; }
  return SK.base(n, first, { b: b, pos: pos, dir: dir, alive: alive, out: [] });
};
LC.copy = function (st) { return { n: st.n, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), pos: st.pos.slice(), dir: st.dir.slice(), alive: st.alive.slice(), out: st.out.slice() }; };
LC.moves = function (st) { var p = st.turn, out = [], d; if (st.over) return out; for (d = 0; d < 4; d++) if (d !== (st.dir[p] + 2) % 4) out.push({ d: d }); return out; };
LC.find = function (st, mv) { return SK.findIn(LC, st, mv); };
LC.cell = function (st, p, d) { var r = ((st.pos[p] / 24) | 0) + LC.DR[d], c = (st.pos[p] % 24) + LC.DC[d]; return r < 0 || r > 23 || c < 0 || c > 23 ? -1 : r * 24 + c; };
LC.apply = function (st, mv) {
  var p = st.turn, nc = LC.cell(st, p, mv.d), i, alive, guard, nxt;
  st.plies++; st.last = { d: mv.d, by: p }; st.dir[p] = mv.d;
  if (nc < 0 || st.b[nc] !== 0) { st.alive[p] = 0; st.out.push(p); st.last.crash = 1; }
  else { st.b[nc] = p + 1; st.pos[p] = nc; }
  alive = []; for (i = 0; i < st.n; i++) if (st.alive[i]) alive.push(i);
  if (alive.length <= 1) { SK.end(st, alive.length ? alive : [p]); return st; }
  if (st.plies >= 4 * 576) { SK.end(st, alive); return st; }
  for (guard = 1; guard <= st.n; guard++) { nxt = (p + guard) % st.n; if (st.alive[nxt]) { st.turn = nxt; break; } }
  return st;
};
/* squares that player p can reach before anyone else (flood fill from every living cycle at the same time) */
LC.voronoi = function (st) {
  var owner = {}, dist = {}, queue = [], head = 0, i, a, d, nc, r, c, counts = ZERO(st.n);
  for (i = 0; i < st.n; i++) if (st.alive[i]) { owner[st.pos[i]] = i; dist[st.pos[i]] = 0; queue.push(st.pos[i]); }
  while (head < queue.length) {
    a = queue[head++]; r = (a / 24) | 0; c = a % 24;
    for (d = 0; d < 4; d++) {
      var rr = r + LC.DR[d], cc = c + LC.DC[d]; if (rr < 0 || rr > 23 || cc < 0 || cc > 23) continue; nc = rr * 24 + cc;
      if (st.b[nc] !== 0 || owner[nc] !== undefined) continue;
      owner[nc] = owner[a]; dist[nc] = dist[a] + 1; counts[owner[a]]++; queue.push(nc);
    }
  }
  return counts;
};
LC.bot = function (st, level, rng) {
  var p = st.turn, list = LC.moves(st), i, best = null, bv = -1e9, v, s, free, k;
  var safe = list.filter(function (m) { var nc = LC.cell(st, p, m.d); return nc >= 0 && st.b[nc] === 0; });
  if (!safe.length) return SK.pick(rng, list);
  if (level === 0) return SK.pick(rng, rng() < 0.9 ? safe : list);
  for (i = 0; i < safe.length; i++) {
    s = LC.copy(st); LC.apply(s, safe[i]);
    var counts = LC.voronoi(s), mine = counts[p], rest = 0, k2;
    for (k2 = 0; k2 < st.n; k2++) if (k2 !== p && s.alive[k2]) rest = Math.max(rest, counts[k2]);
    v = mine - (level >= 2 ? rest * 0.8 : 0) + (safe[i].d === st.dir[p] ? 0.3 : 0) + rng() * 0.2;
    if (level >= 2) { /* avoid squares with a single way out */
      var nc2 = LC.cell(st, p, safe[i].d), exits = 0, d2; for (d2 = 0; d2 < 4; d2++) { var r2 = ((nc2 / 24) | 0) + LC.DR[d2], c2 = (nc2 % 24) + LC.DC[d2]; if (r2 >= 0 && r2 < 24 && c2 >= 0 && c2 < 24 && s.b[r2 * 24 + c2] === 0) exits++; }
      if (exits === 0) v -= 500;
    }
    if (v > bv) { bv = v; best = safe[i]; }
  }
  return best;
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
}(typeof window !== 'undefined' ? window : this));
