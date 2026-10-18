/* ===== Game engines, part 8: skill games, second batch (1/2) =====
   Go 9x9, Amazons, Lines of Action, Santorini. Same interface as games7.js (see the comment there).
   No randomness, every move public. Pure logic, no DOM. */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
if (typeof require !== 'undefined' && !VG.sk) require('./games7.js');
var SK = VG.sk;

/* =====================================================================
   GO 9 x 9. Cell index = row * 9 + col. Moves: { c } (place a stone) or { pass: 1 }.
   Rules: a stone with no free neighbour (a group with no liberties) is captured; moves that would leave your own group without liberties
   are not allowed unless they capture; you may not recapture a single stone straight away (ko). Two passes in a row end the game.
   Score: your stones plus the empty regions that only you touch (area scoring); White gets 7.5 extra points, so there are no draws.
   Player 0 = Black (moves first on the board), player 1 = White. After 300 moves the game is scored as it stands.
   ===================================================================== */
var G9 = SK.def({ id: 'go', seats: [2, 2], perMove: 60000, N: 9, KOMI: 7.5, CAP: 300 });
G9.NB = (function () { var o = [], i, r, c; for (i = 0; i < 81; i++) { r = (i / 9) | 0; c = i % 9; var a = []; if (r > 0) a.push(i - 9); if (c > 0) a.push(i - 1); if (c < 8) a.push(i + 1); if (r < 8) a.push(i + 9); o.push(a); } return o; })();
G9.init = function (n, first) { var b = [], i; for (i = 0; i < 81; i++) b.push(0); return SK.base(2, first, { b: b, ko: -1, passes: 0, cap: [0, 0], score: null }); };
G9.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), ko: st.ko, passes: st.passes, cap: st.cap.slice(), score: st.score }; };
/* the group containing i: { stones:[], libs:count } */
G9.group = function (b, i) {
  var p = b[i], stack = [i], seen = {}, stones = [], libs = {}, nl = 0, x, k, j, nb;
  seen[i] = 1;
  while (stack.length) {
    x = stack.pop(); stones.push(x); nb = G9.NB[x];
    for (k = 0; k < nb.length; k++) { j = nb[k]; if (b[j] === 0) { if (!libs[j]) { libs[j] = 1; nl++; } } else if (b[j] === p && !seen[j]) { seen[j] = 1; stack.push(j); } }
  }
  return { stones: stones, libs: nl };
};
/* try the move: returns the list of captured points (maybe empty), or null when the move is not allowed. Does not change st. */
G9.tryMove = function (st, i) {
  var b = st.b, p = st.turn + 1, o = 3 - p, k, j, nb = G9.NB[i], caps = [], g, seenG = {}, z;
  if (b[i] !== 0 || i === st.ko) return null;
  b[i] = p;
  for (k = 0; k < nb.length; k++) {
    j = nb[k];
    if (b[j] === o && !seenG[j]) { g = G9.group(b, j); for (z = 0; z < g.stones.length; z++) seenG[g.stones[z]] = 1; if (g.libs === 0) caps = caps.concat(g.stones); }
  }
  if (!caps.length) { g = G9.group(b, i); if (g.libs === 0) { b[i] = 0; return null; } }
  b[i] = 0;
  return caps;
};
G9.moves = function (st) {
  var out = [], i; if (st.over) return out;
  for (i = 0; i < 81; i++) if (st.b[i] === 0 && G9.tryMove(st, i)) out.push({ c: i });
  out.push({ pass: 1 });
  return out;
};
G9.find = function (st, mv) {
  var keys, caps;
  if (!mv || st.over || typeof mv !== 'object') return null;
  keys = Object.keys(mv);
  if (keys.length !== 1) return null;
  if (keys[0] === 'pass') return mv.pass === 1 ? { pass: 1 } : null;
  if (keys[0] !== 'c' || typeof mv.c !== 'number' || mv.c !== (mv.c | 0) || mv.c < 0 || mv.c > 80) return null;
  return G9.tryMove(st, mv.c) ? { c: mv.c } : null;
};
/* area score: [black, white] (white without komi) */
G9.area = function (b) {
  var sc = [0, 0], seen = {}, i, k, j, stack, touch, cnt, x, nb;
  for (i = 0; i < 81; i++) {
    if (b[i]) { sc[b[i] - 1]++; continue; }
    if (seen[i]) continue;
    stack = [i]; seen[i] = 1; touch = 0; cnt = 0;
    while (stack.length) {
      x = stack.pop(); cnt++; nb = G9.NB[x];
      for (k = 0; k < nb.length; k++) { j = nb[k]; if (b[j] === 0) { if (!seen[j]) { seen[j] = 1; stack.push(j); } } else touch |= b[j]; }
    }
    if (touch === 1) sc[0] += cnt; else if (touch === 2) sc[1] += cnt;
  }
  return sc;
};
G9.finish = function (st) {
  var a = G9.area(st.b), w = a[1] + G9.KOMI;
  st.score = [a[0], w];
  SK.end(st, a[0] > w ? [0] : [1]);
};
G9.apply = function (st, mv) {
  var p = st.turn + 1, caps, i, g;
  st.plies++;
  if (mv.pass) {
    st.last = { pass: 1 }; st.passes++; st.ko = -1;
    if (st.passes >= 2) { G9.finish(st); return st; }
    st.turn = 1 - st.turn; return st;
  }
  caps = G9.tryMove(st, mv.c);
  st.b[mv.c] = p;
  for (i = 0; i < caps.length; i++) st.b[caps[i]] = 0;
  st.cap[st.turn] += caps.length; st.passes = 0; st.last = { c: mv.c, caps: caps.length };
  st.ko = -1;
  if (caps.length === 1) { g = G9.group(st.b, mv.c); if (g.stones.length === 1 && g.libs === 1) st.ko = caps[0]; }
  if (st.plies >= G9.CAP) { G9.finish(st); return st; }
  st.turn = 1 - st.turn;
  return st;
};
/* a point that is an eye of player p (all neighbours are p's own stones); filling it is almost never good */
G9.ownEye = function (b, i, p) { var nb = G9.NB[i], k; for (k = 0; k < nb.length; k++) if (b[nb[k]] !== p) return false; return true; };
G9.randomMove = function (st, rng) {
  var p = st.turn + 1, tries, i, caps, start = Math.floor(rng() * 81), k;
  for (k = 0; k < 81; k++) {
    i = (start + k) % 81;
    if (st.b[i] !== 0 || G9.ownEye(st.b, i, p)) continue;
    caps = G9.tryMove(st, i); if (caps) return { c: i };
  }
  return { pass: 1 };
};
G9.bot = function (st, level, rng) {
  var p = st.turn + 1, list, best = null, bv = -1, i, v, mv, caps, g;
  if (level >= 1) {
    if (st.plies > 40 && st.passes === 1) { /* the opponent passed: pass too when ahead */
      var a = G9.area(st.b), mine = a[st.turn] + (st.turn === 1 ? G9.KOMI : 0), his = a[1 - st.turn] + (st.turn === 0 ? G9.KOMI : 0);
      if (mine > his) return { pass: 1 };
    }
    mv = SK.mcts(G9, st, level >= 2 ? 500 : 140, rng, 170);
    return mv || { pass: 1 };
  }
  /* level 0: take a capture, save a group in atari, else any move that is not an own eye */
  list = [];
  for (i = 0; i < 81; i++) {
    if (st.b[i] !== 0 || G9.ownEye(st.b, i, p)) continue;
    caps = G9.tryMove(st, i); if (!caps) continue;
    v = caps.length * 10 + rng() * 3; if (v > bv) { bv = v; best = { c: i }; }
  }
  return best || { pass: 1 };
};

/* =====================================================================
   AMAZONS 10 x 10. Each player has 4 queens. A move: slide one queen like a chess queen (not over anything), then shoot an arrow from where it
   landed, again like a queen; the arrow square is blocked for the rest of the game. A player who cannot move loses. No draws.
   Cell index = row * 10 + col. Moves: { f, t, a } (queen from, queen to, arrow to). Player 0 starts with queens on the bottom side.
   ===================================================================== */
var AM = SK.def({ id: 'amazons', seats: [2, 2], perMove: 90000, N: 10 });
AM.DIRS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
AM.init = function (n, first) {
  var b = [], i; for (i = 0; i < 100; i++) b.push(0);
  [3, 6, 30, 39].forEach(function (c) { b[c] = 2; });            /* player 1: row 0 (cols 3, 6) and the sides of row 3 */
  [60, 69, 93, 96].forEach(function (c) { b[c] = 1; });
  return SK.base(2, first, { b: b });
};
AM.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice() }; };
/* every square a queen on `from` can reach (b[from] is treated as empty when `ignore` is that square) */
AM.reach = function (b, from, ignore) {
  var out = [], r0 = (from / 10) | 0, c0 = from % 10, d, r, c, i;
  for (d = 0; d < 8; d++) {
    r = r0 + AM.DIRS[d][0]; c = c0 + AM.DIRS[d][1];
    while (r >= 0 && r < 10 && c >= 0 && c < 10) { i = r * 10 + c; if (b[i] !== 0 && i !== ignore) break; out.push(i); r += AM.DIRS[d][0]; c += AM.DIRS[d][1]; }
  }
  return out;
};
AM.queens = function (b, p) { var o = [], i; for (i = 0; i < 100; i++) if (b[i] === p) o.push(i); return o; };
AM.hasMove = function (b, p) { var q = AM.queens(b, p), k, r0, c0, d, r, c; for (k = 0; k < q.length; k++) { r0 = (q[k] / 10) | 0; c0 = q[k] % 10; for (d = 0; d < 8; d++) { r = r0 + AM.DIRS[d][0]; c = c0 + AM.DIRS[d][1]; if (r >= 0 && r < 10 && c >= 0 && c < 10 && b[r * 10 + c] === 0) return true; } } return false; };
AM.moves = function (st) {
  var out = [], q, k, to, t, arr, a, p = st.turn + 1; if (st.over) return out;
  q = AM.queens(st.b, p);
  for (k = 0; k < q.length; k++) {
    to = AM.reach(st.b, q[k], -1);
    for (t = 0; t < to.length; t++) { arr = AM.reach(st.b, to[t], q[k]); for (a = 0; a < arr.length; a++) out.push({ f: q[k], t: to[t], a: arr[a] }); }
  }
  return out;
};
/* a straight clear line from a to b (b[ignore] counts as empty) */
AM.clear = function (b, a, z, ignore) {
  var ra = (a / 10) | 0, ca = a % 10, rz = (z / 10) | 0, cz = z % 10, dr = rz - ra, dc = cz - ca, n, sr, sc, k, i;
  if (a === z) return false;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return false;
  n = Math.max(Math.abs(dr), Math.abs(dc)); sr = dr / n; sc = dc / n;
  for (k = 1; k <= n; k++) { i = (ra + sr * k) * 10 + ca + sc * k; if (b[i] !== 0 && i !== ignore) return false; }
  return true;
};
AM.find = function (st, mv) {
  var keys, p = st.turn + 1, b = st.b, k;
  if (!mv || st.over || typeof mv !== 'object') return null;
  keys = Object.keys(mv); if (keys.length !== 3) return null;
  for (k = 0; k < 3; k++) { var v = mv[['f', 't', 'a'][k]]; if (typeof v !== 'number' || v !== (v | 0) || v < 0 || v > 99) return null; }
  if (b[mv.f] !== p || b[mv.t] !== 0) return null;
  if (!AM.clear(b, mv.f, mv.t, -1)) return null;
  if (mv.a !== mv.f && b[mv.a] !== 0) return null;
  if (!AM.clear(b, mv.t, mv.a, mv.f)) return null;
  return { f: mv.f, t: mv.t, a: mv.a };
};
AM.apply = function (st, mv) {
  var p = st.turn + 1;
  st.b[mv.f] = 0; st.b[mv.t] = p; st.b[mv.a] = 3; st.plies++; st.last = { f: mv.f, t: mv.t, a: mv.a };
  st.turn = 1 - st.turn;
  if (!AM.hasMove(st.b, st.turn + 1) || !AM.moves(st).length) SK.end(st, [1 - st.turn]);
  return st;
};
/* queen-move distance (BFS over empty squares) from every queen of the player: how many squares each side reaches first */
AM.territory = function (b) {
  var d = [null, null, null], p, i, k, q, front, nxt, dist, to;
  for (p = 1; p <= 2; p++) {
    dist = []; for (i = 0; i < 100; i++) dist.push(99);
    front = AM.queens(b, p); front.forEach(function (x) { dist[x] = 0; });
    var depth = 0;
    while (front.length && depth < 12) {
      depth++; nxt = [];
      for (k = 0; k < front.length; k++) { to = AM.reach(b, front[k], -1); for (i = 0; i < to.length; i++) if (dist[to[i]] > depth) { dist[to[i]] = depth; nxt.push(to[i]); } }
      front = nxt;
    }
    d[p] = dist;
  }
  var mine = 0, his = 0;
  for (i = 0; i < 100; i++) if (b[i] === 0) { if (d[1][i] < d[2][i]) mine++; else if (d[2][i] < d[1][i]) his++; }
  return [mine, his];
};
AM.mobility = function (b, p) { var q = AM.queens(b, p), n = 0, k; for (k = 0; k < q.length; k++) n += AM.reach(b, q[k], -1).length; return n; };
AM.eval = function (b, p) { var t = AM.territory(b), m = AM.mobility(b, p) - AM.mobility(b, 3 - p); var mine = p === 1 ? t[0] - t[1] : t[1] - t[0]; return mine * 3 + m * 0.4; };
AM.randomMove = function (st, rng) {
  var p = st.turn + 1, q = AM.queens(st.b, p), tries, f, to, t, arr, a;
  for (tries = 0; tries < 12; tries++) {
    f = q[Math.floor(rng() * q.length)]; to = AM.reach(st.b, f, -1); if (!to.length) continue;
    t = to[Math.floor(rng() * to.length)]; arr = AM.reach(st.b, t, f); if (!arr.length) continue;
    return { f: f, t: t, a: arr[Math.floor(rng() * arr.length)] };
  }
  return SK.pick(rng, AM.moves(st));
};
AM.bot = function (st, level, rng) {
  var p = st.turn + 1, i, list, best = null, bv = -1e9, n, mv, b, v, cands = [];
  if (level === 0) return AM.randomMove(st, rng);
  n = level >= 2 ? 90 : 40;                              /* look at a sample of moves and take the one with the best evaluation after it */
  for (i = 0; i < n; i++) cands.push(AM.randomMove(st, rng));
  for (i = 0; i < cands.length; i++) {
    mv = cands[i]; b = st.b.slice(); b[mv.f] = 0; b[mv.t] = p; b[mv.a] = 3;
    v = AM.eval(b, p) + rng() * 0.5;
    if (level >= 2) {                                    /* second look: the opponent's best reply by mobility */
      var s2 = { b: b, turn: 2 - p }, worst = 1e9, k, r;
      for (k = 0; k < 6; k++) { r = AM.randomMove({ b: b, turn: 2 - p }, rng); if (!r) { worst = 1e6; break; } var b2 = b.slice(); b2[r.f] = 0; b2[r.t] = 3 - p; b2[r.a] = 3; worst = Math.min(worst, AM.eval(b2, p)); }
      v = v * 0.4 + worst * 0.6;
    }
    if (v > bv) { bv = v; best = mv; }
  }
  return best;
};

/* =====================================================================
   LINES OF ACTION 8 x 8. Cell index = row * 8 + col. Black (player 0) has 12 checkers on the left and right edges (not corners),
   White (player 1) on the top and bottom edges. A checker moves in a straight line exactly as many squares as there are checkers
   (of both colours) on that whole line. It may jump over your own checkers but not over the opponent's; it may land on an opponent's
   checker and capture it. You win by connecting all your checkers in one group (neighbours incl. diagonals). If one move connects both
   sides, the player who moved wins. After 200 moves without a winner the game is a draw.
   Moves: { f, t }.
   ===================================================================== */
var LA = SK.def({ id: 'lines', seats: [2, 2], perMove: 60000, N: 8, CAP: 200 });
LA.init = function (n, first) {
  var b = [], i, r, c; for (i = 0; i < 64; i++) b.push(0);
  for (i = 1; i < 7; i++) { b[i] = 2; b[56 + i] = 2; b[i * 8] = 1; b[i * 8 + 7] = 1; }
  return SK.base(2, first, { b: b });
};
LA.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice() }; };
LA.DIRS = [[0, 1], [1, 0], [1, 1], [1, -1]];
/* number of checkers on the whole line through i in direction d */
LA.count = function (b, i, d) {
  var r0 = (i / 8) | 0, c0 = i % 8, n = 1, k, r, c, s;
  for (s = -1; s <= 1; s += 2) { r = r0 + LA.DIRS[d][0] * s; c = c0 + LA.DIRS[d][1] * s; while (r >= 0 && r < 8 && c >= 0 && c < 8) { if (b[r * 8 + c]) n++; r += LA.DIRS[d][0] * s; c += LA.DIRS[d][1] * s; } }
  return n;
};
LA.movesOf = function (b, i, out) {
  var p = b[i], d, s, n, r, c, r0 = (i / 8) | 0, c0 = i % 8, k, ok, j;
  for (d = 0; d < 4; d++) {
    n = LA.count(b, i, d);
    for (s = -1; s <= 1; s += 2) {
      ok = true; r = r0; c = c0;
      for (k = 1; k <= n; k++) {
        r += LA.DIRS[d][0] * s; c += LA.DIRS[d][1] * s;
        if (r < 0 || r > 7 || c < 0 || c > 7) { ok = false; break; }
        j = r * 8 + c;
        if (b[j] && b[j] !== p && k < n) { ok = false; break; }     /* cannot jump over an opponent */
        if (k === n && b[j] === p) ok = false;                      /* cannot land on your own */
      }
      if (ok) out.push({ f: i, t: r * 8 + c });
    }
  }
};
LA.moves = function (st) { var out = [], i, p = st.turn + 1; if (st.over) return out; for (i = 0; i < 64; i++) if (st.b[i] === p) LA.movesOf(st.b, i, out); return out; };
LA.find = function (st, mv) {
  var list, i, tmp = [];
  if (!mv || st.over || typeof mv !== 'object' || Object.keys(mv).length !== 2 || typeof mv.f !== 'number' || typeof mv.t !== 'number' || mv.f !== (mv.f | 0) || mv.t !== (mv.t | 0) || mv.f < 0 || mv.f > 63 || mv.t < 0 || mv.t > 63) return null;
  if (st.b[mv.f] !== st.turn + 1) return null;
  LA.movesOf(st.b, mv.f, tmp);
  for (i = 0; i < tmp.length; i++) if (tmp[i].t === mv.t) return { f: mv.f, t: mv.t };
  return null;
};
/* are all checkers of player p in one group? */
LA.connected = function (b, p) {
  var cells = [], i, seen = {}, stack, x, k, r, c, dr, dc, cnt = 0, j;
  for (i = 0; i < 64; i++) if (b[i] === p) cells.push(i);
  if (cells.length <= 1) return true;
  stack = [cells[0]]; seen[cells[0]] = 1;
  while (stack.length) {
    x = stack.pop(); cnt++; r = (x / 8) | 0; c = x % 8;
    for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) { if (!dr && !dc) continue; if (r + dr < 0 || r + dr > 7 || c + dc < 0 || c + dc > 7) continue; j = (r + dr) * 8 + c + dc; if (b[j] === p && !seen[j]) { seen[j] = 1; stack.push(j); } }
  }
  return cnt === cells.length;
};
LA.apply = function (st, mv) {
  var p = st.turn + 1, me, he;
  st.b[mv.t] = p; st.b[mv.f] = 0; st.plies++; st.last = { f: mv.f, t: mv.t };
  me = LA.connected(st.b, p); he = LA.connected(st.b, 3 - p);
  if (me) { SK.end(st, [st.turn]); return st; }
  if (he) { SK.end(st, [1 - st.turn]); return st; }
  if (st.plies >= LA.CAP) { SK.end(st, null); return st; }
  st.turn = 1 - st.turn;
  if (!LA.moves(st).length) SK.end(st, [1 - st.turn]);
  return st;
};
/* evaluation: how tightly the checkers of each side are gathered around their centre of mass, plus material */
LA.spread = function (b, p) {
  var xs = 0, ys = 0, n = 0, i, d = 0, cx, cy;
  for (i = 0; i < 64; i++) if (b[i] === p) { xs += i % 8; ys += (i / 8) | 0; n++; }
  if (!n) return 0;
  cx = xs / n; cy = ys / n;
  for (i = 0; i < 64; i++) if (b[i] === p) d += Math.max(Math.abs((i % 8) - cx), Math.abs(((i / 8) | 0) - cy));
  return d / n;
};
LA.eval = function (b, p) { return (LA.spread(b, 3 - p) - LA.spread(b, p)) * 10; };
LA.bot = function (st, level, rng) {
  var list = LA.moves(st), p = st.turn + 1, i, best = null, bv = -1e9, b, v, mv, kept, vk;
  if (!list.length) return null;
  if (level === 0) {                                      /* level 0: a random move, but it always takes an immediate win */
    for (i = 0; i < list.length; i++) { b = st.b.slice(); b[list[i].t] = p; b[list[i].f] = 0; if (LA.connected(b, p)) return list[i]; }
    return SK.pick(rng, list);
  }
  if (level === 1) {
    for (i = 0; i < list.length; i++) {
      mv = list[i]; b = st.b.slice(); b[mv.t] = p; b[mv.f] = 0;
      if (LA.connected(b, p)) return mv;
      v = LA.eval(b, p) + rng() * 0.8; if (v > bv) { bv = v; best = mv; }
    }
    return best;
  }
  return SK.mcts(LA, st, 420, rng, 80);
};

/* =====================================================================
   SANTORINI 5 x 5 (without god powers). Cell index = row * 5 + col. Each player has two builders. First the builders are placed one by one
   (you, opponent, you, opponent). Then on your turn: move one builder to a neighbouring square (8 directions) that is free, has no dome, and is at most one
   level higher than where it stands; then build one level on a free neighbouring square of the builder you moved (a 4th level is a dome).
   Win by moving up onto level 3. A player who cannot move loses.
   Moves: placement { p } (cell), turn { w, m, b } (builder 0/1, move to, build on; b = -1 when the move wins).
   ===================================================================== */
var SA = SK.def({ id: 'santorini', seats: [2, 2], perMove: 60000, N: 5 });
SA.NB = (function () { var o = [], i, r, c, dr, dc; for (i = 0; i < 25; i++) { r = (i / 5) | 0; c = i % 5; var a = []; for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) { if ((dr || dc) && r + dr >= 0 && r + dr < 5 && c + dc >= 0 && c + dc < 5) a.push((r + dr) * 5 + c + dc); } o.push(a); } return o; })();
/* st.h[25] = level 0..4 (4 = dome), st.w[p] = [cell, cell] (-1 = not placed yet), st.place = number of builders still to place */
SA.init = function (n, first) { var h = [], i; for (i = 0; i < 25; i++) h.push(0); return SK.base(2, first, { h: h, w: [[-1, -1], [-1, -1]], place: 4 }); };
SA.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, h: st.h.slice(), w: [st.w[0].slice(), st.w[1].slice()], place: st.place }; };
SA.occ = function (st, i) { return st.w[0][0] === i || st.w[0][1] === i || st.w[1][0] === i || st.w[1][1] === i; };
SA.moves = function (st) {
  var out = [], i, w, k, m, nm, b, nb, cell, me = st.turn;
  if (st.over) return out;
  if (st.place > 0) { for (i = 0; i < 25; i++) if (!SA.occ(st, i)) out.push({ p: i }); return out; }
  for (w = 0; w < 2; w++) {
    cell = st.w[me][w]; nm = SA.NB[cell];
    for (k = 0; k < nm.length; k++) {
      m = nm[k];
      if (SA.occ(st, m) || st.h[m] >= 4 || st.h[m] > st.h[cell] + 1) continue;
      if (st.h[m] === 3) { out.push({ w: w, m: m, b: -1 }); continue; }
      nb = SA.NB[m];
      for (b = 0; b < nb.length; b++) { var t = nb[b]; if (t !== cell && SA.occ(st, t)) continue; if (t === cell || (!SA.occ(st, t) && st.h[t] < 4)) out.push({ w: w, m: m, b: t }); }
    }
  }
  return out;
};
SA.find = function (st, mv) {
  var keys, list, i;
  if (!mv || st.over || typeof mv !== 'object') return null;
  keys = Object.keys(mv);
  if (st.place > 0) { return keys.length === 1 && typeof mv.p === 'number' && mv.p === (mv.p | 0) && mv.p >= 0 && mv.p < 25 && !SA.occ(st, mv.p) ? { p: mv.p } : null; }
  if (keys.length !== 3 || typeof mv.w !== 'number' || typeof mv.m !== 'number' || typeof mv.b !== 'number') return null;
  list = SA.moves(st);
  for (i = 0; i < list.length; i++) if (list[i].w === mv.w && list[i].m === mv.m && list[i].b === mv.b) return list[i];
  return null;
};
SA.apply = function (st, mv) {
  var me = st.turn, cell;
  st.plies++; st.last = mv;
  if (st.place > 0) {
    st.w[me][st.w[me][0] < 0 ? 0 : 1] = mv.p; st.place--; st.turn = 1 - me; return st;
  }
  cell = st.w[me][mv.w]; st.w[me][mv.w] = mv.m;
  if (st.h[mv.m] === 3 && mv.b === -1) { SK.end(st, [me]); return st; }
  st.h[mv.b]++;
  st.turn = 1 - me;
  if (!SA.moves(st).length) SK.end(st, [me]);
  return st;
};
SA.randomMove = function (st, rng) { var l = SA.moves(st), i; for (i = 0; i < l.length; i++) if (l[i].b === -1) return l[i]; return SK.pick(rng, l); };
/* simple evaluation: height of builders and how many neighbouring cells they can still step to */
SA.eval = function (st, p) {
  var v = 0, w, c, k, nb, q;
  for (q = 0; q < 2; q++) for (w = 0; w < 2; w++) {
    c = st.w[q][w]; if (c < 0) continue;
    var s = st.h[c] * 4 + (SA.NB[c].length >= 8 ? 3 : SA.NB[c].length >= 5 ? 2 : 0);
    nb = SA.NB[c]; for (k = 0; k < nb.length; k++) if (!SA.occ(st, nb[k]) && st.h[nb[k]] < 4 && st.h[nb[k]] <= st.h[c] + 1) { s += 1; if (st.h[nb[k]] === 3 && st.h[c] === 2) s += 6; }
    v += (q === p ? 1 : -1) * s;
  }
  return v;
};
SA.bot = function (st, level, rng) {
  var list = SA.moves(st), i, best = null, bv = -1e9, s, v, me = st.turn;
  if (!list.length) return null;
  for (i = 0; i < list.length; i++) if (list[i].b === -1) return list[i];         /* a winning step is always taken */
  if (level === 0) return SK.pick(rng, list);
  if (st.place > 0) { var c = [12, 6, 8, 16, 18, 7, 11, 13, 17]; for (i = 0; i < c.length; i++) if (!SA.occ(st, c[i])) return { p: c[i] }; return SK.pick(rng, list); }
  if (level === 1) {
    for (i = 0; i < list.length; i++) { s = SA.copy(st); SA.apply(s, list[i]); v = SA.eval(s, me) + rng(); if (v > bv) { bv = v; best = list[i]; } }
    return best;
  }
  return SK.mcts(SA, st, 380, rng, 60);
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
}(typeof window !== 'undefined' ? window : this));
