// Refreshes data/perks.json and data/characters.json (names and roles only).
// Source: dbd.tricky.lol community API. Run: npm run update-data
import { writeFileSync } from 'node:fs';
const get = async (p) => (await fetch('https://dbd.tricky.lol/api/' + p)).json();
const [perks, chars] = await Promise.all([get('perks'), get('characters')]);
const characters = Object.entries(chars)
  .map(([num, c]) => ({ id: c.id, num: Number(num), name: c.name, role: c.role,
    ...(c.role === 'killer' && c.tunables ? { speed: c.tunables.MaxWalkSpeed ? c.tunables.MaxWalkSpeed / 100 : null, terror: c.tunables.TerrorRadius ? c.tunables.TerrorRadius / 100 : null, height: c.height || null } : {}) }))
  .sort((a, b) => a.name.localeCompare(b.name));
const byNum = Object.fromEntries(characters.map((c) => [c.num, c.id]));
const perkList = Object.entries(perks)
  .map(([id, p]) => ({ id, name: p.name, role: p.role, character: byNum[p.character] ?? null }))
  .sort((a, b) => a.name.localeCompare(b.name));
// The community API can lag behind renames. The wiki redirects an old page title to the current one,
// so a redirect gives the current in-game name; the old name is kept as `aka` for search.
const flat = (t) => t.normalize('NFD').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
function differs(a, b) {
  const x = flat(a); const y = flat(b); let same = 0;
  for (const ch of new Set(x)) same += Math.min(x.split(ch).length, y.split(ch).length) - 1;
  return same / Math.max(x.length, y.length) < 0.8;
}
async function currentNames(list) {
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40);
    const res = await fetch('https://deadbydaylight.wiki.gg/api.php?action=query&format=json&redirects=1&titles=' + encodeURIComponent(batch.map((x) => x.name).join('|')));
    const q = (await res.json()).query || {};
    const norm = Object.fromEntries((q.normalized || []).map((n) => [n.from, n.to]));
    const redirect = Object.fromEntries((q.redirects || []).map((r) => [r.from, r.to]));
    for (const item of batch) {
      const to = redirect[norm[item.name] || item.name];
      // Spelling-only differences (accents, Chili/Chilli) and disambiguation pages are not renames.
      if (to && !/[#(]/.test(to) && !list.some((x) => x.name === to) && differs(item.name, to)) { item.aka = item.name; item.name = to; }
    }
  }
}
await currentNames(perkList);
// Renames the wiki has no redirect for (checked against balancedbydaylight.com perk aliases).
const MANUAL = { 'Save the best for last': 'Keep Them Waiting' };
for (const p of perkList) if (MANUAL[p.name]) { p.aka = 'Save the Best for Last'; p.name = MANUAL[p.name]; }
perkList.sort((a, b) => a.name.localeCompare(b.name));
writeFileSync('data/characters.json', JSON.stringify(characters, null, 1));
writeFileSync('data/perks.json', JSON.stringify(perkList, null, 1));
console.log(`perks ${perkList.length}, characters ${characters.length}`);
