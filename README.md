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

The **Trading** tab in the site header opens `/trading/`. Anyone not signed in,
and anyone who signs in with a Google account other than ansari342@gmail.com,
sees a "Coming soon" page. Signing in with ansari342@gmail.com opens the
private trading lab: a halal (long-only, cash-only) strategy simulator.

### One-time setup (about 3 minutes)

1. Go to [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials)
   (any Google account works; no billing needed). If asked, create a project and
   fill in the OAuth consent screen with just an app name and your email.
2. Click **Create credentials → OAuth client ID**, choose **Web application**, and
   under **Authorized JavaScript origins** add your site's address, for example
   `https://website-one-umber-15.vercel.app` (and your custom domain, if any).
3. Copy the client ID (it ends in `.apps.googleusercontent.com`). In Vercel →
   Project → Settings → **Environment Variables**, add `GOOGLE_CLIENT_ID` with
   that value, then redeploy.

That's it. Until `GOOGLE_CLIENT_ID` is set, the tab shows "Coming soon" to
everyone, including you.

Optional settings:
- `SESSION_SECRET` (a long random string): keeps you signed in for 7 days
  instead of about an hour. Without it, the page signs you back in automatically
  with Google's one-tap prompt.
- `ALLOWED_EMAILS`: a comma-separated list that replaces the built-in allowed
  account.

### How it fits together

| Path | What it does |
|---|---|
| `middleware.js` | Sends anyone who isn't the allowed account from `/trading/*` to the Coming soon page |
| `api/auth.js` | Verifies the Google sign-in; the allowed account gets a cookie, others get "coming soon" |
| `lib/google.js` | The allowed account and the Google token check |
| `api/prices.js` | Fresh daily prices from Yahoo Finance (signed-in only) |
| `trading/lib/` | Backtest engine, strategies, statistics, charts |
| `trading/data/` | Saved price history, used when live prices are unavailable |

Refresh the saved prices by downloading Yahoo chart JSON files into a folder and
running `node scripts/build-snapshot.mjs <folder>`. Run the tests with `npm test`.

The simulation is educational. It is not financial advice or a religious ruling.
