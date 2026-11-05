# site

Flintstep's landing page, <https://flintstep.app>: plain HTML, CSS and a little JS, no
build.

```sh
python3 -m http.server -d site 8765   # http://localhost:8765, ?theme=light|dark to force a theme
```

- The repo URL lives in one place, `data-repo` on `<html>` in `index.html`. The site URL
  is in the canonical link and `og:url`/`og:image`.
- The pedal is generated: edit `scripts/site/pedal-svg.mjs`, then run `node scripts/site/pedal-svg.mjs`.
- `og.png` is a screenshot of `scripts/site/og.html` at 1200x630 (instructions in that file).
- `img/` holds screenshots of the app's browser mock (`frontend/`, `bunx vite`, then
  `?still&state=connected&cables=11&trigger=engage,toe&exp=62,100&hold=II`, plus
  `&picker=open` and `&theme=light`), taken at 1180x820 and 2x. `app-*` is the whole
  window (PNG at 1x, WebP at 1760 wide); `presets-*` is the 680x280 region at (496, 0)
  of the `&picker=open` shot (PNG at 1x, WebP at 2x).
  `curve-*` is the Response section of
  `?still&state=connected&cables=11&exp=62,100&sel=exp1&tuning=open&trigger=off,off&curve=custom:0.3/0.08_0.6/0.35_0.85/0.8`
  (326x329 at 1x PNG, WebP at 2x).

## Deploy on Railway

Railway's Railpack builder sees a directory with an `index.html` and no app framework
as a static site and serves it with Caddy, so no config file is needed:

1. New service from this GitHub repo.
2. Settings > Source > Root Directory: `site/`.
3. Settings > Networking > Custom Domain: `flintstep.app`, then add the DNS records
   Railway shows at the registrar.
4. Optional: Settings > Build > Watch Paths: `/site/**`, so only changes to the site
   redeploy it. Without it, every push to main does.

`.github/workflows/pages.yml` can also deploy this folder to GitHub Pages once the repo
is public. Use one host for the domain, not both.
