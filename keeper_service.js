'use strict';
// Runs the keeper (start rounds, fix prices, rank forecasts, finalize, pay winners) inside the game server, once a minute.
// Every step is open to anybody on the contract, so a second keeper or a restart can never do harm.
const C = require('./crypto.js');
const makeKeeper = require('./keeper_core.js');
function makeKeeperService({ queue, vault, intervalMs = 60000, anyHour = false, log = console.log, now = Date.now, lowWei = 100_000_000_000_000_000n }) {
  const io = {
    call: (to, data) => queue.rpc('eth_call', [{ to, data }, 'latest']),
    send: (to, data) => queue.send({ to, data }),
    now: async () => Number(BigInt((await queue.rpc('eth_getBlockByNumber', ['latest', false])).timestamp))
  };
  const run = makeKeeper(io, (b) => C.keccak(b).toString('hex'), log);
  const memo = new Set();
  const st = { running: false, lastRun: 0, lastActions: [], lastError: null, runs: 0, balance: null, low: false };
  async function tick() {
    if (st.running) return st;
    st.running = true;
    try {
      const a = await run(vault, { anyHour, memo });
      st.lastActions = a.slice(); st.lastError = a.errors && a.errors.length ? a.errors.join(' | ') : null;
      if (a.length) log('keeper:', a.join(', '));
      st.balance = BigInt(await queue.rpc('eth_getBalance', [queue.address, 'latest'])); st.low = st.balance < lowWei;
      if (st.low) log('keeper: the service wallet is almost out of gas money:', String(st.balance), 'wei');
    } catch (e) { st.lastError = String(e.message || e).slice(0, 300); log('keeper error:', st.lastError); }
    st.running = false; st.lastRun = now(); st.runs++;
    return st;
  }
  let timer = null;
  return {
    tick, start() { if (!timer) { timer = setInterval(tick, intervalMs); tick(); } }, stop() { if (timer) clearInterval(timer); timer = null; },
    status: () => ({ vault, wallet: queue.address, runs: st.runs, lastRun: st.lastRun, lastActions: st.lastActions, lastError: st.lastError, balanceWei: st.balance === null ? null : String(st.balance), lowBalance: st.low })
  };
}
module.exports = makeKeeperService;
