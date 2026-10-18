/* ===== Game engines, part 7: the "skill games" framework and the first six board games =====
   Gomoku, Hex, Breakthrough, Mancala (Kalah), Ultimate Tic-Tac-Toe, Dots and Boxes.
   None of these games has any randomness: every move is public, the result depends only on the moves.
   Pure logic, no DOM. The same file runs in the browser (play against the computer) and on the game server.

   Every skill game is an object E in VG.sk.games[id] with the same small interface:
     E.seats = [min, max]      table sizes
     E.init(n, first)          new game for n players, `first` = index of the player who moves first
     E.copy(st)                a deep copy of the state
     E.moves(st)               every legal move of the player to move (plain JSON objects)
     E.find(st, mv)            the legal move that matches what a client sent, or null
     E.apply(st, mv)           play the move (changes st); sets st.over / st.winners / st.draw when the game ends
     E.bot(st, level, rng)     a move for the computer (level 0 weak ... 2 strong)
   State always has: n, turn (index of the player to move), over, draw, winners (array of indexes, or null), plies, last (last move). */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
var SK = VG.sk = VG.sk || { games: {}, list: [] };
SK.def = function (E) { SK.games[E.id] = E; if (SK.list.indexOf(E.id) < 0) SK.list.push(E.id); return E; };
SK.base = function (n, first, extra) {
  var st = { n: n, turn: first | 0, over: false, draw: false, winners: null, plies: 0, last: null }, k;
  for (k in extra) st[k] = extra[k];
  return st;
};
/* finish the game: winners = array of player indexes, or null for a draw */
SK.end = function (st, winners) { st.over = true; if (winners && winners.length) { st.winners = winners.slice(); st.draw = false; } else { st.winners = null; st.draw = true; } };
/* the result as a bit mask over the seats, the same as the contract: one bit = that player wins, all bits = draw; null while playing */
SK.mask = function (st) { var m = 0, i; if (!st.over) return null; if (st.draw || !st.winners) return (1 << st.n) - 1; for (i = 0; i < st.winners.length; i++) m |= 1 << st.winners[i]; return m; };
SK.clone = function (st) { return JSON.parse(JSON.stringify(st)); };
SK.sameMove = function (a, b) { var k; if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false; for (k in a) if (a[k] !== b[k]) return false; for (k in b) if (!(k in a)) return false; return true; };
/* default find: the client's move must equal one of the engine's own moves (only whole numbers and booleans pass) */
SK.findIn = function (E, st, mv) {
  var list, i, k;
  if (!mv || typeof mv !== 'object' || Array.isArray(mv) || st.over) return null;
  for (k in mv) { var v = mv[k]; if (typeof v !== 'number' && typeof v !== 'boolean' && typeof v !== 'string') return null; }
  list = E.moves(st);
  for (i = 0; i < list.length; i++) if (SK.sameMove(list[i], mv)) return list[i];
  return null;
};
SK.pick = function (rng, arr) { return arr[Math.floor(rng() * arr.length)]; };

/* ---------- generic Monte-Carlo tree search for two-player games (random playouts) ----------
   iters = number of playouts. Uses E.randomMove(st, rng) when the game has it, else a random entry of E.moves(st). */
SK.mcts = function (E, st, iters, rng, cap) {
  var rootMoves = E.moves(st), me = st.turn, i, node, s, path, d, ms, mv, res, j, best, bv, c, v, N;
  if (rootMoves.length <= 1) return rootMoves[0] || null;
  cap = cap || 500;
  var root = { mv: null, who: -1, parent: null, kids: [], untried: rootMoves.slice(), n: 0, w: 0 };
  for (i = 0; i < iters; i++) {
    s = E.copy(st); node = root;
    while (!node.untried.length && node.kids.length) {
      best = null; bv = -1; N = Math.log(node.n + 1);
      for (j = 0; j < node.kids.length; j++) { c = node.kids[j]; v = c.w / c.n + 1.2 * Math.sqrt(N / c.n); if (v > bv) { bv = v; best = c; } }
      node = best; E.apply(s, node.mv);
    }
    if (node.untried.length && !s.over) {
      j = Math.floor(rng() * node.untried.length); mv = node.untried.splice(j, 1)[0];
      var who = s.turn; E.apply(s, mv);
      c = { mv: mv, who: who, parent: node, kids: [], untried: s.over ? [] : E.moves(s), n: 0, w: 0 }; node.kids.push(c); node = c;
    }
    for (d = 0; !s.over && d < cap; d++) { mv = E.randomMove ? E.randomMove(s, rng) : SK.pick(rng, E.moves(s)); if (!mv) break; E.apply(s, mv); }
    for (; node; node = node.parent) {
      if (node.who < 0) { node.n++; continue; }
      res = !s.over ? 0.5 : s.draw || !s.winners ? 0.5 : s.winners.indexOf(node.who) >= 0 ? 1 : 0;
      node.n++; node.w += res;
    }
  }
  best = null; bv = -1;
  for (j = 0; j < root.kids.length; j++) if (root.kids[j].n > bv) { bv = root.kids[j].n; best = root.kids[j]; }
  return best ? best.mv : rootMoves[0];
};
SK.iters = function (level) { return level >= 2 ? 450 : level === 1 ? 160 : 40; };

/* =====================================================================
   GOMOKU. 15 x 15 board, cell index = row * 15 + col. Players take turns putting a stone on any empty cell.
   Five or more stones in a row (any direction) win; a full board is a draw.
   ===================================================================== */
var GM = SK.def({ id: 'gomoku', seats: [2, 2], perMove: 45000, N: 15 });
GM.init = function (n, first) { var b = [], i; for (i = 0; i < 225; i++) b.push(0); return SK.base(2, first, { b: b, line: null }); };
GM.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), line: st.line }; };
GM.moves = function (st) { var out = [], i; if (st.over) return out; for (i = 0; i < 225; i++) if (!st.b[i]) out.push({ c: i }); return out; };
GM.find = function (st, mv) { return mv && !st.over && typeof mv.c === 'number' && mv.c === (mv.c | 0) && mv.c >= 0 && mv.c < 225 && !st.b[mv.c] && Object.keys(mv).length === 1 ? { c: mv.c } : null; };
GM.randomMove = function (st, rng) { var t, k; for (k = 0; k < 40; k++) { t = Math.floor(rng() * 225); if (!st.b[t]) return { c: t }; } return SK.pick(rng, GM.moves(st)); };
/* the cells of the line of five or more through cell i, or null */
GM.lineAt = function (b, i) {
  var p = b[i], r0 = (i / 15) | 0, c0 = i % 15, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], d, k, cells, r, c;
  if (!p) return null;
  for (d = 0; d < 4; d++) {
    cells = [i];
    for (k = 1; k < 15; k++) { r = r0 + dirs[d][0] * k; c = c0 + dirs[d][1] * k; if (r < 0 || r > 14 || c < 0 || c > 14 || b[r * 15 + c] !== p) break; cells.push(r * 15 + c); }
    for (k = 1; k < 15; k++) { r = r0 - dirs[d][0] * k; c = c0 - dirs[d][1] * k; if (r < 0 || r > 14 || c < 0 || c > 14 || b[r * 15 + c] !== p) break; cells.push(r * 15 + c); }
    if (cells.length >= 5) return cells.sort(function (x, y) { return x - y; });
  }
  return null;
};
GM.apply = function (st, mv) {
  var i = mv.c, ln;
  st.b[i] = st.turn + 1; st.plies++; st.last = { c: i };
  ln = GM.lineAt(st.b, i);
  if (ln) { st.line = ln; SK.end(st, [st.turn]); } else if (st.plies >= 225) SK.end(st, null); else st.turn = 1 - st.turn;
  return st;
};
/* score of putting stone p on cell i: how much it builds for p (lines of 2, 3, 4, 5) */
GM.score = function (b, i, p) {
  var r0 = (i / 15) | 0, c0 = i % 15, dirs = [[0, 1], [1, 0], [1, 1], [1, -1]], d, s = 0, run, open, k, r, c, dir;
  for (d = 0; d < 4; d++) {
    run = 1; open = 0;
    for (dir = -1; dir <= 1; dir += 2) {
      for (k = 1; k < 5; k++) { r = r0 + dirs[d][0] * k * dir; c = c0 + dirs[d][1] * k * dir; if (r < 0 || r > 14 || c < 0 || c > 14) break; if (b[r * 15 + c] === p) run++; else { if (b[r * 15 + c] === 0) open++; break; } }
    }
    if (run >= 5) s += 100000; else if (run === 4) s += open === 2 ? 12000 : open === 1 ? 1500 : 0; else if (run === 3) s += open === 2 ? 1400 : open === 1 ? 120 : 0; else if (run === 2) s += open === 2 ? 90 : open === 1 ? 10 : 0; else s += open;
  }
  return s;
};
GM.bot = function (st, level, rng) {
  var b = st.b, me = st.turn + 1, opp = 3 - me, cand = [], seen = {}, i, r, c, dr, dc, rr, cc, j, any = false, best = [], bs = -1, sc, noise;
  for (i = 0; i < 225; i++) if (b[i]) { any = true; r = (i / 15) | 0; c = i % 15; for (dr = -2; dr <= 2; dr++) for (dc = -2; dc <= 2; dc++) { rr = r + dr; cc = c + dc; if (rr < 0 || rr > 14 || cc < 0 || cc > 14) continue; j = rr * 15 + cc; if (!b[j] && !seen[j]) { seen[j] = 1; cand.push(j); } } }
  if (!any) return { c: 112 };
  noise = level >= 2 ? 0 : level === 1 ? 0.15 : 0.6;
  for (i = 0; i < cand.length; i++) {
    sc = GM.score(b, cand[i], me) * 1.05 + GM.score(b, cand[i], opp) * (level >= 1 ? 1 : 0.6);
    sc *= 1 + (rng() - 0.5) * noise;
    if (sc > bs) { bs = sc; best = [cand[i]]; } else if (sc === bs) best.push(cand[i]);
  }
  return { c: best[Math.floor(rng() * best.length)] };
};

/* =====================================================================
   HEX. 11 x 11 board of hexagons, cell index = row * 11 + col; neighbours (r,c+-1) (r+-1,c) (r-1,c+1) (r+1,c-1).
   Colour 1 connects the top row with the bottom row, colour 2 the left column with the right column.
   Pie rule: the player who moves second may, instead of a move, swap: he takes over the first stone's colour.
   ===================================================================== */
var HX = SK.def({ id: 'hex', seats: [2, 2], perMove: 60000, N: 11 });
HX.NB = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, 1], [1, -1]];
HX.init = function (n, first) { var b = [], i; for (i = 0; i < 121; i++) b.push(0); return SK.base(2, first, { b: b, col: [1, 2], first: first | 0, line: null }); };
HX.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), col: st.col.slice(), first: st.first, line: st.line }; };
HX.moves = function (st) {
  var out = [], i; if (st.over) return out;
  for (i = 0; i < 121; i++) if (!st.b[i]) out.push({ c: i });
  if (st.plies === 1) out.push({ s: 1 });
  return out;
};
HX.find = function (st, mv) {
  if (!mv || st.over || typeof mv !== 'object') return null;
  if (mv.s === 1 && Object.keys(mv).length === 1) return st.plies === 1 ? { s: 1 } : null;
  return typeof mv.c === 'number' && mv.c === (mv.c | 0) && mv.c >= 0 && mv.c < 121 && !st.b[mv.c] && Object.keys(mv).length === 1 ? { c: mv.c } : null;
};
HX.randomMove = function (st, rng) { var t, k; if (st.plies === 1 && rng() < 0.05) return { s: 1 }; for (k = 0; k < 60; k++) { t = Math.floor(rng() * 121); if (!st.b[t]) return { c: t }; } return SK.pick(rng, HX.moves(st)); };
/* the chain of colour p that contains cell i and touches both of p's sides, or null */
HX.winChain = function (b, i, p) {
  var seen = {}, stack = [i], cells = [], a = false, z = false, k, x, r, c, rr, cc, j;
  seen[i] = 1;
  while (stack.length) {
    x = stack.pop(); cells.push(x); r = (x / 11) | 0; c = x % 11;
    if (p === 1) { if (r === 0) a = true; if (r === 10) z = true; } else { if (c === 0) a = true; if (c === 10) z = true; }
    for (k = 0; k < 6; k++) { rr = r + HX.NB[k][0]; cc = c + HX.NB[k][1]; if (rr < 0 || rr > 10 || cc < 0 || cc > 10) continue; j = rr * 11 + cc; if (b[j] === p && !seen[j]) { seen[j] = 1; stack.push(j); } }
  }
  return a && z ? cells.sort(function (u, v) { return u - v; }) : null;
};
HX.apply = function (st, mv) {
  var other = 1 - st.turn, ch;
  st.plies++;
  if (mv.s === 1) { st.col = [st.col[1], st.col[0]]; st.last = { s: 1 }; st.turn = st.first; return st; }
  st.b[mv.c] = st.col[st.turn]; st.last = { c: mv.c };
  ch = HX.winChain(st.b, mv.c, st.col[st.turn]);
  if (ch) { st.line = ch; SK.end(st, [st.turn]); } else st.turn = other;
  return st;
};
/* shortest-path style value: how many stones colour p still needs (two-distance light version via BFS with costs) */
HX.dist = function (b, p) {
  var INF = 999, d = [], i, q, h, x, r, c, k, rr, cc, j, w, nd, starts = [], done;
  for (i = 0; i < 121; i++) d.push(INF);
  q = [];
  for (i = 0; i < 11; i++) { j = p === 1 ? i : i * 11; if (b[j] === 3 - p) continue; d[j] = b[j] === p ? 0 : 1; q.push(j); }
  /* 0-1 BFS with a simple relaxation loop (board is tiny) */
  var changed = true;
  while (changed) {
    changed = false;
    for (x = 0; x < 121; x++) {
      if (d[x] >= INF) continue; r = (x / 11) | 0; c = x % 11;
      for (k = 0; k < 6; k++) { rr = r + HX.NB[k][0]; cc = c + HX.NB[k][1]; if (rr < 0 || rr > 10 || cc < 0 || cc > 10) continue; j = rr * 11 + cc; if (b[j] === 3 - p) continue; nd = d[x] + (b[j] === p ? 0 : 1); if (nd < d[j]) { d[j] = nd; changed = true; } }
    }
  }
  var best = INF;
  for (i = 0; i < 11; i++) { j = p === 1 ? 110 + i : i * 11 + 10; if (d[j] < best) best = d[j]; }
  return best;
};
HX.bot = function (st, level, rng) {
  var me = st.col[st.turn], mv, ms, i, best = null, bs = -1e9, sc, s2, opp = 3 - me;
  if (st.plies === 0) return { c: level >= 1 ? 60 + (rng() < 0.5 ? 1 : -1) * Math.floor(rng() * 3) : Math.floor(rng() * 121) };
  if (st.plies === 1) { /* pie rule: swap when the first stone is strong (near the centre) */
    var f = -1; for (i = 0; i < 121; i++) if (st.b[i]) f = i;
    var fr = (f / 11) | 0, fc = f % 11, centre = Math.abs(fr - 5) + Math.abs(fc - 5);
    if (level >= 1 && centre <= 3) return { s: 1 };
    if (level === 0 && centre <= 1) return { s: 1 };
  }
  if (level === 0) { /* weak: a few playouts */
    return SK.mcts(HX, st, SK.iters(0), rng, 140);
  }
  return SK.mcts(HX, st, SK.iters(level), rng, 140);
};

/* =====================================================================
   BREAKTHROUGH. 8 x 8, cell index = row * 8 + col. Player 0 (value 1) starts at the bottom (rows 6, 7) and moves up,
   player 1 (value 2) starts at the top (rows 0, 1) and moves down. A piece moves one step forward or diagonally forward
   onto an empty cell; it captures only diagonally forward. First to reach the far row wins, or the one whose opponent
   has no pieces / no move left.
   ===================================================================== */
var BT = SK.def({ id: 'breakthrough', seats: [2, 2], perMove: 45000 });
BT.init = function (n, first) { var b = [], i; for (i = 0; i < 64; i++) b.push(i < 16 ? 2 : i >= 48 ? 1 : 0); return SK.base(2, first, { b: b }); };
BT.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice() }; };
BT.gen = function (b, p) {
  var out = [], i, r, c, dr = p === 1 ? -1 : 1, dc, t, rr, cc;
  for (i = 0; i < 64; i++) {
    if (b[i] !== p) continue; r = (i / 8) | 0; c = i % 8; rr = r + dr; if (rr < 0 || rr > 7) continue;
    for (dc = -1; dc <= 1; dc++) {
      cc = c + dc; if (cc < 0 || cc > 7) continue; t = rr * 8 + cc;
      if (dc === 0) { if (!b[t]) out.push({ f: i, t: t }); } else if (b[t] !== p) out.push({ f: i, t: t });
    }
  }
  return out;
};
BT.moves = function (st) { return st.over ? [] : BT.gen(st.b, st.turn + 1); };
BT.find = function (st, mv) { return SK.findIn(BT, st, mv); };
BT.apply = function (st, mv) {
  var p = st.turn + 1, tr = (mv.t / 8) | 0, left;
  st.b[mv.t] = p; st.b[mv.f] = 0; st.plies++; st.last = { f: mv.f, t: mv.t };
  if ((p === 1 && tr === 0) || (p === 2 && tr === 7)) { SK.end(st, [st.turn]); return st; }
  left = 0; for (var i = 0; i < 64; i++) if (st.b[i] === 3 - p) left++;
  if (!left) { SK.end(st, [st.turn]); return st; }
  st.turn = 1 - st.turn;
  if (!BT.gen(st.b, st.turn + 1).length) SK.end(st, [1 - st.turn]);
  return st;
};
BT.eval = function (b, p) {
  var s = 0, i, r, v;
  for (i = 0; i < 64; i++) { v = b[i]; if (!v) continue; r = (i / 8) | 0; if (v === p) s += 100 + (p === 1 ? 7 - r : r) * 6; else s -= 100 + (v === 1 ? 7 - r : r) * 6; }
  return s;
};
BT.search = function (b, p, depth, alpha, beta, me) {      /* negamax: value for player p to move */
  var ms = BT.gen(b, p), i, m, best = -1e9, v, tr, cap, from;
  if (depth === 0 || !ms.length) return ms.length ? BT.eval(b, p) : -90000 - depth;
  for (i = 0; i < ms.length; i++) {
    m = ms[i]; tr = (m.t / 8) | 0;
    if ((p === 1 && tr === 0) || (p === 2 && tr === 7)) return 90000 + depth;
  }
  for (i = 0; i < ms.length; i++) {
    m = ms[i]; cap = b[m.t]; b[m.t] = p; b[m.f] = 0;
    v = -BT.search(b, 3 - p, depth - 1, -beta, -alpha, me);
    b[m.f] = p; b[m.t] = cap;
    if (v > best) best = v; if (v > alpha) alpha = v; if (alpha >= beta) break;
  }
  return best;
};
BT.bot = function (st, level, rng) {
  var p = st.turn + 1, ms = BT.gen(st.b, p), b = st.b.slice(), depth = level >= 2 ? 4 : level === 1 ? 2 : 1, i, m, cap, v, best = [], bv = -1e9, tr;
  for (i = 0; i < ms.length; i++) {
    m = ms[i]; tr = (m.t / 8) | 0;
    if ((p === 1 && tr === 0) || (p === 2 && tr === 7)) return m;
    cap = b[m.t]; b[m.t] = p; b[m.f] = 0;
    v = -BT.search(b, 3 - p, depth - 1, -1e9, 1e9, p) + (rng() - 0.5) * (level >= 2 ? 0.5 : 14);
    b[m.f] = p; b[m.t] = cap;
    if (v > bv) { bv = v; best = [m]; } else if (v === bv) best.push(m);
  }
  return best[Math.floor(rng() * best.length)];
};

/* =====================================================================
   MANCALA (Kalah, 6 pits x 4 seeds). pits[0..5] are player 0's pits, pits[6] is player 0's store,
   pits[7..12] are player 1's pits, pits[13] is player 1's store. Seeds are sown counter-clockwise, one per pit,
   skipping the opponent's store. A last seed in your own store gives another turn. A last seed in an empty pit of
   yours captures that seed and the seeds in the opposite pit into your store. When one side has no seeds left the
   other player keeps his own seeds; most seeds in the store wins (24 each = draw).
   ===================================================================== */
var MC = SK.def({ id: 'mancala', seats: [2, 2], perMove: 40000 });
MC.init = function (n, first) { var p = [], i; for (i = 0; i < 14; i++) p.push(i === 6 || i === 13 ? 0 : 4); return SK.base(2, first, { pits: p }); };
MC.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, pits: st.pits.slice() }; };
MC.moves = function (st) { var out = [], k, off = st.turn * 7; if (st.over) return out; for (k = 0; k < 6; k++) if (st.pits[off + k] > 0) out.push({ p: k }); return out; };
MC.find = function (st, mv) { return SK.findIn(MC, st, mv); };
/* play pit k (0..5) for player pl on a pits array; returns { again, end } */
MC.sow = function (pits, pl, k) {
  var pos = pl * 7 + k, n = pits[pos], skip = (1 - pl) * 7 + 6, mine = pl * 7 + 6, opp, i;
  pits[pos] = 0;
  while (n > 0) { pos = (pos + 1) % 14; if (pos === skip) continue; pits[pos]++; n--; }
  if (pos === mine) return true;
  if (pos >= pl * 7 && pos < pl * 7 + 6 && pits[pos] === 1) { opp = 12 - pos; if (pits[opp] > 0) { pits[mine] += pits[opp] + 1; pits[opp] = 0; pits[pos] = 0; } }
  return false;
};
MC.side = function (pits, pl) { var s = 0, i; for (i = 0; i < 6; i++) s += pits[pl * 7 + i]; return s; };
MC.apply = function (st, mv) {
  var again = MC.sow(st.pits, st.turn, mv.p), s0 = MC.side(st.pits, 0), s1 = MC.side(st.pits, 1), i;
  st.plies++; st.last = { p: mv.p, by: st.turn };
  if (!s0 || !s1) {
    for (i = 0; i < 6; i++) { st.pits[6] += st.pits[i]; st.pits[i] = 0; st.pits[13] += st.pits[7 + i]; st.pits[7 + i] = 0; }
    SK.end(st, st.pits[6] > st.pits[13] ? [0] : st.pits[13] > st.pits[6] ? [1] : null);
    return st;
  }
  if (!again) st.turn = 1 - st.turn;
  return st;
};
MC.eval = function (pits, pl) { return pits[pl * 7 + 6] - pits[(1 - pl) * 7 + 6]; };
MC.search = function (pits, pl, depth, alpha, beta, root) {  /* value for player root; pl = player to move */
  var s0 = MC.side(pits, 0), s1 = MC.side(pits, 1), k, p2, again, v, best, i;
  if (!s0 || !s1 || depth === 0) {
    var q = pits.slice(); if (!s0 || !s1) for (i = 0; i < 6; i++) { q[6] += q[i]; q[i] = 0; q[13] += q[7 + i]; q[7 + i] = 0; }
    return MC.eval(q, root) * 10 + (s0 && s1 ? (MC.side(pits, root) - MC.side(pits, 1 - root)) * 0.3 : 0);
  }
  best = pl === root ? -1e9 : 1e9;
  for (k = 0; k < 6; k++) {
    if (!pits[pl * 7 + k]) continue;
    p2 = pits.slice(); again = MC.sow(p2, pl, k);
    v = MC.search(p2, again ? pl : 1 - pl, depth - 1, alpha, beta, root);
    if (pl === root) { if (v > best) best = v; if (v > alpha) alpha = v; } else { if (v < best) best = v; if (v < beta) beta = v; }
    if (alpha >= beta) break;
  }
  return best;
};
MC.bot = function (st, level, rng) {
  var ms = MC.moves(st), depth = level >= 2 ? 9 : level === 1 ? 5 : 1, i, p2, again, v, best = [], bv = -1e9;
  for (i = 0; i < ms.length; i++) {
    p2 = st.pits.slice(); again = MC.sow(p2, st.turn, ms[i].p);
    v = MC.search(p2, again ? st.turn : 1 - st.turn, depth - 1, -1e9, 1e9, st.turn) + (rng() - 0.5) * (level >= 2 ? 0.01 : level === 1 ? 1 : 8);
    if (v > bv) { bv = v; best = [ms[i]]; } else if (v === bv) best.push(ms[i]);
  }
  return best[Math.floor(rng() * best.length)];
};

/* =====================================================================
   ULTIMATE TIC-TAC-TOE. Nine small boards (3 x 3) form one big board. Cell index = board * 9 + cell (0..80).
   The cell you play decides in which small board your opponent must play next (when that board is won or full he may
   choose any board that is still open). Winning a small board = three in a row inside it. Three small boards in a row
   win the game; if no one gets there, the player with more small boards wins (equal = draw).
   ===================================================================== */
var UT = SK.def({ id: 'ultimate', seats: [2, 2], perMove: 45000 });
UT.LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
UT.init = function (n, first) { var b = [], l = [], i; for (i = 0; i < 81; i++) b.push(0); for (i = 0; i < 9; i++) l.push(0); return SK.base(2, first, { b: b, loc: l, next: -1 }); };
UT.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), loc: st.loc.slice(), next: st.next }; };
UT.open = function (st, bd) { return st.loc[bd] === 0; };
UT.moves = function (st) {
  var out = [], bd, i, from, to;
  if (st.over) return out;
  if (st.next >= 0 && st.loc[st.next] === 0) { from = st.next; to = st.next; } else { from = 0; to = 8; }
  for (bd = from; bd <= to; bd++) { if (st.loc[bd]) continue; for (i = 0; i < 9; i++) if (!st.b[bd * 9 + i]) out.push({ c: bd * 9 + i }); }
  return out;
};
UT.find = function (st, mv) { return SK.findIn(UT, st, mv); };
UT.lineOf = function (cells9, p) { var k, L; for (k = 0; k < 8; k++) { L = UT.LINES[k]; if (cells9[L[0]] === p && cells9[L[1]] === p && cells9[L[2]] === p) return true; } return false; };
UT.apply = function (st, mv) {
  var bd = (mv.c / 9) | 0, cell = mv.c % 9, p = st.turn + 1, i, full, sub, k, L, won, w0 = 0, w1 = 0;
  st.b[mv.c] = p; st.plies++; st.last = { c: mv.c };
  sub = st.b.slice(bd * 9, bd * 9 + 9);
  if (UT.lineOf(sub, p)) st.loc[bd] = p; else { full = true; for (i = 0; i < 9; i++) if (!sub[i]) full = false; if (full) st.loc[bd] = 3; }
  if (UT.lineOf(st.loc, p)) { SK.end(st, [st.turn]); return st; }
  var anyOpen = false; for (i = 0; i < 9; i++) if (st.loc[i] === 0) anyOpen = true;
  if (!anyOpen) { for (i = 0; i < 9; i++) { if (st.loc[i] === 1) w0++; else if (st.loc[i] === 2) w1++; } SK.end(st, w0 > w1 ? [0] : w1 > w0 ? [1] : null); return st; }
  st.next = st.loc[cell] === 0 ? cell : -1;
  st.turn = 1 - st.turn;
  return st;
};
UT.bot = function (st, level, rng) { return SK.mcts(UT, st, SK.iters(level) * 2, rng, 90); };

/* =====================================================================
   DOTS AND BOXES. 5 x 5 boxes (6 x 6 dots). 60 edges: 0..29 horizontal (row r 0..5, col c 0..4: r * 5 + c),
   30..59 vertical (row r 0..4, col c 0..5: 30 + r * 6 + c). Draw one edge per turn. Closing the fourth side of a box
   gives you the box and another turn. The player with more boxes wins (25 boxes, so no draws).
   ===================================================================== */
var DB = SK.def({ id: 'dots', seats: [2, 2], perMove: 30000 });
DB.boxEdges = function (r, c) { return [r * 5 + c, (r + 1) * 5 + c, 30 + r * 6 + c, 30 + r * 6 + c + 1]; };
DB.BOXES = (function () { var o = [], r, c; for (r = 0; r < 5; r++) for (c = 0; c < 5; c++) o.push(DB.boxEdges(r, c)); return o; })();
/* which boxes touch each edge */
DB.EDGE_BOXES = (function () { var m = [], e, i; for (e = 0; e < 60; e++) m.push([]); for (i = 0; i < 25; i++) DB.BOXES[i].forEach(function (e2) { m[e2].push(i); }); return m; })();
DB.init = function (n, first) { var e = [], b = [], cnt = [], i; for (i = 0; i < 60; i++) e.push(0); for (i = 0; i < 25; i++) { b.push(0); cnt.push(0); } return SK.base(2, first, { e: e, box: b, cnt: cnt, score: [0, 0] }); };
DB.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, e: st.e.slice(), box: st.box.slice(), cnt: st.cnt.slice(), score: st.score.slice() }; };
DB.moves = function (st) { var out = [], i; if (st.over) return out; for (i = 0; i < 60; i++) if (!st.e[i]) out.push({ e: i }); return out; };
DB.find = function (st, mv) { return mv && !st.over && typeof mv.e === 'number' && mv.e === (mv.e | 0) && mv.e >= 0 && mv.e < 60 && !st.e[mv.e] && Object.keys(mv).length === 1 ? { e: mv.e } : null; };
DB.apply = function (st, mv) {
  var bx = DB.EDGE_BOXES[mv.e], i, got = 0, done = 0;
  st.e[mv.e] = st.turn + 1; st.plies++;
  for (i = 0; i < bx.length; i++) { st.cnt[bx[i]]++; if (st.cnt[bx[i]] === 4) { st.box[bx[i]] = st.turn + 1; st.score[st.turn]++; got++; } }
  st.last = { e: mv.e, got: got, by: st.turn };
  for (i = 0; i < 25; i++) if (st.box[i]) done++;
  if (done === 25) { SK.end(st, st.score[0] > st.score[1] ? [0] : [1]); return st; }
  if (!got) st.turn = 1 - st.turn;
  return st;
};
/* boxes the opponent would collect if it takes every box that has three sides after our move e */
DB.chainGain = function (st, e) {
  var s = DB.copy(st), pl = s.turn, i, k, found, ed, start;
  DB.apply(s, { e: e });
  if (s.over || s.turn === pl) return 0;
  start = s.score[s.turn];
  for (var guard = 0; guard < 60 && !s.over; guard++) {
    found = -1;
    for (i = 0; i < 25 && found < 0; i++) if (!s.box[i] && s.cnt[i] === 3) { ed = DB.BOXES[i]; for (k = 0; k < 4; k++) if (!s.e[ed[k]]) { found = ed[k]; break; } }
    if (found < 0) break;
    DB.apply(s, { e: found });
  }
  return s.score[1 - pl] - start;
};
DB.bot = function (st, level, rng) {
  var ms = DB.moves(st), i, k, bx, closes, gives, closing = [], safe = [], best = [], bg = 1e9, g;
  for (i = 0; i < ms.length; i++) {
    bx = DB.EDGE_BOXES[ms[i].e]; closes = false; gives = false;
    for (k = 0; k < bx.length; k++) { if (st.cnt[bx[k]] === 3) closes = true; else if (st.cnt[bx[k]] === 2) gives = true; }
    if (closes) closing.push(ms[i]); else if (!gives) safe.push(ms[i]);
  }
  if (closing.length && (level >= 1 || rng() < 0.7)) return SK.pick(rng, closing);
  if (safe.length) return SK.pick(rng, safe);
  if (closing.length) return SK.pick(rng, closing);
  if (level === 0) return SK.pick(rng, ms);
  for (i = 0; i < ms.length; i++) { g = DB.chainGain(st, ms[i].e); if (g < bg) { bg = g; best = [ms[i]]; } else if (g === bg) best.push(ms[i]); }
  return SK.pick(rng, best);
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
