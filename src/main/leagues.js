// League balancing presets from Balanced by Daylight (balancedbydaylight.com, by Kyle Starr and contributors).
// Nothing from that site is shipped with this app. A preset is fetched when the user asks for it and stored locally.
const BASE = 'https://balancedbydaylight.com/';
const norm = (s) => String(s).normalize('NFD').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');

async function getJson(file) {
  const res = await fetch(BASE + file);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
  return res.json();
}
async function listPresets() {
  const list = await getJson('Balancings.json');
  return list.map((p) => ({ name: p.Name, path: p.Path, updated: p.LastUpdated, aliases: p.Aliases || '' })).filter((p) => p.path);
}

// Pure conversion: their preset + their perk and map tables -> this app's ruleset shape.
function convertPreset(preset, theirPerks, theirMaps, ourPerks, ourCharacters) {
  const ours = Object.fromEntries(ourPerks.flatMap((p) => [[norm(p.name), p.id], ...(p.aka ? [[norm(p.aka), p.id]] : [])]));
  const byTheirId = Object.fromEntries(theirPerks.map((p) => [String(p.id), ours[norm(p.name)] || String(p.aliases || '').split(',').map((a) => ours[norm(a)]).find(Boolean)]));
  const ids = (arr) => [...new Set((arr || []).map((x) => byTheirId[String(x)]).filter(Boolean))];
  const pairs = (arr) => (arr || []).map((pair) => ids(pair)).filter((p) => p.length > 1);
  const mapName = Object.fromEntries(theirMaps.map((m) => [String(m.ID), m.Name]));
  const charId = Object.fromEntries(ourCharacters.filter((c) => c.role === 'killer').map((c) => [norm(c.name), c.id]));
  const tiers = preset.Tiers || []; const general = tiers[0] || {};
  const fromTiers = (indexes, key) => (indexes || []).filter((i) => i !== 0).flatMap((i) => (tiers[i] || {})[key] || []);
  const killers = {};
  for (const k of preset.KillerOverride || []) {
    const id = charId[norm(k.Name)]; if (!id) continue;
    killers[id] = {
      name: k.Name, disabled: Boolean(k.IsDisabled), notes: String(k.KillerNotes || '').slice(0, 2000),
      tiers: (k.BalanceTiers || []).map((i) => (tiers[i] || {}).Name).filter(Boolean),
      maps: (k.Map || []).map((m) => mapName[String(m)]).filter(Boolean),
      survBanned: ids([...fromTiers(k.SurvivorBalanceTiers, 'SurvivorIndvPerkBans'), ...(k.SurvivorIndvPerkBans || [])]),
      killerBanned: ids([...fromTiers(k.BalanceTiers, 'KillerIndvPerkBans'), ...(k.KillerIndvPerkBans || [])]),
      survCombos: pairs([...fromTiers(k.SurvivorBalanceTiers, 'SurvivorComboPerkBans'), ...(k.SurvivorComboPerkBans || [])]),
      killerCombos: pairs([...fromTiers(k.BalanceTiers, 'KillerComboPerkBans'), ...(k.KillerComboPerkBans || [])]),
      survWhitelist: ids(k.SurvivorWhitelistedPerks), killerWhitelist: ids(k.KillerWhitelistedPerks),
    };
  }
  return {
    name: String(preset.Name || 'League preset').slice(0, 80), source: 'balancedbydaylight.com', updated: preset.Version || null,
    maxRepetition: Number(preset.MaxPerkRepetition) || 0, maxExhaustion: 0, uniquePerTeam: Number(preset.MaxPerkRepetition) === 1,
    notes: String(preset.GlobalNotes || '').slice(0, 4000),
    banned: ids(general.SurvivorIndvPerkBans), killerBanned: ids(general.KillerIndvPerkBans),
    combos: pairs(general.SurvivorComboPerkBans), killerCombos: pairs(general.KillerComboPerkBans),
    killers,
  };
}

async function importPreset(presetPath, ourPerks, ourCharacters) {
  if (!/^BalancingPresets\/[\w\-./ ()']+\.json$/.test(presetPath) || presetPath.includes('..')) throw new Error('Unexpected preset path');
  const [preset, theirPerks, theirMaps] = await Promise.all([getJson(presetPath.split('/').map(encodeURIComponent).join('/')), getJson('Perks/dbdperks.json'), getJson('NewMaps.json')]);
  return convertPreset(preset, theirPerks, theirMaps, ourPerks, ourCharacters);
}

module.exports = { listPresets, importPreset, convertPreset };
