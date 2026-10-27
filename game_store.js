'use strict';
// Keeps the game state between restarts. Two places, the first that is configured wins:
//   UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN  (a free Redis database, survives every redeploy)
//   DATA_DIR (a folder on a persistent disk; default ./data, which a free Render instance loses on redeploy)
// The whole state is one JSON text. It is saved a moment after every change and when the server stops.
const fs = require('fs');
const path = require('path');

function fileStore(dir) {
  const file = path.join(dir, 'game.json');
  return {
    kind: 'file:' + file,
    async load() { try { return fs.readFileSync(file, 'utf8'); } catch (e) { return null; } },
    async save(text) { fs.mkdirSync(dir, { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); },
  };
}
function redisStore(url, token, key = 'vaultseer_game', fetchFn = fetch) {
  const call = async (cmd) => {
    const r = await fetchFn(url.replace(/\/+$/, ''), { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(cmd) });
    const j = await r.json(); if (j.error) throw new Error(j.error); return j.result;
  };
  return { kind: 'redis', async load() { return await call(['GET', key]); }, async save(text) { await call(['SET', key, text]); } };
}
function memoryStore() { let v = null; return { kind: 'memory', async load() { return v; }, async save(t) { v = t; } }; }

function makeStore(env = process.env, fetchFn = fetch) {
  if (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN) return redisStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN, 'vaultseer_game', fetchFn);
  return fileStore(env.DATA_DIR || path.join(process.cwd(), 'data'));
}
// wraps a store: load once, then save(state) with a short delay and never two saves at the same time
function autosave(store, getText, { delayMs = 1500, log = console.error } = {}) {
  let timer = null, busy = false, dirty = false, last = '';
  async function flush() {
    if (busy) { dirty = true; return; }
    busy = true; dirty = false;
    try { const t = getText(); if (t !== last) { await store.save(t); last = t; } } catch (e) { log('game save failed:', String(e.message || e)); dirty = true; }
    busy = false; if (dirty) schedule();
  }
  function schedule() { if (timer) return; timer = setTimeout(() => { timer = null; flush(); }, delayMs); if (timer.unref) timer.unref(); }
  return { touch: schedule, flush: async () => { if (timer) { clearTimeout(timer); timer = null; } await flush(); } };
}
module.exports = { makeStore, fileStore, redisStore, memoryStore, autosave };
