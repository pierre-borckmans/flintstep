# site

Flint's landing page: plain HTML, CSS and a little JS, no build. `.github/workflows/pages.yml`
deploys this folder to GitHub Pages on every push to main that touches it (set the repo's
Pages source to "GitHub Actions" once).

```sh
python3 -m http.server -d site 8765   # http://localhost:8765, ?theme=light|dark to force a theme
```

- The repo URL lives in one place, `data-repo` on `<html>` in `index.html`.
- The pedal is generated: edit `scripts/site/pedal-svg.mjs`, then run `node scripts/site/pedal-svg.mjs`.
- `og.png` is a screenshot of `scripts/site/og.html` at 1200x630 (instructions in that file).
- `img/` holds screenshots of the app's browser mock (`frontend/`, `bunx vite`, then
  `?still&state=connected&cables=11&trigger=engage,toe&exp=62,100&hold=II`, plus
  `&picker=open` and `&theme=light`), taken at 1180x820 and 2x, as WebP with PNG fallbacks.

Custom domain: add a `site/CNAME` file containing the domain, then point DNS at GitHub Pages.
