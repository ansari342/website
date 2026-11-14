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
whether it is permissible. Fourteen strategies are available: the original four, five new ideas
(Breakout, Golden Cross, Volatility Target, Calm Leaders, Weekly Reversal) and
five variations (Band Bounce, Momentum Dips, Core + Dips, Dual Momentum,
Calm-Sized Dips), defined in `trading/lib/strategies.js` and
`trading/lib/strategies2.js`. Re-run the tuning with
`node scripts/hillclimb.mjs` (optionally followed by family ids to re-run only
those), then `node scripts/robustness.mjs` for the fragility check. Both update
`trading/data/hillclimb.json`.

The **100 lab** tab shows a larger experiment: 100 strategies (rule families
across 5-minute crypto, hourly crypto, hourly halal ETFs and daily markets,
including rules driven by the VIX, rates, the dollar, credit, breadth, GDELT
news tone and the crypto Fear & Greed index). Each is hill-climbed on return
over the tuning years, ranked on a separate picking period, and scored on a
final test period nothing was tuned or picked on. To reproduce it:

```sh
bash scripts/lab100-fetch.sh /some/folder        # free data, about 200 MB
for m in c5 c1h e1h ed cd; do node scripts/lab100.mjs /some/folder $m; done
node scripts/lab100.mjs /some/folder merge       # writes trading/data/lab100.json
```

The strategies are defined in `trading/lib/lab100.js` and run on the fast
bar backtester in `trading/lib/fast.js`.

Refresh the saved prices by downloading Yahoo chart JSON files into a folder and
running `node scripts/build-snapshot.mjs <folder>`. Run the tests with `npm test`.

The simulation is educational. It is not financial advice or a religious ruling.

## Rattil (Quran recitation videos)

`/rattil/` turns a recitation clip into a 1080×1920 video: each ayah's Arabic
appears as it is recited, with the English under it and a thin white line
animation that echoes its meaning. Everything runs in the visitor's browser and
the recording is never uploaded.

1. **Pauses.** The audio is decoded, resampled to 16 kHz and split into breath
   groups at the reciter's pauses (`rattil/lib/audio.js`).
2. **Recognition.** Each breath goes through Tarteel AI's
   `whisper-base-ar-quran` (8-bit browser build
   `nael239/tasme3-whisper-base-ar-quran-web`, about 100 MB, cached after the
   first visit) in a Web Worker via transformers.js (`rattil/worker.js`).
3. **Matching.** The model's words are lined up with the verified text to find
   the surah and ayahs and when each starts (`rattil/lib/match.js`). Only the
   verified text is shown. Ayahs joined in one breath share a screen, because the
   pause is the only boundary that can be trusted. The visitor can correct the
   surah and range, and if the model can't load they pick the range by hand.
4. **Animations.** For the line-animation style, `api/rattil-scenes.js` asks
   Claude (`claude-sonnet-5-5`) to design a scene for every ayah: first a plan
   for the whole passage (its theme, one recurring visual thread, an image per
   ayah), then the full scenes a few ayahs at a time, in parallel. Scenes are
   JSON in a small drawing format (named line-art shapes, paths, waves, rays,
   particles, branching, with timing and motion) that `rattil/lib/scenes.js`
   checks and draws. The rules forbid depicting people, prophets, angels,
   faces or animals. Designed scenes are saved in the browser per passage.
   **Needs `ANTHROPIC_API_KEY` in Vercel**; without it, or if a call fails,
   the built-in motifs are used.
5. **Video.** `rattil/lib/render.js` draws the frames, and `rattil/lib/encode.js`
   makes an MP4 with WebCodecs (H.264 + AAC). Browsers without an AAC encoder
   (Chrome on Linux, for example) record in real time instead, which gives WebM.

### Rattil access and spending

Rattil (the page and its API) is private: visitors sign in with Google, and
only emails in `ALLOWED_EMAILS` (default `ansari342@gmail.com`) get in. The AI
animations are capped at `DAILY_LIMIT_USD` (default $1) per Pacific day; each
call reserves its worst-case cost first, then records the real cost from the
API's token counts. Vercel environment variables:

| Variable | What it's for |
|---|---|
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client (Google Cloud → APIs & Services → Credentials → OAuth client ID, type "Web application"; authorized redirect URI `https://<your domain>/api/google/callback`) |
| `AUTH_SECRET` | Any long random string; signs the session cookie. Without it nobody can sign in. |
| `ALLOWED_EMAILS` | Optional; comma-separated. Defaults to `ansari342@gmail.com`. |
| `ANTHROPIC_API_KEY` | For the AI animations. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Upstash Redis (Vercel → Storage → Upstash for Redis), which keeps the daily total. Without it, no AI calls are made. |
| `DAILY_LIMIT_USD` | Optional; defaults to 1. |

The Quran text is bundled in `rattil/data/quran.json`: Hafs in Uthmani script
and the Saheeh International translation, from fawazahmed0/quran-api. Rebuild it
with `node scripts/build-quran-data.mjs <folder>`, which checks the text letter
by letter against a second Hafs copy (see the script for the files it needs).
Fonts (Noto Sans Arabic at regular weight, DM Sans; SIL Open Font License) are self-hosted in
`rattil/fonts/`.
