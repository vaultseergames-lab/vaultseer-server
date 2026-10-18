'use strict';
// Vaultseer game server. Environment: RPC_URL, ARENA, CHAIN_ID, SIGNER_KEY, PORT (optional)
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto_ = require('./crypto');
const makeCore = require('./core');
const { byId } = require('./adapters');

function createServer({ chain, signer, port = 8080, now = Date.now, restartGuardSec = 180, keepDoneMs = 48 * 3600 * 1000, verify = (id, sig) => crypto_.recoverMessage('Vaultseer match #' + id, sig) }) {
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
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, matches: core.matches.size, signer: signer.address })); return; }
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
            // The server keeps matches in memory only. If it does not know a match that started long ago it was restarted:
            // never start such a game again from scratch (a loser could get a second try). The stakes come back by themselves
            // 24 hours after the start (button "Return stakes").
            if (on.joinedAt && now() / 1000 - on.joinedAt > restartGuardSec) return send(ws, { t: 'error', err: 'this match was lost when the server restarted; use "Return stakes" 24 hours after it started' });
            if (!core.get(id)) { try { core.start(id, on.game, on.players); } catch (e) { return send(ws, { t: 'error', err: String(e.message) }); } }
            m = core.get(id);
          }
          if (!m.players.includes(addr)) return send(ws, { t: 'error', err: 'you are not in this match' });
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
  createServer({ chain, signer, port: Number(process.env.PORT || 8080) }).listen().then((p) => console.log('Vaultseer game server on :' + p + ', signer ' + signer.address));
}
