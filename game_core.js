'use strict';
// "School of the Seer": the rules of the game, as a pure state machine. No network, no disk, no clock of its own:
// the caller passes `now` (ms) and the prices, so every rule can be tested with a fake clock.
// Money is kept in micro-USDT (1 USDT = 1,000,000). Seevar are whole numbers.
const DAY = 86400000, WEEK = 7 * DAY;
const COINS = ['BTC', 'ETH', 'SOL'];
const RANK_XP = [0, 1000, 5000, 15000, 40000, 100000];     // Novice, Observer, Pathfinder, Master, Keeper, Grand Keeper
const RANK_BONUS = [0, 0, 5, 10, 15, 20];                   // % on top of every play award
const RANK_LIMIT = [600, 600, 650, 700, 750, 800];          // Seevar per day from play
const MAX_RANK_NOW = 2;                                     // the trials of the higher ranks need duels and flashes (next release)
const POOL = ['up:BTC', 'up:ETH', 'up:SOL', 'pair:BTC:ETH', 'pair:ETH:SOL', 'pair:SOL:BTC', 'big:BTC', 'big:ETH', 'big:SOL'];

const DEFAULT_CFG = {
  weeklyBudget: 5000000,          // micro-USDT shared by everyone each week
  ceiling: 500,                   // micro-USDT per Seevar at most (1000 Seevar = 0.50 USDT)
  personCap: 2000000,             // micro-USDT per person per week
  totalCap: 300000000,            // micro-USDT in the whole campaign
  minExchange: 1000,              // Seevar
  minDays: 3,                     // days of play before the first exchange
  payoutDelay: 7 * DAY,
  requireTg: false,
  maxWalletsPerIp: 5,
  visionBase: 50, visionHit: 100, visionBull: 250, visionHitPct: 1, visionBullPct: 0.3,
  duelWin: 40,
};

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayNum = (ms) => Math.floor(ms / DAY);
function nextClose(now) {                                   // next Sunday 18:00 UTC strictly after `now`
  const d = new Date(now), add = (7 - d.getUTCDay()) % 7;
  const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, 18, 0, 0);
  return t > now ? t : t + WEEK;
}
function hashStr(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
function questionsFor(day) {                                // five different questions, the same for everyone on a given day
  let seed = hashStr('seer-scroll-' + day) || 1; const a = POOL.slice();
  const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, 5);
}
const answerOk = (q, x) => (q.startsWith('pair:') ? x === 'a' || x === 'b' : x === 'y' || x === 'n');

function newState(now, secret) {
  return { v: 1, secret, paused: false, n: 0, cfg: { ...DEFAULT_CFG }, users: {}, visions: {}, scrolls: {}, windows: {}, payouts: [],
    carry: 0, committed: 0, lastClose: nextClose(now) - WEEK, ips: {}, tgUsed: {}, log: [] };
}

function makeGame({ state, now: clock = Date.now }) {
  const S = state; S.cfg = { ...DEFAULT_CFG, ...S.cfg };
  const cfg = () => S.cfg;
  const note = (m) => { S.log.push(clock() + ' ' + m); if (S.log.length > 300) S.log.splice(0, S.log.length - 300); };
  const err = (e) => ({ ok: false, err: e });
  const valid = (a) => typeof a === 'string' && /^0x[0-9a-f]{40}$/.test(a);

  function rollDay(u, now) { const d = dayOf(now); if (u.capDay !== d) { u.capDay = d; u.earnedToday = 0; } }
  function rank(u) {
    let i = 0; while (i + 1 < RANK_XP.length && u.xp >= RANK_XP[i + 1]) i++;
    if (i >= 2 && !u.trials.t2) i = 1;
    return Math.min(i, MAX_RANK_NOW);
  }
  const limit = (u) => RANK_LIMIT[rank(u)];
  function giftPct(u, coin) {
    if (!u.gift || rank(u) < 2) return 0;
    if (u.gift.coin === 'ALL') return 5;
    if (u.gift.coin !== coin) return 0;
    const c = u.correct[coin] || 0; return c >= 60 ? 30 : c >= 20 ? 20 : 10;
  }
  // an award for playing: rank and gift bonus, then the daily limit
  function play(u, base, now, coin) {
    rollDay(u, now);
    const amt = Math.round(base * (1 + (RANK_BONUS[rank(u)] + (coin ? giftPct(u, coin) : 0)) / 100));
    const give = Math.max(0, Math.min(amt, limit(u) - u.earnedToday));
    u.earnedToday += give; u.bal += give; u.xp += give; return give;
  }
  function bonus(u, amt) { u.bal += amt; u.xp += amt; return amt; }

  function user(addr, ip, now, create) {
    addr = String(addr || '').toLowerCase(); if (!valid(addr)) return null;
    let u = S.users[addr];
    if (!u && create) {
      if (ip) {
        const k = dayOf(now) + '|' + ip, set = S.ips[k] || (S.ips[k] = []);
        if (!set.includes(addr)) { if (set.length >= cfg().maxWalletsPerIp) return 'ip'; set.push(addr); }
        for (const key of Object.keys(S.ips)) if (key.slice(0, 10) < dayOf(now - 2 * DAY)) delete S.ips[key];
      }
      u = S.users[addr] = { addr, created: now, xp: 0, bal: 0, capDay: '', earnedToday: 0, streak: 0, best: 0, lastPlay: '', freeze: 1, freezeWeek: -1, days: 0,
        visionDay: '', scrollDay: '', tg: null, claims: {}, gift: null, giftAt: 0, correct: {}, cons: 0, trials: { t2: false }, spent: 0, exchanged: 0 };
    }
    return u || null;
  }

  function bumpStreak(u, now) {
    const d = dayOf(now), wk = Math.floor(dayNum(now) / 7);
    if (u.freezeWeek !== wk) { u.freezeWeek = wk; u.freeze = 1; }
    if (u.lastPlay === d) return 0;
    const gap = u.lastPlay ? dayNum(Date.parse(d)) - dayNum(Date.parse(u.lastPlay)) : 99;
    if (gap === 1) u.streak++; else if (gap === 2 && u.freeze > 0) { u.freeze--; u.streak++; } else u.streak = 1;
    u.lastPlay = d; u.days++; u.best = Math.max(u.best, u.streak);
    return u.streak === 3 ? bonus(u, 50) : u.streak === 7 ? bonus(u, 300) : u.streak === 30 ? bonus(u, 1500) : 0;
  }

  const api = {
    state: S, cfg, rank, limit, dayOf, nextClose, questionsFor,

    login(addr, ip, now) {
      const u = user(addr, ip, now, true);
      if (u === 'ip') return err('too many accounts from this network today');
      return u ? { ok: true, user: u } : err('bad address');
    },

    // ---- the Vision of the day ----
    vision(addr, coin, price, spot, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      if (S.paused) return err('the game is paused');
      if (!COINS.includes(coin)) return err('bad coin');
      if (!(typeof price === 'number' && isFinite(price) && price > 0) || !(spot > 0)) return err('bad price');
      if (Math.abs(price / spot - 1) > 0.2) return err('price is too far from the market (more than 20%)');
      if (u.visionDay === dayOf(now)) return err('you already made today\'s Vision');
      const id = 'v' + (++S.n);
      S.visions[id] = { id, addr: u.addr, coin, price, base: spot, t0: now, due: now + DAY, status: 'open' };
      u.visionDay = dayOf(now);
      const streakBonus = bumpStreak(u, now), got = play(u, cfg().visionBase, now, coin);
      return { ok: true, id, got, streakBonus, due: now + DAY };
    },
    resolveVision(id, actual, now) {
      const v = S.visions[id]; if (!v || v.status !== 'open') return null;
      const u = S.users[v.addr]; v.status = 'done'; v.actual = actual;
      v.err = Math.abs(v.price - actual) / actual * 100;
      const c = cfg(); let extra = 0;
      if (v.err <= c.visionBullPct) { v.tier = 'bull'; extra = c.visionBull; }
      else if (v.err <= c.visionHitPct) { v.tier = 'hit'; extra = c.visionHit; } else v.tier = 'miss';
      if (v.tier !== 'miss') { u.correct[v.coin] = (u.correct[v.coin] || 0) + 1; u.cons++; if (u.cons >= 3) u.trials.t2 = true; } else u.cons = 0;
      v.got = extra ? play(u, extra, now, v.coin) : 0;
      return v;
    },

    // ---- the Scroll of the day ----
    scroll(addr, answers, spots, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      if (S.paused) return err('the game is paused');
      const day = dayOf(now), qs = questionsFor(day);
      if (u.scrollDay === day) return err('you already answered today\'s Scroll');
      if (!Array.isArray(answers) || answers.length !== 5 || !answers.every((x, i) => answerOk(qs[i], x))) return err('answer all five questions');
      for (const c of COINS) if (!(spots && spots[c] > 0)) return err('prices are not available right now');
      const id = 's' + (++S.n);
      S.scrolls[id] = { id, addr: u.addr, day, qs, answers: answers.slice(), base: { ...spots }, t0: now, due: now + DAY, status: 'open' };
      u.scrollDay = day; bumpStreak(u, now);
      return { ok: true, id, due: now + DAY };
    },
    resolveScroll(id, actual, now) {
      const s = S.scrolls[id]; if (!s || s.status !== 'open') return null;
      const u = S.users[s.addr]; s.status = 'done'; s.right = [];
      s.qs.forEach((q, i) => {
        const p = q.split(':'), b = s.base, a = actual;
        const truth = p[0] === 'up' ? (a[p[1]] > b[p[1]] ? 'y' : 'n')
          : p[0] === 'big' ? (Math.abs(a[p[1]] / b[p[1]] - 1) >= 0.01 ? 'y' : 'n')
          : (a[p[1]] / b[p[1]] > a[p[2]] / b[p[2]] ? 'a' : 'b');
        s.right.push(truth === s.answers[i]);
      });
      const n = s.right.filter(Boolean).length; s.n = n;
      s.got = n ? play(u, n * 10 + (n === 5 ? 50 : 0), now, null) : 0;
      return s;
    },

    // ---- one-time bonuses, Telegram, the Gift ----
    claim(addr, kind, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      if (kind !== 'x' && kind !== 'tg') return err('bad bonus');
      if (kind === 'tg' && !u.tg) return err('link Telegram first');
      if (u.claims[kind]) return err('already taken');
      u.claims[kind] = now; return { ok: true, got: bonus(u, 100) };
    },
    bindTelegram(addr, tgId, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      tgId = String(tgId || ''); if (!/^\d{1,15}$/.test(tgId)) return err('bad Telegram id');
      if (u.tg) return u.tg === tgId ? { ok: true } : err('this wallet already has a Telegram linked');
      if (S.tgUsed[tgId]) return err('this Telegram is linked to another wallet');
      u.tg = tgId; S.tgUsed[tgId] = u.addr; return { ok: true };
    },
    setGift(addr, coin, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      if (rank(u) < 2) return err('the Gift opens at the Pathfinder rank');
      if (coin !== 'ALL' && !COINS.includes(coin)) return err('bad coin');
      if (u.gift && now - u.giftAt < 30 * DAY) return err('the Gift can be changed once in 30 days');
      u.gift = { coin }; u.giftAt = now; return { ok: true };
    },

    // ---- the Exchange ----
    exchange(addr, amount, now) {
      const u = user(addr, null, now); if (!u) return err('no account');
      const c = cfg();
      if (S.paused) return err('the game is paused');
      if (!Number.isInteger(amount) || amount <= 0) return err('bad amount');
      if (u.days < c.minDays) return err('play at least ' + c.minDays + ' days before the first exchange');
      if (c.requireTg && !u.tg) return err('link Telegram first');
      if (amount > u.bal) return err('not enough Seevar');
      const close = nextClose(now), w = S.windows[close] || (S.windows[close] = { closeAt: close, status: 'open', req: {} });
      if ((w.req[u.addr] || 0) + amount < c.minExchange) return err('the minimum is ' + c.minExchange + ' Seevar');
      u.bal -= amount; u.exchanged += amount; w.req[u.addr] = (w.req[u.addr] || 0) + amount;
      return { ok: true, closeAt: close, total: w.req[u.addr] };
    },
    // close every weekly window that is over: the rate, the limits, the payouts
    settleDue(now) {
      const done = [], c = cfg();
      while (S.lastClose + WEEK <= now) {
        const close = S.lastClose + WEEK; S.lastClose = close;
        const w = S.windows[close] || (S.windows[close] = { closeAt: close, status: 'open', req: {} });
        const remaining = Math.max(0, c.totalCap - S.committed);
        const avail = Math.min(S.carry + c.weeklyBudget, remaining);
        const capSeevar = Math.floor(c.personCap / c.ceiling), rows = [];
        let total = 0;
        for (const [addr, amount] of Object.entries(w.req)) { const take = Math.min(amount, capSeevar); rows.push({ addr, amount, take }); total += take; }
        const rate = total > 0 ? Math.min(c.ceiling, avail / total) : 0;
        let paid = 0;
        for (const r of rows) {
          const u = S.users[r.addr]; u.bal += r.amount - r.take;                    // over the personal limit: back to the balance
          const micro = Math.floor(r.take * rate);
          r.micro = micro; paid += micro;
          if (micro > 0) S.payouts.push({ id: 'p' + (++S.n), addr: r.addr, micro, seevar: r.take, window: close, payAt: close + c.payoutDelay, status: 'wait', tx: '', error: '' });
        }
        S.committed += paid; S.carry = Math.max(0, avail - paid);
        Object.assign(w, { status: 'settled', rate, total, paid, count: rows.length, detail: rows });
        note('window ' + new Date(close).toISOString() + ' settled: ' + rows.length + ' requests, rate ' + rate.toFixed(4) + ', paid ' + paid);
        done.push(close);
      }
      return done;
    },
    duePayouts(now) { return S.paused ? [] : S.payouts.filter((p) => p.status === 'wait' && p.payAt <= now); },

    // ---- what the player sees ----
    me(addr, now) {
      const u = user(addr, null, now); if (!u) return null;
      rollDay(u, now);
      const day = dayOf(now), r = rank(u), c = cfg();
      const vis = Object.values(S.visions).filter((v) => v.addr === u.addr).slice(-5).reverse();
      const sc = Object.values(S.scrolls).filter((s) => s.addr === u.addr).slice(-3).reverse();
      const close = nextClose(now), w = S.windows[close], payouts = S.payouts.filter((p) => p.addr === u.addr).slice(-10).reverse();
      return {
        addr: u.addr, bal: u.bal, xp: u.xp, rank: r, rankXp: RANK_XP, nextXp: r + 1 < RANK_XP.length ? RANK_XP[r + 1] : null,
        trial: { t2: u.trials.t2, cons: u.cons, maxRank: MAX_RANK_NOW },
        bonusPct: RANK_BONUS[r], limit: limit(u), earnedToday: u.earnedToday,
        streak: u.streak, best: u.best, freeze: u.freeze, days: u.days, tg: !!u.tg, claims: Object.keys(u.claims),
        gift: u.gift, giftAt: u.giftAt, correct: u.correct,
        visionToday: u.visionDay === day, scrollToday: u.scrollDay === day, questions: questionsFor(day),
        visions: vis.map((v) => ({ id: v.id, coin: v.coin, price: v.price, base: v.base, t0: v.t0, due: v.due, status: v.status, actual: v.actual, err: v.err, tier: v.tier, got: v.got })),
        scrolls: sc.map((s) => ({ id: s.id, day: s.day, qs: s.qs, answers: s.answers, due: s.due, status: s.status, right: s.right, n: s.n, got: s.got })),
        exchange: { closeAt: close, mine: w && w.req[u.addr] || 0, min: c.minExchange, minDays: c.minDays, canNow: u.days >= c.minDays && (!c.requireTg || !!u.tg) },
        payouts: payouts.map((p) => ({ id: p.id, micro: p.micro, seevar: p.seevar, payAt: p.payAt, status: p.status, tx: p.tx })),
        paused: S.paused,
      };
    },
    info(now) {
      const c = cfg(), last = Object.values(S.windows).filter((w) => w.status === 'settled').sort((a, b) => b.closeAt - a.closeAt)[0];
      return { closeAt: nextClose(now), lastRate: last ? last.rate : null, lastClose: last ? last.closeAt : null, ceiling: c.ceiling, min: c.minExchange,
        personCap: c.personCap, minDays: c.minDays, payoutDays: Math.round(c.payoutDelay / DAY), requireTg: !!c.requireTg, paused: S.paused,
        players: Object.keys(S.users).length };
    },
    top(n) {
      return Object.values(S.users).filter((u) => u.xp > 0).sort((a, b) => b.xp - a.xp || a.created - b.created).slice(0, n || 20)
        .map((u) => ({ addr: u.addr, xp: u.xp, rank: rank(u), streak: u.streak }));
    },

    // ---- the owner ----
    admin() {
      const us = Object.values(S.users), c = cfg();
      const open = Object.values(S.windows).filter((w) => w.status === 'open');
      return { cfg: c, paused: S.paused, players: us.length, seevarInBalances: us.reduce((s, u) => s + u.bal, 0), seevarEarned: us.reduce((s, u) => s + u.xp, 0),
        carry: S.carry, committed: S.committed, remaining: Math.max(0, c.totalCap - S.committed), openRequests: open.reduce((s, w) => s + Object.keys(w.req).length, 0),
        openSeevar: open.reduce((s, w) => s + Object.values(w.req).reduce((a, b) => a + b, 0), 0), nextClose: nextClose(clock()),
        payouts: S.payouts.slice(-100).reverse(), windows: Object.values(S.windows).filter((w) => w.status === 'settled').sort((a, b) => b.closeAt - a.closeAt).slice(0, 8).map((w) => ({ closeAt: w.closeAt, rate: w.rate, total: w.total, paid: w.paid, count: w.count })),
        log: S.log.slice(-40) };
    },
    setPaused(on) { S.paused = !!on; note('paused=' + S.paused); return { ok: true, paused: S.paused }; },
    setCfg(patch) {
      const ok = ['weeklyBudget', 'ceiling', 'personCap', 'totalCap', 'minExchange', 'minDays', 'requireTg', 'maxWalletsPerIp'];
      for (const k of Object.keys(patch || {})) {
        if (!ok.includes(k)) continue; const v = patch[k];
        if (k === 'requireTg') S.cfg[k] = !!v; else if (Number.isFinite(v) && v >= 0 && v <= 1e12) S.cfg[k] = Math.floor(v);
      }
      note('cfg ' + JSON.stringify(patch)); return { ok: true, cfg: S.cfg };
    },
    payoutAction(id, action) {
      const p = S.payouts.find((x) => x.id === id); if (!p) return err('no such payout');
      if (action === 'retry' && (p.status === 'failed' || p.status === 'sending')) { p.status = 'wait'; p.error = ''; return { ok: true }; }
      if (action === 'cancel' && (p.status === 'wait' || p.status === 'failed')) { p.status = 'cancelled'; S.committed = Math.max(0, S.committed - p.micro); S.carry += p.micro; return { ok: true }; }
      return err('not possible in this state');
    },
    payoutMark(id, status, extra) { const p = S.payouts.find((x) => x.id === id); if (p) Object.assign(p, { status }, extra || {}); return p; },
  };
  return api;
}
module.exports = makeGame;
Object.assign(module.exports, { newState, nextClose, questionsFor, dayOf, COINS, RANK_XP, RANK_BONUS, RANK_LIMIT, DEFAULT_CFG, DAY, WEEK });
