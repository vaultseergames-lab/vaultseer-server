'use strict';
// Memory (a row of digits) for 2 to 9 players, everybody at the same time.
//  - Everybody presses "ready" first. Then each round shows the same row of digits to all players (1.8 s + 0.45 s per digit), it disappears,
//    and every player types it back. No digit is the same as the one before it.
//  - Rounds have 5, 6 and 7 digits. A digit typed in the right place is 1 point. After the 3 rounds the player with the most points wins the pool.
//  - If the best total is shared, extra rounds follow, each one digit longer than the last (up to 10 digits), until one player is alone on top.
//    After 5 extra rounds a shared top total is shared prize.
//  - Nobody can type before the row has disappeared. A player who does not answer in time is out and loses the stake.
const crypto = require('crypto');
const LENS = [5, 6, 7], MAX_EXTRA = 5, GAP_MS = 6000;
const showMs = (n) => 1800 + n * 450;
function seqOf(n) { const a = []; let last = -1; for (let i = 0; i < n; i++) { let d; do { d = crypto.randomInt(0, 10); } while (d === last); a.push(d); last = d; } return a; }
const score = (target, answer) => { let s = 0; for (let i = 0; i < target.length; i++) if (answer[i] != null && +answer[i] === target[i]) s++; return s; };

function create(n, now, seqOverride) {
  if (n < 2 || n > 9) throw new Error('memory is for 2 to 9 players');
  return { n, phase: 'ready', ready: Array(n).fill(false), round: 0, len: 0, seq: null, startAt: 0, showUntil: 0, answers: Array(n).fill(null), totals: Array(n).fill(0), rows: [], extra: 0, over: false, winners: null, seqOverride: seqOverride || null };
}
function startRound(st, now) {
  st.round++;
  st.len = st.round <= LENS.length ? LENS[st.round - 1] : Math.min(10, LENS[LENS.length - 1] + (st.round - LENS.length));
  st.seq = st.seqOverride ? st.seqOverride[(st.round - 1) % st.seqOverride.length].slice() : seqOf(st.len);
  st.startAt = now + (st.round === 1 ? 3000 : GAP_MS); st.showUntil = st.startAt + showMs(st.len);
  st.answers = Array(st.n).fill(null); st.phase = 'play';
}
const actors = (st, ) => (st.over ? [] : Array.from({ length: st.n }, (_, i) => i));
function legal(st, s, now) {
  if (st.over) return [];
  if (st.phase === 'ready') return st.ready[s] ? [] : [{ t: 'ready' }];
  if (st.answers[s] != null) return [];
  return [{ t: 'answer', len: st.len, from: st.showUntil }];
}
function find(st, mv, s, now) {
  if (!mv || st.over) return null;
  if (st.phase === 'ready') return mv.t === 'ready' && !st.ready[s] ? { t: 'ready' } : null;
  if (mv.t !== 'answer' || st.answers[s] != null) return null;
  const d = String(mv.digits == null ? '' : mv.digits);
  if (!/^\d*$/.test(d) || d.length > st.len) return null;
  if (d.length && now != null && now < st.showUntil) return null;            // no typing while the row can still be seen
  return { t: 'answer', digits: d };
}
// `both` = { seat letter or index: move } for every actor
function apply(st, both, now) {
  const get = (i) => both[i] || both['abcdefghi'[i]];
  if (st.phase === 'ready') {
    for (let i = 0; i < st.n; i++) st.ready[i] = true;
    startRound(st, now); return st;
  }
  const sc = [];
  for (let i = 0; i < st.n; i++) { const m = get(i); st.answers[i] = m ? m.digits : ''; sc.push(score(st.seq, st.answers[i].split('').map(Number))); st.totals[i] += sc[i]; }
  st.rows.push({ round: st.round, len: st.len, seq: st.seq.slice(), answers: st.answers.slice(), scores: sc, totals: st.totals.slice() });
  if (st.rows.length > 12) st.rows.shift();
  const top = Math.max(...st.totals), leaders = st.totals.map((x, i) => (x === top ? i : -1)).filter((i) => i >= 0);
  const regular = st.round >= LENS.length;
  if (regular && (leaders.length === 1 || st.round >= LENS.length + MAX_EXTRA)) { st.over = true; st.winners = leaders; st.phase = 'over'; return st; }
  startRound(st, now);
  return st;
}
function auto(st, s) { return st.phase === 'ready' ? { t: 'ready' } : { t: 'answer', digits: '' }; }
module.exports = { create, actors, legal, find, apply, auto, score, showMs, LENS, MAX_EXTRA, GAP_MS };
