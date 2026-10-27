'use strict';
// The game service: HTTP endpoints under /game, the saved state, the clock that settles Visions and weekly exchanges,
// and the payouts. Everything outside (store, prices, payer) is passed in, so tests can use fakes.
const crypto = require('crypto');
const C = require('./crypto');
const makeGame = require('./game_core');
const { autosave } = require('./game_store');
const OWNER = '0x3ec742032f483b6bcd3c8b88a5bbf92fc62558df';

async function makeGameService({ store, prices, payer = null, now = Date.now, env = process.env, fetchFn = fetch, log = console.error, tickMs = 60000, verify = (msg, sig) => C.recoverMessage(msg, sig) }) {
  // ---- load or create the state ----
  let state = null; try { const t = await store.load(); if (t) state = JSON.parse(t); } catch (e) { log('game: could not read the saved state:', String(e.message || e)); throw e; }
  if (!state) state = makeGame.newState(now(), crypto.randomBytes(32).toString('hex'));
  const game = makeGame({ state, now });
  const saver = autosave(store, () => JSON.stringify(state), { log });
  const admins = String(env.ADMIN_ADDRESSES || OWNER).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const tgToken = env.TELEGRAM_BOT_TOKEN || '', tgBot = env.TELEGRAM_BOT_NAME || '', tgChannel = env.TELEGRAM_CHANNEL || '';
  if (tgToken && state.cfg.requireTg === false && !state.tgSet) { state.cfg.requireTg = true; state.tgSet = true; }
  const status = { lastTick: 0, ticks: 0, lastError: '', store: store.kind };

  // ---- sessions: a signed token, no table needed ----
  const sign = (a, e) => { const p = Buffer.from(JSON.stringify({ a, e })).toString('base64url'); return p + '.' + crypto.createHmac('sha256', state.secret).update(p).digest('base64url'); };
  function who(req) {
    const h = String(req.headers.authorization || ''), tok = h.startsWith('Bearer ') ? h.slice(7) : '';
    const [p, m] = tok.split('.'); if (!p || !m) return null;
    const want = crypto.createHmac('sha256', state.secret).update(p).digest('base64url');
    if (m.length !== want.length || !crypto.timingSafeEqual(Buffer.from(m), Buffer.from(want))) return null;
    try { const o = JSON.parse(Buffer.from(p, 'base64url').toString()); return o.e > now() ? o.a : null; } catch (e) { return null; }
  }
  const loginText = (ts) => 'Vaultseer game login\n' + ts;

  // ---- the clock ----
  let ticking = false;
  async function tick() {
    if (ticking) return; ticking = true;
    try {
      const t = now(); let changed = false;
      if (game.settleDue(t).length) changed = true;
      let n = 0;
      for (const v of Object.values(state.visions)) {
        if (v.status !== 'open' || v.due > t || n >= 25) continue;
        let p = null; try { p = await prices.at(v.coin, v.due); } catch (e) { p = null; }
        if (p > 0) { game.resolveVision(v.id, p, t); changed = true; n++; }
      }
      for (const s of Object.values(state.scrolls)) {
        if (s.status !== 'open' || s.due > t || n >= 25) continue;
        let a = null; try { a = await prices.allAt(s.due); } catch (e) { a = null; }
        if (a) { game.resolveScroll(s.id, a, t); changed = true; n++; }
      }
      if (payer) {
        for (const p of game.duePayouts(t)) {
          game.payoutMark(p.id, 'sending', { startedAt: t }); await saver.flush();       // saved BEFORE sending: a crash can never cause a second payment
          try { const tx = await payer.send(p.addr, p.micro); game.payoutMark(p.id, 'sent', { tx, sentAt: now() }); }
          catch (e) { game.payoutMark(p.id, 'failed', { error: String(e.message || e).slice(0, 200) }); log('payout failed:', p.id, String(e.message || e)); }
          changed = true;
        }
      }
      if (changed) saver.touch();
      status.lastTick = t; status.ticks++; status.lastError = '';
    } catch (e) { status.lastError = String(e.message || e).slice(0, 200); log('game tick:', status.lastError); }
    ticking = false;
  }
  let lastLazy = 0; const lazyTick = () => { if (now() - lastLazy > 15000) { lastLazy = now(); tick(); } };   // a sleeping server catches up as soon as someone visits
  let timer = null;

  // ---- HTTP ----
  const hits = new Map();
  const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  function limited(ip, max) { const m = Math.floor(now() / 60000), k = ip; let h = hits.get(k); if (!h || h.m !== m) { h = { m, n: 0 }; hits.set(k, h); if (hits.size > 20000) hits.clear(); } return ++h.n > max; }
  function out(res, code, obj) { res.writeHead(code, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); }
  function body(req) {
    return new Promise((resolve) => {
      let b = ''; req.on('data', (c) => { b += c; if (b.length > 4000) { req.destroy(); resolve(null); } });
      req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { resolve(null); } }); req.on('error', () => resolve(null));
    });
  }
  function verifyTelegram(d) {
    if (!tgToken || !d || typeof d !== 'object' || !d.hash) return null;
    const rows = Object.keys(d).filter((k) => k !== 'hash').sort().map((k) => k + '=' + d[k]).join('\n');
    const key = crypto.createHash('sha256').update(tgToken).digest();
    const h = crypto.createHmac('sha256', key).update(rows).digest('hex');
    if (h !== String(d.hash) || Math.abs(now() / 1000 - Number(d.auth_date)) > 86400) return null;
    return String(d.id);
  }
  async function inChannel(tgId) {
    if (!tgToken || !tgChannel) return true;
    try { const r = await fetchFn('https://api.telegram.org/bot' + tgToken + '/getChatMember?chat_id=' + encodeURIComponent(tgChannel) + '&user_id=' + tgId); const j = await r.json(); return !!(j.ok && ['member', 'administrator', 'creator'].includes(j.result.status)); } catch (e) { return false; }
  }

  async function handle(req, res, u) {
    if (req.method === 'OPTIONS') return out(res, 204, {});
    const ip = ipOf(req), path = u.pathname.replace(/^\/game/, '') || '/';
    if (limited(ip, 150)) return out(res, 429, { ok: false, err: 'too many requests' });
    lazyTick();
    try {
      if (path === '/status') return out(res, 200, { ok: true, ...status });
      if (path === '/info') { const sp = await prices.all().catch(() => null); return out(res, 200, { ok: true, ...game.info(now()), tgBot: tgToken ? tgBot : '', prices: sp }); }
      if (path === '/top') return out(res, 200, { ok: true, top: game.top(20) });
      if (path === '/auth' && req.method === 'POST') {
        if (limited('auth' + ip, 12)) return out(res, 429, { ok: false, err: 'too many attempts' });
        const b = await body(req); if (!b) return out(res, 400, { ok: false, err: 'bad request' });
        const ts = Number(b.ts), addr = String(b.addr || '').toLowerCase();
        if (!(Math.abs(now() - ts) < 10 * 60000)) return out(res, 400, { ok: false, err: 'the time on your device is off' });
        let rec; try { rec = String(verify(loginText(ts), String(b.sig))).toLowerCase(); } catch (e) { return out(res, 400, { ok: false, err: 'bad signature' }); }
        if (rec !== addr) return out(res, 400, { ok: false, err: 'bad signature' });
        const r = game.login(addr, ip, now()); if (!r.ok) return out(res, 429, r);
        saver.touch(); return out(res, 200, { ok: true, token: sign(addr, now() + 7 * 86400000) });
      }
      const me = who(req);
      if (path.startsWith('/admin')) {
        if (!me || !admins.includes(me)) return out(res, 403, { ok: false, err: 'not allowed' });
        if (path === '/admin' && req.method === 'GET') {
          let bal = null; if (payer) { try { bal = await payer.balances(); } catch (e) { bal = { error: String(e.message || e).slice(0, 100) }; } }
          return out(res, 200, { ok: true, ...game.admin(), payer: payer ? { address: payer.address, token: payer.token, ...bal } : null, store: store.kind, status, tg: !!tgToken });
        }
        const b = await body(req); if (!b) return out(res, 400, { ok: false, err: 'bad request' });
        let r;
        if (path === '/admin/pause') r = game.setPaused(b.paused);
        else if (path === '/admin/cfg') r = game.setCfg(b);
        else if (path === '/admin/payout') r = game.payoutAction(String(b.id), String(b.action));
        else return out(res, 404, { ok: false });
        saver.touch(); return out(res, 200, r);
      }
      if (!me) return out(res, 401, { ok: false, err: 'sign in first' });
      const t = now(); game.settleDue(t);
      if (path === '/me') return out(res, 200, { ok: true, me: game.me(me, t) });
      if (req.method !== 'POST') return out(res, 405, { ok: false });
      const b = await body(req); if (!b) return out(res, 400, { ok: false, err: 'bad request' });
      let r;
      if (path === '/vision') {
        const spot = await prices.spot(String(b.coin)).catch(() => null);
        r = spot > 0 ? game.vision(me, String(b.coin), Number(b.price), spot, t) : { ok: false, err: 'prices are not available right now, try again in a minute' };
      } else if (path === '/scroll') {
        const sp = await prices.all().catch(() => null); r = game.scroll(me, b.answers, sp, t);
      } else if (path === '/claim') {
        const kind = String(b.kind);
        if (kind === 'tg') { const u2 = state.users[me]; if (u2 && u2.tg && !(await inChannel(u2.tg))) return out(res, 200, { ok: false, err: 'join the Telegram channel first' }); }
        r = game.claim(me, kind, t);
      } else if (path === '/telegram') {
        const id = verifyTelegram(b.auth); r = id ? game.bindTelegram(me, id, t) : { ok: false, err: 'Telegram check failed' };
      } else if (path === '/gift') r = game.setGift(me, String(b.coin), t);
      else if (path === '/exchange') r = game.exchange(me, Number(b.amount), t);
      else return out(res, 404, { ok: false });
      if (r.ok) saver.touch();
      return out(res, 200, { ...r, me: game.me(me, t) });
    } catch (e) { log('game error:', e); return out(res, 500, { ok: false, err: 'server error' }); }
  }

  return {
    game, state, handle, tick, status, saver,
    start() { if (!timer) { timer = setInterval(tick, tickMs); if (timer.unref) timer.unref(); tick(); } },
    async stop() { if (timer) clearInterval(timer); timer = null; await saver.flush(); },
    summary: () => ({ ...status, players: Object.keys(state.users).length, paused: state.paused, payer: payer ? payer.address : null }),
  };
}
module.exports = makeGameService;
