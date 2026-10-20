'use strict';
// Age confirmation for big stakes. A trusted "attester" key (the verification service, or the owner by hand through age.html)
// signs the text below for a wallet address once that person has proven they are an adult. The server only checks the signature,
// so nothing has to be stored: the player keeps the code and sends it with every hello.
const C = require('./crypto');
const BIG_STAKE = 100n * 1000000n;                      // stakes above $100 (6-decimal tokens) need it
const message = (addr) => 'Vaultseer age 18+ ok: ' + String(addr).toLowerCase();
function makeAge({ attester }) {
  const want = attester ? String(attester).toLowerCase() : '';
  return {
    message,
    check(addr, code) {
      if (!want || typeof code !== 'string' || code.length > 140) return false;
      try { return String(C.recoverMessage(message(addr), code)).toLowerCase() === want; } catch (e) { return false; }
    },
  };
}
module.exports = makeAge; module.exports.BIG_STAKE = BIG_STAKE; module.exports.message = message;
