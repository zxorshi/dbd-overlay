// Refreshes data/perks.json and data/characters.json (names and roles only).
// Source: dbd.tricky.lol community API. Run: npm run update-data
import { writeFileSync } from 'node:fs';
const get = async (p) => (await fetch('https://dbd.tricky.lol/api/' + p)).json();
const [perks, chars, mapData] = await Promise.all([get('perks'), get('characters'), get('maps')]);
const maps = Object.entries(mapData).map(([id, m]) => ({ id, name: m.name, realm: m.realm }))
  .sort((a, b) => a.realm.localeCompare(b.realm) || a.name.localeCompare(b.name));
writeFileSync('data/maps.json', JSON.stringify(maps, null, 1));
const characters = Object.entries(chars)
  .map(([num, c]) => ({ id: c.id, num: Number(num), name: c.name, role: c.role }))
  .sort((a, b) => a.name.localeCompare(b.name));
const byNum = Object.fromEntries(characters.map((c) => [c.num, c.id]));
const perkList = Object.entries(perks)
  .map(([id, p]) => ({ id, name: p.name, role: p.role, character: byNum[p.character] ?? null }))
  .sort((a, b) => a.name.localeCompare(b.name));
writeFileSync('data/characters.json', JSON.stringify(characters, null, 1));
writeFileSync('data/perks.json', JSON.stringify(perkList, null, 1));
console.log(`perks ${perkList.length}, characters ${characters.length}`);
