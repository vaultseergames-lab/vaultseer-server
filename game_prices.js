'use strict';
// Prices for the game: the market now, and the market at a moment in the past (to settle a Vision after exactly 24 hours,
// even if the server was asleep at that moment). Source: Kraken public API, spot from Coinbase as a backup. No keys needed.
const PAIR = { BTC: 'XBTUSD', ETH: 'ETHUSD', SOL: 'SOLUSD' };
const CB = { BTC: 'BTC-USD', ETH: 'ETH-USD', SOL: 'SOL-USD' };

function makePrices({ fetchFn = fetch, now = Date.now, ttlMs = 8000, timeoutMs = 8000 } = {}) {
  const cache = {};
  async function get(url) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null, tm = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : 0;
    try { const r = await fetchFn(url, ctl ? { signal: ctl.signal } : {}); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); } finally { if (tm) clearTimeout(tm); }
  }
  async function spot(coin) {
    const c = cache[coin]; if (c && now() - c.t < ttlMs) return c.v;
    let v = null;
    try { const j = await get('https://api.kraken.com/0/public/Ticker?pair=' + PAIR[coin]); const r = j.result && Object.values(j.result)[0]; v = r ? Number(r.c[0]) : null; } catch (e) { v = null; }
    if (!(v > 0)) { try { const j = await get('https://api.coinbase.com/v2/prices/' + CB[coin] + '/spot'); v = Number(j.data.amount); } catch (e) { v = null; } }
    if (!(v > 0)) return (c && now() - c.t < 120000) ? c.v : null;
    cache[coin] = { t: now(), v }; return v;
  }
  // price of the minute that contains `ts` (ms); null when it is in the future or not available
  async function at(coin, ts) {
    if (ts > now() - 60000) return null;
    const minute = Math.floor(ts / 60000) * 60;
    const j = await get('https://api.kraken.com/0/public/OHLC?pair=' + PAIR[coin] + '&interval=1&since=' + (minute - 1));
    const rows = j.result && Object.values(j.result).find(Array.isArray);
    if (!rows) return null;
    const row = rows.find((x) => Number(x[0]) >= minute); const v = row ? Number(row[4]) : null;
    return v > 0 ? v : null;
  }
  async function all() { const o = {}; for (const c of Object.keys(PAIR)) { const v = await spot(c); if (!(v > 0)) return null; o[c] = v; } return o; }
  async function allAt(ts) { const o = {}; for (const c of Object.keys(PAIR)) { const v = await at(c, ts); if (!(v > 0)) return null; o[c] = v; } return o; }
  return { spot, at, all, allAt };
}
module.exports = makePrices;
