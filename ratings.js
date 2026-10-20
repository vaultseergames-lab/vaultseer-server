'use strict';
// Builds the player table from the blockchain: every MatchSettled event of the Arena contract is replayed in order through ledger.js.
// Nothing is stored on the server's disk, so a restart or a redeploy loses nothing: the table is simply rebuilt. The chain is the record.
const { applyMatch, newProfile } = require('./ledger');

function makeRatings({ chain, fromBlock, confirmations = 4, chunk = 2000, now = Date.now, log = console.error }) {
  const book = new Map();               // address -> profile
  const done = new Set();               // match ids already counted
  let next = null, busy = false, lastOk = 0, lastErr = '', counted = 0, minChunk = 10;

  async function step() {
    const head = await chain.blockNumber();
    if (next === null) next = fromBlock != null ? fromBlock : Math.max(0, head - 20000);
    const to = Math.min(head - confirmations, next + chunk - 1);
    if (to < next) return false;
    let logs;
    try { logs = await chain.getSettled(next, to); }
    catch (e) { if (chunk > minChunk) { chunk = Math.max(minChunk, Math.floor(chunk / 2)); return true; } throw e; }   // range too big for this node: ask for less
    for (const l of logs) {
      if (done.has(l.id)) continue;
      const m = await chain.getMatch(BigInt(l.id));
      if (applyMatch(book, { players: m.players.map((a) => a.toLowerCase()), game: m.game || 'game', mask: l.mask })) counted++;
      done.add(l.id);
    }
    next = to + 1;
    return to < head - confirmations;
  }
  async function sync() {
    if (busy) return; busy = true;
    try { let more = true, guard = 0; while (more && guard++ < 5000) more = await step(); lastOk = now(); lastErr = ''; }
    catch (e) { lastErr = String(e.message || e); log('ratings:', lastErr); }
    finally { busy = false; }
  }
  return {
    sync, book,
    start(everyMs = 30000) { sync(); const t = setInterval(sync, everyMs); if (t.unref) t.unref(); return () => clearInterval(t); },
    profile(addr) { return book.get(String(addr).toLowerCase()) || newProfile(); },
    top(n = 20) {
      return [...book.entries()].map(([addr, p]) => ({ addr, rating: p.rating, games: p.games, wins: p.wins }))
        .sort((a, b) => b.rating - a.rating || b.games - a.games || (a.addr < b.addr ? -1 : 1)).slice(0, Math.max(1, Math.min(100, n)));
    },
    status() { return { counted, players: book.size, nextBlock: next, lastOk, error: lastErr }; },
  };
}
module.exports = makeRatings;
