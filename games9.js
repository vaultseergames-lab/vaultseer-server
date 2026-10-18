/* ===== Game engines, part 9: skill games, second batch (2/2) =====
   International Draughts (10x10) and Xiangqi (Chinese chess). Same interface as games7.js. No randomness, every move public. Pure logic, no DOM. */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
if (typeof require !== 'undefined' && !VG.sk) require('./games7.js');
var SK = VG.sk;

/* =====================================================================
   INTERNATIONAL DRAUGHTS 10 x 10. Only the dark squares are used: 50 squares, index i = row * 5 + k (k = 0..4 along the row);
   row 0 is the top. The dark square of row r, column c (r + c odd) has k = (c - (r % 2 === 0 ? 1 : 0)) / 2.
   Player 0 (White) starts on rows 6-9 and moves up, player 1 (Black) starts on rows 0-3 and moves down.
   Men step one square diagonally forward; kings move any distance along a diagonal. Men capture forward and backward; kings fly.
   A capture is compulsory and you must take the sequence that captures the most pieces. Captured pieces are removed after the whole sequence,
   and a piece may not be jumped twice. A man that ENDS its move on the far row becomes a king.
   You win when the opponent has no legal move. Only kings move for 25 moves each without a capture: draw. 400 plies: draw.
   Move = { p: '34-29' } for a step, or '28-19-10' for a capture sequence (the squares the piece lands on).
   ===================================================================== */
var DR = SK.def({ id: 'draughts', seats: [2, 2], perMove: 75000, CAP: 400, QUIET: 50 });
DR.RC = []; DR.IDX = [];
(function () { var r, c, i = 0, k; for (r = 0; r < 10; r++) { DR.IDX.push([]); for (c = 0; c < 10; c++) DR.IDX[r].push(-1); } for (r = 0; r < 10; r++) for (c = 0; c < 10; c++) if ((r + c) % 2 === 1) { DR.IDX[r][c] = r * 5 + (c - (r % 2 === 0 ? 1 : 0)) / 2; DR.RC[DR.IDX[r][c]] = [r, c]; } })();
DR.D = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
DR.sq = function (r, c) { return r < 0 || r > 9 || c < 0 || c > 9 ? -1 : DR.IDX[r][c]; };
DR.init = function (n, first) {
  var b = [], i; for (i = 0; i < 50; i++) b.push(i < 20 ? 2 : i >= 30 ? 1 : 0);
  return SK.base(2, first, { b: b, quiet: 0 });
};
DR.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), quiet: st.quiet }; };
/* all capture sequences of the piece on `from`: pushes { path:[...], caps:[...] } */
DR.capturesFrom = function (b, from, me, out) {
  var piece = b[from], king = piece > 2, taken = {}, start = from, best = [];
  b[from] = 0;
  function walk(pos, path, caps) {
    var rc = DR.RC[pos], d, r, c, any = false, over, land, k;
    for (d = 0; d < 4; d++) {
      r = rc[0] + DR.D[d][0]; c = rc[1] + DR.D[d][1];
      if (!king) {
        over = DR.sq(r, c); land = DR.sq(r + DR.D[d][0], c + DR.D[d][1]);
        if (over >= 0 && land >= 0 && b[over] && ((b[over] - 1) & 1) !== (me - 1) && !taken[over] && b[land] === 0) {
          any = true; taken[over] = 1; walk(land, path.concat([land]), caps.concat([over])); taken[over] = 0;
        }
      } else {
        while ((over = DR.sq(r, c)) >= 0 && b[over] === 0) { r += DR.D[d][0]; c += DR.D[d][1]; }
        if (over < 0 || !b[over] || taken[over] || ((b[over] - 1) & 1) === (me - 1)) continue;   /* edge, own piece, or an already captured piece */
        r += DR.D[d][0]; c += DR.D[d][1];
        taken[over] = 1;
        while ((land = DR.sq(r, c)) >= 0 && b[land] === 0) { any = true; walk(land, path.concat([land]), caps.concat([over])); r += DR.D[d][0]; c += DR.D[d][1]; }
        taken[over] = 0;
      }
    }
    if (!any && caps.length) out.push({ path: path, caps: caps });
  }
  walk(from, [from], []);
  b[start] = piece;
};
DR.legalList = function (st) {
  var p = st.turn + 1, b = st.b, i, caps = [], res = [], maxc = 0, k, rc, d, r, c, to, pc, king, m, step;
  for (i = 0; i < 50; i++) if (b[i] && ((b[i] - 1) & 1) === p - 1) DR.capturesFrom(b, i, p, caps);
  if (caps.length) {
    for (k = 0; k < caps.length; k++) if (caps[k].caps.length > maxc) maxc = caps[k].caps.length;
    for (k = 0; k < caps.length; k++) if (caps[k].caps.length === maxc) res.push({ path: caps[k].path, caps: caps[k].caps, cap: true });
    return res;
  }
  step = p === 1 ? -1 : 1;
  for (i = 0; i < 50; i++) {
    pc = b[i]; if (!pc || ((pc - 1) & 1) !== p - 1) continue;
    king = pc > 2; rc = DR.RC[i];
    for (d = 0; d < 4; d++) {
      if (!king && DR.D[d][0] !== step) continue;
      r = rc[0] + DR.D[d][0]; c = rc[1] + DR.D[d][1];
      while ((to = DR.sq(r, c)) >= 0 && b[to] === 0) { res.push({ path: [i, to], caps: [], cap: false }); if (!king) break; r += DR.D[d][0]; c += DR.D[d][1]; }
    }
  }
  return res;
};
DR.key = function (path) { return path.join('-'); };
DR.moves = function (st) { if (st.over) return []; return DR.legalList(st).map(function (m) { return { p: DR.key(m.path) }; }); };
DR.find = function (st, mv) {
  var list, i, keys;
  if (!mv || st.over || typeof mv !== 'object') return null;
  keys = Object.keys(mv); if (keys.length !== 1 || typeof mv.p !== 'string' || mv.p.length > 60 || !/^[0-9]+(-[0-9]+)+$/.test(mv.p)) return null;
  list = DR.legalList(st);
  for (i = 0; i < list.length; i++) if (DR.key(list[i].path) === mv.p) return { p: mv.p };
  return null;
};
DR.applyList = function (st, m) {
  var p = st.turn + 1, from = m.path[0], to = m.path[m.path.length - 1], piece = st.b[from], i;
  for (i = 0; i < m.caps.length; i++) st.b[m.caps[i]] = 0;
  st.b[from] = 0;
  if (piece <= 2 && ((p === 1 && DR.RC[to][0] === 0) || (p === 2 && DR.RC[to][0] === 9))) piece += 2;
  st.b[to] = piece;
  return piece;
};
DR.apply = function (st, mv) {
  var list = DR.legalList(st), m = null, i, p = st.turn + 1, wasKing, from;
  for (i = 0; i < list.length; i++) if (DR.key(list[i].path) === mv.p) { m = list[i]; break; }
  from = m.path[0]; wasKing = st.b[from] > 2;
  DR.applyList(st, m);
  st.plies++; st.last = { p: mv.p, caps: m.caps };
  if (wasKing && !m.cap) st.quiet++; else st.quiet = 0;
  st.turn = 1 - st.turn;
  if (!DR.legalList(st).length) { SK.end(st, [1 - st.turn]); return st; }
  if (st.quiet >= DR.QUIET || st.plies >= DR.CAP) SK.end(st, null);
  return st;
};
/* evaluation for the side `me` (1 or 2): material, advancement, a little protection of the back row */
DR.eval = function (b, me) {
  var v = 0, i, pc, own, rc, adv;
  for (i = 0; i < 50; i++) {
    pc = b[i]; if (!pc) continue;
    own = ((pc - 1) & 1) === me - 1; rc = DR.RC[i];
    if (pc > 2) v += own ? 320 : -320;
    else { adv = (pc === 1 ? 9 - rc[0] : rc[0]); var x = 100 + adv * 3 + (rc[1] > 1 && rc[1] < 8 ? 2 : 0) + ((pc === 1 && rc[0] === 9) || (pc === 2 && rc[0] === 0) ? 4 : 0); v += own ? x : -x; }
  }
  return v;
};
DR.search = function (st, depth, alpha, beta, me, budget) {
  var list, i, s, v, best = -1e9;
  if (budget.n-- <= 0) return DR.eval(st.b, me) * (st.turn + 1 === me ? 1 : -1);
  list = DR.legalList(st);
  if (!list.length) return -100000 + depth * -1;
  if (depth <= 0 && !list[0].cap) return DR.eval(st.b, me) * (st.turn + 1 === me ? 1 : -1);
  if (depth <= -6) return DR.eval(st.b, me) * (st.turn + 1 === me ? 1 : -1);
  for (i = 0; i < list.length; i++) {
    s = DR.copy(st); DR.applyList(s, list[i]); s.turn = 1 - s.turn; s.plies++;
    v = -DR.search(s, depth - 1, -beta, -alpha, me, budget);
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
};
DR.bot = function (st, level, rng) {
  var list = DR.legalList(st), i, best = null, bv, s, v, depth, budget, me = st.turn + 1, dmax, bestList;
  if (!list.length) return null;
  if (list.length === 1) return { p: DR.key(list[0].path) };
  if (level === 0) {
    /* level 0: take a capture if there is one, otherwise a random step that is not immediately lost to a capture */
    var safe = list.filter(function (m) { var s2 = DR.copy(st); DR.applyList(s2, m); s2.turn = 1 - s2.turn; var l2 = DR.legalList(s2); return !(l2.length && l2[0].cap); });
    return { p: DR.key(SK.pick(rng, safe.length && rng() < 0.7 ? safe : list).path) };
  }
  dmax = level >= 2 ? 6 : 2;
  for (depth = 1; depth <= dmax; depth++) {
    budget = { n: level >= 2 ? 26000 : 3000 }; bv = -1e9; bestList = [];
    for (i = 0; i < list.length; i++) {
      s = DR.copy(st); DR.applyList(s, list[i]); s.turn = 1 - s.turn; s.plies++;
      v = -DR.search(s, depth - 1, -1e9, 1e9, me, budget) + rng() * 0.5;
      if (v > bv + 0.0001) { bv = v; bestList = [list[i]]; }
    }
    if (budget.n <= 0 && depth > 1) break;
    best = bestList[0];
  }
  return { p: DR.key((best || list[0]).path) };
};
/* perft for tests: number of move sequences of the given length from a position */
DR.perft = function (st, depth) {
  var list, i, n = 0, s;
  if (depth === 0) return 1;
  list = DR.legalList(st);
  if (depth === 1) return list.length;
  for (i = 0; i < list.length; i++) { s = DR.copy(st); DR.applyList(s, list[i]); s.turn = 1 - s.turn; n += DR.perft(s, depth - 1); }
  return n;
};

/* =====================================================================
   XIANGQI (Chinese chess) 9 x 10. Cell index = row * 9 + col, row 0 at the top. Red (player 0, bottom) moves first on the board; Black (player 1) is on top.
   Pieces: General (stays in the palace, never faces the other General on an open file), Advisor (diagonal step in the palace), Elephant (two squares
   diagonally, not over a blocker, never crosses the river), Horse (one orthogonal + one diagonal step; blocked by a piece next to it), Chariot (any distance
   along a line), Cannon (moves like a chariot, captures by jumping exactly one piece), Soldier (one step forward; after the river also sideways).
   You may not leave your General attacked. A player with no legal move loses (checkmate or stalemate). A position that occurs 3 times is a draw,
   as are 120 plies without a capture or a soldier move, and 400 plies in all. Move = { f, t }.
   ===================================================================== */
var XQ = SK.def({ id: 'xiangqi', seats: [2, 2], perMove: 90000, CAP: 400, QUIET: 120 });
/* piece codes: 1 general, 2 advisor, 3 elephant, 4 horse, 5 chariot, 6 cannon, 7 soldier. Red = +code, Black = -code. */
XQ.init = function (n, first) {
  var b = [], i, back = [5, 4, 3, 2, 1, 2, 3, 4, 5];
  for (i = 0; i < 90; i++) b.push(0);
  for (i = 0; i < 9; i++) { b[i] = -back[i]; b[81 + i] = back[i]; }
  b[19] = -6; b[25] = -6; b[64] = 6; b[70] = 6;
  [0, 2, 4, 6, 8].forEach(function (c) { b[27 + c] = -7; b[54 + c] = 7; });
  var st = SK.base(2, first, { b: b, quiet: 0, keys: [] });
  st.keys.push(XQ.key(st));
  return st;
};
XQ.key = function (st) { return st.b.join(',') + '|' + st.turn; };
XQ.copy = function (st) { return { n: 2, turn: st.turn, over: st.over, draw: st.draw, winners: st.winners, plies: st.plies, last: st.last, b: st.b.slice(), quiet: st.quiet, keys: st.keys.slice() }; };
XQ.own = function (v, p) { return p === 0 ? v > 0 : v < 0; };
XQ.inPalace = function (r, c, p) { return c >= 3 && c <= 5 && (p === 0 ? r >= 7 && r <= 9 : r >= 0 && r <= 2); };
/* pseudo-legal moves of the piece on i (do not yet check the own General) pushing target squares to out */
XQ.gen = function (b, i, out) {
  var v = b[i], p = v > 0 ? 0 : 1, t = Math.abs(v), r = (i / 9) | 0, c = i % 9, k, rr, cc, j, d, n, dr, dc, screen;
  var orth = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  var free = function (x) { return b[x] === 0 || !XQ.own(b[x], p); };
  if (t === 1) {
    for (k = 0; k < 4; k++) { rr = r + orth[k][0]; cc = c + orth[k][1]; if (XQ.inPalace(rr, cc, p) && free(rr * 9 + cc)) out.push(rr * 9 + cc); }
  } else if (t === 2) {
    for (dr = -1; dr <= 1; dr += 2) for (dc = -1; dc <= 1; dc += 2) { rr = r + dr; cc = c + dc; if (XQ.inPalace(rr, cc, p) && free(rr * 9 + cc)) out.push(rr * 9 + cc); }
  } else if (t === 3) {
    for (dr = -1; dr <= 1; dr += 2) for (dc = -1; dc <= 1; dc += 2) {
      rr = r + 2 * dr; cc = c + 2 * dc;
      if (rr < 0 || rr > 9 || cc < 0 || cc > 8) continue;
      if (p === 0 ? rr < 5 : rr > 4) continue;                                  /* never crosses the river */
      if (b[(r + dr) * 9 + c + dc] !== 0) continue;                              /* the elephant's eye is blocked */
      if (free(rr * 9 + cc)) out.push(rr * 9 + cc);
    }
  } else if (t === 4) {
    var hm = [[-2, -1, -1, 0], [-2, 1, -1, 0], [2, -1, 1, 0], [2, 1, 1, 0], [-1, -2, 0, -1], [1, -2, 0, -1], [-1, 2, 0, 1], [1, 2, 0, 1]];
    for (k = 0; k < 8; k++) {
      rr = r + hm[k][0]; cc = c + hm[k][1];
      if (rr < 0 || rr > 9 || cc < 0 || cc > 8) continue;
      if (b[(r + hm[k][2]) * 9 + c + hm[k][3]] !== 0) continue;                  /* the horse's leg is blocked */
      if (free(rr * 9 + cc)) out.push(rr * 9 + cc);
    }
  } else if (t === 5 || t === 6) {
    for (k = 0; k < 4; k++) {
      rr = r + orth[k][0]; cc = c + orth[k][1]; screen = false;
      while (rr >= 0 && rr < 10 && cc >= 0 && cc < 9) {
        j = rr * 9 + cc;
        if (!screen) {
          if (b[j] === 0) out.push(j);
          else { if (t === 5) { if (!XQ.own(b[j], p)) out.push(j); break; } screen = true; }
        } else if (b[j] !== 0) { if (!XQ.own(b[j], p)) out.push(j); break; }
        rr += orth[k][0]; cc += orth[k][1];
      }
    }
  } else if (t === 7) {
    var fw = p === 0 ? -1 : 1, crossed = p === 0 ? r <= 4 : r >= 5;
    rr = r + fw; if (rr >= 0 && rr < 10 && free(rr * 9 + c)) out.push(rr * 9 + c);
    if (crossed) { if (c > 0 && free(r * 9 + c - 1)) out.push(r * 9 + c - 1); if (c < 8 && free(r * 9 + c + 1)) out.push(r * 9 + c + 1); }
  }
};
XQ.general = function (b, p) { var i; for (i = 0; i < 90; i++) if (b[i] === (p === 0 ? 1 : -1)) return i; return -1; };
/* is the General of player p attacked (including the flying-General rule)? */
XQ.attacked = function (b, p) {
  var g = XQ.general(b, p), r, c, k, rr, cc, j, orth = [[-1, 0], [1, 0], [0, -1], [0, 1]], screen, eg = p === 0 ? -1 : 1, v, e = (p === 0 ? -1 : 1);
  if (g < 0) return true;
  r = (g / 9) | 0; c = g % 9;
  for (k = 0; k < 4; k++) {
    rr = r + orth[k][0]; cc = c + orth[k][1]; screen = false;
    while (rr >= 0 && rr < 10 && cc >= 0 && cc < 9) {
      j = rr * 9 + cc; v = b[j];
      if (v !== 0) {
        if (!screen) {
          if (v === e * 5 || v === e * 1) return true;                         /* chariot, or the facing General */
          screen = true;
        } else { if (v === e * 6) return true; break; }
      }
      rr += orth[k][0]; cc += orth[k][1];
    }
  }
  /* horses: a horse at H attacks g if the leg square next to H towards g is empty */
  var hm = [[-2, -1], [-2, 1], [2, -1], [2, 1], [-1, -2], [1, -2], [-1, 2], [1, 2]];
  for (k = 0; k < 8; k++) {
    rr = r + hm[k][0]; cc = c + hm[k][1];
    if (rr < 0 || rr > 9 || cc < 0 || cc > 8 || b[rr * 9 + cc] !== e * 4) continue;
    var lr = Math.abs(hm[k][0]) === 2 ? rr - hm[k][0] / 2 : rr, lc = Math.abs(hm[k][0]) === 2 ? cc : cc - hm[k][1] / 2;
    if (b[lr * 9 + lc] === 0) return true;
  }
  /* soldiers: an enemy soldier directly "in front" of its own movement, or beside the General once it has crossed the river */
  if (p === 0) { if (r > 0 && b[(r - 1) * 9 + c] === e * 7) return true; } else { if (r < 9 && b[(r + 1) * 9 + c] === e * 7) return true; }
  if (c > 0 && b[r * 9 + c - 1] === e * 7 && (p === 0 ? r >= 5 : r <= 4)) return true;
  if (c < 8 && b[r * 9 + c + 1] === e * 7 && (p === 0 ? r >= 5 : r <= 4)) return true;
  return false;
};
XQ.legalList = function (st) {
  var p = st.turn, b = st.b, out = [], i, k, t, tmp, cap, v;
  for (i = 0; i < 90; i++) {
    v = b[i]; if (v === 0 || !XQ.own(v, p)) continue;
    tmp = []; XQ.gen(b, i, tmp);
    for (k = 0; k < tmp.length; k++) {
      t = tmp[k]; cap = b[t]; b[t] = v; b[i] = 0;
      if (!XQ.attacked(b, p)) out.push({ f: i, t: t });
      b[i] = v; b[t] = cap;
    }
  }
  return out;
};
XQ.moves = function (st) { return st.over ? [] : XQ.legalList(st); };
XQ.find = function (st, mv) {
  var list, i;
  if (!mv || st.over || typeof mv !== 'object' || Object.keys(mv).length !== 2 || typeof mv.f !== 'number' || typeof mv.t !== 'number' || mv.f !== (mv.f | 0) || mv.t !== (mv.t | 0) || mv.f < 0 || mv.f > 89 || mv.t < 0 || mv.t > 89) return null;
  if (st.b[mv.f] === 0 || !XQ.own(st.b[mv.f], st.turn)) return null;
  list = XQ.legalList(st);
  for (i = 0; i < list.length; i++) if (list[i].f === mv.f && list[i].t === mv.t) return { f: mv.f, t: mv.t };
  return null;
};
XQ.apply = function (st, mv) {
  var v = st.b[mv.f], cap = st.b[mv.t], k, same = 0, i;
  st.b[mv.t] = v; st.b[mv.f] = 0; st.plies++; st.last = { f: mv.f, t: mv.t, cap: cap };
  if (cap !== 0 || Math.abs(v) === 7) { st.quiet = 0; st.keys = []; } else st.quiet++;
  st.turn = 1 - st.turn;
  k = XQ.key(st); st.keys.push(k);
  for (i = 0; i < st.keys.length; i++) if (st.keys[i] === k) same++;
  if (!XQ.legalList(st).length) { SK.end(st, [1 - st.turn]); return st; }
  if (same >= 3 || st.quiet >= XQ.QUIET || st.plies >= XQ.CAP) SK.end(st, null);
  return st;
};
/* is the side to move in check? (for the screen) */
XQ.check = function (st) { return !st.over && XQ.attacked(st.b, st.turn); };
XQ.perft = function (st, depth) {
  var list, i, n = 0, s, v, cap;
  if (depth === 0) return 1;
  list = XQ.legalList(st);
  if (depth === 1) return list.length;
  for (i = 0; i < list.length; i++) {
    v = st.b[list[i].f]; cap = st.b[list[i].t]; st.b[list[i].t] = v; st.b[list[i].f] = 0; st.turn = 1 - st.turn;
    n += XQ.perft(st, depth - 1);
    st.turn = 1 - st.turn; st.b[list[i].f] = v; st.b[list[i].t] = cap;
  }
  return n;
};
XQ.VAL = [0, 10000, 20, 20, 45, 90, 48, 10];
XQ.eval = function (b, me) {
  var v = 0, i, x, t, r, side;
  for (i = 0; i < 90; i++) {
    x = b[i]; if (!x) continue;
    t = Math.abs(x); r = (i / 9) | 0; side = x > 0 ? 0 : 1;
    var s = XQ.VAL[t];
    if (t === 7) { var adv = side === 0 ? (6 - r) : (r - 3); if (adv > 0) s += 12 * adv; if (adv > 0 && (i % 9) >= 3 && (i % 9) <= 5) s += 6; }
    if (t === 4 || t === 5 || t === 6) { var cen = 4 - Math.abs((i % 9) - 4); s += cen * 1.2; }
    v += (side === me ? 1 : -1) * s;
  }
  return v;
};
XQ.search = function (st, depth, alpha, beta, me, budget) {
  var list, i, v, best = -1e9, cap, t, f, sgn = st.turn === me ? 1 : -1, b = st.b, pc;
  if (budget.n-- <= 0) return XQ.eval(b, st.turn);
  list = XQ.legalList(st);
  if (!list.length) return -50000 - depth;
  if (depth <= 0) { return XQ.eval(b, st.turn); }
  list.sort(function (x, y) { return (Math.abs(b[y.t]) * 10 - Math.abs(b[y.f])) - (Math.abs(b[x.t]) * 10 - Math.abs(b[x.f])); });
  for (i = 0; i < list.length; i++) {
    f = list[i].f; t = list[i].t; cap = b[t]; pc = b[f]; b[t] = pc; b[f] = 0; st.turn = 1 - st.turn;
    v = -XQ.search(st, depth - 1, -beta, -alpha, me, budget);
    st.turn = 1 - st.turn; b[f] = pc; b[t] = cap;
    if (v > best) best = v; if (best > alpha) alpha = best; if (alpha >= beta) break;
  }
  return best;
};
XQ.bot = function (st, level, rng) {
  var list = XQ.legalList(st), i, best = null, bv, v, b = st.b, depth, dmax, budget, me = st.turn, f, t, cap, pc, cur, bestList;
  if (!list.length) return null;
  if (level === 0) {                                           /* take the most valuable capture if any, else a random move */
    var caps = list.filter(function (m) { return b[m.t] !== 0; });
    if (caps.length && rng() < 0.8) { caps.sort(function (x, y) { return Math.abs(b[y.t]) - Math.abs(b[x.t]); }); return caps[0]; }
    return SK.pick(rng, list);
  }
  var work = XQ.copy(st); b = work.b;
  list.sort(function (x, y) { return (Math.abs(b[y.t]) * 10 - Math.abs(b[y.f])) - (Math.abs(b[x.t]) * 10 - Math.abs(b[x.f])); });
  dmax = level >= 2 ? 4 : 2;
  best = list[0];
  for (depth = 1; depth <= dmax; depth++) {
    budget = { n: level >= 2 ? 30000 : 2500 }; bv = -1e9; cur = null;
    for (i = 0; i < list.length; i++) {
      f = list[i].f; t = list[i].t; cap = b[t]; pc = b[f]; b[t] = pc; b[f] = 0; work.turn = 1 - work.turn;
      v = -XQ.search(work, depth - 1, -1e9, 1e9, me, budget) + rng() * 0.3;
      work.turn = 1 - work.turn; b[f] = pc; b[t] = cap;
      if (v > bv) { bv = v; cur = list[i]; }
    }
    if (budget.n <= 0 && depth > 1) break;
    best = cur || best;
    /* put the best move first for the next depth */
    list.sort(function (x, y) { return (y === best ? 1 : 0) - (x === best ? 1 : 0); });
  }
  return { f: best.f, t: best.t };
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
}(typeof window !== 'undefined' ? window : this));
