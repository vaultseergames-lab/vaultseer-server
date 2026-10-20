'use strict';
// Reads the Arena contract over plain JSON-RPC: who sits at table #id and is it active.
const C = require('./crypto.js');
const GAME_IDS = ['chess', 'checkers', 'backgammon', 'poker', 'durak', 'battleship', 'domino', 'gin', 'sixtysix', 'scopa', 'penalty', 'memory', 'bridge', 'slots', 'roulette', 'connect4', 'reversi', 'ludo', 'liars', 'gomoku', 'hex', 'breakthrough', 'mancala', 'ultimate', 'dots', 'go', 'amazons', 'lines', 'santorini', 'draughts', 'xiangqi', 'chinese', 'blokus', 'quoridor', 'tron'];
const SEL = C.keccak(Buffer.from('getMatch(uint256)')).subarray(0, 4).toString('hex');
const SETTLED = '0x' + C.keccak(Buffer.from('MatchSettled(uint256,uint16,uint256,uint256)')).toString('hex');
function makeChain({ rpcUrl, arena, fetchFn = fetch }) {
  const rpc = async (method, params) => {
    const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json(); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result;
  };
  return {
    async blockNumber() { return Number(BigInt(await rpc('eth_blockNumber', []))); },
    // settled matches in a block range, oldest first: [{ id, mask, block, index }]
    async getSettled(from, to) {
      const logs = await rpc('eth_getLogs', [{ address: arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [SETTLED] }]);
      return logs.filter((l) => !l.removed).map((l) => ({ id: BigInt(l.topics[1]).toString(), mask: Number(BigInt('0x' + String(l.data).replace(/^0x/, '').slice(0, 64))), block: Number(BigInt(l.blockNumber)), index: Number(BigInt(l.logIndex || 0)) }))
        .sort((a, b) => a.block - b.block || a.index - b.index);
    },
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
      return { players, game: GAME_IDS[Number(BigInt('0x' + w(3)))], seats: Number(BigInt('0x' + w(4))), status: Number(BigInt('0x' + w(5))), joinedAt: Number(BigInt('0x' + w(6))), stake: BigInt('0x' + w(1)) };
    },
  };
}
module.exports = makeChain; module.exports.GAME_IDS = GAME_IDS;
