'use strict';
// Self-contained crypto for the game server (no npm packages): keccak256 + secp256k1 sign/recover.
// These exact functions signed and verified results against the real Arena bytecode in tests/online_e2e.js.
// NOTE for real money: switch to an audited library (ethers / noble) before launch; this is fine for the test network.
const M = (1n << 256n), MASK = M - 1n;
const RC = [0x0000000000000001n,0x0000000000008082n,0x800000000000808an,0x8000000080008000n,0x000000000000808bn,0x0000000080000001n,0x8000000080008081n,0x8000000000008009n,0x000000000000008an,0x0000000000000088n,0x0000000080008009n,0x000000008000000an,0x000000008000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x000000000000800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x0000000080000001n,0x8000000080008008n];
const ROT = [[0,36,3,41,18],[1,44,10,45,2],[62,6,43,15,61],[28,55,25,21,56],[27,20,39,8,14]];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & M64;
function keccakf(s) {
  for (let r = 0; r < 24; r++) {
    const C = [], D = [];
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
    for (let i = 0; i < 25; i++) s[i] ^= D[i % 5];
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y]) & M64 & B[(x + 2) % 5 + 5 * y]);
    s[0] ^= RC[r];
  }
}
function keccak(buf) {
  const rate = 136, s = new Array(25).fill(0n);
  const data = Buffer.concat([Buffer.from(buf), Buffer.alloc(rate - (buf.length % rate))]);
  data[buf.length] ^= 0x01; data[data.length - 1] ^= 0x80;
  for (let off = 0; off < data.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) s[i] ^= data.readBigUInt64LE(off + i * 8);
    keccakf(s);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(s[i], i * 8);
  return out;
}
const P = 2n**256n - 2n**32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) { let [o, r] = [m, mod(a, m)], [x0, x1] = [0n, 1n]; while (r) { const q = o / r; [o, r] = [r, o - q * r]; [x0, x1] = [x1, x0 - q * x1]; } return mod(x0, m); }
function add(p, q) {
  if (!p) return q; if (!q) return p;
  if (p[0] === q[0]) { if (mod(p[1] + q[1]) === 0n) return null; const l = mod(3n * p[0] * p[0] * inv(2n * p[1])); const x = mod(l * l - 2n * p[0]); return [x, mod(l * (p[0] - x) - p[1])]; }
  const l = mod((q[1] - p[1]) * inv(q[0] - p[0])); const x = mod(l * l - p[0] - q[0]); return [x, mod(l * (p[0] - x) - p[1])];
}
function mul(k, p = G) { let r = null, a = p; while (k > 0n) { if (k & 1n) r = add(r, a); a = add(a, a); k >>= 1n; } return r; }
const b32 = (n) => n.toString(16).padStart(64, '0');
const addrOf = (pt) => '0x' + keccak(Buffer.from(b32(pt[0]) + b32(pt[1]), 'hex')).subarray(12).toString('hex');
function sign(hashBuf, priv) {
  const z = BigInt('0x' + hashBuf.toString('hex'));
  let k = mod(BigInt('0x' + keccak(Buffer.concat([hashBuf, Buffer.from(b32(priv), 'hex')])).toString('hex')), N) || 1n;
  for (;;) {
    const R = mul(k); const r = mod(R[0], N); let s = mod(inv(k, N) * (z + r * priv), N);
    if (r && s) { let v = Number(R[1] & 1n); if (s > N / 2n) { s = N - s; v ^= 1; } return { r, s, v: 27 + v }; }
    k++;
  }
}
function recover(hashBuf, v, r, s) {
  if (r <= 0n || r >= N || s <= 0n || s >= N || (v !== 27 && v !== 28)) return null;
  const x = r; const y2 = mod(x * x * x + 7n); let y = (function pw(b, e) { let o = 1n; b = mod(b); while (e) { if (e & 1n) o = mod(o * b); b = mod(b * b); e >>= 1n; } return o; })(y2, (P + 1n) / 4n);
  if (mod(y * y) !== y2) return null;
  if ((y & 1n) !== BigInt(v - 27)) y = P - y;
  const z = BigInt('0x' + hashBuf.toString('hex')); const ri = inv(r, N);
  const Q = mul(mod(ri * s, N), [x, y]); const zg = mul(mod(-ri * z, N));
  const pub = add(Q, zg); return pub ? addrOf(pub) : null;
}

const hexOf = (n) => n.toString(16).padStart(64, '0');
const pad32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, '0'), 'hex');
const ethHash = (msg) => keccak(Buffer.concat([Buffer.from('\x19Ethereum Signed Message:\n' + msg.length), msg]));
const sigHex = (g) => '0x' + hexOf(g.r) + hexOf(g.s) + g.v.toString(16);
function addressOfKey(privHex) { return addrOf(mul(BigInt(privHex))); }
function recoverMessage(text, sig) {                 // personal_sign of a text -> signer address
  const s = sig.replace(/^0x/, ''); if (!/^[0-9a-fA-F]{130}$/.test(s)) throw new Error('bad signature');
  let v = parseInt(s.slice(128), 16); if (v < 27) v += 27;
  const a = recover(ethHash(Buffer.from(text)), v, BigInt('0x' + s.slice(0, 64)), BigInt('0x' + s.slice(64, 128)));
  if (!a) throw new Error('bad signature'); return a;
}
module.exports = { keccak, sign, recover, mul, addrOf, addressOfKey, recoverMessage, ethHash, sigHex, pad32 };
