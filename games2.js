/* ===== Game engines, part 2: heads-up poker, penalties, memory, battleship ===== */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);

/* =====================================================================
   POKER: heads-up Texas hold'em, a fixed number of hands, blinds 10/20, 1000 chips each.
   Cards 0..51: rank = c % 13 (0 = deuce ... 12 = ace), suit = floor(c / 13).
   Side 0 = the player, side 1 = the bot. The deck order is fixed by the seed and its
   SHA-256 commitment is shown before the hand and the seed is revealed after it.
   ===================================================================== */
var PK = VG.poker = {};
PK.SB = 10; PK.BB = 20; PK.START = 1000;
var RK = '23456789TJQKA', SU = ['♠', '♥', '♦', '♣'];
PK.cardName = function (c) { return RK.charAt(c % 13) + SU[Math.floor(c / 13)]; };
PK.red = function (c) { var s = Math.floor(c / 13); return s === 1 || s === 2; };
function eval5(cs) {
  var r = cs.map(function (c) { return c % 13; }).sort(function (a, b) { return b - a; }), flush = true, i;
  for (i = 1; i < 5; i++) if (Math.floor(cs[i] / 13) !== Math.floor(cs[0] / 13)) flush = false;
  var cnt = {}; r.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
  var groups = Object.keys(cnt).map(function (k) { return { r: +k, n: cnt[k] }; }).sort(function (a, b) { return b.n - a.n || b.r - a.r; });
  var straight = false, high = r[0];
  if (groups.length === 5) { if (r[0] - r[4] === 4) straight = true; else if (r[0] === 12 && r[1] === 3 && r[4] === 0) { straight = true; high = 3; } }
  var cat;
  if (straight && flush) cat = 8; else if (groups[0].n === 4) cat = 7; else if (groups[0].n === 3 && groups[1].n === 2) cat = 6; else if (flush) cat = 5; else if (straight) cat = 4; else if (groups[0].n === 3) cat = 3; else if (groups[0].n === 2 && groups[1].n === 2) cat = 2; else if (groups[0].n === 2) cat = 1; else cat = 0;
  var tb = (straight ? [high] : groups.map(function (g) { return g.r; })), v = cat;
  for (i = 0; i < 5; i++) v = v * 13 + (tb[i] != null ? tb[i] : 0);
  return v;
}
PK.best = function (cards) {
  var best = -1, n = cards.length, a, b, c, d, e;
  if (n === 5) return eval5(cards);
  for (a = 0; a < n - 4; a++) for (b = a + 1; b < n - 3; b++) for (c = b + 1; c < n - 2; c++) for (d = c + 1; d < n - 1; d++) for (e = d + 1; e < n; e++) {
    var v = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]); if (v > best) best = v;
  }
  return best;
};
PK.handName = function (v) { var cat = Math.floor(v / Math.pow(13, 5)); return ['high', 'pair', 'twopair', 'trips', 'straight', 'flush', 'full', 'quads', 'sflush'][cat]; };
PK.equity = function (hole, board, samples, r) {
  var used = {}, i; hole.concat(board).forEach(function (c) { used[c] = 1; });
  var rest = []; for (i = 0; i < 52; i++) if (!used[i]) rest.push(i);
  var win = 0, tie = 0;
  for (i = 0; i < samples; i++) {
    var deck = VG.shuffle(r, rest), opp = [deck[0], deck[1]], bd = board.concat(deck.slice(2, 2 + 5 - board.length));
    var a = PK.best(hole.concat(bd)), b = PK.best(opp.concat(bd));
    if (a > b) win++; else if (a === b) tie++;
  }
  return (win + tie / 2) / samples;
};
PK.newMatch = function (seed, opts) {
  opts = opts || {};
  var r = VG.rng(seed);
  return { seed: seed, rnd: r, hands: opts.hands || 10, hand: 0, stacks: [PK.START, PK.START], dealer: r() < 0.5 ? 0 : 1, over: false, result: null, h: null, history: [] };
};
PK.startHand = function (m) {
  var seedStr = m.seed + ':' + m.hand, rr = VG.rng(parseInt(VG.sha256(seedStr).slice(0, 8), 16)), deck = VG.shuffle(rr, Array.apply(null, Array(52)).map(function (_, i) { return i; }));
  var h = m.h = {
    deck: deck, pos: 4, seedStr: seedStr, commit: VG.sha256(seedStr + '|' + deck.join(',')), revealed: false,
    hole: [[deck[0], deck[2]], [deck[1], deck[3]]], board: [], street: 0, bets: [0, 0], pot: 0, stk: m.stacks.slice(), allin: [false, false],
    acted: [false, false], turn: m.dealer, lastRaise: PK.BB, folded: -1, done: false, winner: null, showdown: false, log: [], won: [0, 0], names: null
  };
  var sb = m.dealer, bb = 1 - m.dealer;
  PK._post(h, sb, PK.SB); PK._post(h, bb, PK.BB);
  PK._settle(m);
  return h;
};
PK._post = function (h, i, amt) { var a = Math.min(amt, h.stk[i]); h.stk[i] -= a; h.bets[i] += a; if (h.stk[i] === 0) h.allin[i] = true; };
PK.toCall = function (h, i) { return Math.max(0, h.bets[1 - i] - h.bets[i]); };
PK.potNow = function (h) { return h.pot + h.bets[0] + h.bets[1]; };
/* legal raise range for side i: {min, max} as "raise to" totals for this street, or null */
PK.raiseRange = function (h, i) {
  var o = 1 - i;
  if (h.allin[o] || h.allin[i]) return null;
  var max = h.bets[i] + h.stk[i];
  if (max <= h.bets[o]) return null;
  var min = h.bets[o] + h.lastRaise;
  if (min > max) min = max;
  return { min: min, max: max };
};
PK.legal = function (h, i) {
  if (h.done || h.turn !== i) return [];
  var out = [], tc = PK.toCall(h, i);
  if (tc > 0) out.push('fold', 'call'); else out.push('check');
  if (PK.raiseRange(h, i)) out.push('raise');
  return out;
};
PK.act = function (m, i, a) {
  var h = m.h, lg = PK.legal(h, i);
  if (!h || lg.indexOf(a.t) < 0) return false;
  var tc = PK.toCall(h, i);
  if (a.t === 'fold') { h.folded = i; h.log.push([i, 'fold']); }
  else if (a.t === 'check') { h.acted[i] = true; h.log.push([i, 'check']); }
  else if (a.t === 'call') { PK._post(h, i, tc); h.acted[i] = true; h.log.push([i, 'call', Math.min(tc, tc)]); }
  else {
    var rg = PK.raiseRange(h, i), to = Math.max(rg.min, Math.min(rg.max, Math.round(a.to)));
    var raiseBy = to - h.bets[1 - i];
    if (raiseBy >= h.lastRaise) h.lastRaise = raiseBy;
    PK._post(h, i, to - h.bets[i]);
    h.acted = [false, false]; h.acted[i] = true; h.log.push([i, 'raise', to]);
  }
  h.turn = 1 - i;
  PK._settle(m);
  return true;
};
PK._streetClosed = function (h) {
  if (h.folded >= 0) return true;
  var eq = h.bets[0] === h.bets[1];
  if (h.allin[0] && h.allin[1]) return true;
  if (h.allin[0] || h.allin[1]) { var a = h.allin[0] ? 0 : 1; return h.bets[1 - a] >= h.bets[a]; }
  return eq && h.acted[0] && h.acted[1];
};
PK._settle = function (m) {
  var h = m.h, guard = 0;
  while (!h.done && PK._streetClosed(h) && guard++ < 10) {
    if (h.folded >= 0) { PK._collect(h); PK._award(m, 1 - h.folded, false); return; }
    PK._collect(h);
    var anyAll = h.allin[0] || h.allin[1];
    if (h.street === 3 || anyAll) {
      while (h.board.length < 5) h.board.push(h.deck[h.pos++]);
      h.street = 3; PK._award(m, null, true); return;
    }
    h.street++;
    var n = h.street === 1 ? 3 : 1, k; for (k = 0; k < n; k++) h.board.push(h.deck[h.pos++]);
    h.acted = [false, false]; h.lastRaise = PK.BB; h.turn = 1 - m.dealer;
  }
};
PK._collect = function (h) {
  var lo = Math.min(h.bets[0], h.bets[1]);
  if (h.bets[0] > lo) h.stk[0] += h.bets[0] - lo; if (h.bets[1] > lo) h.stk[1] += h.bets[1] - lo;
  h.pot += lo * 2; h.bets = [0, 0];
};
PK._award = function (m, winner, showdown) {
  var h = m.h; h.done = true; h.showdown = showdown; h.revealed = true;
  if (showdown) {
    var a = PK.best(h.hole[0].concat(h.board)), b = PK.best(h.hole[1].concat(h.board));
    h.score = [a, b];
    if (a > b) winner = 0; else if (b > a) winner = 1; else winner = 'split';
  }
  h.winner = winner;
  if (winner === 'split') { h.stk[0] += Math.floor(h.pot / 2); h.stk[1] += h.pot - Math.floor(h.pot / 2); }
  else h.stk[winner] += h.pot;
  h.won = [h.stk[0] - m.stacks[0], h.stk[1] - m.stacks[1]];
  m.stacks = h.stk.slice();
  m.history.push({ hand: m.hand, winner: winner, won: h.won.slice() });
  m.hand++;
  if (m.hand >= m.hands || m.stacks[0] <= 0 || m.stacks[1] <= 0) {
    m.over = true; m.result = m.stacks[0] > m.stacks[1] ? 0 : m.stacks[1] > m.stacks[0] ? 1 : 'draw';
  }
};
PK.nextHand = function (m) { if (m.over) return null; m.dealer = 1 - m.dealer; return PK.startHand(m); };
/* the bot: Monte-Carlo equity against a random hand, pot odds, a little randomness */
PK.bot = function (m, level) {
  var h = m.h, i = 1, r = m.rnd, tc = PK.toCall(h, i), pot = PK.potNow(h), lg = PK.legal(h, i);
  if (!lg.length) return null;
  var eq = PK.equity(h.hole[i], h.board, level >= 2 ? 160 : 70, r), rg = PK.raiseRange(h, i);
  function raiseTo(frac) { if (!rg) return { t: tc > 0 ? 'call' : 'check' }; var to = Math.round(h.bets[0] + Math.max(h.lastRaise, pot * frac) * 1); if (tc === 0) to = Math.round(h.bets[i] + pot * frac); return { t: 'raise', to: Math.max(rg.min, Math.min(rg.max, to)) }; }
  if (tc === 0) {
    if (eq > 0.72) return r() < 0.8 ? raiseTo(0.75) : { t: 'check' };
    if (eq > 0.56 && r() < 0.55) return raiseTo(0.5);
    if (r() < 0.07) return raiseTo(0.5);
    return { t: 'check' };
  }
  var odds = tc / (pot + tc);
  if (eq > 0.82) return r() < 0.7 ? raiseTo(1) : { t: 'call' };
  if (eq > 0.66 && r() < 0.35) return raiseTo(0.6);
  if (eq > odds + 0.04) return { t: 'call' };
  if (r() < 0.05 && tc <= pot * 0.35) return { t: 'call' };
  return { t: 'fold' };
};

/* =====================================================================
   PENALTIES. A kick is a shooter picking one of 6 zones (3 columns x high/low) and the keeper
   picking one too, both without seeing the other's choice. Same zone = saved.
   ===================================================================== */
var PN = VG.penalty = {};
PN.zones = 6;
PN.new = function (opts) { opts = opts || {}; return { kicks: opts.kicks || 5, round: 0, score: [0, 0], shot: [[], []], log: [], over: false, result: null, phase: 0 }; };
/* sides: 0 = the player, 1 = the bot. phase 0: the player shoots, phase 1: the bot shoots */
PN.shooter = function (st) { return st.phase; };
PN.kick = function (st, shotZone, keeperZone) {
  var s = st.phase, goal = shotZone !== keeperZone;
  if (goal) st.score[s]++;
  st.shot[s].push(goal);
  st.log.push({ s: s, shot: shotZone, keep: keeperZone, goal: goal, round: st.round });
  if (st.phase === 0) st.phase = 1;
  else { st.phase = 0; st.round++; }
  PN._check(st);
  return goal;
};
PN._check = function (st) {
  var a = st.score[0], b = st.score[1], k = st.kicks;
  var taken0 = st.shot[0].length, taken1 = st.shot[1].length;
  if (taken0 <= k && taken1 <= k) {
    var left0 = k - taken0, left1 = k - taken1;
    if (a > b + left1) { st.over = true; st.result = 0; return; }
    if (b > a + left0) { st.over = true; st.result = 1; return; }
  }
  if (taken0 === taken1 && taken0 >= k && a !== b) { st.over = true; st.result = a > b ? 0 : 1; }
};
/* the bot picks without seeing the player's current choice: it uses only the history of earlier kicks */
PN.botPick = function (st, role, r) {
  var hist = st.log.filter(function (x) { return role === 'keep' ? x.s === 0 : false; }), w = [1, 1, 1, 1, 1, 1], i;
  hist.forEach(function (x) { w[x.shot] += 1.2; });
  if (role === 'shoot') { w = [1, 1.3, 1, 1, 1.3, 1]; var last = st.log.filter(function (x) { return x.s === 1; }).slice(-1)[0]; if (last && !last.goal) w[last.shot] *= 0.4; }
  var tot = w.reduce(function (a, c) { return a + c; }, 0), x = r() * tot;
  for (i = 0; i < 6; i++) { x -= w[i]; if (x <= 0) return i; }
  return 5;
};

/* =====================================================================
   MEMORY: remember a row of digits, then type them back. Score = digits in the right place.
   ===================================================================== */
var MM = VG.memory = {};
MM.lengths = [5, 6, 7];
MM.seq = function (r, n) { var a = [], i, last = -1; for (i = 0; i < n; i++) { var d; do { d = Math.floor(r() * 10); } while (d === last); a.push(d); last = d; } return a; };
MM.showMs = function (n) { return 1800 + n * 450; };
MM.score = function (target, answer) { var s = 0, i; for (i = 0; i < target.length; i++) if (answer[i] != null && +answer[i] === target[i]) s++; return s; };
/* the bot's result: it recalls each digit with a chance that falls as the row gets longer */
MM.botScore = function (n, level, r) { var p = (level >= 2 ? 0.93 : level === 1 ? 0.88 : 0.8) - (n - 5) * 0.06, s = 0, i; for (i = 0; i < n; i++) if (r() < p) s++; return s; };

/* =====================================================================
   BATTLESHIP: 10x10, fleet 4x1, 3x2, 2x3, 1x4 cells, ships may not touch (also diagonally).
   A hit gives the shooter another turn. Cells: 0 water, 1 ship. Ship list holds the cells.
   ===================================================================== */
var BS = VG.battleship = {};
BS.FLEET = [4, 3, 3, 2, 2, 2, 1, 1, 1, 1];
BS.place = function (r) {
  for (var attempt = 0; attempt < 500; attempt++) {
    var occ = {}, ships = [], okAll = true;
    for (var si = 0; si < BS.FLEET.length && okAll; si++) {
      var len = BS.FLEET[si], placed = false;
      for (var tries = 0; tries < 200 && !placed; tries++) {
        var horiz = r() < 0.5, row = Math.floor(r() * 10), col = Math.floor(r() * 10), cells = [], k, fit = true;
        for (k = 0; k < len; k++) { var rr = row + (horiz ? 0 : k), cc = col + (horiz ? k : 0); if (rr > 9 || cc > 9) { fit = false; break; } cells.push(rr * 10 + cc); }
        if (!fit) continue;
        for (k = 0; k < len && fit; k++) { var cr = (cells[k] / 10) | 0, ccc = cells[k] % 10, dr, dc; for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) { var nr = cr + dr, nc = ccc + dc; if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && occ[nr * 10 + nc]) fit = false; } }
        if (!fit) continue;
        cells.forEach(function (c) { occ[c] = 1; });
        ships.push({ cells: cells, hits: 0 }); placed = true;
      }
      if (!placed) okAll = false;
    }
    if (okAll) return ships;
  }
  return null;
};
BS.newSide = function (r) { var ships = BS.place(r); return { ships: ships, shots: {}, sunkCells: {} }; };
/* a shot at the board `bd`: returns {hit, sunk, around} */
BS.shoot = function (bd, cell) {
  if (bd.shots[cell]) return null;
  var res = { hit: false, sunk: false, around: [] }, i;
  for (i = 0; i < bd.ships.length; i++) {
    var sh = bd.ships[i];
    if (sh.cells.indexOf(cell) > -1) {
      sh.hits++; res.hit = true; bd.shots[cell] = 'hit';
      if (sh.hits === sh.cells.length) {
        res.sunk = true;
        sh.cells.forEach(function (c) {
          var cr = (c / 10) | 0, cc = c % 10, dr, dc;
          for (dr = -1; dr <= 1; dr++) for (dc = -1; dc <= 1; dc++) { var nr = cr + dr, nc = cc + dc, n = nr * 10 + nc; if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && !bd.shots[n]) { bd.shots[n] = 'miss'; res.around.push(n); } }
        });
        res.ship = sh;
      }
      return res;
    }
  }
  bd.shots[cell] = 'miss';
  return res;
};
BS.allSunk = function (bd) { return bd.ships.every(function (s) { return s.hits === s.cells.length; }); };
BS.remaining = function (bd) { return bd.ships.filter(function (s) { return s.hits < s.cells.length; }).length; };
/* the bot: finish a wounded ship first, otherwise shoot at a checkerboard pattern */
BS.botPick = function (bd, level, r) {
  var hits = [], i;
  for (i = 0; i < 100; i++) if (bd.shots[i] === 'hit') { var inSunk = bd.ships.some(function (s) { return s.cells.indexOf(i) > -1 && s.hits === s.cells.length; }); if (!inSunk) hits.push(i); }
  var cand = [];
  if (hits.length) {
    hits.forEach(function (c) {
      [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(function (d) { var nr = ((c / 10) | 0) + d[0], nc = c % 10 + d[1]; if (nr >= 0 && nr < 10 && nc >= 0 && nc < 10 && !bd.shots[nr * 10 + nc]) cand.push({ c: nr * 10 + nc, line: hits.length > 1 && ((hits[0] / 10 | 0) === (c / 10 | 0) ? d[0] === 0 : hits[0] % 10 === c % 10 ? d[1] === 0 : false) }); });
    });
    var lined = cand.filter(function (x) { return x.line; });
    if (lined.length) cand = lined;
    if (cand.length) return cand[Math.floor(r() * cand.length)].c;
  }
  var free = [], par = [];
  for (i = 0; i < 100; i++) if (!bd.shots[i]) { free.push(i); if ((((i / 10) | 0) + i % 10) % 2 === 0) par.push(i); }
  var pool = level >= 1 && par.length ? par : free;
  return pool[Math.floor(r() * pool.length)];
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
