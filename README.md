# Personal website (placeholder)

A minimal, editorial-style placeholder for a personal site. Plain HTML, CSS and JS: no build step.

- Serif display type (Instrument Serif) paired with Inter
- Light and dark themes (follows the system setting, with a manual toggle)
- Lists for work and writing that highlight the hovered row and dim the rest
- Fade-in on scroll, film grain overlay, local clock
- Responsive, and respects `prefers-reduced-motion`

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Customize

Everything lives in `index.html`. Search for `Your Name`, `Somewhere, Earth`, `hello@example.com` and the `href="#"` links, and swap in your own details. Colors are defined as CSS variables at the top of `styles.css`.

## Deploy

Works as-is on GitHub Pages, Netlify, Vercel or Cloudflare Pages. For GitHub Pages, go to Settings → Pages and pick this branch with the root folder.
