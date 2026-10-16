'use strict';
// Signs the result exactly as Arena.sol expects:
// keccak256(abi.encode(chainid, arena, id, outcome)) wrapped as an Ethereum signed message.
const C = require('./crypto.js');
function makeSigner({ privateKey, chainId, arena }) {
  const key = BigInt(privateKey.startsWith('0x') ? privateKey : '0x' + privateKey);
  if (key <= 0n) throw new Error('bad key');
  const address = C.addrOf(C.mul(key));
  const digest = (id, outcome) => C.keccak(Buffer.concat([C.pad32(chainId), C.pad32(arena), C.pad32(id), C.pad32(outcome)]));
  const sign = async (id, outcome) => {
    const h = C.keccak(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n32'), digest(id, outcome)]));
    return C.sigHex(C.sign(h, key));
  };
  return { address, digest, sign };
}
module.exports = makeSigner;
