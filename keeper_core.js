'use strict';
// Vaultseer keeper: does every step that must happen on a schedule. Safe to run as often as you like:
// each run only does what is due right now (every step is also open to anybody, so a second keeper cannot break anything).
// It never needs an event search: the contract itself lists the wallets that saved a forecast in a round.
const SEL = {
  currentRound: '8a19c8bc', rounds: '8c65c81f', roundFeeds: '5e98c435', claimable: '402914f5',
  startRound: '55e3f086', fixPrice: 'e06c9bba', submitClaims: '14a7f218', finalize: '4bb278f3', payOut: '1922ff39',
  abortRound: '030c7174', latestRoundData: 'feaf968c', getRoundData: '9a6fc8f5'
};
module.exports = function makeKeeper(io, keccakHex, log = console.log) {
  // io: { call(to,data)->hex, send(to,data)->receipt, now()->seconds }
  const sel = (sig) => keccakHex(Buffer.from(sig)).slice(0, 8);
  const S = {
    treasury: sel('treasury()'), season: sel('season()'), seasonStart: sel('seasonStart()'), abortDelay: sel('abortDelay()'),
    settleSeason: sel('settleSeason()'), leader: sel('leader(uint256)'), playersPage: sel('roundPlayersPage(uint256,uint256,uint256)'),
    playerCount: sel('roundPlayerCount(uint256)'), forecasts: sel('forecasts(uint256,uint8,uint8,address)'), freePot: sel('freePot()')
  };
  const pad = (h) => ('0'.repeat(64) + h).slice(-64);
  const wNum = (n) => pad(BigInt(n).toString(16));
  const wAddr = (a) => pad(a.toLowerCase().replace('0x', ''));
  const words = (h) => { h = h.slice(2); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
  const big = (w) => BigInt('0x' + w);
  const data = (s, args = []) => '0x' + s + args.join('');
  const MAXU64 = (1n << 64n) - 1n;

  // every wallet that saved a forecast in round `rid`, read in pages straight from the contract
  async function roundPlayers(vault, rid, call) {
    const n = Number(big((await call('playerCount', [wNum(rid)]))[0])), out = [], PAGE = 200;
    for (let from = 0; from < n; from += PAGE) {
      const w = await call('playersPage', [wNum(rid), wNum(from), wNum(PAGE)]);   // [offset, length, ...addresses]
      const len = Number(big(w[1]));
      for (let i = 0; i < len; i++) out.push('0x' + w[2 + i].slice(24));
    }
    return out;
  }

  return async function run(vault, opts = {}) {
    const BATCH = opts.batch || 40, memo = opts.memo || new Set();
    const call = async (sig, args) => words(await io.call(vault, data(SEL[sig] || S[sig], args)));
    const now = await io.now();
    const actions = [], errors = [];
    actions.errors = errors;
    const act = async (name, to, d) => { log('->', name); await io.send(to, d); actions.push(name); };

    const rid = Number(big((await call('currentRound'))[0]));
    let R = null;
    if (rid) {
      const w = await call('rounds', [wNum(rid)]);
      R = { id: rid, start: Number(big(w[0])), end: Number(big(w[1])), claimDeadline: Number(big(w[2])), coins: Number(big(w[3])), mask: Number(big(w[4])), finalized: big(w[5]) !== 0n, aborted: big(w[6]) !== 0n, freePrize: big(w[7]) };
    }

    if (!R || R.finalized) {
      // pay everybody who is owed money, then start the next round at the usual time
      await payOutAll(vault, rid, call, act, errors, log);
      const ss = Number(big((await call('seasonStart'))[0]));
      if (now >= ss + 365 * 86400) {
        const season = (await call('season'))[0];
        const lead = '0x' + (await call('leader', [season]))[0].slice(24);
        await act('settleSeason', vault, data(S.settleSeason));
        if (big((await call('claimable', [wAddr(lead)]))[0]) > 0n) await act('payOut ' + lead, vault, data(SEL.payOut, [wAddr(lead)]));
      }
      const hour = new Date(now * 1000).getUTCHours();
      if (opts.anyHour || hour === 12 || !R) await act('startRound', vault, data(SEL.startRound));
      return actions;
    }
    if (now < R.end) return actions; // round is running: nothing to do

    const full = (1 << R.coins) - 1;
    if (R.mask !== full) {
      const abortDelay = Number(big((await call('abortDelay'))[0]));
      if (now > R.end + abortDelay) { await act('abortRound', vault, data(SEL.abortRound)); return actions; }
      for (let c = 0; c < R.coins; c++) {
        if (R.mask & (1 << c)) continue;
        const feed = '0x' + (await call('roundFeeds', [wNum(rid), wNum(c)]))[0].slice(24);
        const first = await firstRoundAfter(io, feed, R.end);
        if (first === null) { log('oracle has not published after the end yet for coin', c); continue; }
        try { await act('fixPrice coin ' + c, vault, data(SEL.fixPrice, [wNum(c), wNum(first)])); }
        catch (e) { errors.push('fixPrice coin ' + c + ': ' + e.message); log('fixPrice coin', c, 'failed:', e.message); }   // one stuck coin must not block the others
      }
      return actions;
    }

    if (now <= R.claimDeadline) {
      // submit every forecast so the contract can rank them (the contract skips what is already counted or not set)
      const players = await roundPlayers(vault, rid, call);
      for (let league = 0; league <= 1; league++) {
        if (league === 0 && R.freePrize === 0n) continue;
        for (let coin = 0; coin < R.coins; coin++) {
          const todo = players.filter((p) => !memo.has(rid + ':' + league + ':' + coin + ':' + p));
          for (let i = 0; i < todo.length; i += BATCH) {
            const part = todo.slice(i, i + BATCH);
            await act(`submitClaims league ${league} coin ${coin} (${part.length})`, vault, data(SEL.submitClaims, [wNum(league), wNum(coin), wNum(96), wNum(part.length), ...part.map(wAddr)]));
            part.forEach((p) => memo.add(rid + ':' + league + ':' + coin + ':' + p));
          }
        }
      }
      return actions;
    }
    // claim window is over: close the round; if closing keeps failing, the contract lets anyone abort it after a delay
    try { await act('finalize', vault, data(SEL.finalize)); }
    catch (e) {
      const abortDelay = Number(big((await call('abortDelay'))[0]));
      if (now > R.claimDeadline + abortDelay) await act('abortRound', vault, data(SEL.abortRound)); else throw e;
    }
    return actions;
  };

  async function payOutAll(vault, rid, call, act, errors, log) {
    if (!rid) return;
    const who = new Set(await roundPlayers(vault, rid, call));
    who.add('0x' + (await call('treasury'))[0].slice(24));
    for (const a of who) {
      const c = big((await call('claimable', [wAddr(a)]))[0]);
      if (c > 0n) {
        // one address that cannot receive (for example a blocked wallet) must not hold back everybody else or the next round
        try { await act('payOut ' + a, vault, data(SEL.payOut, [wAddr(a)])); }
        catch (e) { errors.push('payOut ' + a + ': ' + e.message); log('payOut', a, 'failed:', e.message); }
      }
    }
  }
};

// The first oracle round published at or after `end`: binary search inside the newest oracle phase
// (round numbers inside a phase run 1, 2, 3 ...; the phase is the upper part of the id).
async function firstRoundAfter(io, feed, end) {
  const w = (h) => { h = h.slice(2); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
  const lr = w(await io.call(feed, '0x' + SEL.latestRoundData));
  if (Number(BigInt('0x' + lr[3])) < end) return null;   // nothing published after the end yet
  const latest = BigInt('0x' + lr[0]), phase = latest >> 64n, top = latest & ((1n << 64n) - 1n);
  const at = async (agg) => {
    try { const r = w(await io.call(feed, '0x' + SEL.getRoundData + ('0'.repeat(64) + ((phase << 64n) | agg).toString(16)).slice(-64))); return Number(BigInt('0x' + r[3])); }
    catch (e) { return -1; }
  };
  let lo = 1n, hi = top;   // smallest round whose time is >= end lies in [lo, hi]; `top` is known to qualify
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if ((await at(mid)) >= end) hi = mid; else lo = mid + 1n;
  }
  return (phase << 64n) | lo;
}
module.exports.firstRoundAfter = firstRoundAfter;
