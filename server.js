'use strict';
// Vaultseer game server. Environment: RPC_URL, ARENA, CHAIN_ID, SIGNER_KEY, PORT (optional)
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto_ = require('./crypto');
const makeCore = require('./core');
const { byId } = require('./adapters');

function createServer({ chain, signer, port = 8080, now = Date.now, verify = (id, sig) => crypto_.recoverMessage('Vaultseer match #' + id, sig) }) {
  const core = makeCore({ now, sign: signer.sign });
  const conns = new Map();                               // match id -> Set of {ws, addr}
  const send = (ws, o) => { if (ws.readyState === 1) ws.send(JSON.stringify(o)); };
  const push = (id) => { for (const c of conns.get(id) || []) send(c.ws, { t: 'state', ...core.view(id, c.addr) }); };

  const server = http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, matches: core.matches.size, signer: signer.address })); return; }
    res.writeHead(404); res.end();
  });
  const wss = new WebSocketServer({ server, maxPayload: 4096 });

  wss.on('connection', (ws) => {
    let me = null;                                       // { id, addr }
    ws.on('message', async (raw) => {
      let msg; try { msg = JSON.parse(String(raw)); } catch (e) { return send(ws, { t: 'error', err: 'bad message' }); }
      try {
        if (msg.t === 'hello') {
          const id = String(msg.id); if (!/^\d{1,18}$/.test(id)) return send(ws, { t: 'error', err: 'bad id' });
          let addr; try { addr = verify(id, msg.sig).toLowerCase(); } catch (e) { return send(ws, { t: 'error', err: 'bad signature' }); }
          let m = core.get(id);
          if (!m) {
            const on = await chain.getMatch(BigInt(id));
            if (on.status !== 2) return send(ws, { t: 'error', err: 'match is not active on the contract' });
            if (!byId[on.game]) return send(ws, { t: 'error', err: 'this game is not available on the server yet' });
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
  return { core, server, wss, listen: () => new Promise((r) => server.listen(port, () => r(server.address().port))), close: () => { clearInterval(timer); wss.close(); server.close(); } };
}

module.exports = createServer;
if (require.main === module) {
  const need = (k) => { if (!process.env[k]) { console.error('Missing ' + k); process.exit(1); } return process.env[k]; };
  const arena = need('ARENA'), chainId = BigInt(need('CHAIN_ID'));
  const signer = require('./signer')({ privateKey: need('SIGNER_KEY'), chainId, arena });
  const chain = require('./chain')({ rpcUrl: need('RPC_URL'), arena });
  createServer({ chain, signer, port: Number(process.env.PORT || 8080) }).listen().then((p) => console.log('Vaultseer game server on :' + p + ', signer ' + signer.address));
}
