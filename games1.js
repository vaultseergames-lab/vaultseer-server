/* ===== Game engines, part 1: shared helpers, checkers, chess =====
   Pure logic, no DOM. Works in the browser (window.VG) and in node (module.exports) for tests. */
(function (root) {
'use strict';
var VG = {};

/* ---------- random (seedable) ---------- */
VG.rng = function (seed) {
  var a = (seed >>> 0) || 1;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
};
VG.pick = function (r, arr) { return arr[Math.floor(r() * arr.length)]; };
VG.shuffle = function (r, arr) { var a = arr.slice(), i, j, t; for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); t = a[i]; a[i] = a[j]; a[j] = t; } return a; };

/* ---------- SHA-256 (small, for the "deck commitment" shown to the player) ---------- */
VG.sha256 = function (msg) {
  var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  var bytes = [], i, j;
  for (i = 0; i < msg.length; i++) { var c = msg.charCodeAt(i); if (c < 128) bytes.push(c); else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63); else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63); }
  var bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (i = 7; i >= 0; i--) bytes.push(i > 3 ? 0 : (bitLen >>> (i * 8)) & 255);
  var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
  for (var off = 0; off < bytes.length; off += 64) {
    var w = [];
    for (i = 0; i < 16; i++) w[i] = (bytes[off + i * 4] << 24) | (bytes[off + i * 4 + 1] << 16) | (bytes[off + i * 4 + 2] << 8) | bytes[off + i * 4 + 3];
    for (i = 16; i < 64; i++) { var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10); w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0; }
    var a = H[0], b = H[1], c2 = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (i = 0; i < 64; i++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25), ch = (e & f) ^ (~e & g), t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22), mj = (a & b) ^ (a & c2) ^ (b & c2), t2 = (S0 + mj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c2; c2 = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c2) | 0; H[3] = (H[3] + d) | 0; H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var out = '';
  for (j = 0; j < 8; j++) out += ('00000000' + (H[j] >>> 0).toString(16)).slice(-8);
  return out;
};

/* =====================================================================
   CHECKERS (Russian draughts). Board: array of 64, index = row*8+col, row 0 is the top.
   Pieces: 'w' man, 'W' king (white, starts at the bottom, moves up), 'b','B' (black).
   Captures are compulsory, men capture backwards too, kings fly, a man that reaches
   the far row in the middle of a capture becomes a king and goes on capturing.
   ===================================================================== */
var CK = VG.checkers = {};
CK.init = function () {
  var b = [], r, c;
  for (r = 0; r < 8; r++) for (c = 0; c < 8; c++) b[r * 8 + c] = (r + c) % 2 === 1 ? (r < 3 ? 'b' : r > 4 ? 'w' : '') : '';
  return { b: b, turn: 'w', quiet: 0, n: 0 };
};
var DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
function ckSide(p) { return p === 'w' || p === 'W' ? 'w' : p === 'b' || p === 'B' ? 'b' : ''; }
function ckKing(p) { return p === 'W' || p === 'B'; }
function ckCaps(board, from, piece, taken, side, path, out) {
  var king = ckKing(piece), any = false, d, k, r0 = (from / 8) | 0, c0 = from % 8;
  for (d = 0; d < 4; d++) {
    var dr = DIRS[d][0], dc = DIRS[d][1], r = r0 + dr, c = c0 + dc;
    if (king) { while (r >= 0 && r < 8 && c >= 0 && c < 8 && board[r * 8 + c] === '') { r += dr; c += dc; } }
    if (r < 0 || r > 7 || c < 0 || c > 7) continue;
    var sq = r * 8 + c, p = board[sq];
    if (!p || ckSide(p) === side || taken.indexOf(sq) > -1) continue;
    var lands = [], lr = r + dr, lc = c + dc;
    while (lr >= 0 && lr < 8 && lc >= 0 && lc < 8 && board[lr * 8 + lc] === '') {
      lands.push(lr * 8 + lc);
      if (!king) break;
      lr += dr; lc += dc;
    }
    if (!lands.length) continue;
    any = true;
    var tk = taken.concat([sq]), cont = [], plain = [];
    for (k = 0; k < lands.length; k++) {
      var l = lands[k], lrow = (l / 8) | 0, np = piece;
      if (!king && ((side === 'w' && lrow === 0) || (side === 'b' && lrow === 7))) np = side === 'w' ? 'W' : 'B';
      // temporarily move the piece to look for a continuation
      var tmp = []; ckCaps(board, l, np, tk, side, path.concat([l]), tmp);
      // the starting square must count as empty while the piece is away
      if (tmp.length) cont.push(tmp); else plain.push({ path: path.concat([l]), caps: tk });
    }
    if (cont.length) { cont.forEach(function (arr) { arr.forEach(function (m) { out.push(m); }); }); }
    else plain.forEach(function (m) { out.push(m); });
  }
  return any;
}
CK.moves = function (st) {
  var side = st.turn, b = st.b, caps = [], quiet = [], i;
  for (i = 0; i < 64; i++) {
    var p = b[i];
    if (!p || ckSide(p) !== side) continue;
    // lift the piece off the board so it does not block its own capture path
    b[i] = '';
    var out = [];
    ckCaps(b, i, p, [], side, [i], out);
    b[i] = p;
    out.forEach(function (m) { caps.push(m); });
  }
  if (caps.length) return caps;
  for (i = 0; i < 64; i++) {
    var q = b[i];
    if (!q || ckSide(q) !== side) continue;
    var r0 = (i / 8) | 0, c0 = i % 8, king = ckKing(q), d;
    for (d = 0; d < 4; d++) {
      var dr = DIRS[d][0], dc = DIRS[d][1];
      if (!king && ((side === 'w' && dr > 0) || (side === 'b' && dr < 0))) continue;
      var r = r0 + dr, c = c0 + dc;
      while (r >= 0 && r < 8 && c >= 0 && c < 8 && b[r * 8 + c] === '') {
        quiet.push({ path: [i, r * 8 + c], caps: [] });
        if (!king) break;
        r += dr; c += dc;
      }
    }
  }
  return quiet;
};
CK.apply = function (st, m) {
  var b = st.b.slice(), from = m.path[0], to = m.path[m.path.length - 1], p = b[from], side = ckSide(p), i;
  b[from] = '';
  m.caps.forEach(function (s) { b[s] = ''; });
  // promotion: reached the far row at any point of the path
  var promoted = ckKing(p);
  m.path.forEach(function (s) { var row = (s / 8) | 0; if ((side === 'w' && row === 0) || (side === 'b' && row === 7)) promoted = true; });
  b[to] = promoted ? (side === 'w' ? 'W' : 'B') : p;
  var wasMan = !ckKing(p);
  return { b: b, turn: side === 'w' ? 'b' : 'w', quiet: (m.caps.length || wasMan) ? 0 : st.quiet + 1, n: st.n + 1 };
};
CK.material = function (b, side) {
  var s = 0, i; for (i = 0; i < 64; i++) { var p = b[i]; if (p && ckSide(p) === side) s += ckKing(p) ? 3 : 1; } return s;
};
/* result: null | 'w' | 'b' | 'draw'. opts.limit = adjudicate by material after that many half-moves (quick mode). */
CK.result = function (st, opts) {
  var mv = CK.moves(st);
  if (!mv.length) return st.turn === 'w' ? 'b' : 'w';
  if (st.quiet >= 30) return 'draw';
  if (opts && opts.limit && st.n >= opts.limit) {
    var a = CK.material(st.b, 'w'), c = CK.material(st.b, 'b');
    return a > c ? 'w' : c > a ? 'b' : 'draw';
  }
  return null;
};
function ckEval(st, side) {
  var b = st.b, s = 0, i;
  for (i = 0; i < 64; i++) {
    var p = b[i]; if (!p) continue;
    var own = ckSide(p), row = (i / 8) | 0, v = ckKing(p) ? 3.2 : 1 + (own === 'w' ? (7 - row) : row) * 0.04;
    if (!ckKing(p) && (i % 8 === 0 || i % 8 === 7)) v += 0.03;
    s += own === side ? v : -v;
  }
  return s;
}
function ckSearch(st, depth, alpha, beta, side) {
  var mv = CK.moves(st);
  if (!mv.length) return st.turn === side ? -100 - depth : 100 + depth;
  if (depth === 0) return ckEval(st, side);
  var i, best = st.turn === side ? -1e9 : 1e9;
  for (i = 0; i < mv.length; i++) {
    var v = ckSearch(CK.apply(st, mv[i]), depth - 1, alpha, beta, side);
    if (st.turn === side) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}
CK.bot = function (st, level, r) {
  var mv = CK.moves(st); if (!mv.length) return null;
  if (mv.length === 1) return mv[0];
  var depth = level >= 2 ? 5 : level === 1 ? 3 : 1, best = [], bv = -1e9, i;
  for (i = 0; i < mv.length; i++) {
    var v = ckSearch(CK.apply(st, mv[i]), depth - 1, -1e9, 1e9, st.turn) + (r ? r() * 0.02 : 0);
    if (v > bv + 1e-9) { bv = v; best = [mv[i]]; } else if (Math.abs(v - bv) <= 1e-9) best.push(mv[i]);
  }
  return best[Math.floor((r ? r() : Math.random()) * best.length)];
};
CK.sqName = function (i) { return 'abcdefgh'.charAt(i % 8) + (8 - ((i / 8) | 0)); };

/* =====================================================================
   CHESS. Board: array of 64, index = row*8+col, row 0 is rank 8.
   Upper case = white, lower case = black. Castling, en passant, promotion (queen by default,
   m.promo may hold one of 'q','r','b','n'), check, checkmate, stalemate, insufficient material,
   fifty moves, threefold repetition.
   ===================================================================== */
var CH = VG.chess = {};
CH.init = function () {
  var rows = ['rnbqkbnr', 'pppppppp', '', '', '', '', 'PPPPPPPP', 'RNBQKBNR'], b = [], r, c;
  for (r = 0; r < 8; r++) for (c = 0; c < 8; c++) b[r * 8 + c] = rows[r] ? rows[r].charAt(c) : '';
  var st = { b: b, turn: 'w', cast: { K: true, Q: true, k: true, q: true }, ep: -1, half: 0, n: 0, hist: [] };
  st.hist.push(CH.key(st));
  return st;
};
CH.key = function (st) { return st.b.join('|') + st.turn + (st.cast.K ? 'K' : '') + (st.cast.Q ? 'Q' : '') + (st.cast.k ? 'k' : '') + (st.cast.q ? 'q' : '') + st.ep; };
function chSide(p) { return !p ? '' : p === p.toUpperCase() ? 'w' : 'b'; }
var KN = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
var KG = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
var BI = [[-1, -1], [-1, 1], [1, -1], [1, 1]], RO = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function chAttacked(b, sq, by) {   // is square sq attacked by side `by`
  var r0 = (sq / 8) | 0, c0 = sq % 8, i, p;
  var pr = by === 'w' ? r0 + 1 : r0 - 1;
  if (pr >= 0 && pr < 8) { for (i = -1; i <= 1; i += 2) { var pc = c0 + i; if (pc >= 0 && pc < 8) { p = b[pr * 8 + pc]; if (p && p === (by === 'w' ? 'P' : 'p')) return true; } } }
  for (i = 0; i < 8; i++) { var nr = r0 + KN[i][0], nc = c0 + KN[i][1]; if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) { p = b[nr * 8 + nc]; if (p && p === (by === 'w' ? 'N' : 'n')) return true; } }
  for (i = 0; i < 8; i++) { var kr = r0 + KG[i][0], kc = c0 + KG[i][1]; if (kr >= 0 && kr < 8 && kc >= 0 && kc < 8) { p = b[kr * 8 + kc]; if (p && p === (by === 'w' ? 'K' : 'k')) return true; } }
  var d;
  for (d = 0; d < 4; d++) { var r = r0 + BI[d][0], c = c0 + BI[d][1]; while (r >= 0 && r < 8 && c >= 0 && c < 8) { p = b[r * 8 + c]; if (p) { if (chSide(p) === by && (p.toLowerCase() === 'b' || p.toLowerCase() === 'q')) return true; break; } r += BI[d][0]; c += BI[d][1]; } }
  for (d = 0; d < 4; d++) { var r2 = r0 + RO[d][0], c2 = c0 + RO[d][1]; while (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) { p = b[r2 * 8 + c2]; if (p) { if (chSide(p) === by && (p.toLowerCase() === 'r' || p.toLowerCase() === 'q')) return true; break; } r2 += RO[d][0]; c2 += RO[d][1]; } }
  return false;
}
CH.kingSq = function (b, side) { var k = side === 'w' ? 'K' : 'k', i; for (i = 0; i < 64; i++) if (b[i] === k) return i; return -1; };
CH.inCheck = function (st, side) { var s = CH.kingSq(st.b, side); return s >= 0 && chAttacked(st.b, s, side === 'w' ? 'b' : 'w'); };
function chPseudo(st, side) {
  var b = st.b, out = [], i, d, enemy = side === 'w' ? 'b' : 'w';
  function add(from, to, extra) { var m = { from: from, to: to }; if (extra) for (var k in extra) m[k] = extra[k]; out.push(m); }
  for (i = 0; i < 64; i++) {
    var p = b[i]; if (!p || chSide(p) !== side) continue;
    var r0 = (i / 8) | 0, c0 = i % 8, t = p.toLowerCase();
    if (t === 'p') {
      var dir = side === 'w' ? -1 : 1, start = side === 'w' ? 6 : 1, last = side === 'w' ? 0 : 7, r1 = r0 + dir;
      if (r1 >= 0 && r1 < 8 && !b[r1 * 8 + c0]) {
        add(i, r1 * 8 + c0, r1 === last ? { promo: 'q' } : null);
        if (r0 === start && !b[(r0 + 2 * dir) * 8 + c0]) add(i, (r0 + 2 * dir) * 8 + c0, { dbl: true });
      }
      for (d = -1; d <= 1; d += 2) {
        var cc = c0 + d; if (cc < 0 || cc > 7 || r1 < 0 || r1 > 7) continue;
        var tsq = r1 * 8 + cc, tp = b[tsq];
        if (tp && chSide(tp) === enemy) add(i, tsq, r1 === last ? { promo: 'q', cap: true } : { cap: true });
        else if (!tp && tsq === st.ep) add(i, tsq, { ep: true, cap: true });
      }
    } else if (t === 'n' || t === 'k') {
      var set = t === 'n' ? KN : KG;
      for (d = 0; d < 8; d++) {
        var nr = r0 + set[d][0], nc = c0 + set[d][1]; if (nr < 0 || nr > 7 || nc < 0 || nc > 7) continue;
        var q = b[nr * 8 + nc]; if (!q) add(i, nr * 8 + nc); else if (chSide(q) === enemy) add(i, nr * 8 + nc, { cap: true });
      }
      if (t === 'k') {
        var home = side === 'w' ? 60 : 4, kk = side === 'w' ? 'K' : 'k', qq = side === 'w' ? 'Q' : 'q', rk = side === 'w' ? 'R' : 'r';
        if (i === home && !chAttacked(b, home, enemy)) {
          if (st.cast[kk] && b[home + 3] === rk && !b[home + 1] && !b[home + 2] && !chAttacked(b, home + 1, enemy) && !chAttacked(b, home + 2, enemy)) add(i, home + 2, { castle: 'k' });
          if (st.cast[qq] && b[home - 4] === rk && !b[home - 1] && !b[home - 2] && !b[home - 3] && !chAttacked(b, home - 1, enemy) && !chAttacked(b, home - 2, enemy)) add(i, home - 2, { castle: 'q' });
        }
      }
    } else {
      var dirs = t === 'b' ? BI : t === 'r' ? RO : BI.concat(RO);
      for (d = 0; d < dirs.length; d++) {
        var r = r0 + dirs[d][0], c = c0 + dirs[d][1];
        while (r >= 0 && r < 8 && c >= 0 && c < 8) {
          var q2 = b[r * 8 + c];
          if (!q2) add(i, r * 8 + c); else { if (chSide(q2) === enemy) add(i, r * 8 + c, { cap: true }); break; }
          r += dirs[d][0]; c += dirs[d][1];
        }
      }
    }
  }
  return out;
}
CH.make = function (st, m) {
  var b = st.b.slice(), p = b[m.from], side = chSide(p), cast = { K: st.cast.K, Q: st.cast.Q, k: st.cast.k, q: st.cast.q }, ep = -1, captured = b[m.to];
  b[m.from] = ''; b[m.to] = p;
  if (m.ep) { var cs = m.to + (side === 'w' ? 8 : -8); captured = b[cs]; b[cs] = ''; }
  if (m.castle === 'k') { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = ''; }
  if (m.castle === 'q') { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = ''; }
  if (m.promo) { var pp = m.promo; b[m.to] = side === 'w' ? pp.toUpperCase() : pp.toLowerCase(); }
  if (m.dbl) ep = (m.from + m.to) / 2;
  if (p === 'K') { cast.K = false; cast.Q = false; } if (p === 'k') { cast.k = false; cast.q = false; }
  if (m.from === 63 || m.to === 63) cast.K = false; if (m.from === 56 || m.to === 56) cast.Q = false;
  if (m.from === 7 || m.to === 7) cast.k = false; if (m.from === 0 || m.to === 0) cast.q = false;
  var ns = { b: b, turn: side === 'w' ? 'b' : 'w', cast: cast, ep: ep, half: (p.toLowerCase() === 'p' || captured) ? 0 : st.half + 1, n: st.n + 1, hist: st.hist };
  ns.hist = st.hist.concat([CH.key(ns)]);
  return ns;
};
CH.moves = function (st) {
  var side = st.turn, ps = chPseudo(st, side), out = [], i;
  for (i = 0; i < ps.length; i++) { var ns = CH.make(st, ps[i]); if (!CH.inCheck(ns, side)) out.push(ps[i]); }
  return out;
};
CH.insufficient = function (b) {
  var minors = [], i;
  for (i = 0; i < 64; i++) { var p = b[i]; if (!p) continue; var t = p.toLowerCase(); if (t === 'k') continue; if (t === 'p' || t === 'r' || t === 'q') return false; minors.push({ t: t, sq: i }); }
  if (minors.length <= 1) return true;
  if (minors.length === 2 && minors[0].t === 'b' && minors[1].t === 'b') { var c1 = ((minors[0].sq / 8 | 0) + minors[0].sq % 8) % 2, c2 = ((minors[1].sq / 8 | 0) + minors[1].sq % 8) % 2; return c1 === c2; }
  return false;
};
CH.PV = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
CH.material = function (b, side) { var s = 0, i; for (i = 0; i < 64; i++) { var p = b[i]; if (p && chSide(p) === side) s += CH.PV[p.toLowerCase()]; } return s; };
/* result: null | 'w' | 'b' | 'draw'; also sets why */
CH.result = function (st, opts) {
  var mv = CH.moves(st);
  if (!mv.length) { if (CH.inCheck(st, st.turn)) return { r: st.turn === 'w' ? 'b' : 'w', why: 'mate' }; return { r: 'draw', why: 'stalemate' }; }
  if (CH.insufficient(st.b)) return { r: 'draw', why: 'material' };
  if (st.half >= 100) return { r: 'draw', why: 'fifty' };
  var k = st.hist[st.hist.length - 1], cnt = 0, i; for (i = 0; i < st.hist.length; i++) if (st.hist[i] === k) cnt++;
  if (cnt >= 3) return { r: 'draw', why: 'repeat' };
  if (opts && opts.limit && st.n >= opts.limit) {
    var a = CH.material(st.b, 'w'), c = CH.material(st.b, 'b');
    return { r: a > c + 50 ? 'w' : c > a + 50 ? 'b' : 'draw', why: 'limit' };
  }
  return null;
};
/* piece-square bonus: centre and development, kept small */
function chPst(p, i) {
  var t = p.toLowerCase(), r = (i / 8) | 0, c = i % 8, side = chSide(p), rr = side === 'w' ? 7 - r : r, cen = 3.5 - Math.abs(c - 3.5), cr = 3.5 - Math.abs(rr - 3.5);
  if (t === 'p') return rr * 6 + (c >= 2 && c <= 5 ? rr * 2 : 0);
  if (t === 'n') return (cen + cr) * 7 - (rr === 0 ? 10 : 0);
  if (t === 'b') return (cen + cr) * 4;
  if (t === 'r') return rr === 6 ? 15 : 0;
  if (t === 'q') return (cen + cr) * 2;
  return rr === 0 ? 10 : -rr * 4;
}
function chEval(st, side) {
  var s = 0, i, b = st.b;
  for (i = 0; i < 64; i++) { var p = b[i]; if (!p) continue; var v = CH.PV[p.toLowerCase()] + chPst(p, i); s += chSide(p) === side ? v : -v; }
  return s;
}
var CH_ORDER = function (st, m) { var v = 0, t = st.b[m.to]; if (t) v += 10 * CH.PV[t.toLowerCase()] - CH.PV[st.b[m.from].toLowerCase()] / 10; if (m.promo) v += 800; return v; };
function chSearch(st, depth, alpha, beta, side, deadline) {
  var mv = CH.moves(st);
  if (!mv.length) { if (CH.inCheck(st, st.turn)) return st.turn === side ? -50000 - depth : 50000 + depth; return 0; }
  if (depth === 0) return chEval(st, side);
  if (CH.insufficient(st.b)) return 0;
  mv.sort(function (x, y) { return CH_ORDER(st, y) - CH_ORDER(st, x); });
  var i, best = st.turn === side ? -1e9 : 1e9;
  for (i = 0; i < mv.length; i++) {
    var v = chSearch(CH.make(st, mv[i]), depth - 1, alpha, beta, side, deadline);
    if (st.turn === side) { if (v > best) best = v; if (best > alpha) alpha = best; } else { if (v < best) best = v; if (best < beta) beta = best; }
    if (alpha >= beta) break;
  }
  return best;
}
CH.bot = function (st, level, r) {
  var mv = CH.moves(st); if (!mv.length) return null;
  var depth = level >= 2 ? 3 : level === 1 ? 2 : 1, best = [], bv = -1e9, i;
  mv.sort(function (x, y) { return CH_ORDER(st, y) - CH_ORDER(st, x); });
  for (i = 0; i < mv.length; i++) {
    var v = chSearch(CH.make(st, mv[i]), depth - 1, -1e9, 1e9, st.turn) + (r ? r() * 6 : 0);
    if (v > bv + 1e-9) { bv = v; best = [mv[i]]; } else if (Math.abs(v - bv) <= 1e-9) best.push(mv[i]);
  }
  return best[Math.floor((r ? r() : Math.random()) * best.length)];
};
CH.name = function (i) { return 'abcdefgh'.charAt(i % 8) + (8 - ((i / 8) | 0)); };
CH.GLYPH = { K: '♔', Q: '♕', R: '♖', B: '♗', N: '♘', P: '♙', k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };

root.VG = VG;
if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
