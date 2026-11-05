# Ahsan Ansari — personal website

A minimal, dark, editorial-style personal site. Plain HTML, CSS and JS: no build step.

- Serif display type (Instrument Serif) paired with Inter
- Dark theme with a warm accent glow
- Side projects (from GitHub), a photography grid, experience and contact links
- Fade-in on scroll, film grain overlay, San Francisco local time
- Responsive, and respects `prefers-reduced-motion`

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Customize

All content lives in `index.html`.

- **Photos:** add images to a `photos/` folder and replace each `<span class="ph"></span>` in the Photography section with an `<img>` (see the comment there).
- **LinkedIn:** replace the placeholder `https://www.linkedin.com/` link with your profile URL.
- **Experience:** add earlier roles as extra `<li>` rows. Colors are defined as CSS variables at the top of `styles.css`.

## Deploy

Works as-is on GitHub Pages, Netlify, Vercel or Cloudflare Pages. For GitHub Pages, go to Settings → Pages and pick this branch with the root folder.
