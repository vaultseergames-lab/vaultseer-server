'use strict';
// Runs the Events keeper inside the game server, every 2 minutes. Only started when EVENTS (the contract address) is set,
// so a server without it behaves exactly as before.
const C = require('./crypto.js');
const makeEventsKeeper = require('./events_core.js');
const P = require('./events_providers.js');
function makeEventsService({ queue, contract, providers, intervalMs = 120000, log = console.log, now = Date.now, opts }) {
  const io = {
    call: (to, data) => queue.rpc('eth_call', [{ to, data }, 'latest']),
    send: (to, data) => queue.send({ to, data }),
    now: async () => Number(BigInt((await queue.rpc('eth_getBlockByNumber', ['latest', false])).timestamp))
  };
  const run = makeEventsKeeper({ io, contract, keccakHex: (b) => C.keccak(b).toString('hex'), providers, log, opts });
  const st = { running: false, lastRun: 0, lastActions: [], lastError: null, runs: 0 };
  async function tick() {
    if (st.running) return st; st.running = true;
    try { const a = await run(); st.lastActions = a.slice(); st.lastError = a.errors && a.errors.length ? a.errors.join(' | ').slice(0, 600) : null; if (a.length) log('events:', a.join(', ')); }
    catch (e) { st.lastError = String(e.message || e).slice(0, 300); log('events error:', st.lastError); }
    st.running = false; st.lastRun = now(); st.runs++; return st;
  }
  let timer = null;
  return { tick, meta: () => run.meta(), start() { if (!timer) { timer = setInterval(tick, intervalMs); tick(); } }, stop() { if (timer) clearInterval(timer); timer = null; },
    status: () => ({ contract, providers: providers.map((p) => p.sport), runs: st.runs, lastRun: st.lastRun, lastActions: st.lastActions, lastError: st.lastError }) };
}
// providers from the environment: only the ones that have a key
function providersFromEnv(env = process.env) {
  const out = [];
  if (env.FOOTBALL_DATA_KEY) out.push(P.footballData({ key: env.FOOTBALL_DATA_KEY }));
  if (env.APISPORTS_KEY) {
    out.push(P.nba({ key: env.APISPORTS_KEY, season: env.NBA_SEASON }));
    out.push(P.nhl({ key: env.APISPORTS_KEY, season: env.NHL_SEASON }));
    out.push(P.nfl({ key: env.APISPORTS_KEY, season: env.NFL_SEASON }));
  }
  return out;
}
module.exports = makeEventsService; module.exports.providersFromEnv = providersFromEnv;
