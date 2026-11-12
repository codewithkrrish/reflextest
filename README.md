# ReflexTest — Reaction Time Test

I built ReflexTest because I kept arguing with my friends about who has the fastest reflexes, and every "reaction test" I found was either buried in ads or wanted an account. This one is a single page: click, wait for green, click again. Five rounds, your best and average, a rank, and a card you can share to settle the argument.

## What it does

- **Reaction test, best of 5** — the panel turns red, waits a random 1.5–5 seconds, then turns green. Click or tap as fast as you can. You can also press Space. Rounds are selectable: 3, 5 or 10.
- **False starts are handled properly** — clicking while the panel is red voids the round, shows a warning, and lets you retry the same round. The void round is never recorded.
- **Results that mean something** — best time, average, median and consistency (spread between your fastest and slowest round), plus a rank based on your average: Pro Gamer under 180 ms, Lightning under 220, Sharp under 270, Average under 320, Steady under 400, and Warming Up above that.
- **Personal best, saved on your device** — your all-time best single time and best average live in localStorage, and beating either one gets a clear callout on the results screen.
- **Result card** — a downloadable PNG with your best, average and rank, drawn on a canvas, plus copyable result text and a "challenge a friend" share line.
- **Past tests** — your last 8 sessions with best, average, rank and false starts, with a clear-history button.
- **Works on mobile** — the whole test is one big tap target, and it works with a keyboard too.

## How it works

There is no server and no tracking. `js/engine.js` holds the pure logic: the game state machine (idle → waiting → ready → round-done → done), the stats (best, average, median, spread), the rank tiers, the personal-best and history storage helpers, and the result-card drawing data. `js/main.js` only wires that logic to the page and the timers. Timing uses `performance.now()`, so each round is measured from the exact moment the screen turns green.

## Honest limits

- Your number depends on your device. A phone touchscreen, a wireless mouse and a 144 Hz monitor will not give the same result, and this test measures your reaction **plus** your input latency together — it cannot separate the two.
- Reaction time also varies by time of day, tiredness and practice, so one session is a snapshot, not a verdict. The past-tests list exists for exactly that reason.
- The result card is drawn on a canvas in your browser; if your browser cannot do canvas, the download button tells you so instead of failing silently.

## Run it locally

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. No build step, no dependencies, no install.

## Tech

Vanilla HTML, CSS and JavaScript (ES modules). No frameworks, no analytics, no network calls at all — everything happens on your device.

## License

MIT — see [LICENSE](LICENSE).
