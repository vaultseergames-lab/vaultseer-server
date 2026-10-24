'use strict';
// One wallet, one line: every transaction of the server (gas drip, keeper) goes through this queue, so the nonces never collide.
// Fees: on Polygon the network refuses a priority fee below ~25 gwei, so a floor is applied there.
const C = require('./crypto.js');
const { rlp } = require('./gas.js');
const bytes = (n) => { n = BigInt(n); if (n === 0n) return Buffer.alloc(0); let h = n.toString(16); if (h.length % 2) h = '0' + h; return Buffer.from(h, 'hex'); };
const hexBuf = (h) => Buffer.from(String(h || '0x').replace(/^0x/, ''), 'hex');

// EIP-1559 (type 2) transaction with call data, signed with key; returns the raw transaction hex
function rawTx({ key, chainId, nonce, tip, maxFee, gas, to, value = 0n, data = '0x' }) {
  const f = [bytes(chainId), bytes(nonce), bytes(tip), bytes(maxFee), bytes(gas), hexBuf(to), bytes(value), hexBuf(data), []];
  const h = C.keccak(Buffer.concat([Buffer.from([2]), rlp(f)]));
  const g = C.sign(h, key);
  return '0x' + Buffer.concat([Buffer.from([2]), rlp(f.concat([bytes(g.v - 27), bytes(g.r), bytes(g.s)]))]).toString('hex');
}

function makeTxQueue({ rpcUrl, privateKey, chainId, fetchFn = fetch, minTipWei, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), receiptTries = 90 }) {
  const key = BigInt(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  const address = C.addrOf(C.mul(key));
  const cid = BigInt(chainId);
  const floor = minTipWei !== undefined ? BigInt(minTipWei) : (cid === 137n ? 30_000_000_000n : 0n);
  let rpc = async (method, params) => {
    const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result;
  };
  // a public node sometimes answers "archive requests require a personal token" or a rate-limit error for a plain request: ask again a moment later
  const TRANSIENT = /archive requests|rate limit|too many|timeout|timed out|temporar|unavailable|try again|bad gateway|fetch failed/i;
  const rpcOnce = rpc;
  rpc = async (method, params) => {
    for (let i = 0; ; i++) {
      try { return await rpcOnce(method, params); }
      catch (e) { if (method === 'eth_sendRawTransaction' || i >= 3 || !TRANSIENT.test(String(e && e.message))) throw e; await sleep(1500); }
    }
  };
  async function fees() {
    const gp = BigInt(await rpc('eth_gasPrice', []));
    let tip; try { tip = BigInt(await rpc('eth_maxPriorityFeePerGas', [])); } catch (e) { tip = gp / 5n + 1n; }
    if (tip < floor) tip = floor;
    return { tip, maxFee: gp * 2n + tip };
  }
  let line = Promise.resolve();
  // send({to, data, value, gas, wait}) -> receipt (or the hash when wait === false)
  function send({ to, data = '0x', value = 0n, gas, wait = true }) {
    const job = line.then(async () => {
      const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [address, 'pending'])));
      if (!gas) {
        let est;
        try { est = BigInt(await rpc('eth_estimateGas', [{ from: address, to, data, value: '0x' + BigInt(value).toString(16) }])); }
        catch (e) { throw new Error('would fail: ' + e.message); }
        gas = est * 13n / 10n + 30000n;
      }
      const { tip, maxFee } = await fees();
      const raw = rawTx({ key, chainId: cid, nonce, tip, maxFee, gas, to, value, data });
      const hash = await rpc('eth_sendRawTransaction', [raw]);
      if (!wait) return hash;
      for (let i = 0; i < receiptTries; i++) {
        let r = null; try { r = await rpc('eth_getTransactionReceipt', [hash]); } catch (e) { r = null; }
        if (r) { if (r.status !== '0x1') throw new Error('transaction reverted ' + hash); return r; }
        await sleep(2000);
      }
      throw new Error('no receipt for ' + hash);
    });
    line = job.catch(() => {});
    return job;
  }
  return { address, send, rpc, fees };
}
module.exports = makeTxQueue; module.exports.rawTx = rawTx;
