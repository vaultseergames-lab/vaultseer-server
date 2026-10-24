'use strict';
// Data providers for the Events keeper. Each one is strict: anything it does not fully understand is "no data",
// never a guess (an event without a result is simply cancelled after a week and the prize goes back to the fund).
// Free-plan protection: answers are cached and every sport has a daily request cap.
const dayStr = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const isInt = (x) => Number.isInteger(x) && x >= 0 && x < 1000;
const txt = (x) => (typeof x === 'string' && x.trim() ? x.trim() : null);

function makeHttp({ fetchFn = fetch, now = () => Date.now(), dailyCap = 90 }) {
  const cache = new Map(); let day = '', used = 0;
  return async function get(url, headers, ttlMs) {
    const t = now(), c = cache.get(url);
    if (c && t - c.t < ttlMs) return c.v;
    const d = new Date(t).toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; }
    if (used >= dailyCap) { if (c) return c.v; throw new Error('daily request cap reached'); }
    used++;
    const r = await fetchFn(url, { headers });
    if (!r.ok) { if (c) return c.v; let b = ''; try { b = String(await r.text()).replace(/\s+/g, ' ').slice(0, 110); } catch (e) { /* no body */ } throw new Error('http ' + r.status + (b ? ' ' + b : '')); }
    const v = await r.json(); cache.set(url, { t, v }); return v;
  };
}

// football-data.org (v4): one request covers all competitions of the plan for a date range
function footballData({ key, fetchFn, now = () => Date.now(), base = 'https://api.football-data.org/v4', bps = 400 }) {
  const get = makeHttp({ fetchFn, now, dailyCap: 400 });
  const H = { 'X-Auth-Token': key };
  const known = new Map();
  async function list(from, to) {
    const j = await get(base + '/matches?dateFrom=' + dayStr(from) + '&dateTo=' + dayStr(to + 86400), H, 30 * 60 * 1000);
    if (!j || !Array.isArray(j.matches)) throw new Error('unexpected answer');
    const out = [];
    for (const m of j.matches) {
      const id = m && Number.isInteger(m.id) ? String(m.id) : null, home = txt(m.homeTeam && (m.homeTeam.shortName || m.homeTeam.name)), away = txt(m.awayTeam && (m.awayTeam.shortName || m.awayTeam.name));
      const k = Math.floor(Date.parse(m.utcDate) / 1000), league = txt(m.competition && m.competition.name);
      if (!id || !home || !away || !league || !Number.isFinite(k)) continue;
      const fx = { id, league, home, away, kickoff: k, raw: m }; known.set(id, fx); out.push(fx);
    }
    return out;
  }
  async function result(fx) {
    const m = fx.raw; if (!m) return null;
    const j = await get(base + '/matches/' + fx.id, H, 8 * 60 * 1000);
    const x = j && j.id !== undefined ? j : (j && j.match);
    if (!x || String(x.id) !== String(fx.id) || x.status !== 'FINISHED' || !x.score) return { final: false };
    // regular time only: if the match went to extra time use the regular-time score, and if it is missing give no answer
    const s = x.score, r = s.duration === 'REGULAR' ? s.fullTime : s.regularTime;
    if (!r || !isInt(r.home) || !isInt(r.away)) return null;
    return { final: true, value: r.home - r.away };
  }
  return { sport: 'football', kind: 'gd', bps, list, result, minMinutes: 105 };
}

// API-Sports (basketball / american-football / hockey share one shape): one request per date
function apiSports({ sport, host, key, league, season, finals, fetchFn, now = () => Date.now(), bps, kind = 'pd', dailyCap = 90 }) {
  const get = makeHttp({ fetchFn, now, dailyCap });
  const H = { 'x-apisports-key': key };
  async function day(sec, ttl) {
    const q = '/games?date=' + dayStr(sec) + '&league=' + league + (season ? '&season=' + season : '');
    const j = await get('https://' + host + q, H, ttl);
    if (!j || !Array.isArray(j.response)) throw new Error('unexpected answer');
    return j.response;
  }
  const pick = (g) => {
    const gg = g && g.game ? Object.assign({}, g, g.game) : g;   // american-football nests the game
    const id = gg && (Number.isInteger(gg.id) ? String(gg.id) : null);
    const ts = gg && (Number.isFinite(gg.timestamp) ? gg.timestamp : (gg.date && Number.isFinite(gg.date.timestamp) ? gg.date.timestamp : null));
    const home = txt(g.teams && g.teams.home && g.teams.home.name), away = txt(g.teams && g.teams.away && g.teams.away.name);
    const lg = txt(g.league && g.league.name) || sport.toUpperCase();
    if (!id || !ts || !home || !away) return null;
    return { id, league: lg, home, away, kickoff: ts, raw: g };
  };
  async function list(from, to) {
    const now0 = Math.floor(now() / 1000), out = [], seen = new Set();
    for (let t = from; t <= to + 86400; t += 86400) {
      const d = dayStr(t), diff = Math.floor(t / 86400) - Math.floor(now0 / 86400);
      const ttl = diff < 0 ? 6 * 3600e3 : diff === 0 ? 40 * 60e3 : diff === 1 ? 3 * 3600e3 : 6 * 3600e3;
      if (diff < -1) continue;
      let arr; try { arr = await day(t, ttl); } catch (e) { if (diff <= 0) continue; throw e; }
      for (const g of arr) { const f = pick(g); if (f && !seen.has(f.id)) { seen.add(f.id); out.push(f); } }
    }
    return out;
  }
  async function result(fx) {
    const arr = await day(fx.kickoff, 10 * 60 * 1000), g = arr.find((x) => { const f = pick(x); return f && f.id === fx.id; });
    if (!g) return { final: false };
    const gg = g.game ? Object.assign({}, g, g.game) : g, status = gg.status && gg.status.short;
    if (!finals.includes(status)) return { final: false };
    const sc = g.scores, h = sc && sc.home && (typeof sc.home === 'object' ? sc.home.total : sc.home), a = sc && sc.away && (typeof sc.away === 'object' ? sc.away.total : sc.away);
    if (!isInt(h) || !isInt(a)) return null;
    return { final: true, value: h - a };
  }
  return { sport, kind, bps, list, result, minMinutes: sport === 'nfl' ? 170 : 130 };
}
const nba = (o) => apiSports(Object.assign({ sport: 'nba', host: 'v1.basketball.api-sports.io', league: 12, finals: ['FT', 'AOT'], bps: 300 }, o));
const nhl = (o) => apiSports(Object.assign({ sport: 'nhl', host: 'v1.hockey.api-sports.io', league: 57, finals: ['FT', 'AOT', 'AP'], bps: 250 }, o));
const nfl = (o) => apiSports(Object.assign({ sport: 'nfl', host: 'v1.american-football.api-sports.io', league: 1, finals: ['FT', 'AOT'], bps: 600 }, o));
module.exports = { footballData, apiSports, nba, nhl, nfl, makeHttp };
