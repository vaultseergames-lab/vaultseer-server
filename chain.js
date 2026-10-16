'use strict';
// Reads the Arena contract over plain JSON-RPC: who sits at table #id and is it active.
const C = require('./crypto.js');
const GAME_IDS = ['chess', 'checkers', 'backgammon', 'poker', 'durak', 'battleship', 'domino', 'gin', 'sixtysix', 'scopa', 'penalty', 'memory', 'bridge'];
const SEL = C.keccak(Buffer.from('getMatch(uint256)')).subarray(0, 4).toString('hex');
function makeChain({ rpcUrl, arena, fetchFn = fetch }) {
  return {
    async getMatch(id) {
      const data = '0x' + SEL + BigInt(id).toString(16).padStart(64, '0');
      const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: arena, data }, 'latest'] }) });
      const j = await res.json(); if (j.error) throw new Error(j.error.message || 'rpc error');
      const h = String(j.result).replace(/^0x/, ''); if (h.length < 64 * 9) throw new Error('bad reply');
      const w = (i) => h.slice(i * 64, i * 64 + 64);
      // getMatch returns (token, stake, feeBps, game, seats, status, joinedAt, players[])
      const off = Number(BigInt('0x' + w(7))) / 32, cnt = Number(BigInt('0x' + w(off)));
      if (cnt > 9 || h.length < 64 * (off + 1 + cnt)) throw new Error('bad reply');
      const players = []; for (let i = 0; i < cnt; i++) players.push('0x' + w(off + 1 + i).slice(24));
      return { players, game: GAME_IDS[Number(BigInt('0x' + w(3)))], seats: Number(BigInt('0x' + w(4))), status: Number(BigInt('0x' + w(5))), stake: BigInt('0x' + w(1)) };
    },
  };
}
module.exports = makeChain; module.exports.GAME_IDS = GAME_IDS;
