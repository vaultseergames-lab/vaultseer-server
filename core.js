'use strict';
// Match manager for 2 to 9 players. No network code here, so it can be tested alone.
// Seats are letters in join order: 'a' = first player, 'b' = second, ... 'i' = ninth.
// The result is a bit mask over the seats, the same as in Arena.sol: bit 0 = seat 'a', bit 1 = seat 'b' ...
//   one bit = that player wins the whole pool, several bits = they share it (a team, or a tie),
//   all bits = a draw (everybody gets the stake back).  For two players 1 = a wins, 2 = b wins, 3 = draw.
// A player who leaves or runs out of time is OUT: he loses his stake, and for the rest of the game the server plays
// for him with the simplest legal move (adapter.auto). Out players can never be among the winners.
const { byId } = require('./adapters');
const lower = (a) => String(a || '').toLowerCase();
const SEATS = 'abcdefghi';
const bit = (s) => 1 << SEATS.indexOf(s);

function makeCore({ now = () => Date.now(), sign = async () => null } = {}) {
  const matches = new Map();
  const seatOf = (m, addr) => { const i = m.players.indexOf(lower(addr)); return i < 0 ? null : SEATS[i]; };
  const teamOf = (m, ad, s) => (ad.team ? ad.team(s, m.n) : s);
  const aliveSeats = (m) => m.seats.filter((s) => !m.out.has(s));
  const mustAct = (m, s) => !m.over && m.actors.includes(s) && !m.pending[s] && !m.out.has(s);

  // time left (ms) for one player. Total-clock games: only the player to move spends time. Per-move games: every player who still must act.
  function left(m, s) {
    const ad = byId[m.game];
    const act = mustAct(m, s);
    if (ad.clock.total) return m.clock[s] - (act ? now() - m.turnStart : 0);
    return act ? ad.clock.perMove - (now() - m.turnStart) : ad.clock.perMove;
  }

  function view(m, addr) {
    const ad = byId[m.game], me = seatOf(m, addr);
    const clocks = {}; for (const s of m.seats) clocks[s] = Math.max(0, left(m, s));
    return {
      id: m.id, game: m.game, you: me, n: m.n, players: m.players, a: m.players[0], b: m.players[1],
      state: ad.view(m.st, me, now()), actors: m.actors, waiting: !!(me && m.pending[me]), out: [...m.out],
      over: m.over, outcome: m.outcome, why: m.why, sig: m.sig,
      clocks, perMove: ad.clock.perMove, serverTime: now(),
      legal: me && mustAct(m, me) ? ad.legal(m.st, me, now()) : [],
    };
  }

  async function finish(m, outcome, why) {
    if (m.over) return;
    m.over = true; m.outcome = outcome; m.why = why; m.actors = []; m.doneAt = now();
    try { m.sig = await sign(m.id, outcome); } catch (e) { m.sig = null; m.signError = String((e && e.message) || e); }
  }

  function nextTurn(m) {
    const ad = byId[m.game];
    m.actors = ad.actors(m.st); m.pending = {};
    m.turnStart = now();
  }

  const maskOf = (list) => list.reduce((a, s) => a | bit(s), 0);
  const fullMask = (m) => (1 << m.n) - 1;

  // Everybody who is still in plays on the same team (or only one player is left)? Then they win. Nobody left? Draw.
  async function settleIfDecided(m, why) {
    const alive = aliveSeats(m);
    if (!alive.length) { await finish(m, fullMask(m), why); return true; }
    const ad = byId[m.game];
    const teams = new Set(alive.map((s) => teamOf(m, ad, s)));
    if (teams.size === 1) { await finish(m, maskOf(alive), why); return true; }
    return false;
  }

  // The server plays for players who are out, until a live player has to act (or the game ends).
  async function autoPlay(m) {
    const ad = byId[m.game];
    for (let guard = 0; guard < 2000 && !m.over; guard++) {
      const outs = m.actors.filter((s) => m.out.has(s) && !m.pending[s]);
      if (!outs.length) return;
      const s = outs[0];
      const mv = ad.auto ? ad.auto(m.st, s, now()) : (ad.legal(m.st, s, now())[0] || null);
      const legal = mv && ad.find(m.st, mv, s, now());
      if (!legal) { // nothing sensible to play: should not happen; end the game as a draw between the live players
        await finish(m, aliveSeats(m).length ? maskOf(aliveSeats(m)) : fullMask(m), 'stuck'); return;
      }
      if (ad.simultaneous || (ad.simul && ad.simul(m.st))) {
        m.pending[s] = legal;
        if (!m.actors.every((x) => m.pending[x] || m.out.has(x))) return;
        for (const x of m.actors) if (!m.pending[x]) m.pending[x] = ad.find(m.st, ad.auto ? ad.auto(m.st, x, now()) : ad.legal(m.st, x, now())[0], x, now());
        m.st = ad.apply(m.st, m.pending, now());
      } else m.st = ad.apply(m.st, legal, now());
      if (await checkResult(m)) return;
      nextTurn(m);
    }
  }

  async function checkResult(m) {
    const ad = byId[m.game];
    const out = maskOf([...m.out]);
    const r = ad.result(m.st, out);
    if (!r) return false;
    let w = r & ~out & fullMask(m);
    if (!w) { const alive = aliveSeats(m); w = alive.length ? maskOf(alive) : fullMask(m); } // the engine's winner was out: the live players share
    await finish(m, w, w === fullMask(m) ? 'draw' : 'win');
    return true;
  }

  function start(id, game, ...rest) {
    const ad = byId[game];
    if (!ad) throw new Error('game not available yet: ' + game);
    const players = (Array.isArray(rest[0]) ? rest[0] : rest).map(lower);
    const n = players.length;
    const [lo, hi] = ad.seats || [2, 2];
    if (n < lo || n > hi) throw new Error('wrong number of players for ' + game);
    if (new Set(players).size !== n) throw new Error('same player twice');
    if (matches.has(id)) throw new Error('match exists');
    const seats = SEATS.slice(0, n).split('');
    const st = ad.init(n, now());
    const t = ad.clock.total || ad.clock.perMove;
    const clock = {}; for (const s of seats) clock[s] = t;
    const m = { id, game, players, n, seats, st, actors: ad.actors(st), pending: {}, out: new Set(), over: false, outcome: null, why: null, sig: null, clock, turnStart: now(), log: [] };
    matches.set(id, m);
    return m;
  }

  async function move(id, addr, mv) {
    const m = matches.get(id); if (!m) return { ok: false, err: 'no such match' };
    const ad = byId[m.game], who = seatOf(m, addr);
    if (!who) return { ok: false, err: 'you are not in this match' };
    await tick(id);                                         // a late move after the time ran out does not count
    if (m.over) return { ok: false, err: 'match is over' };
    if (m.out.has(who)) return { ok: false, err: 'you are out of this match' };
    if (!m.actors.includes(who)) return { ok: false, err: 'not your turn' };
    if (m.pending[who]) return { ok: false, err: 'already chosen' };
    const legal = ad.find(m.st, mv, who, now());
    if (!legal) return { ok: false, err: 'illegal move' };
    if (ad.clock.total) m.clock[who] -= now() - m.turnStart;
    if (ad.simultaneous || (ad.simul && ad.simul(m.st))) {
      m.pending[who] = legal;
      if (!m.actors.every((s) => m.pending[s] || m.out.has(s))) return { ok: true, waiting: true };
      for (const s of m.actors) if (!m.pending[s]) m.pending[s] = ad.find(m.st, ad.auto ? ad.auto(m.st, s, now()) : ad.legal(m.st, s, now())[0], s, now());
      m.log.push({ both: true });
      m.st = ad.apply(m.st, m.pending, now());
    } else {
      m.st = ad.apply(m.st, legal, now()); m.log.push({ by: who, mv });
      if (m.st && typeof m.st === 'object' && !ad.hidden) m.st.last = mv;
    }
    if (await checkResult(m)) return { ok: true, over: true };
    nextTurn(m);
    await autoPlay(m);
    return { ok: true, over: m.over };
  }

  async function dropOut(m, seats, why) {
    for (const s of seats) m.out.add(s);
    if (await settleIfDecided(m, why)) return;
    await autoPlay(m);
    if (!m.over && m.actors.every((s) => m.out.has(s))) nextTurn(m);
  }

  async function leave(id, addr) {                          // leaving counts as a loss
    const m = matches.get(id); if (!m || m.over) return { ok: false };
    const who = seatOf(m, addr); if (!who || m.out.has(who)) return { ok: false };
    await dropOut(m, [who], 'left');
    return { ok: true };
  }

  async function tick(only) {                               // call about once a second
    const done = [];
    for (const m of matches.values()) {
      if (m.over || (only && m.id !== only)) continue;
      const late = m.actors.filter((s) => !m.pending[s] && !m.out.has(s) && left(m, s) <= 0);
      if (!late.length) continue;
      await dropOut(m, late, 'timeout'); done.push(m.id);
    }
    return done;
  }

  // forget matches that ended long ago (memory); a match that is still running is never touched
  function purge(maxAgeMs, maxKeep = 5000) {
    let n = 0;
    const done = [...matches.values()].filter((m) => m.over && m.doneAt).sort((a, b) => a.doneAt - b.doneAt);
    for (const m of done) if (now() - m.doneAt > maxAgeMs || matches.size > maxKeep) { matches.delete(m.id); n++; }
    return n;
  }

  return { start, move, leave, tick, purge, view: (id, addr) => { const m = matches.get(id); return m ? view(m, addr) : null; }, get: (id) => matches.get(id), matches, SEATS };
}
module.exports = makeCore;
