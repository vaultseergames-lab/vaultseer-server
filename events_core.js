'use strict';
// Keeper of the "Events" feature (VaultseerPass contract). Every run does only what is due now, so a restart or a second copy can do no harm.
// It creates events from the match schedule, closes them at kickoff, posts the real result (after a confirmation delay),
// ranks the forecasts, finalizes and pays the winners. It never touches the Arena or the Vault.
//
// providers: [{ sport, kind, bps, list(fromSec, toSec) -> [{ id, league, home, away, kickoff }], result(fixture) -> { final: bool, value: int } | null }]
const ST = { None: 0, Open: 1, Locked: 2, Resulted: 3, Finalized: 4, Cancelled: 5 };
const pad = (h) => ('0'.repeat(64) + h).slice(-64);
const wNum = (n) => pad((BigInt(n) < 0n ? (1n << 256n) + BigInt(n) : BigInt(n)).toString(16));
const wAddr = (a) => pad(a.toLowerCase().replace('0x', ''));
const words = (h) => { h = String(h).slice(2); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(h.slice(i, i + 64)); return o; };
const big = (w) => BigInt('0x' + w);
const signed64 = (w) => BigInt.asIntN(64, big(w));
const clean = (s) => String(s || '').replace(/[|\r\n\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);

module.exports = function makeEventsKeeper({ io, contract, keccakHex, providers, log = console.log, opts = {} }) {
  const O = Object.assign({
    aheadSec: 3 * 86400,        // create events for matches starting within this time
    minLeadSec: 30 * 60,        // ...but not less than this before kickoff
    maxPerRun: 8,               // new events per run
    maxOpenBps: 3000,           // total share of the fund promised to events that are not yet locked
    confirmSec: 20 * 60,        // the result must stay the same this long before it is posted
    pageSize: 150, claimBatch: 60,
    lookBackSec: 4 * 86400
  }, opts);
  const sel = (sig) => keccakHex(Buffer.from(sig)).slice(0, 8);
  const S = {
    eventCount: sel('eventCount()'), getEvent: sel('getEvent(uint256)'), createEvent: sel('createEvent(uint64,uint16,bytes32,string)'),
    closeEvent: sel('closeEvent(uint256)'), postResult: sel('postResult(uint256,int64)'), submitClaims: sel('submitClaims(uint256,address[])'),
    finalize: sel('finalize(uint256)'), claimPrize: sel('claimPrize(uint256,address)'), expireEvent: sel('expireEvent(uint256)'),
    playerCount: sel('playerCount(uint256)'), playersPage: sel('playersPage(uint256,uint256,uint256)'), forecastOf: sel('forecastOf(uint256,address)'),
    sendTreasury: sel('sendTreasury()'), treasuryDue: sel('treasuryDue()'), paused: sel('paused()'), resultTimeout: sel('resultTimeout()'),
    disputeWindow: sel('disputeWindow()'), claimWindow: sel('claimWindow()'), solvent: sel('solvent()')
  };
  const call = async (sig, args = []) => words(await io.call(contract, '0x' + S[sig] + args.join('')));
  const refOf = (sport, id) => '0x' + keccakHex(Buffer.from('vaultseer-event|' + sport + '|' + id));

  const cache = new Map();           // id -> { ref, closed: bool } for events we already know about
  const refToId = new Map();         // ref -> id
  const seen = new Map();            // id -> { value, since } result candidates waiting for confirmation
  const st = { runs: 0, errors: [], lastActions: [], known: 0, providerErrors: {} };

  async function readEvent(id) {
    const w = await call('getEvent', [wNum(id)]);
    return { id, close: Number(big(w[0])), resultAt: Number(big(w[1])), bps: Number(big(w[2])), status: Number(big(w[3])), result: signed64(w[4]),
      forecasters: Number(big(w[5])), counted: Number(big(w[6])), winners: Number(big(w[7])), prize: big(w[8]), share: big(w[9]), best: big(w[10]), ref: '0x' + w[11] };
  }
  async function players(id) {
    const n = Number(big((await call('playerCount', [wNum(id)]))[0])), out = [];
    for (let from = 0; from < n; from += O.pageSize) {
      const w = await call('playersPage', [wNum(id), wNum(from), wNum(O.pageSize)]);
      const len = Number(big(w[1])); for (let i = 0; i < len; i++) out.push('0x' + w[2 + i].slice(24));
    }
    return out;
  }

  return async function run() {
    const now = await io.now();
    const actions = [], errors = [];
    const act = async (name, data) => { log('events ->', name); await io.send(contract, data); actions.push(name); };
    const guard = async (name, fn) => { try { await fn(); } catch (e) { errors.push(name + ': ' + String(e.message || e).slice(0, 160)); } };

    // 1. everything the contract already holds
    const count = Number(big((await call('eventCount'))[0]));
    const evs = [];
    for (let id = 1; id <= count; id++) {
      let c = cache.get(id), e = null;
      if (c && c.done) continue;
      e = await readEvent(id);
      cache.set(id, { ref: e.ref, done: (e.status === ST.Finalized && e.winners === 0) || e.status === ST.Cancelled });
      refToId.set(e.ref, id);
      evs.push(e);
    }
    st.known = count;
    const paused = big((await call('paused'))[0]) !== 0n;
    const dispute = Number(big((await call('disputeWindow'))[0])), claimW = Number(big((await call('claimWindow'))[0]));

    // 2. fixtures from every provider (one failing provider never stops the others)
    const fixtures = [];   // { sport, kind, bps, fx, ref }
    for (const p of providers) {
      await guard('provider ' + p.sport, async () => {
        const list = await p.list(now - O.lookBackSec, now + O.aheadSec);
        st.providerErrors[p.sport] = null;
        for (const fx of list) fixtures.push({ p, fx, ref: refOf(p.sport, fx.id) });
      });
      const last = errors.find((x) => x.startsWith('provider ' + p.sport)); if (last) st.providerErrors[p.sport] = last;
    }
    const byRef = new Map(fixtures.map((f) => [f.ref, f]));

    // 3. create events for matches that start soon
    if (!paused) {
      let openBps = evs.filter((e) => e.status === ST.Open).reduce((a, e) => a + e.bps, 0);
      let made = 0;
      for (const f of fixtures.sort((a, b) => a.fx.kickoff - b.fx.kickoff)) {
        if (made >= O.maxPerRun) break;
        if (refToId.has(f.ref)) continue;
        const k = Number(f.fx.kickoff);
        if (!(k >= now + O.minLeadSec && k <= now + O.aheadSec)) continue;
        if (openBps + f.p.bps > O.maxOpenBps) continue;
        const meta = [clean(f.p.sport), clean(f.fx.league), clean(f.fx.home), clean(f.fx.away), String(k), clean(f.p.kind)].join('|');
        if (!f.fx.home || !f.fx.away) continue;
        await guard('create ' + f.fx.id, async () => {
          const data = '0x' + S.createEvent + wNum(k) + wNum(f.p.bps) + pad(f.ref.slice(2)) + wNum(128) + wNum(Buffer.byteLength(meta)) +
            Buffer.from(meta).toString('hex').padEnd(Math.ceil(Buffer.byteLength(meta) / 32) * 64, '0');
          await act('create ' + f.p.sport + ' ' + f.fx.id, data);
          openBps += f.p.bps; made++;
        });
      }
      if (made) { // learn the new ids right away
        const n2 = Number(big((await call('eventCount'))[0]));
        for (let id = count + 1; id <= n2; id++) { const e = await readEvent(id); cache.set(id, { ref: e.ref, done: false }); refToId.set(e.ref, id); evs.push(e); }
        st.known = n2;
      }
    }

    // 4. move every event along
    for (const e of evs) {
      await guard('event ' + e.id, async () => {
        if (e.status === ST.Open && now >= e.close) { await act('close ' + e.id, '0x' + S.closeEvent + wNum(e.id)); Object.assign(e, await readEvent(e.id)); }
        if (e.status === ST.Locked) {
          const f = byRef.get(e.ref);
          if (now > e.close + 7 * 86400 + 60 && !f) { await act('expire ' + e.id, '0x' + S.expireEvent + wNum(e.id)); return; }
          if (!f) return;
          if (now < Number(f.fx.kickoff) + (f.p.minMinutes || 0) * 60) return;   // far too early for a finished match
          const r = await f.p.result(f.fx);
          if (!r || !r.final || !Number.isSafeInteger(r.value) || Math.abs(r.value) > 10000) { seen.delete(e.id); return; }
          const s = seen.get(e.id);
          if (!s || s.value !== r.value) { seen.set(e.id, { value: r.value, since: now }); return; }
          if (now - s.since < O.confirmSec) return;
          await act('result ' + e.id + ' = ' + r.value, '0x' + S.postResult + wNum(e.id) + wNum(r.value));
          seen.delete(e.id);
          Object.assign(e, await readEvent(e.id));
        }
        if (e.status === ST.Resulted) {
          const start = e.resultAt + dispute;
          if (now >= start && now <= start + claimW && e.counted < e.forecasters) {
            const all = await players(e.id);
            const todo = [];
            for (const a of all) {
              const w = words(await io.call(contract, '0x' + S.forecastOf + wNum(e.id) + wAddr(a)));
              if (big(w[1]) !== 0n && big(w[2]) === 0n) todo.push(a);
            }
            for (let i = 0; i < todo.length; i += O.claimBatch) {
              const part = todo.slice(i, i + O.claimBatch);
              await act('rank ' + e.id + ' x' + part.length, '0x' + S.submitClaims + wNum(e.id) + wNum(64) + wNum(part.length) + part.map(wAddr).join(''));
            }
          }
          if (now > start + claimW) { await act('finalize ' + e.id, '0x' + S.finalize + wNum(e.id)); Object.assign(e, await readEvent(e.id)); }
        }
        if (e.status === ST.Finalized && e.winners > 0) {
          const all = await players(e.id);
          let left = 0, paid = 0;
          for (const a of all) {
            const w = words(await io.call(contract, '0x' + S.forecastOf + wNum(e.id) + wAddr(a)));
            const value = BigInt.asIntN(64, big(w[0])), counted = big(w[2]) !== 0n, claimed = big(w[3]) !== 0n;
            const d = value > e.result ? value - e.result : e.result - value;
            if (counted && claimed && BigInt(d) === e.best) paid++;
            if (counted && !claimed && BigInt(d) === e.best) {
              try { await act('pay ' + e.id + ' ' + a, '0x' + S.claimPrize + wNum(e.id) + wAddr(a)); paid++; } catch (err) { left++; errors.push('pay ' + e.id + ': ' + String(err.message).slice(0, 100)); }
            }
          }
          if (!left && paid >= e.winners) cache.set(e.id, { ref: e.ref, done: true });
        }
      });
    }

    // 5. the platform share goes to the treasury
    await guard('treasury', async () => {
      const due = big((await call('treasuryDue'))[0]);
      if (due >= 5_000_000n) await act('sendTreasury', '0x' + S.sendTreasury);
    });

    actions.errors = errors;
    st.runs++; st.errors = errors; st.lastActions = actions.slice();
    return actions;
  };
};
module.exports.ST = ST;
