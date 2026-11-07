# Ahsan Ansari — personal website

A minimal, dark, editorial-style personal site. Plain HTML, CSS and JS: no build step.

- Poster-scale condensed display type (Anton) with Newsreader and JetBrains Mono, on a grid of ruled lines
- Interactive contour-line field in the hero that bends around the cursor
- Numbered side-project rows, a horizontal strip of photo frames, experience and a giant "Say hello"
- Dark theme, film grain, San Francisco local time
- Design inspired by Antoine Wodniack's portfolio (wodniack.dev); all code here is original
- Responsive, and respects `prefers-reduced-motion`

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Customize

All content lives in `index.html`.

- **Photos:** add images to a `photos/` folder and replace each `<span class="frame__img gN"></span>` in the Photography section with an `<img class="frame__img">` (see the comment there).
- **LinkedIn:** replace the two placeholder `https://www.linkedin.com/` links (the "Say hello" link and the LinkedIn button) with your profile URL.
- **Experience:** add earlier roles as extra `<li>` rows. Colors are defined as CSS variables at the top of `styles.css`.

## Deploy

Works as-is on GitHub Pages, Netlify, Vercel or Cloudflare Pages. For GitHub Pages, go to Settings → Pages and pick this branch with the root folder.

## Trading tab

The **Trading** tab in the site header opens `/trading/`. Visitors see a
"Coming soon" page with a passcode box. The right passcode opens the private
trading lab (a halal, long-only, cash-only strategy simulator) and keeps that
browser unlocked for 30 days. **Lock** in the lab's header locks it again.

The passcode is `12345` by default. Because this repository is public, anyone
reading the code can see that default, so change it: in Vercel → Project →
Settings → Environment Variables, add `TRADING_PASSCODE` with a code of your
choice and redeploy. Changing the passcode locks every browser that used the
old one.

### How it fits together

| Path | What it does |
|---|---|
| `middleware.js` | Sends anyone who hasn't entered the passcode from `/trading/*` to the Coming soon page |
| `api/unlock.js` | Checks the passcode and sets the 30-day unlock cookie |
| `lib/session.js` | The passcode and the signed unlock cookie |
| `api/prices.js` | Fresh daily prices from Yahoo Finance (signed-in only) |
| `trading/lib/` | Backtest engine, strategies, statistics, charts |
| `trading/data/` | Saved price history, used when live prices are unavailable |

The lab has four tabs: **Simulation** (strategy backtests), **Quick trades**
(the probability trader, scored on sampled weeks), **Tuning** (hill-climbed
settings, tuned on 2021–24 and tested on 2024–26) and **Live** (not built yet).
Crypto (spot only) can be selected alongside the halal funds; scholars differ on
whether it is permissible. Re-run the tuning with `node scripts/hillclimb.mjs`
(a few minutes); it rewrites `trading/data/hillclimb.json`.

Refresh the saved prices by downloading Yahoo chart JSON files into a folder and
running `node scripts/build-snapshot.mjs <folder>`. Run the tests with `npm test`.

The simulation is educational. It is not financial advice or a religious ruling.
