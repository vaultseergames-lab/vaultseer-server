'use strict';
// Vaultseer game server. Environment: RPC_URL, ARENA, CHAIN_ID, SIGNER_KEY, PORT (optional)
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto_ = require('./crypto');
const makeCore = require('./core');
const { byId } = require('./adapters');
const { BIG_STAKE } = require('./age');

function createServer({ chain, signer, port = 8080, now = Date.now, restartGuardSec = 180, keepDoneMs = 48 * 3600 * 1000, verify = (id, sig) => crypto_.recoverMessage('Vaultseer match #' + id, sig), age = null, ratings = null, gas = null, keeper = null, events = null, game = null }) {
  const bigStake = new Map();                           // match id -> true when the stake needs the age confirmation
  const core = makeCore({ now, sign: signer.sign });
  const conns = new Map();
  // --- abuse protection ---
  const MAX_CONNS = 3000, MSGS_PER_10S = 60, HELLOS_PER_CONN = 6, HELLOS_PER_SEC = 40;
  let helloWin = 0, helloCnt = 0;                       // global budget for signature checks (they cost CPU)
  const helloBudget = () => { const w = Math.floor(now() / 1000); if (w !== helloWin) { helloWin = w; helloCnt = 0; } return ++helloCnt <= HELLOS_PER_SEC; };
  const bad = new Map();                                // match id -> { until, err }: ids that are not playable, remembered a few seconds
  const badGet = (id) => { const b = bad.get(id); if (b && b.until > now()) return b.err; bad.delete(id); return null; };
  const badSet = (id, err) => { if (bad.size > 5000) bad.clear(); bad.set(id, { until: now() + 5000, err }); return err; };                               // match id -> Set of {ws, addr}
  const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const push = (id) => { for (const c of conns.get(id) || []) send(c.ws, { t: 'state', ...core.view(id, c.addr) }); };

  const server = http.createServer((req, res) => {
    // public player table, read by the website
    const u = new URL(req.url, 'http://x'), cors = { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=10', 'content-type': 'application/json' };
    let mm;
    if (game && u.pathname.startsWith('/game')) { game.handle(req, res, u); return; }
    if (ratings && (mm = /^\/profile\/(0x[0-9a-fA-F]{40})$/.exec(u.pathname))) { res.writeHead(200, cors); res.end(JSON.stringify({ addr: mm[1].toLowerCase(), ...ratings.profile(mm[1]) })); return; }
    if (ratings && u.pathname === '/top') { res.writeHead(200, cors); res.end(JSON.stringify(ratings.top(Number(u.searchParams.get('n')) || 20))); return; }
    if (gas && u.pathname === '/gas') {
      const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'content-type': 'application/json' };
      if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return; }
      if (req.method !== 'POST') { res.writeHead(405, h); res.end(); return; }
      let body = ''; req.on('data', (c) => { body += c; if (body.length > 400) req.destroy(); });
      req.on('end', async () => {
        let a = ''; try { a = JSON.parse(body).addr; } catch (e) { /* bad body */ }
        const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
        let r; try { r = await gas.drip(a, ip); } catch (e) { r = { ok: false, err: 'error' }; }
        res.writeHead(200, h); res.end(JSON.stringify(r));
      });
      return;
    }
    if (req.url === '/events') { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=20' }); res.end(JSON.stringify({ meta: events && events.meta ? events.meta() : {} })); return; }
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, matches: core.matches.size, signer: signer.address, ratings: ratings ? ratings.status() : null, keeper: keeper ? keeper.status() : null, events: events ? events.status() : null, gas: gas ? gas.status() : null, game: game ? game.summary() : null })); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  wss.on('connection', (ws) => {
    if (wss.clients.size > MAX_CONNS) { ws.close(1013, 'busy'); return; }
    ws.on('error', () => {});                            // e.g. an oversized frame: without a handler Node would crash the whole server
    let me = null;                                       // { id, addr }
    let winStart = now(), winCnt = 0, hellos = 0;
    ws.on('message', async (raw) => {
      if (now() - winStart > 10000) { winStart = now(); winCnt = 0; }
      if (++winCnt > MSGS_PER_10S) { ws.close(1008, 'too many messages'); return; }
      let msg; try { msg = JSON.parse(String(raw)); } catch (e) { return send(ws, { t: 'error', err: 'bad message' }); }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send(ws, { t: 'error', err: 'bad message' });
      try {
        if (msg.t === 'hello') {
          const id = String(msg.id); if (!/^\d{1,18}$/.test(id)) return send(ws, { t: 'error', err: 'bad id' });
          if (++hellos > HELLOS_PER_CONN) { ws.close(1008, 'too many hellos'); return; }
          if (!helloBudget()) return send(ws, { t: 'error', err: 'server is busy, try again in a moment' });
          let addr; try { addr = verify(id, msg.sig).toLowerCase(); } catch (e) { return send(ws, { t: 'error', err: 'bad signature' }); }
          let m = core.get(id);
          if (!m) {
            const cached = badGet(id); if (cached) return send(ws, { t: 'error', err: cached });
            const on = await chain.getMatch(BigInt(id));
            if (on.status !== 2) return send(ws, { t: 'error', err: badSet(id, 'match is not active on the contract') });
            if (!byId[on.game]) return send(ws, { t: 'error', err: 'this game is not available on the server yet' });
            bigStake.set(id, typeof on.stake === 'bigint' && on.stake > BIG_STAKE);
            if (bigStake.get(id) && !(age && age.check(addr, msg.age))) return send(ws, { t: 'error', err: 'age verification required' });
            // The server keeps matches in memory only. If it does not know a match that started long ago it was restarted:
            // never start such a game again from scratch (a loser could get a second try). The stakes come back by themselves
            // 24 hours after the start (button "Return stakes").
            if (on.joinedAt && now() / 1000 - on.joinedAt > restartGuardSec) return send(ws, { t: 'error', err: 'this match was lost when the server restarted; use "Return stakes" 24 hours after it started' });
            if (!core.get(id)) { try { core.start(id, on.game, on.players); } catch (e) { return send(ws, { t: 'error', err: String(e.message) }); } }
            m = core.get(id);
          }
          if (!m.players.includes(addr)) return send(ws, { t: 'error', err: 'you are not in this match' });
          if (bigStake.get(id) && !(age && age.check(addr, msg.age))) return send(ws, { t: 'error', err: 'age verification required' });
          me = { id, addr };
          if (!conns.has(id)) conns.set(id, new Set());
          conns.get(id).add({ ws, addr });
          return send(ws, { t: 'state', ...core.view(id, addr) });
        }
        if (!me) return send(ws, { t: 'error', err: 'say hello first' });
        if (msg.t === 'move') { const r = await core.move(me.id, me.addr, msg.mv); if (!r.ok) send(ws, { t: 'error', err: r.err }); push(me.id); }
        else if (msg.t === 'leave') { await core.leave(me.id, me.addr); push(me.id); }
        else if (msg.t === 'sync') send(ws, { t: 'state', ...core.view(me.id, me.addr) });
      } catch (e) { send(ws, { t: 'error', err: 'server error' }); console.error(e); }
    });
    ws.on('close', () => { if (me) for (const c of conns.get(me.id) || []) if (c.ws === ws) conns.get(me.id).delete(c); });
  });

  const timer = setInterval(async () => { for (const id of await core.tick()) push(id); }, 1000);
  const cleaner = setInterval(() => { core.purge(keepDoneMs); for (const [id, set] of conns) if (!core.get(id) || set.size === 0) conns.delete(id); }, 60000);
  return { core, server, wss, listen: () => new Promise((r) => server.listen(port, () => r(server.address().port))), close: () => { clearInterval(timer); clearInterval(cleaner); wss.close(); server.close(); } };
}

module.exports = createServer;
if (require.main === module) {
  // one bad request must never take every running match down
  process.on('uncaughtException', (e) => console.error('uncaught', e));
  process.on('unhandledRejection', (e) => console.error('unhandled', e));
  const need = (k) => { if (!process.env[k]) { console.error('Missing ' + k); process.exit(1); } return process.env[k]; };
  const arena = need('ARENA'), chainId = BigInt(need('CHAIN_ID'));
  const signer = require('./signer')({ privateKey: need('SIGNER_KEY'), chainId, arena });
  const chain = require('./chain')({ rpcUrl: need('RPC_URL'), arena });
  const ratings = require('./ratings')({ chain, fromBlock: process.env.ARENA_BLOCK ? Number(process.env.ARENA_BLOCK) : undefined }); ratings.start();
  // optional gas drip: needs GAS_KEY (a separate small wallet) and GAS_TOKENS (comma list of stake token addresses)
  const queue = process.env.GAS_KEY ? require('./txq')({ rpcUrl: process.env.RPC_URL, privateKey: process.env.GAS_KEY, chainId }) : null;   // one line for every transaction of the service wallet
  const gas = process.env.GAS_KEY ? require('./gas')({ queue, rpcUrl: process.env.RPC_URL, privateKey: process.env.GAS_KEY, chainId, tokens: String(process.env.GAS_TOKENS || '').split(',').map((x) => x.trim()).filter(Boolean),
    dripWei: process.env.GAS_DRIP_WEI || (chainId === 137n ? '200000000000000000' : '1000000000000000'),
    reserveWei: process.env.VAULT ? (process.env.GAS_RESERVE_WEI || (chainId === 137n ? '2000000000000000000' : '0')) : 0 }) : null;
  // the service wallet (GAS_KEY) pays for the gas drip and for the keeper; both go through the one queue above
  const keeper = queue && process.env.VAULT ? require('./keeper_service')({ queue, vault: process.env.VAULT }) : null;
  if (keeper) keeper.start();
  // optional: the Events feature (VaultseerPass). Off unless EVENTS is set; the service wallet must be the operator of that contract.
  const evProviders = process.env.EVENTS ? require('./events_service').providersFromEnv() : [];
  const events = queue && process.env.EVENTS && evProviders.length ? require('./events_service')({ queue, contract: process.env.EVENTS, providers: evProviders }) : null;
  if (events) events.start();
  // optional: the School of the Seer game (Seevar, Visions, weekly exchange). Off only if GAME_OFF is set. Prize payouts need PAYOUT_KEY (a separate wallet that holds only the prize money).
  const startGame = async () => {
    if (process.env.GAME_OFF) return null;
    const payQueue = process.env.PAYOUT_KEY ? require('./txq')({ rpcUrl: process.env.RPC_URL, privateKey: process.env.PAYOUT_KEY, chainId }) : null;
    const payer = payQueue ? require('./game_payer')({ queue: payQueue, token: process.env.PAYOUT_TOKEN || undefined }) : null;
    const g = await require('./game_service')({ store: require('./game_store').makeStore(), prices: require('./game_prices')(), payer });
    g.start();
    const bye = async () => { try { await g.stop(); } finally { process.exit(0); } };
    process.on('SIGTERM', bye); process.on('SIGINT', bye);
    return g;
  };
  startGame().catch((e) => { console.error('game failed to start:', e); return null; }).then((game) => createServer({ chain, signer, port: Number(process.env.PORT || 8080), age: require('./age')({ attester: process.env.AGE_ATTESTER }), ratings, gas, keeper, events, game }).listen()).then((p) => console.log('Vaultseer game server on :' + p + ', signer ' + signer.address));
}
