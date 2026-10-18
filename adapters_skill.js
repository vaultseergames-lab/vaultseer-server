'use strict';
// One generic adapter for all "skill games" (VG.sk). Every move is public, so the view is the whole state;
// the legal-move list is left to the client (it uses the same engine). The server accepts a move only if the
// engine itself lists it as legal. If a player runs out of time, the server plays the weak computer move for him.
const crypto = require('crypto');
const VG = require('./games1.js');
require('./games7.js'); require('./games8.js'); require('./games9.js'); require('./games10.js');
const SK = VG.sk;
const SEATS = 'abcdefghi';
const rnd = () => crypto.randomBytes(4).readUInt32BE(0);
const PER_MOVE = { gomoku: 45000, hex: 60000, breakthrough: 45000, mancala: 30000, ultimate: 45000, dots: 30000 };

function make(id) {
  const E = SK.games[id];
  return {
    id, seats: E.seats || [2, 2], clock: { total: 0, perMove: E.perMove || PER_MOVE[id] || 45000 }, skill: true,
    init: (n) => E.init(n, rnd() % n),
    actors: (st) => (st.over ? [] : [SEATS[st.turn]]),
    find: (st, mv) => (st.over ? null : E.find(st, mv)),
    apply(st, m) { E.apply(st, m); return st; },
    result: (st) => SK.mask(st),
    auto: (st) => E.bot(st, 0, VG.rng(rnd())),
    view: (st) => { const v = SK.clone(st); v.turnSeat = SEATS[st.turn]; return v; },
    legal: () => [],
  };
}
const list = SK.list.map(make);
module.exports = { list, make };
