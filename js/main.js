/* ReflexTest main — DOM wiring for the reaction-time test.
 *
 * The test area is one big button. Its state machine lives in engine.js;
 * this file only translates engine events into screen states and timers.
 * Timing uses performance.now(); the engine never sees the clock directly,
 * so tests can drive the whole game with explicit timestamps.
 */
import {
  ROUND_OPTIONS,
  DEFAULT_ROUNDS,
  SITE_URL,
  pickDelay,
  rankLabel,
  normalizeRounds,
  computeStats,
  createGame,
  startGame,
  markGreen,
  beginNextRound,
  resetGame,
  handlePress,
  emptyPersonalBest,
  updatePersonalBest,
  loadPersonalBest,
  savePersonalBest,
  loadHistory,
  saveHistory,
  addSession,
  sessionFromGame,
  loadSettings,
  saveSettings,
  buildResultCard,
  buildShareText,
  buildResultText,
  drawResultCard,
  formatMs,
  formatSessionDate,
} from "./engine.js";

const $ = (id) => document.getElementById(id);

const storage = (() => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
})();

const safeStorage = storage || {
  getItem: () => null,
  setItem: () => { throw new Error("storage unavailable"); },
};

let settings = loadSettings(safeStorage);
let game = createGame(settings.rounds);
let pb = loadPersonalBest(safeStorage);
let history = loadHistory(safeStorage);
let lastStats = null;
let lastCard = null;
let pendingTimer = null;
let suppressNextClick = false;

function clearPendingTimer() {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
}

function setStatus(message) {
  $("status-line").textContent = message;
}

/* ------------------------------------------------------------------ */
/* Test-area rendering                                                 */
/* ------------------------------------------------------------------ */

const AREA_TEXT = {
  idle: { title: "Ready?", sub: "Click the panel — or press Space — to start.", time: "" },
  waiting: { title: "Wait for green…", sub: "Do not click yet. Clicking early voids the round.", time: "" },
  ready: { title: "CLICK!", sub: "Tap now — as fast as you can.", time: "" },
  "false-start": { title: "Too soon!", sub: "That click was early. Click again to retry this round.", time: "" },
  "round-done": { title: "Round recorded", sub: "Click the panel for the next round.", time: "" },
  done: { title: "Test complete", sub: "Your results are below.", time: "" },
};

function renderArea() {
  const area = $("test-area");
  const text = AREA_TEXT[game.status] || AREA_TEXT.idle;
  area.dataset.state = game.status;
  area.className = `test-area state-${game.status}`;
  $("test-title").textContent = text.title;
  $("test-message").textContent = text.sub;
  let timeText = text.time;
  if (game.status === "round-done" && game.times.length > 0) {
    timeText = formatMs(game.times[game.times.length - 1]);
  } else if (game.status === "done" && lastStats) {
    timeText = `Best ${formatMs(lastStats.best)}`;
  }
  $("test-time").textContent = timeText;
  area.setAttribute("aria-label", `${text.title} ${text.sub}`);
}

function renderProgress() {
  const current = game.status === "idle" ? 0 : game.round;
  $("round-status").textContent = game.status === "done"
    ? `Finished — ${game.times.length} of ${game.total} rounds`
    : `Round ${current} of ${game.total}`;
  $("false-start-count").textContent = game.falseStarts === 0
    ? "No false starts"
    : `False starts: ${game.falseStarts}`;
  const list = $("round-times");
  list.innerHTML = "";
  for (let i = 0; i < game.total; i += 1) {
    const li = document.createElement("li");
    const time = game.times[i];
    if (typeof time === "number") {
      li.textContent = `Round ${i + 1} — ${formatMs(time)}`;
      li.className = "round-done-item";
    } else if (i === game.times.length && game.status !== "idle" && game.status !== "done") {
      li.textContent = `Round ${i + 1} — in progress`;
      li.className = "round-current-item";
    } else {
      li.textContent = `Round ${i + 1} — waiting`;
      li.className = "round-pending-item";
    }
    list.appendChild(li);
  }
}

function renderPills() {
  document.querySelectorAll("#rounds-pills .pill").forEach((pill) => {
    const n = Number(pill.dataset.rounds);
    pill.classList.toggle("active", n === game.total);
    pill.setAttribute("aria-pressed", n === game.total ? "true" : "false");
  });
}

/* ------------------------------------------------------------------ */
/* Game flow                                                           */
/* ------------------------------------------------------------------ */

function armRound() {
  clearPendingTimer();
  const delay = pickDelay(Math.random);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    markGreen(game, performance.now());
    renderArea();
    renderProgress();
  }, delay);
}

function startTest() {
  clearPendingTimer();
  startGame(game, settings.rounds);
  lastStats = null;
  lastCard = null;
  $("results-section").hidden = true;
  $("pb-callout").hidden = true;
  renderArea();
  renderProgress();
  setStatus(`Test started — ${game.total} rounds. Wait for green.`);
}

function finishGame(stats) {
  lastStats = stats;
  const at = new Date().toISOString();
  const updated = updatePersonalBest(pb, stats, at);
  pb = updated.pb;
  savePersonalBest(safeStorage, pb);
  history = addSession(history, sessionFromGame(game, stats, at));
  saveHistory(safeStorage, history);
  lastCard = buildResultCard(stats, pb, SITE_URL);
  renderArea();
  renderResults(stats, updated.newBestSingle, updated.newBestAverage);
  renderHistory();
  renderPersonalBest();
  renderCard();
}

function press() {
  return pressAt(performance.now());
}

/* The press handler. `now` is a performance.now() timestamp; main.js
 * normally passes performance.now(), tests pass explicit values. */
function pressAt(now) {
  if (game.status === "idle") {
    startTest();
    armRound();
    return { type: "started" };
  }
  if (game.status === "waiting") {
    clearPendingTimer();
  }
  const event = handlePress(game, now);
  if (event.type === "false-start") {
    renderArea();
    renderProgress();
    setStatus(`False start — round ${game.round} does not count. Click again to retry it.`);
  } else if (event.type === "rearm") {
    armRound();
    renderArea();
    renderProgress();
  } else if (event.type === "round") {
    renderArea();
    renderProgress();
    if (event.done) {
      finishGame(event.stats);
      setStatus(`Test complete. Best ${formatMs(event.stats.best)}, average ${formatMs(event.stats.average)}.`);
    } else {
      setStatus(`Round ${game.times.length} recorded: ${formatMs(event.time)}. Click for the next round.`);
    }
  } else if (event.type === "next") {
    beginNextRound(game);
    armRound();
    renderArea();
    renderProgress();
  }
  return event;
}

/* Test hook: turn the screen green immediately (bypasses the random
 * delay). `now` defaults to performance.now(). */
function simulateGreen(now = performance.now()) {
  markGreen(game, now);
  renderArea();
  renderProgress();
  return game.status === "ready";
}

/* ------------------------------------------------------------------ */
/* Results, personal best, history                                     */
/* ------------------------------------------------------------------ */

function renderResults(stats, newBestSingle, newBestAverage) {
  $("result-best").textContent = formatMs(stats.best);
  $("result-average").textContent = formatMs(stats.average);
  $("result-median").textContent = formatMs(stats.median);
  $("result-spread").textContent = formatMs(stats.spread);
  $("result-rank").textContent = stats.rank ? stats.rank.label : "—";
  $("result-rank-blurb").textContent = stats.rank ? stats.rank.blurb : "";
  $("result-rounds").textContent = `${stats.count} rounds · ${game.falseStarts} false start${game.falseStarts === 1 ? "" : "s"}`;
  const callout = $("pb-callout");
  if (newBestSingle || newBestAverage) {
    const parts = [];
    if (newBestSingle) parts.push(`new best single time (${formatMs(stats.best)})`);
    if (newBestAverage) parts.push(`new best average (${formatMs(stats.average)})`);
    callout.textContent = `New personal best — ${parts.join(" and ")}.`;
    callout.hidden = false;
  } else {
    callout.hidden = true;
  }
  $("results-section").hidden = false;
}

function renderPersonalBest() {
  $("pb-best").textContent = pb.bestSingle === null
    ? "No tests yet"
    : formatMs(pb.bestSingle);
  $("pb-average").textContent = pb.bestAverage === null
    ? "No tests yet"
    : formatMs(pb.bestAverage);
  $("pb-note").textContent = pb.bestSingle === null
    ? "Finish a test and your best times will show up here."
    : `Best single ${pb.bestSingleAt ? formatSessionDate(pb.bestSingleAt) : ""} · best average ${pb.bestAverageAt ? formatSessionDate(pb.bestAverageAt) : ""}`;
}

function renderHistory() {
  const section = $("history-section");
  const list = $("history-list");
  list.innerHTML = "";
  if (history.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  $("clear-history-btn").hidden = false;
  for (const entry of history) {
    const li = document.createElement("li");
    const main = document.createElement("span");
    main.className = "history-main";
    main.textContent = `${formatMs(entry.best)} best · ${formatMs(entry.average)} avg · ${entry.rank}`;
    const meta = document.createElement("span");
    meta.className = "history-meta";
    meta.textContent = `${entry.rounds} rounds · ${entry.falseStarts} false start${entry.falseStarts === 1 ? "" : "s"} · ${formatSessionDate(entry.at)}`;
    li.appendChild(main);
    li.appendChild(meta);
    list.appendChild(li);
  }
}

function clearHistory() {
  history = [];
  saveHistory(safeStorage, history);
  renderHistory();
  setStatus("History cleared.");
  return history;
}

/* ------------------------------------------------------------------ */
/* Result card                                                         */
/* ------------------------------------------------------------------ */

function renderCard() {
  const canvas = $("result-card-canvas");
  if (!lastCard) return false;
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) {
    $("card-status").textContent = "Result card preview is not available in this browser.";
    return false;
  }
  const ok = drawResultCard(ctx, lastCard, canvas.width, canvas.height);
  $("card-status").textContent = ok
    ? "Your result card is ready to download."
    : "Result card could not be drawn.";
  return ok;
}

function downloadCard() {
  if (!lastCard) {
    setStatus("Finish a test first, then download your result card.");
    return false;
  }
  const canvas = $("result-card-canvas");
  let ctx = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx || typeof canvas.toBlob !== "function") {
    $("card-status").textContent = "Downloading the card is not supported in this browser.";
    return false;
  }
  drawResultCard(ctx, lastCard, canvas.width, canvas.height);
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          $("card-status").textContent = "The card image could not be created.";
          resolve(false);
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `reflextest-${lastStats.best}ms.png`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        $("card-status").textContent = "Result card downloaded.";
        resolve(true);
      }, "image/png");
    } catch {
      $("card-status").textContent = "Downloading the card is not supported in this browser.";
      resolve(false);
    }
  });
}

async function copyText(text, doneMessage) {
  if (!text) return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      setStatus(doneMessage);
      return true;
    }
    throw new Error("clipboard unavailable");
  } catch {
    try {
      if (typeof document.execCommand !== "function") return false;
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      if (ok) setStatus(doneMessage);
      return ok;
    } catch {
      return false;
    }
  }
}

function copyResultText() {
  return copyText(buildResultText(lastStats, game.falseStarts), "Result copied to the clipboard.");
}

function copyShareText() {
  return copyText(buildShareText(lastStats, SITE_URL), "Challenge text copied to the clipboard.");
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function setRounds(n) {
  const rounds = normalizeRounds(Number(n));
  settings = { rounds };
  saveSettings(safeStorage, settings);
  clearPendingTimer();
  resetGame(game);
  game.total = rounds;
  lastStats = null;
  lastCard = null;
  $("results-section").hidden = true;
  renderPills();
  renderArea();
  renderProgress();
  setStatus(`Rounds set to ${rounds}.`);
  return rounds;
}

function restartTest() {
  clearPendingTimer();
  resetGame(game);
  lastStats = null;
  lastCard = null;
  $("results-section").hidden = true;
  renderArea();
  renderProgress();
  setStatus("Ready when you are — click the panel to start.");
}

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */

function init() {
  document.querySelectorAll("#rounds-pills .pill").forEach((pill) => {
    pill.addEventListener("click", () => setRounds(pill.dataset.rounds));
  });
  $("test-area").addEventListener("click", () => {
    // A Space keydown handled below can still produce a click in some
    // browsers (and in jsdom): ignore the one click that follows it, so
    // a single Space press can never count twice.
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    press();
  });
  $("test-area").addEventListener("keydown", (event) => {
    if (event.repeat) return; // holding Space down is not a new press
    if (event.code === "Space" || event.key === " ") {
      event.preventDefault();
      suppressNextClick = true;
      setTimeout(() => { suppressNextClick = false; }, 0);
      press();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.repeat) return; // holding Space down is not a new press
    // Only when the keypress landed on the page itself, not on a control
    // that handles Space on its own (the test area has its own handler).
    if ((event.code === "Space" || event.key === " ") && event.target === document.body) {
      event.preventDefault();
      press();
    }
  });
  $("restart-btn").addEventListener("click", restartTest);
  $("new-test-btn").addEventListener("click", restartTest);
  $("download-card-btn").addEventListener("click", () => { downloadCard(); });
  $("copy-result-btn").addEventListener("click", () => { copyResultText(); });
  $("copy-share-btn").addEventListener("click", () => { copyShareText(); });
  $("clear-history-btn").addEventListener("click", clearHistory);
  renderPills();
  renderArea();
  renderProgress();
  renderPersonalBest();
  renderHistory();
}

init();

export {
  startTest,
  press,
  pressAt,
  simulateGreen,
  setRounds,
  restartTest,
  clearPendingTimer,
  renderCard,
  downloadCard,
  copyResultText,
  copyShareText,
  clearHistory,
  getState,
};

function getState() {
  return {
    game: {
      total: game.total,
      status: game.status,
      round: game.round,
      times: [...game.times],
      falseStarts: game.falseStarts,
      greenAt: game.greenAt,
    },
    stats: lastStats ? { ...lastStats } : null,
    pb: { ...pb },
    history: history.map((h) => ({ ...h })),
    settings: { ...settings },
    rankLabel: lastStats ? rankLabel(lastStats.average) : null,
  };
}
