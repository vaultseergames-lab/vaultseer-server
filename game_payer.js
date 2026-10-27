'use strict';
// Sends USDT from the campaign wallet. Only exists when PAYOUT_KEY is set. This wallet should hold only the prize money
// (plus a little POL for fees): the most the game server can ever lose is what is in it.
const C = require('./crypto.js');
const hex32 = (x) => BigInt(x).toString(16).padStart(64, '0');
const USDT_POLYGON = '0xc2132D05D31c914a87C6611C10748AEb04B58e8F';

function makePayer({ queue, token = USDT_POLYGON }) {
  const address = queue.address;
  return {
    address, token,
    async send(to, micro) {
      if (!/^0x[0-9a-fA-F]{40}$/.test(to) || !(micro > 0)) throw new Error('bad payout');
      const data = '0xa9059cbb' + hex32(to) + hex32(micro);              // transfer(address,uint256)
      const r = await queue.send({ to: token, data });
      return r.transactionHash || String(r);
    },
    async balances() {
      const usdt = BigInt(await queue.rpc('eth_call', [{ to: token, data: '0x70a08231' + hex32(address) }, 'latest']));
      const pol = BigInt(await queue.rpc('eth_getBalance', [address, 'latest']));
      return { usdtMicro: Number(usdt), polWei: pol.toString() };
    },
  };
}
module.exports = makePayer; module.exports.USDT_POLYGON = USDT_POLYGON; module.exports.keccak = C.keccak;
