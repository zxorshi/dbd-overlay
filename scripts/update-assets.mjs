// Downloads perk icons and character portraits from deadbydaylight.wiki.gg into assets/game/.
// Game art is the property of Behaviour Interactive and is not covered by this project's MIT license.
// Run: npm run update-assets
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
const UA = { 'User-Agent': 'dbd-overlay-asset-sync' };
const get = async (u) => { for (let n = 0; n < 4; n++) { try { const r = await fetch(u, { headers: UA }); if (r.ok) return r; } catch { /* retry */ } await new Promise((r) => setTimeout(r, 500 * (n + 1))); } return null; };
const json = async (u) => { const r = await get(u); try { return r ? await r.json() : {}; } catch { return {}; } };
const base = (p) => p.split('/').pop().replace(/\.png$/i, '');
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const [perks, chars] = await Promise.all([json('https://dbd.tricky.lol/api/perks'), json('https://dbd.tricky.lol/api/characters')]);
const jobs = [
  ...Object.entries(perks).map(([id, p]) => ({ dir: 'perks', id, file: cap(base(p.image)) + '.png', width: 128 })),
  ...Object.values(chars).filter((c) => c.image).map((c) => ({ dir: 'portraits', id: c.id, file: base(c.image) + '.png', width: 256 })),
];
mkdirSync('assets/game/perks', { recursive: true }); mkdirSync('assets/game/portraits', { recursive: true });

const manifest = { perks: [], portraits: [] }; const missing = [];
for (let i = 0; i < jobs.length; i += 40) {
  const batch = jobs.slice(i, i + 40);
  const width = batch[0].width;
  const groups = [batch.filter((j) => j.width === width), batch.filter((j) => j.width !== width)].filter((g) => g.length);
  for (const g of groups) {
    const q = await json('https://deadbydaylight.wiki.gg/api.php?action=query&format=json&prop=imageinfo&iiprop=url&iiurlwidth=' + g[0].width +
      '&titles=' + encodeURIComponent(g.map((j) => 'File:' + j.file).join('|')));
    const norm = Object.fromEntries((q.query.normalized || []).map((n) => [n.from, n.to]));
    const pages = Object.values(q.query.pages);
    for (const j of g) {
      const title = norm['File:' + j.file] || 'File:' + j.file;
      const info = (pages.find((p) => p.title.toLowerCase() === title.toLowerCase()) || {}).imageinfo;
      const out = `assets/game/${j.dir}/${j.id}.png`;
      if (existsSync(out)) { manifest[j.dir].push(j.id); continue; }
      if (!info) { missing.push(j.file); continue; }
      const res = await get(info[0].thumburl || info[0].url);
      if (!res) { missing.push(j.file); continue; }
      writeFileSync(out, Buffer.from(await res.arrayBuffer()));
      manifest[j.dir].push(j.id);
    }
  }
}
// Second pass for files the wiki stores under another name.
const wiki = 'https://deadbydaylight.wiki.gg/api.php?format=json&action=query&';
const camel = (name) => name.replace(/&/g, 'And').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean)
  .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w[0].toLowerCase() + w.slice(1))).join('');
const byId = Object.fromEntries(Object.entries(perks));
const charById = Object.fromEntries(Object.values(chars).map((c) => [c.id, c]));
const current = Object.fromEntries(JSON.parse(readFileSync('data/perks.json', 'utf8')).map((p) => [p.id, p.name]));
const still = [];
for (const j of jobs) {
  if (manifest[j.dir].includes(j.id)) continue;
  let url = null;
  if (j.dir === 'perks') {
    const name = current[j.id] || byId[j.id].name;
    const q = await json(wiki + 'prop=imageinfo&iiprop=url&iiurlwidth=128&titles=' + encodeURIComponent('File:IconPerks_' + camel(name) + '.png'));
    const pg = (Object.values(q.query?.pages ?? {})[0] ?? {});
    if (pg.imageinfo) url = pg.imageinfo[0].thumburl || pg.imageinfo[0].url;
    if (!url) {
      const r = await json(wiki + 'list=search&srnamespace=6&srlimit=5&srsearch=' + encodeURIComponent('IconPerks ' + name.replace(/[^A-Za-z0-9 ]/g, ' ')));
      const hit = (r.query?.search || []).find((x) => /IconPerks/i.test(x.title) && /\.png$/i.test(x.title));
      if (hit) { const q2 = await json(wiki + 'prop=imageinfo&iiprop=url&iiurlwidth=128&titles=' + encodeURIComponent(hit.title)); const p2 = (Object.values(q2.query?.pages ?? {})[0] ?? {}); if (p2.imageinfo) url = p2.imageinfo[0].thumburl || p2.imageinfo[0].url; }
    }
  } else {
    const code = (j.file.match(/[KS]\d\d/) || [])[0];
    if (code) {
      const r = await json(wiki + 'list=allimages&ailimit=50&aiprop=url&aiprefix=' + code + '_');
      const hit = (r.query?.allimages || []).find((x) => /portrait/i.test(x.name) && /\.png$/i.test(x.name));
      if (hit) { const q2 = await json(wiki + 'prop=imageinfo&iiprop=url&iiurlwidth=256&titles=' + encodeURIComponent('File:' + hit.name)); const p2 = (Object.values(q2.query?.pages ?? {})[0] ?? {}); if (p2.imageinfo) url = p2.imageinfo[0].thumburl || p2.imageinfo[0].url; }
    }
  }
  const res = url && await get(url);
  if (!res) { still.push(j.dir === 'perks' ? byId[j.id].name : charById[j.id].name); continue; }
  writeFileSync(`assets/game/${j.dir}/${j.id}.png`, Buffer.from(await res.arrayBuffer()));
  manifest[j.dir].push(j.id);
}
missing.length = 0; missing.push(...still);
manifest.perks.sort(); manifest.portraits.sort();
writeFileSync('assets/game/manifest.json', JSON.stringify(manifest));
console.log(`perks ${manifest.perks.length}, portraits ${manifest.portraits.length}, missing ${missing.length}`);
if (missing.length) console.log(missing.join('\n'));
