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

## Trading lab (private)

`/trader/` is a private, halal (long-only, cash-only) trading simulator. It is
gated behind Google sign-in and only lets in the email addresses you allow.

- **Mode 1: Simulation** (built). Backtests strategies on real daily prices for
  shariah-screened ETFs, with charts, win rates, odds and a halal checklist.
- **Mode 2: Live** (not built yet).

### One-time setup on Vercel

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
   create an **OAuth client ID** of type *Web application*. Under **Authorized
   JavaScript origins** add your site's address, for example
   `https://your-site.vercel.app` (add your custom domain too, if you have one).
2. In Vercel → Project → Settings → **Environment Variables**, add:
   - `GOOGLE_CLIENT_ID`: the client ID from step 1
   - `ALLOWED_EMAILS`: the Gmail address(es) allowed in, comma-separated
   - `SESSION_SECRET`: a long random string, for example the output of `openssl rand -hex 32`
3. Redeploy. Visiting `/trader/` now redirects to the sign-in page.

Until these are set, the lab stays locked for everyone (it fails closed).

### How it fits together

| Path | What it does |
|---|---|
| `middleware.js` | Redirects anyone without a valid session away from `/trader/*` and `/api/prices` |
| `api/auth.js` | Verifies the Google sign-in token and the allow list, then sets a signed cookie |
| `api/prices.js` | Fresh daily prices from Yahoo Finance (signed-in users only) |
| `trader/lib/` | Backtest engine, strategies, statistics, charts |
| `trader/data/` | Saved price history, used when live prices are unavailable |

Refresh the saved prices by downloading Yahoo chart JSON files into a folder and
running `node scripts/build-snapshot.mjs <folder>`. Run the tests with `npm test`.

The simulation is educational. It is not financial advice or a religious ruling.
