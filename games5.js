/* ===== Game engines, part 5: slot duel and multi-player roulette (games of chance with a provably fair result) =====
   The result is a pure function of three things: a secret `nonce` the server commits to (sha256(nonce) is shown before the game),
   the round number, and a random `seed` every player adds when he presses the button. The server cannot change the result after it has
   seen the seeds (the nonce is fixed), and a player cannot steer it (he does not know the nonce or the other seeds).
   After the game the nonce is revealed, so anyone can recompute every result right here in the browser. */
(function (root) {
'use strict';
var VG = root.VG || (typeof require !== 'undefined' ? require('./games1.js') : null);

var CH = VG.chance = {};
CH.SYMBOLS = 7;                  /* 0..6, a higher number is a stronger symbol (6 = the seven) */
CH.SLOT_WINS = 2;                /* the duel is first to two rounds */
CH.SLOT_MAX_ROUNDS = 8;          /* rounds that end level are replayed; after this many the duel is a draw */
CH.POCKETS_PER_PLAYER = 6;       /* the wheel has n * 6 pockets, pocket i belongs to player i mod n: every player has the same share */

/* a number from the first 12 hex digits of a sha256, then reduced to 0..m-1 (the bias is below 1e-12) */
CH.pick = function (hex, m) { return parseInt(hex.slice(0, 12), 16) % m; };
CH.mix = function (nonce, round, seeds) { return VG.sha256(nonce + '|' + round + '|' + seeds.join(',')); };
CH.commit = function (nonce) { return VG.sha256(nonce); };
CH.okSeed = function (s) { return typeof s === 'string' && /^[0-9a-f]{8,32}$/.test(s); };

/* ---- slots: three reels per player ---- */
CH.reels = function (mix, seat) {
  var out = [], k;
  for (k = 0; k < 3; k++) out.push(CH.pick(VG.sha256(mix + ':' + seat + ':' + k), CH.SYMBOLS));
  return out;
};
/* three of a kind > a pair > high card; inside a class the higher symbols win. Equal numbers = a level round. */
CH.score = function (r) {
  var s = r.slice().sort(function (a, b) { return b - a; });
  if (s[0] === s[2]) return 30000 + s[0];
  if (s[0] === s[1]) return 20000 + s[0] * 10 + s[2];
  if (s[1] === s[2]) return 20000 + s[1] * 10 + s[0];
  return 10000 + s[0] * 100 + s[1] * 10 + s[2];
};
CH.kind = function (r) { var s = r.slice().sort(function (a, b) { return b - a; }); return s[0] === s[2] ? 'three' : (s[0] === s[1] || s[1] === s[2]) ? 'pair' : 'high'; };

/* ---- roulette ---- */
CH.pockets = function (n) { return n * CH.POCKETS_PER_PLAYER; };
CH.pocket = function (mix, n) { return CH.pick(VG.sha256(mix + ':pocket'), CH.pockets(n)); };
CH.owner = function (pocket, n) { return pocket % n; };

/* one finished round, exactly as the server computes it (the browser uses the same code to check it) */
CH.slotRow = function (nonce, round, seeds) {
  var mix = CH.mix(nonce, round, seeds), reels = [0, 1].map(function (s) { return CH.reels(mix, s); }), scores = reels.map(CH.score);
  return { round: round, seeds: seeds, reels: reels, scores: scores, kinds: reels.map(CH.kind), winner: scores[0] === scores[1] ? -1 : scores[0] > scores[1] ? 0 : 1 };
};
CH.rouletteRow = function (nonce, round, seeds, n) {
  var pocket = CH.pocket(CH.mix(nonce, round, seeds), n);
  return { round: round, seeds: seeds, pocket: pocket, owner: CH.owner(pocket, n) };
};
/* v = { commit, nonce, rows }: true = every round recomputes, false = something does not match, null = nothing to check yet */
CH.verify = function (kind, n, v) {
  if (!v || !v.nonce) return null;
  if (CH.commit(v.nonce) !== v.commit) return false;
  return v.rows.every(function (r) {
    var x = kind === 'roulette' ? CH.rouletteRow(v.nonce, r.round, r.seeds, n) : CH.slotRow(v.nonce, r.round, r.seeds);
    return kind === 'roulette' ? x.pocket === r.pocket && x.owner === r.owner : JSON.stringify(x.reels) === JSON.stringify(r.reels) && x.winner === r.winner;
  });
};

if (typeof module !== 'undefined' && module.exports) module.exports = VG;
})(typeof window !== 'undefined' ? window : globalThis);
