'use strict';
// "Gas drip": a new wallet that already holds stake tokens but has no native coin (ETH / POL) gets a small one-time amount,
// so a person who signed in by email and only topped up USDT can play at once. The cost is paid from a separate small wallet
// (GAS_KEY) that the owner tops up from the fee income. Rules: only when the wallet really holds tokens, only when its native
// balance is low, only plain wallets (no contracts), per-wallet cooldown, per-IP limit and a daily cap for the whole server.
const C = require('./crypto.js');
const BAL = C.keccak(Buffer.from('balanceOf(address)')).subarray(0, 4).toString('hex');
const bytes = (n) => { n = BigInt(n); if (n === 0n) return Buffer.alloc(0); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
function rlp(x) {
  if (Array.isArray(x)) { const b = Buffer.concat(x.map(rlp)); return Buffer.concat([lenPrefix(b.length, 0xc0), b]); }
  if (x.length === 1 && x[0] < 0x80) return x;
  return Buffer.concat([lenPrefix(x.length, 0x80), x]);
}
function lenPrefix(len, base) { if (len < 56) return Buffer.from([base + len]); const l = bytes(len); return Buffer.concat([Buffer.from([base + 55 + l.length]), l]); }
// EIP-1559 (type 2) transfer, signed with key; returns the raw transaction hex
function rawTransfer({ key, chainId, nonce, tip, maxFee, gas, to, value }) {
  const f = [bytes(chainId), bytes(nonce), bytes(tip), bytes(maxFee), bytes(gas), Buffer.from(to.replace(/^0x/, ''), 'hex'), bytes(value), Buffer.alloc(0), []];
  const h = C.keccak(Buffer.concat([Buffer.from([2]), rlp(f)]));
  const g = C.sign(h, key);
  return '0x' + Buffer.concat([Buffer.from([2]), rlp(f.concat([bytes(g.v - 27), bytes(g.r), bytes(g.s)]))]).toString('hex');
}
function makeGas({ queue = null, rpcUrl, privateKey, chainId, tokens = [], dripWei, minToken = 1000000n, lowWei, perDay = 300, reserveWei = 0n, cooldownMs = 24 * 3600 * 1000, ipPerHour = 5, now = Date.now, fetchFn = fetch }) {
  const key = BigInt(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  const address = C.addrOf(C.mul(key));
  dripWei = BigInt(dripWei); reserveWei = BigInt(reserveWei); lowWei = BigInt(lowWei === undefined ? dripWei / 2n : lowWei); minToken = BigInt(minToken);
  const rpc = async (method, params) => {
    const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result;
  };
  const last = new Map(), ips = new Map(), asks = new Map(); let day = 0, today = 0, busy = Promise.resolve();
  async function holdsTokens(addr) {
    for (const t of tokens) {
      try { const r = await rpc('eth_call', [{ to: t, data: '0x' + BAL + addr.slice(2).toLowerCase().padStart(64, '0') }, 'latest']); if (BigInt(r || '0x0') >= minToken) return true; } catch (e) { /* try next token */ }
    }
    return false;
  }
  async function drip(addrIn, ip) {
    const addr = String(addrIn || '').toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return { ok: false, err: 'bad address' };
    const t = now(), d = Math.floor(t / 86400000); if (d !== day) { day = d; today = 0; }
    const l = last.get(addr); if (l && t - l < cooldownMs) return { ok: false, err: 'already sent' };
    const ask = (asks.get(ip) || []).filter((x) => t - x < 3600000); if (ask.length >= 300) return { ok: false, err: 'too many requests' };   // looks only (checks cost a little)
    asks.set(ip, ask.concat(t)); if (asks.size > 5000) asks.clear();
    if (today >= perDay) return { ok: false, err: 'daily limit' };
    if (BigInt(await rpc('eth_getBalance', [addr, 'latest'])) >= lowWei) return { ok: false, err: 'has gas' };
    if ((await rpc('eth_getCode', [addr, 'latest'])) !== '0x') return { ok: false, err: 'not a plain wallet' };
    if (!(await holdsTokens(addr))) return { ok: false, err: 'no tokens' };
    if (reserveWei > 0n && BigInt(await rpc('eth_getBalance', [address, 'latest'])) < reserveWei + dripWei) return { ok: false, err: 'paused' };   // what is left must always be enough for the keeper
    const l2 = last.get(addr); if (l2 && now() - l2 < cooldownMs) return { ok: false, err: 'already sent' };   // the same wallet asked many times at once: only the first one passes
    const arr = (ips.get(ip) || []).filter((x) => t - x < 3600000); if (arr.length >= ipPerHour) return { ok: false, err: 'too many requests' };   // actual sends per IP
    ips.set(ip, arr.concat(t)); if (ips.size > 5000) ips.clear();
    last.set(addr, t); if (last.size > 20000) last.clear(); today++;
    // one transaction at a time so the nonces never collide
    // with a shared queue (production) the nonce, fee floor and ordering are handled there
    const job = queue ? queue.send({ to: addr, value: dripWei, gas: 21000, wait: false }) : busy.then(async () => {
      const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [address, 'pending'])));
      const base = BigInt(await rpc('eth_gasPrice', []));
      const tip = base / 5n + 1n, maxFee = base * 2n + tip;
      const raw = rawTransfer({ key, chainId: BigInt(chainId), nonce, tip, maxFee, gas: 21000, to: addr, value: dripWei });
      return rpc('eth_sendRawTransaction', [raw]);
    });
    busy = job.catch(() => {});
    try { return { ok: true, tx: await job }; } catch (e) { last.delete(addr); today--; return { ok: false, err: 'send failed' }; }
  }
  return { address, drip, rawTransfer, status: () => ({ address, today, perDay }) };
}
module.exports = makeGas; module.exports.rlp = rlp; module.exports.rawTransfer = rawTransfer;
