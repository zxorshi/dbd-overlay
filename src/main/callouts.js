// Downloads Hens' clock callout images (hens333.com/callouts) to the user's computer on request.
// Images belong to their creators (map art by Lethia) and are never shipped with the app.
const fs = require('node:fs');
const path = require('node:path');
const { matchMap } = require('./detect');

const SITE = 'https://hens333.com';
const STYLES = ['classic', 'dark', 'empty'];

// The index page lists every map as a card with one thumbnail per style. A thumbnail is
// /_astro/<slug>.<hash>_<size>.webp and the full image is /_astro/<slug>.<hash>.webp.
function parseIndex(html, catalog) {
  const out = [];
  for (const card of html.matchAll(/<a href="\/callouts\/([a-z0-9-]+)"[^>]*>(.*?)<\/a>/gs)) {
    const map = matchMap([card[1].replace(/-/g, ' ')], catalog); if (!map) continue;
    const styles = {};
    for (const im of card[2].matchAll(/<img src="\/_astro\/([^"]+?)\.([A-Za-z0-9_-]{8})_[^"]*\.webp"[^>]*data-style="(\w+)"/g)) styles[im[3]] = `${SITE}/_astro/${im[1]}.${im[2]}.webp`;
    if (Object.keys(styles).length) out.push({ id: map.id, styles });
  }
  return out;
}

// Saves <dir>/hens-<style>/<map id>.webp for every map not already there. Returns { saved, failed, total }.
async function download({ dir, style, catalog, onProgress = () => {} }) {
  if (!STYLES.includes(style)) style = 'classic';
  const res = await fetch(SITE + '/callouts/', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error('hens333.com answered ' + res.status);
  const entries = parseIndex(await res.text(), catalog);
  if (!entries.length) throw new Error('No callouts found on hens333.com. The site layout may have changed.');
  const folder = path.join(dir, 'hens-' + style); fs.mkdirSync(folder, { recursive: true });
  let saved = 0; let failed = 0; let n = 0;
  for (const e of entries) {
    n += 1; onProgress(n, entries.length);
    const file = path.join(folder, e.id + '.webp'); const url = e.styles[style] || e.styles.classic;
    if (fs.existsSync(file)) continue;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!r.ok || !String(r.headers.get('content-type')).startsWith('image/')) throw new Error('not an image');
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer())); saved += 1;
    } catch { failed += 1; }
  }
  return { saved, failed, total: entries.length };
}

module.exports = { download, parseIndex, STYLES };
