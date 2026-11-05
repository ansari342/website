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
