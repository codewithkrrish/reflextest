/* ReflexTest engine — pure logic, no DOM.
 *
 * A reaction-time test is a small state machine:
 *   idle -> waiting (red, "wait for green") -> ready (green, timer runs)
 *   -> round-done (one time recorded) -> waiting (next round) ...
 *   -> done (every round recorded).
 * Clicking while the screen is red is a false start: the round is void,
 * nothing is recorded, and the same round is tried again.
 *
 * All times are milliseconds (performance.now() deltas from main.js).
 * Nothing here touches the DOM, storage or the network, so every function
 * below is unit-testable with plain numbers.
 */

export const ROUND_OPTIONS = [3, 5, 10];
export const DEFAULT_ROUNDS = 5;
export const DELAY_MIN_MS = 1500;
export const DELAY_MAX_MS = 5000;
export const SITE_URL = "https://reflextest.vercel.app/";

/* Rank tiers, ranked on the session average. Boundaries are exclusive
 * upper bounds: a 179 ms average is Pro Gamer, 180 ms is Lightning. */
export const RANK_TIERS = [
  { max: 180, label: "Pro Gamer", blurb: "Faster than most people will ever be." },
  { max: 220, label: "Lightning", blurb: "Seriously quick hands." },
  { max: 270, label: "Sharp", blurb: "Well above average — keep practising." },
  { max: 320, label: "Average", blurb: "Right around the typical human range." },
  { max: 400, label: "Steady", blurb: "A solid, dependable reaction." },
  { max: Infinity, label: "Warming Up", blurb: "Everyone starts somewhere — try again." },
];

export const PB_KEY = "reflextest:pb:v1";
export const HISTORY_KEY = "reflextest:history:v1";
export const SETTINGS_KEY = "reflextest:settings:v1";
export const MAX_HISTORY = 8;

/* ------------------------------------------------------------------ */
/* Small numeric helpers                                               */
/* ------------------------------------------------------------------ */

export function round1(value) {
  return Math.round(value * 10) / 10;
}

/* Mean of an array of numbers; null for an empty array. */
export function meanOf(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/* Median of an array of numbers; null for an empty array. */
export function medianOf(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/* "243 ms", or an em dash when there is nothing to show. */
export function formatMs(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
  return `${round1(ms)} ms`;
}

/* ------------------------------------------------------------------ */
/* Delay and rank tiers                                                */
/* ------------------------------------------------------------------ */

/* A random wait between 1.5 and 5 seconds before the screen turns green.
 * rng is injected so tests can pin it down. */
export function pickDelay(rng = Math.random) {
  const r = typeof rng === "function" ? rng() : Math.random();
  const clamped = Number.isFinite(r) ? Math.min(Math.max(r, 0), 0.999999) : 0.5;
  return Math.round(DELAY_MIN_MS + clamped * (DELAY_MAX_MS - DELAY_MIN_MS));
}

export function isValidDelay(ms) {
  return typeof ms === "number" && Number.isFinite(ms)
    && ms >= DELAY_MIN_MS && ms <= DELAY_MAX_MS;
}

/* Rank tier for a time in ms (usually the session average).
 * Returns the tier object, or null for junk input. */
export function rankFor(ms) {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return null;
  for (const tier of RANK_TIERS) {
    if (ms < tier.max) return tier;
  }
  return RANK_TIERS[RANK_TIERS.length - 1];
}

export function rankLabel(ms) {
  const tier = rankFor(ms);
  return tier ? tier.label : "—";
}

/* ------------------------------------------------------------------ */
/* Round-count config                                                  */
/* ------------------------------------------------------------------ */

export function isValidRoundCount(n) {
  return ROUND_OPTIONS.includes(n);
}

export function normalizeRounds(n) {
  return isValidRoundCount(n) ? n : DEFAULT_ROUNDS;
}

/* ------------------------------------------------------------------ */
/* Session stats                                                       */
/* ------------------------------------------------------------------ */

/* Stats for a finished (or partial) list of round times.
 * Empty input gives nulls, not zeros — "no data" is not "0 ms". */
export function computeStats(times) {
  const list = Array.isArray(times)
    ? times.filter((t) => typeof t === "number" && Number.isFinite(t) && t >= 0)
    : [];
  if (list.length === 0) {
    return { count: 0, best: null, average: null, median: null, spread: null, rank: null };
  }
  const best = Math.min(...list);
  const average = round1(meanOf(list));
  const median = round1(medianOf(list));
  const spread = round1(Math.max(...list) - Math.min(...list));
  return { count: list.length, best, average, median, spread, rank: rankFor(average) };
}

/* ------------------------------------------------------------------ */
/* The game state machine                                              */
/* ------------------------------------------------------------------ */

/* Statuses:
 *   idle        — before a test, or between tests
 *   waiting     — red screen, green is coming
 *   ready       — green screen, timer running (greenAt is set)
 *   false-start — clicked too soon; press again to retry the same round
 *   round-done  — one round recorded; press again for the next round
 *   done        — every round recorded
 */
export function createGame(totalRounds = DEFAULT_ROUNDS) {
  return {
    total: normalizeRounds(totalRounds),
    status: "idle",
    round: 0,
    times: [],
    falseStarts: 0,
    greenAt: null,
  };
}

export function startGame(game, totalRounds = game.total) {
  game.total = normalizeRounds(totalRounds);
  game.status = "waiting";
  game.round = 1;
  game.times = [];
  game.falseStarts = 0;
  game.greenAt = null;
  return game;
}

/* The screen turns green at `now` (a performance.now() timestamp).
 * Only valid while waiting; anything else is a no-op. */
export function markGreen(game, now) {
  if (game.status !== "waiting") return game;
  game.status = "ready";
  game.greenAt = now;
  return game;
}

/* Move to the next round after a round-done press. Only valid from
 * round-done; anything else is a no-op. */
export function beginNextRound(game) {
  if (game.status !== "round-done") return game;
  game.round = game.times.length + 1;
  game.status = "waiting";
  game.greenAt = null;
  return game;
}

export function resetGame(game) {
  game.status = "idle";
  game.round = 0;
  game.times = [];
  game.falseStarts = 0;
  game.greenAt = null;
  return game;
}

/* The one press handler. `now` is a performance.now() timestamp.
 * Returns an event object describing what happened:
 *   { type: "ignored" }                          — press did nothing
 *   { type: "false-start", falseStarts }          — clicked while red
 *   { type: "rearm" }                            — retry the same round
 *   { type: "round", time, done, stats }          — a time was recorded
 *   { type: "next" }                             — advance to the next round
 */
export function handlePress(game, now) {
  switch (game.status) {
    case "idle":
    case "done":
      return { type: "ignored" };
    case "waiting": {
      game.falseStarts += 1;
      game.status = "false-start";
      game.greenAt = null;
      return { type: "false-start", falseStarts: game.falseStarts };
    }
    case "false-start":
      game.status = "waiting";
      return { type: "rearm" };
    case "ready": {
      const raw = now - game.greenAt;
      const time = Math.max(0, Math.round(Number.isFinite(raw) ? raw : 0));
      game.times.push(time);
      game.greenAt = null;
      const done = game.times.length >= game.total;
      game.status = done ? "done" : "round-done";
      return { type: "round", time, done, stats: computeStats(game.times) };
    }
    case "round-done":
      return { type: "next" };
    default:
      return { type: "ignored" };
  }
}

/* ------------------------------------------------------------------ */
/* Personal best                                                       */
/* ------------------------------------------------------------------ */

/* pb shape: { bestSingle, bestAverage, bestSingleAt, bestAverageAt }
 * (times in ms, dates as ISO strings). Either field may be null. */
export function emptyPersonalBest() {
  return { bestSingle: null, bestAverage: null, bestSingleAt: null, bestAverageAt: null };
}

export function isValidPersonalBest(pb) {
  if (!pb || typeof pb !== "object" || Array.isArray(pb)) return false;
  const ok = (v) => v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);
  const okDate = (v) => v === null || (typeof v === "string" && v.length > 0);
  return ok(pb.bestSingle) && ok(pb.bestAverage)
    && okDate(pb.bestSingleAt) && okDate(pb.bestAverageAt);
}

export function parsePersonalBest(raw) {
  if (raw === null || raw === undefined) return emptyPersonalBest();
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isValidPersonalBest(parsed) ? parsed : emptyPersonalBest();
  } catch {
    return emptyPersonalBest();
  }
}

/* Fold a finished session's stats into the personal best.
 * Returns { pb, newBestSingle, newBestAverage } — a tie is not a new best,
 * only a strictly faster time is. `at` is an ISO date string. */
export function updatePersonalBest(pb, stats, at = new Date().toISOString()) {
  const base = isValidPersonalBest(pb) ? { ...pb } : emptyPersonalBest();
  let newBestSingle = false;
  let newBestAverage = false;
  if (stats && typeof stats.best === "number") {
    if (base.bestSingle === null || stats.best < base.bestSingle) {
      base.bestSingle = stats.best;
      base.bestSingleAt = at;
      newBestSingle = true;
    }
  }
  if (stats && typeof stats.average === "number") {
    if (base.bestAverage === null || stats.average < base.bestAverage) {
      base.bestAverage = stats.average;
      base.bestAverageAt = at;
      newBestAverage = true;
    }
  }
  return { pb: base, newBestSingle, newBestAverage };
}

export function loadPersonalBest(storage) {
  try {
    return parsePersonalBest(storage.getItem(PB_KEY));
  } catch {
    return emptyPersonalBest();
  }
}

export function savePersonalBest(storage, pb) {
  try {
    storage.setItem(PB_KEY, JSON.stringify(pb));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* History (past sessions)                                             */
/* ------------------------------------------------------------------ */

/* Session shape: { at, rounds, best, average, median, rank, falseStarts } */
export function isValidSession(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  return typeof entry.at === "string" && entry.at.length > 0
    && isValidRoundCount(entry.rounds)
    && typeof entry.best === "number" && Number.isFinite(entry.best) && entry.best >= 0
    && typeof entry.average === "number" && Number.isFinite(entry.average) && entry.average >= 0
    && typeof entry.median === "number" && Number.isFinite(entry.median) && entry.median >= 0
    && typeof entry.rank === "string" && entry.rank.length > 0
    && typeof entry.falseStarts === "number" && Number.isFinite(entry.falseStarts) && entry.falseStarts >= 0;
}

export function parseHistory(raw) {
  if (raw === null || raw === undefined) return [];
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSession).slice(0, MAX_HISTORY);
  } catch {
    return [];
  }
}

export function loadHistory(storage) {
  try {
    return parseHistory(storage.getItem(HISTORY_KEY));
  } catch {
    return [];
  }
}

export function saveHistory(storage, history) {
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(history));
    return true;
  } catch {
    return false;
  }
}

/* Newest first, capped at MAX_HISTORY. Invalid sessions are ignored. */
export function addSession(history, session) {
  if (!isValidSession(session)) return Array.isArray(history) ? [...history] : [];
  const list = Array.isArray(history) ? [...history] : [];
  list.unshift(session);
  return list.slice(0, MAX_HISTORY);
}

export function sessionFromGame(game, stats, at = new Date().toISOString()) {
  return {
    at,
    rounds: game.total,
    best: stats.best,
    average: stats.average,
    median: stats.median,
    rank: stats.rank ? stats.rank.label : "—",
    falseStarts: game.falseStarts,
  };
}

/* ------------------------------------------------------------------ */
/* Settings (round count)                                              */
/* ------------------------------------------------------------------ */

export function parseSettings(raw) {
  if (raw === null || raw === undefined) return { rounds: DEFAULT_ROUNDS };
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { rounds: DEFAULT_ROUNDS };
    }
    return { rounds: normalizeRounds(parsed.rounds) };
  } catch {
    return { rounds: DEFAULT_ROUNDS };
  }
}

export function loadSettings(storage) {
  try {
    return parseSettings(storage.getItem(SETTINGS_KEY));
  } catch {
    return { rounds: DEFAULT_ROUNDS };
  }
}

export function saveSettings(storage, settings) {
  try {
    storage.setItem(SETTINGS_KEY, JSON.stringify({ rounds: normalizeRounds(settings.rounds) }));
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* Result card + share text                                            */
/* ------------------------------------------------------------------ */

/* Structured data for the downloadable result card. `stats` is the
 * computeStats() output for a finished test. */
export function buildResultCard(stats, pb, siteUrl = SITE_URL) {
  const rank = stats && stats.rank ? stats.rank : rankFor(stats ? stats.average : null);
  return {
    title: "ReflexTest",
    subtitle: "My reaction time",
    best: stats ? stats.best : null,
    average: stats ? stats.average : null,
    median: stats ? stats.median : null,
    rounds: stats ? stats.count : 0,
    rank: rank ? rank.label : "—",
    rankBlurb: rank ? rank.blurb : "",
    isPersonalBest: !!(pb && stats && pb.bestSingle !== null && stats.best === pb.bestSingle),
    siteUrl,
  };
}

export function buildShareText(stats, siteUrl = SITE_URL) {
  if (!stats || typeof stats.best !== "number") return "";
  const rank = stats.rank ? stats.rank.label : rankLabel(stats.average);
  return `My reaction time on ReflexTest: best ${formatMs(stats.best)}, average ${formatMs(stats.average)} (${rank}). Think you can beat it? ${siteUrl}`;
}

export function buildResultText(stats, falseStarts = 0) {
  if (!stats || typeof stats.best !== "number") return "";
  const rank = stats.rank ? stats.rank.label : rankLabel(stats.average);
  const lines = [
    "ReflexTest — my reaction time",
    `Best: ${formatMs(stats.best)}`,
    `Average: ${formatMs(stats.average)}`,
    `Median: ${formatMs(stats.median)}`,
    `Consistency (spread): ${formatMs(stats.spread)}`,
    `Rank: ${rank}`,
    `Rounds: ${stats.count}`,
    `False starts: ${falseStarts}`,
    SITE_URL,
  ];
  return lines.join("\n");
}

/* Draw the shareable result card onto a 2D canvas context.
 * `ctx` is injected (a real CanvasRenderingContext2D in the browser, a
 * recording stub in tests). Width/height default to a 1080x1080 square. */
export function drawResultCard(ctx, card, width = 1080, height = 1080) {
  if (!ctx || !card) return false;
  const pad = 90;
  ctx.fillStyle = "#0B0B0F";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#E5484D";
  ctx.fillRect(0, 0, width, 14);
  ctx.fillStyle = "#121218";
  ctx.fillRect(pad, 150, width - pad * 2, height - 300);
  ctx.strokeStyle = "#23232E";
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, 150, width - pad * 2, height - 300);

  ctx.textAlign = "center";
  ctx.fillStyle = "#E5484D";
  ctx.font = "700 64px Inter, Arial, sans-serif";
  ctx.fillText(card.title, width / 2, 110);
  ctx.fillStyle = "#9A9AA5";
  ctx.font = "400 34px Inter, Arial, sans-serif";
  ctx.fillText(card.subtitle, width / 2, 210);

  ctx.fillStyle = "#F5F5F7";
  ctx.font = "700 150px Inter, Arial, sans-serif";
  ctx.fillText(formatMs(card.best), width / 2, 420);
  ctx.fillStyle = "#9A9AA5";
  ctx.font = "400 32px Inter, Arial, sans-serif";
  ctx.fillText("BEST REACTION", width / 2, 470);

  ctx.fillStyle = "#F5F5F7";
  ctx.font = "600 52px Inter, Arial, sans-serif";
  ctx.fillText(`Average ${formatMs(card.average)}  ·  Median ${formatMs(card.median)}`, width / 2, 580);
  ctx.fillText(`${card.rounds} rounds`, width / 2, 650);

  ctx.fillStyle = "#E5484D";
  ctx.font = "700 76px Inter, Arial, sans-serif";
  ctx.fillText(card.rank, width / 2, 780);
  if (card.isPersonalBest) {
    ctx.fillStyle = "#F5F5F7";
    ctx.font = "600 36px Inter, Arial, sans-serif";
    ctx.fillText("New personal best", width / 2, 840);
  }

  ctx.fillStyle = "#9A9AA5";
  ctx.font = "400 32px Inter, Arial, sans-serif";
  ctx.fillText(card.siteUrl, width / 2, height - 90);
  ctx.fillText("Test your own reflexes — free, in your browser", width / 2, height - 44);
  return true;
}

/* Short, human date for history rows, e.g. "12 Nov 2026, 11:08". */
export function formatSessionDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso || "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}, ${hour}:${minute}`;
}
