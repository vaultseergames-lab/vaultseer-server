/* ===== Game engines, part 4: gin rummy, sixty-six, scopa (card games between two people) ===== */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);
var SUITS = ['♠', '♥', '♦', '♣'];

/* =====================================================================
   GIN RUMMY. 52 cards, 10 each. Side 0 = the player, side 1 = the bot.
   Card c: rank = c % 13 (0 = ace .. 12 = king), suit = floor(c / 13). The ace is low only.
   A turn: take the top card of the stock or of the discard pile, then discard one card (or knock).
   Knock when the cards outside combinations ("deadwood") are worth 10 or less. Gin = no deadwood (+20).
   The other player lays off cards on the knocker's combinations (not after gin). If the knocker does
   not have strictly less deadwood, it is an undercut: the other player scores the difference + 25.
   The match goes to 50 points. A deal with only 2 cards left in the stock is void and is dealt again.
   ===================================================================== */
var GR = VG.ginrummy = {};
GR.TARGET = 50; GR.MAXDEALS = 30;
GR.rank = function (c) { return c % 13; };
GR.suit = function (c) { return Math.floor(c / 13); };
GR.red = function (c) { var s = GR.suit(c); return s === 1 || s === 2; };
GR.name = function (c) { return 'A23456789TJQK'.charAt(c % 13).replace('T', '10') + SUITS[Math.floor(c / 13)]; };
GR.val = function (c) { return Math.min(GR.rank(c) + 1, 10); };
GR.sum = function (cards) { var s = 0; cards.forEach(function (c) { s += GR.val(c); }); return s; };

/* every possible combination (set of 3-4 of one rank, run of 3+ in one suit) inside a hand */
GR.melds = function (hand) {
  var out = [], byRank = {}, bySuit = {}, i;
  hand.forEach(function (c) { (byRank[GR.rank(c)] = byRank[GR.rank(c)] || []).push(c); (bySuit[GR.suit(c)] = bySuit[GR.suit(c)] || []).push(c); });
  Object.keys(byRank).forEach(function (r) {
    var g = byRank[r]; if (g.length < 3) return;
    out.push(g.slice());
    if (g.length === 4) for (i = 0; i < 4; i++) out.push(g.filter(function (_, k) { return k !== i; }));
  });
  Object.keys(bySuit).forEach(function (s) {
    var g = bySuit[s].slice().sort(function (a, b) { return a - b; }), a, b;
    for (a = 0; a < g.length; a++) for (b = a + 2; b < g.length; b++) {
      if (g[b] - g[a] !== b - a) break;   // consecutive ranks inside one suit are consecutive numbers
      out.push(g.slice(a, b + 1));
    }
  });
  var seen = {}, res = [];
  out.forEach(function (m) { var k = m.slice().sort(function (x, y) { return x - y; }).join(','); if (!seen[k]) { seen[k] = 1; res.push(m); } });
  return res;
};
/* the split of a hand with the smallest deadwood: { dw, melds, rest } */
GR.best = function (hand) {
  var ms = GR.melds(hand), n = hand.length, idx = {}, best = null;
  hand.forEach(function (c, i) { idx[c] = i; });
  var masks = ms.map(function (m) { var k = 0; m.forEach(function (c) { k |= 1 << idx[c]; }); return k; });
  var vals = hand.map(GR.val);
  function rec(from, used, chosen) {
    var i, dw = 0;
    for (i = 0; i < n; i++) if (!(used & (1 << i))) dw += vals[i];
    if (!best || dw < best.dw) best = { dw: dw, chosen: chosen.slice(), used: used };
    if (dw === 0) return;
    for (i = from; i < ms.length; i++) if (!(masks[i] & used)) { chosen.push(i); rec(i + 1, used | masks[i], chosen); chosen.pop(); if (best.dw === 0) return; }
  }
  rec(0, 0, []);
  return { dw: best.dw, melds: best.chosen.map(function (i) { return ms[i]; }), rest: hand.filter(function (_, i) { return !(best.used & (1 << i)); }) };
};
GR.deadwood = function (hand) { return GR.best(hand).dw; };
/* can card c be added to a combination? returns the new combination or null */
GR.extend = function (meld, c) {
  var r = GR.rank(meld[0]);
  var isSet = meld.every(function (x) { return GR.rank(x) === r; });
  if (isSet) {
    if (GR.rank(c) !== r || meld.length >= 4 || meld.some(function (x) { return GR.suit(x) === GR.suit(c); })) return null;
    return meld.concat([c]);
  }
  var s = GR.suit(meld[0]); if (GR.suit(c) !== s) return null;
  var lo = Math.min.apply(null, meld), hi = Math.max.apply(null, meld);
  if (c === hi + 1 && GR.rank(c) <= 12 && GR.suit(c) === s && hi % 13 !== 12) return meld.concat([c]);
  if (c === lo - 1 && lo % 13 !== 0) return [c].concat(meld);
  return null;
};
/* the defender's best result after laying off on the knocker's combinations: { dw, laid } */
GR.defend = function (hand, melds) {
  // which cards can ever be laid off (chains allowed)? try every subset of the hand that can be placed in some order
  var n = hand.length, best = null, mask, i;
  function placeable(sub) {
    var ms = melds.map(function (m) { return m.slice(); }), left = sub.slice(), prog = true;
    while (left.length && prog) {
      prog = false;
      for (var k = 0; k < left.length && !prog; k++) for (var j = 0; j < ms.length; j++) {
        var e = GR.extend(ms[j], left[k]);
        if (e) { ms[j] = e; left.splice(k, 1); prog = true; break; }
      }
    }
    return left.length === 0;
  }
  // cards that can be laid off, counting chains (a 6 can follow a 5 that is laid off first)
  var cand = [], cm = melds.map(function (m) { return m.slice(); }), grew = true;
  while (grew) {
    grew = false;
    hand.forEach(function (c) {
      if (cand.indexOf(c) >= 0) return;
      for (var j = 0; j < cm.length; j++) { var e = GR.extend(cm[j], c); if (e) { cm[j] = e; cand.push(c); grew = true; return; } }
    });
  }
  var cn = cand.length;
  for (mask = 0; mask < (1 << cn); mask++) {
    var sub = [], k;
    for (k = 0; k < cn; k++) if (mask & (1 << k)) sub.push(cand[k]);
    if (!placeable(sub)) continue;
    var rest = hand.filter(function (c) { return sub.indexOf(c) < 0; });
    var dw = GR.deadwood(rest);
    if (!best || dw < best.dw) best = { dw: dw, laid: sub };
  }
  return best || { dw: GR.deadwood(hand), laid: [] };
};
GR.new = function (r) {
  var st = { r: r, scores: [0, 0], deal: 0, dealer: 0, over: false, result: null, phase: 'draw', turn: 0, hands: [[], []], stock: [], disc: [], took: -1, last: null, log: [] };
  GR._deal(st);
  return st;
};
GR._deal = function (st) {
  var deck = VG.shuffle(st.r, Array.apply(null, { length: 52 }).map(function (_, i) { return i; }));
  st.hands = [deck.slice(0, 10), deck.slice(10, 20)];
  st.disc = [deck[20]]; st.stock = deck.slice(21);
  st.deal++; st.dealer = 1 - st.dealer; st.turn = 1 - st.dealer; st.phase = 'draw'; st.took = -1; st.last = null;
};
GR.draw = function (st, side, from) {
  if (st.over || st.phase !== 'draw' || st.turn !== side) return false;
  var c;
  if (from === 'disc') { if (!st.disc.length) return false; c = st.disc.pop(); st.took = c; }
  else { if (!st.stock.length) return false; c = st.stock.pop(); st.took = -1; }
  st.hands[side].push(c); st.phase = 'discard';
  return true;
};
/* cards that may be discarded: not the card just taken from the discard pile */
GR.discardable = function (st, side) { return st.hands[side].filter(function (c) { return c !== st.took; }); };
/* which discards allow a knock (deadwood of the remaining 10 cards <= 10) */
GR.knockable = function (st, side) {
  if (st.phase !== 'discard' || st.turn !== side) return [];
  return GR.discardable(st, side).filter(function (c) { return GR.deadwood(st.hands[side].filter(function (x) { return x !== c; })) <= 10; });
};
GR.discard = function (st, side, c) {
  if (st.over || st.phase !== 'discard' || st.turn !== side) return false;
  if (GR.discardable(st, side).indexOf(c) < 0) return false;
  st.hands[side] = st.hands[side].filter(function (x) { return x !== c; }); st.disc.push(c); st.took = -1;
  if (st.stock.length <= 2) { st.last = { type: 'void' }; st.phase = 'show'; GR._check(st); return true; }
  st.turn = 1 - side; st.phase = 'draw';
  return true;
};
GR.knock = function (st, side, c) {
  if (GR.knockable(st, side).indexOf(c) < 0) return false;
  st.hands[side] = st.hands[side].filter(function (x) { return x !== c; }); st.disc.push(c); st.took = -1;
  var k = GR.best(st.hands[side]), o = 1 - side, info = { type: 'knock', by: side, kn: k, pts: 0, winner: side, laid: [], oppRest: [], oppDw: 0 };
  if (k.dw === 0) {
    info.type = 'gin'; info.oppDw = GR.deadwood(st.hands[o]); info.oppRest = GR.best(st.hands[o]).rest;
    info.pts = info.oppDw + 20;
  } else {
    var d = GR.defend(st.hands[o], k.melds); info.laid = d.laid; info.oppDw = d.dw;
    var rest = st.hands[o].filter(function (x) { return d.laid.indexOf(x) < 0; });
    info.oppRest = GR.best(rest).rest;
    if (d.dw > k.dw) info.pts = d.dw - k.dw;
    else { info.type = 'undercut'; info.winner = o; info.pts = k.dw - d.dw + 25; }
  }
  st.scores[info.winner] += info.pts; st.last = info; st.phase = 'show';
  GR._check(st);
  return true;
};
GR._check = function (st) {
  if (st.scores[0] >= GR.TARGET || st.scores[1] >= GR.TARGET || st.deal >= GR.MAXDEALS) {
    st.over = true; st.result = st.scores[0] === st.scores[1] ? 'draw' : st.scores[0] > st.scores[1] ? 0 : 1;
  }
};
GR.next = function (st) { if (st.phase !== 'show' || st.over) return false; GR._deal(st); return true; };
/* the bot */
GR.bot = function (st, level, r) {
  var side = 1, h = st.hands[side], i, c;
  if (st.phase === 'draw') {
    var top = st.disc[st.disc.length - 1];
    if (top == null) return { t: 'stock' };
    var now = GR.deadwood(h), best = 999;
    var withTop = h.concat([top]);
    withTop.forEach(function (x) { if (x === top) return; var d = GR.deadwood(withTop.filter(function (y) { return y !== x; })); if (d < best) best = d; });
    // the discard is wanted when it makes a combination or lowers the deadwood clearly
    if (best < now - (level ? 2 : 1) || (best === 0)) return { t: 'disc' };
    // a card that joins a pair or sequence neighbour is worth taking
    var join = h.some(function (x) { return GR.rank(x) === GR.rank(top) || (GR.suit(x) === GR.suit(top) && Math.abs(x - top) === 1); });
    if (join && level >= 1 && best <= now) return { t: 'disc' };
    return { t: 'stock' };
  }
  // discard phase
  var opts = GR.discardable(st, side), pick = null, pv = 1e9;
  opts.forEach(function (x) {
    var rest = h.filter(function (y) { return y !== x; }), b = GR.best(rest);
    var v = b.dw * 10 - GR.val(x) * (b.rest.indexOf(x) >= 0 ? 0 : 0) + (r ? r() * 0.5 : 0);
    // prefer to throw a high deadwood card that is not near its neighbours
    var near = rest.some(function (y) { return GR.rank(y) === GR.rank(x) || (GR.suit(y) === GR.suit(x) && Math.abs(y - x) <= 2); });
    v += near ? 6 : 0; v -= GR.val(x) * 0.8;
    if (v < pv) { pv = v; pick = x; }
  });
  var kn = GR.knockable(st, side);
  if (kn.length) {
    var kbest = null, kd = 99;
    kn.forEach(function (x) { var d = GR.deadwood(h.filter(function (y) { return y !== x; })); if (d < kd) { kd = d; kbest = x; } });
    if (kd === 0 || level === 0 ? true : (kd <= 4 || st.stock.length <= 8)) return { t: 'knock', c: kbest };
  }
  return { t: 'discard', c: pick };
};

/* =====================================================================
   SIXTY-SIX. 24 cards (9 J Q K 10 A of four suits). Side 0 = the player, side 1 = the bot.
   Card c: suit = floor(c / 6), r = c % 6 (0 = 9, 1 = J, 2 = Q, 3 = K, 4 = 10, 5 = A); points 0 2 3 4 10 11.
   6 cards each, one trump card turned face up under the stock. Win tricks, collect points: 66 wins the deal.
   Marriage (K+Q of a suit, announced when leading one of them, needs one won trick) = 20, in trumps 40.
   The trump 9 may be swapped for the turned trump card (leader, stock of 3+ cards).
   The leader may close the stock. After that (and when the stock is empty) you must follow suit and beat the card if you can.
   Deal winner scores 1 game point (2 if the other has under 33, 3 if the other has nothing). Closing and failing gives the other 2.
   The match goes to 7 game points.
   ===================================================================== */
var SS = VG.sixtysix = {};
SS.TARGET = 7;
var SSR = '9JQKTA', SSP = [0, 2, 3, 4, 10, 11];
SS.suit = function (c) { return Math.floor(c / 6); };
SS.rank = function (c) { return c % 6; };
SS.pts = function (c) { return SSP[c % 6]; };
SS.red = function (c) { var s = SS.suit(c); return s === 1 || s === 2; };
SS.name = function (c) { return SSR.charAt(c % 6).replace('T', '10') + SUITS[Math.floor(c / 6)]; };
SS.new = function (r) {
  var st = { r: r, games: [0, 0], deal: 0, dealer: 0, over: false, result: null };
  SS._deal(st);
  return st;
};
SS._deal = function (st) {
  var deck = VG.shuffle(st.r, Array.apply(null, { length: 24 }).map(function (_, i) { return i; }));
  st.hands = [deck.slice(0, 6), deck.slice(6, 12)]; st.stock = deck.slice(12);   // the last element drawn is stock[0] = the turned trump card
  st.trumpCard = st.stock[0]; st.trump = SS.suit(st.trumpCard);
  st.pts = [0, 0]; st.tricks = [0, 0]; st.closed = -1; st.led = -1; st.deal++; st.dealer = 1 - st.dealer; st.lead = 1 - st.dealer; st.turn = st.lead;
  st.phase = 'play'; st.last = null; st.trick = null; st.said = [];
};
SS.beats = function (st, a, b) {   // does the follower's card b take the trick led with a ?
  if (SS.suit(a) === SS.suit(b)) return SS.rank(b) > SS.rank(a);
  return SS.suit(b) === st.trump;
};
SS.strict = function (st) { return st.closed >= 0 || st.stock.length === 0; };
SS.legal = function (st, side) {
  if (st.phase !== 'play' || st.turn !== side) return [];
  var h = st.hands[side];
  if (st.led < 0 || !SS.strict(st)) return h.slice();
  var led = st.led, same = h.filter(function (c) { return SS.suit(c) === SS.suit(led); });
  if (same.length) { var hi = same.filter(function (c) { return SS.rank(c) > SS.rank(led); }); return hi.length ? hi : same; }
  var tr = h.filter(function (c) { return SS.suit(c) === st.trump; });
  return tr.length ? tr : h.slice();
};
/* marriages the leader may announce with card c (c is the king or queen being led) */
SS.canMarry = function (st, side, c) {
  if (st.phase !== 'play' || st.turn !== side || st.led >= 0 || st.tricks[side] < 1) return false;
  var r = SS.rank(c); if (r !== 2 && r !== 3) return false;
  var mate = SS.suit(c) * 6 + (r === 2 ? 3 : 2);
  return st.hands[side].indexOf(mate) >= 0;
};
SS.canExchange = function (st, side) {
  return st.phase === 'play' && st.turn === side && st.led < 0 && st.closed < 0 && st.stock.length > 2 && st.hands[side].indexOf(st.trump * 6) >= 0;
};
SS.exchange = function (st, side) {
  if (!SS.canExchange(st, side)) return false;
  var nine = st.trump * 6, h = st.hands[side];
  h[h.indexOf(nine)] = st.trumpCard; st.stock[0] = nine; st.trumpCard = nine; st.said.push({ side: side, t: 'swap' });
  return true;
};
SS.canClose = function (st, side) { return st.phase === 'play' && st.turn === side && st.led < 0 && st.closed < 0 && st.stock.length > 2; };
SS.close = function (st, side) { if (!SS.canClose(st, side)) return false; st.closed = side; st.said.push({ side: side, t: 'close' }); return true; };
SS.play = function (st, side, c, marry) {
  if (SS.legal(st, side).indexOf(c) < 0) return false;
  var leading = st.led < 0;
  if (marry) { if (!leading || !SS.canMarry(st, side, c)) return false; }
  st.hands[side] = st.hands[side].filter(function (x) { return x !== c; });
  if (leading) {
    st.led = c; st.turn = 1 - side;
    if (marry) { var add = SS.suit(c) === st.trump ? 40 : 20; st.pts[side] += add; st.said.push({ side: side, t: 'marry', n: add, s: SS.suit(c) }); if (st.pts[side] >= 66) { SS._win(st, side, 'points'); } }
    st.trick = { lead: side, a: c, b: null };
    return true;
  }
  st.trick.b = c;
  var lead = st.lead, a = st.led, win = SS.beats(st, a, c) ? side : lead;
  st.pts[win] += SS.pts(a) + SS.pts(c); st.tricks[win]++;
  st.led = -1; st.lead = win; st.turn = win;
  if (st.pts[win] >= 66) { SS._win(st, win, 'points'); return true; }
  // draw, winner first
  if (st.closed < 0 && st.stock.length) {
    st.hands[win].push(st.stock.pop());
    if (st.stock.length) st.hands[1 - win].push(st.stock.pop());
  }
  if (!st.hands[0].length && !st.hands[1].length) {
    if (st.closed >= 0) SS._win(st, 1 - st.closed, 'closefail'); else SS._win(st, win, 'last');
  }
  return true;
};
SS._gp = function (st, w, why) {
  if (why === 'closefail') return 2;
  var o = st.pts[1 - w];
  if (st.closed >= 0 && st.closed !== w && why === 'points') return 2;   // the other side reached 66 although you closed
  return o === 0 ? 3 : o < 33 ? 2 : 1;
};
SS._win = function (st, w, why) {
  if (st.phase === 'show') return;
  var gp = SS._gp(st, w, why);
  st.games[w] += gp; st.last = { winner: w, gp: gp, why: why, pts: st.pts.slice() }; st.phase = 'show';
  if (st.games[w] >= SS.TARGET) { st.over = true; st.result = w; }
};
SS.next = function (st) { if (st.phase !== 'show' || st.over) return false; SS._deal(st); return true; };
SS.bot = function (st, level, r) {
  var side = 1, h = st.hands[side], i;
  if (st.led < 0) {
    // on the lead
    if (SS.canExchange(st, side)) return { t: 'exchange' };
    if (level >= 1 && SS.canClose(st, side) && st.pts[side] >= 55 && h.filter(function (c) { return SS.suit(c) === st.trump; }).length >= 2) return { t: 'close' };
    var m = h.filter(function (c) { return SS.canMarry(st, side, c); });
    if (m.length) { m.sort(function (a, b) { return (SS.suit(b) === st.trump) - (SS.suit(a) === st.trump); }); return { t: 'play', c: m[0], marry: true }; }
    var leg = SS.legal(st, side), best = null, bv = 1e9;
    leg.forEach(function (c) { var v = SS.pts(c) + (SS.suit(c) === st.trump ? 30 : 0) + (r ? r() * 2 : 0) - (SS.canMarry(st, side, c) ? 0 : 0); if (v < bv) { bv = v; best = c; } });
    return { t: 'play', c: best };
  }
  var legal = SS.legal(st, side), led = st.led, win = legal.filter(function (c) { return SS.beats(st, led, c); });
  var worth = SS.pts(led);
  if (win.length && (worth >= 3 || level >= 1 || SS.strict(st))) {
    win.sort(function (a, b) { return (SS.suit(a) === st.trump) - (SS.suit(b) === st.trump) || SS.pts(a) - SS.pts(b); });
    return { t: 'play', c: win[0] };
  }
  var low = legal.slice().sort(function (a, b) { return ((SS.suit(a) === st.trump) - (SS.suit(b) === st.trump)) * 40 + SS.pts(a) - SS.pts(b); });
  return { t: 'play', c: low[0] };
};

/* =====================================================================
   SCOPA. 40 cards: A 2 3 4 5 6 7 J Q K of four suits (J = 8, Q = 9, K = 10). Side 0 = the player, side 1 = the bot.
   Card c: suit = floor(c / 10), r = c % 10 -> value r + 1. Suit 2 (diamonds) is "denari".
   3 cards each, 4 on the table; 3 more each time hands are empty. Play one card: if the table has a card of
   the same value you must take it; otherwise you may take any cards that add up to your value; otherwise
   the card stays on the table. Clearing the table (not on the very last play) = 1 scopa point.
   The last player to capture takes what remains. A deal gives points for: most cards, most diamonds,
   the 7 of diamonds, best "primiera", and each scopa. The match goes to 11 points.
   ===================================================================== */
var SC = VG.scopa = {};
SC.TARGET = 11; SC.MAXDEALS = 12;
SC.suit = function (c) { return Math.floor(c / 10); };
SC.val = function (c) { return c % 10 + 1; };
SC.red = function (c) { var s = SC.suit(c); return s === 1 || s === 2; };
SC.name = function (c) { return 'A234567JQK'.charAt(c % 10) + SUITS[Math.floor(c / 10)]; };
SC.isSeven = function (c) { return SC.suit(c) === 2 && SC.val(c) === 7; };
SC.prim = function (c) { return [16, 12, 13, 14, 15, 18, 21, 10, 10, 10][c % 10]; };
SC.new = function (r) {
  var st = { r: r, scores: [0, 0], deal: 0, dealer: 0, over: false, result: null };
  SC._deal(st);
  return st;
};
SC._deal = function (st) {
  var deck, tries = 0;
  do {
    deck = VG.shuffle(st.r, Array.apply(null, { length: 40 }).map(function (_, i) { return i; }));
    tries++;
  } while (deck.slice(6, 10).filter(function (c) { return SC.val(c) === 10; }).length >= 3 && tries < 20);   // never start with 3+ kings on the table
  st.hands = [deck.slice(0, 3), deck.slice(3, 6)]; st.table = deck.slice(6, 10); st.deck = deck.slice(10);
  st.cap = [[], []]; st.scopas = [0, 0]; st.lastCap = -1; st.deal++; st.dealer = 1 - st.dealer; st.turn = 1 - st.dealer; st.phase = 'play'; st.last = null; st.event = null;
};
/* all ways to take cards with hand card index hi: list of arrays of table indexes ([] = leave the card on the table) */
SC.options = function (st, side, hi) {
  var c = st.hands[side][hi]; if (c == null || st.phase !== 'play' || st.turn !== side) return [];
  var v = SC.val(c), same = [], i;
  for (i = 0; i < st.table.length; i++) if (SC.val(st.table[i]) === v) same.push([i]);
  if (same.length) return same;
  var out = [], n = st.table.length;
  for (var mask = 1; mask < (1 << n); mask++) {
    var s = 0, idx = [];
    for (i = 0; i < n; i++) if (mask & (1 << i)) { s += SC.val(st.table[i]); idx.push(i); }
    if (s === v) out.push(idx);
  }
  return out.length ? out : [[]];
};
SC.play = function (st, side, hi, cap) {
  var opts = SC.options(st, side, hi);
  if (!opts.length) return false;
  var key = cap.slice().sort(function (a, b) { return a - b; }).join(',');
  if (!opts.some(function (o) { return o.join(',') === key; })) return false;
  var c = st.hands[side].splice(hi, 1)[0], taken = cap.map(function (i) { return st.table[i]; });
  st.event = { side: side, played: c, taken: taken.slice(), scopa: false };
  if (cap.length) {
    st.table = st.table.filter(function (_, i) { return cap.indexOf(i) < 0; });
    st.cap[side].push(c); taken.forEach(function (x) { st.cap[side].push(x); }); st.lastCap = side;
    var lastPlay = !st.hands[0].length && !st.hands[1].length && !st.deck.length;
    if (!st.table.length && !lastPlay) { st.scopas[side]++; st.event.scopa = true; }
  } else st.table.push(c);
  if (!st.hands[0].length && !st.hands[1].length) {
    if (st.deck.length) { st.hands = [st.deck.splice(0, 3), st.deck.splice(0, 3)]; }
    else { SC._end(st); return true; }
  }
  st.turn = 1 - side;
  if (!st.hands[st.turn].length) st.turn = side;   // cannot happen with equal hands, kept as a guard
  return true;
};
SC._end = function (st) {
  if (st.table.length && st.lastCap >= 0) { st.table.forEach(function (x) { st.cap[st.lastCap].push(x); }); st.table = []; }
  var s = [0, 0], rows = {};
  var n0 = st.cap[0].length, n1 = st.cap[1].length;
  rows.cards = n0 > n1 ? 0 : n1 > n0 ? 1 : -1;
  var d0 = st.cap[0].filter(function (c) { return SC.suit(c) === 2; }).length, d1 = st.cap[1].filter(function (c) { return SC.suit(c) === 2; }).length;
  rows.coins = d0 > d1 ? 0 : d1 > d0 ? 1 : -1;
  rows.seven = st.cap[0].some(SC.isSeven) ? 0 : st.cap[1].some(SC.isSeven) ? 1 : -1;
  var p = [0, 0];
  [0, 1].forEach(function (sd) { for (var su = 0; su < 4; su++) { var m = 0; st.cap[sd].forEach(function (c) { if (SC.suit(c) === su) m = Math.max(m, SC.prim(c)); }); p[sd] += m; } });
  rows.prim = p[0] > p[1] ? 0 : p[1] > p[0] ? 1 : -1;
  ['cards', 'coins', 'seven', 'prim'].forEach(function (k) { if (rows[k] >= 0) s[rows[k]]++; });
  s[0] += st.scopas[0]; s[1] += st.scopas[1];
  st.scores[0] += s[0]; st.scores[1] += s[1];
  st.last = { rows: rows, prim: p, counts: [n0, n1], coins: [d0, d1], scopas: st.scopas.slice(), gain: s };
  st.phase = 'show';
  if ((st.scores[0] >= SC.TARGET || st.scores[1] >= SC.TARGET) && st.scores[0] !== st.scores[1]) { st.over = true; st.result = st.scores[0] > st.scores[1] ? 0 : 1; }
  else if (st.deal >= SC.MAXDEALS) { st.over = true; st.result = st.scores[0] === st.scores[1] ? 'draw' : st.scores[0] > st.scores[1] ? 0 : 1; }
};
SC.next = function (st) { if (st.phase !== 'show' || st.over) return false; SC._deal(st); return true; };
SC.bot = function (st, level, r) {
  var side = 1, best = null, bv = -1e9;
  st.hands[side].forEach(function (c, hi) {
    SC.options(st, side, hi).forEach(function (cap) {
      var taken = cap.map(function (i) { return st.table[i]; }), v = 0;
      if (cap.length) {
        v += 10 + (1 + taken.length) * 2;
        var cards = taken.concat([c]);
        cards.forEach(function (x) { if (SC.suit(x) === 2) v += 3; if (SC.isSeven(x)) v += 14; if (SC.val(x) === 7) v += 3; if (SC.val(x) === 6) v += 1.5; });
        if (cap.length === st.table.length) v += (st.hands[0].length || st.deck.length) ? 12 : 0;
      } else {
        v -= 4 + (SC.suit(c) === 2 ? 6 : 0) + (SC.isSeven(c) ? 40 : 0) + (SC.val(c) === 7 ? 8 : 0);
        var sum = SC.val(c); st.table.forEach(function (x) { sum += SC.val(x); });
        if (sum <= 10) v -= 14;   // leaves an easy sweep for the opponent
        v -= SC.val(c) * 0.3;
      }
      v += r ? r() * (level >= 1 ? 0.6 : 3) : 0;
      if (v > bv) { bv = v; best = { t: 'play', hi: hi, cap: cap }; }
    });
  });
  return best;
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
