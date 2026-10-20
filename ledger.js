'use strict';
// Player ratings. Pure functions: the same list of settled matches always gives the same table, so the table can be rebuilt
// from the blockchain at any time (see ratings.js). Elo, start 1000, K 24. A table of n players is scored as n-1 duels per player.
const START = 1000, K = 24;
const newProfile = () => ({ rating: START, games: 0, wins: 0, losses: 0, draws: 0, byGame: {} });

// players: addresses in seat order (lower case); mask: bit i set = seat i takes the pool; all bits = draw (stakes returned)
function applyMatch(book, { players, game, mask }) {
  const n = players.length;
  if (n < 2 || n > 9 || new Set(players).size !== n) return false;       // never rate a table with the same wallet twice
  const full = (1 << n) - 1; mask &= full; if (mask === 0) return false;
  const draw = mask === full;
  const prof = players.map((a) => book.get(a) || newProfile());
  const old = prof.map((p) => p.rating);
  const won = players.map((_, i) => !!(mask >> i & 1));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const s = won[i] === won[j] ? 0.5 : won[i] ? 1 : 0;
      sum += s - 1 / (1 + Math.pow(10, (old[j] - old[i]) / 400));
    }
    const p = prof[i];
    p.rating = Math.max(100, old[i] + Math.round(K * sum / (n - 1)));
    p.games++;
    if (draw) p.draws++; else if (won[i]) p.wins++; else p.losses++;
    const g = p.byGame[game] || (p.byGame[game] = { games: 0, wins: 0 }); g.games++; if (won[i] && !draw) g.wins++;
    book.set(players[i], p);
  }
  return true;
}
module.exports = { START, K, newProfile, applyMatch };
