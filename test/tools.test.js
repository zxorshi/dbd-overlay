const test = require('node:test');
const assert = require('node:assert');
const { defaultState, dispatch, merge, slotMs } = require('../src/main/tools');
const perks = require('../data/perks.json');
const characters = require('../data/characters.json');
const ctx = (now, r = 0.5) => ({ now, perks, characters, random: () => r });

test('timer: run, stop, switch, penalty', () => {
  const s = defaultState();
  dispatch(s, 'timer.toggle', {}, ctx(1000));
  dispatch(s, 'timer.toggle', {}, ctx(31000));
  assert.equal(slotMs(s.timer.slots[0], 99999), 30000);
  dispatch(s, 'timer.penalty', { ms: 5000 }, ctx(0));
  assert.equal(s.timer.slots[0].base, 25000);
  dispatch(s, 'timer.toggle', {}, ctx(40000));
  dispatch(s, 'timer.switch', {}, ctx(41000));
  assert.equal(s.timer.active, 1);
  assert.equal(s.timer.slots[0].startedAt, null);
  assert.equal(s.timer.slots[0].base, 26000);
});

test('perk timers: only armed timers fire', () => {
  const s = defaultState();
  dispatch(s, 'perks.fireAll', {}, ctx(1000));
  const ds = s.perks.list.find((p) => p.id === 'ds');
  const otr = s.perks.list.find((p) => p.id === 'otr');
  assert.equal(ds.endsAt, 1000 + ds.seconds * 1000);
  assert.equal(otr.endsAt, null);
});

test('streak: win, loss, undo', () => {
  const s = defaultState();
  dispatch(s, 'streak.win'); dispatch(s, 'streak.win'); dispatch(s, 'streak.loss');
  assert.deepEqual([s.streak.current, s.streak.best, s.streak.attempts], [0, 2, 2]);
  dispatch(s, 'streak.undo');
  assert.deepEqual([s.streak.current, s.streak.best, s.streak.attempts], [2, 2, 1]);
});

test('perk shuffle: four unique perks of the role, locked slot kept', () => {
  const s = defaultState();
  let i = 0; const c = { ...ctx(0), random: () => ((i++ * 0.37) % 1) };
  dispatch(s, 'perkShuffle.roll', {}, c);
  const first = [...s.perkShuffle.result];
  assert.equal(new Set(first).size, 4);
  assert.ok(first.every((id) => perks.find((p) => p.id === id).role === 'survivor'));
  s.perkShuffle.locked[0] = true;
  dispatch(s, 'perkShuffle.roll', {}, c);
  assert.equal(s.perkShuffle.result[0], first[0]);
  assert.equal(new Set(s.perkShuffle.result).size, 4);
});

test('killer shuffle: no repeats across a full cycle', () => {
  const s = defaultState();
  const killers = characters.filter((x) => x.role === 'killer');
  const seen = new Set();
  for (let n = 0; n < killers.length; n++) { dispatch(s, 'killerShuffle.roll', {}, { ...ctx(0), random: Math.random }); seen.add(s.killerShuffle.result); }
  assert.equal(seen.size, killers.length);
});

test('merge keeps saved values and adds new keys', () => {
  const m = merge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } });
  assert.deepEqual(m, { a: 1, b: { c: 9, d: 3 } });
});

const { scoreSummary, statsSummary, derive } = require('../src/main/tools');
test('scoreboard: set decided by stages, then gens left', () => {
  const s = defaultState();
  for (let n = 0; n < 5; n++) dispatch(s, 'score.hook', { i: 0 }, ctx(0));
  dispatch(s, 'score.hook', { i: 1, dead: true }, ctx(0)); dispatch(s, 'score.hook', { i: 2 }, ctx(0));
  assert.deepEqual([s.score.current.stages, s.score.current.kills], [7, 2]);
  dispatch(s, 'score.current', { stages: 8, gensLeft: 2 }, ctx(0)); dispatch(s, 'score.endGame', {}, ctx(0));
  assert.equal(s.score.current.killerTeam, 1);
  dispatch(s, 'score.current', { stages: 8, gensLeft: 1 }, ctx(0)); dispatch(s, 'score.endGame', {}, ctx(0));
  const sum = scoreSummary(s.score);
  assert.deepEqual(sum.sets, [1, 0]);
  assert.equal(sum.need, 2);
});
test('rulesets: banned perk and duplicate perk are reported', () => {
  const s = defaultState();
  dispatch(s, 'rules.import', { json: JSON.stringify({ name: 'Test', banned: ['Decisive Strike'], maxExhaustion: 1 }) }, ctx(5));
  dispatch(s, 'builds.add', { perks: ['DecisiveStrike', 'Lithe', 'Sprint_Burst', null] }, ctx(7));
  s.lobby.survivors[0].perks[0] = 'Lithe'; s.lobby.survivors[1].perks[0] = 'Lithe';
  const d = derive(s, perks);
  assert.equal(d.buildIssues[s.builds.list[0].id].length, 2);
  assert.ok(d.lobbyIssues.some((x) => x.includes('Lithe used 2 times')));
});
test('league preset: conversion and per-killer check', () => {
  const { convertPreset } = require('../src/main/leagues');
  const theirPerks = [{ id: 0, name: 'Lithe' }, { id: 1, name: 'Sprint Burst' }, { id: 2, name: 'Kindred' }, { id: 3, name: 'Corrupt Intervention' }];
  const preset = { Name: 'L', MaxPerkRepetition: 1, Tiers: [{ Name: 'General', SurvivorIndvPerkBans: ['2'], KillerIndvPerkBans: [], SurvivorComboPerkBans: [['0', '1']], KillerComboPerkBans: [] }, { Name: 'Tier 1', SurvivorIndvPerkBans: ['0'], KillerIndvPerkBans: ['3'], SurvivorComboPerkBans: [], KillerComboPerkBans: [] }],
    KillerOverride: [{ Name: 'The Nurse', IsDisabled: false, Map: [5], BalanceTiers: [0, 1], SurvivorBalanceTiers: [0, 1], SurvivorWhitelistedPerks: [], KillerWhitelistedPerks: [] }] };
  const rs = convertPreset(preset, theirPerks, [{ ID: 5, Name: 'Coal Tower I' }], perks, characters);
  const nurse = characters.find((c) => c.name === 'The Nurse').id;
  assert.deepEqual(rs.killers[nurse].maps, ['Coal Tower I']);
  const s = defaultState(); dispatch(s, 'rules.addImported', { ruleset: rs }, ctx(3));
  dispatch(s, 'builds.add', { perks: ['Lithe', null, null, null] }, ctx(4));
  assert.equal(derive(s, perks).buildIssues[s.builds.list[0].id].length, 0);
  s.builds.vsKiller = nurse;
  assert.match(derive(s, perks).buildIssues[s.builds.list[0].id][0], /Lithe is banned on The Nurse/);
});
test('stats: win rate per character', () => {
  const sum = statsSummary([{ character: 'A', result: 'win' }, { character: 'A', result: 'loss' }, { character: 'B', result: 'win' }]);
  assert.equal(sum.total.rate, 67);
  assert.equal(sum.by[0].key, 'B');
});

const { matchMap, buildCatalog, createSession } = require('../src/main/detect');
const catalog = buildCatalog(require('../data/maps.json'));
test('map match: exact, variants, strict alias, OCR typo', () => {
  assert.equal(matchMap(['THE MACMILLAN ESTATE', 'COAL TOWER'], catalog).name, 'Coal Tower');
  assert.equal(matchMap(['Coal Tower II'], catalog).name, 'Coal Tower II');
  assert.equal(matchMap(['Leave the game'], catalog), null);
  assert.equal(matchMap(['THE GAME'], catalog).name, 'The Game');
  assert.equal(matchMap(['Azarovs Restinq Place'], catalog).name, "Azarov's Resting Place");
  assert.equal(matchMap(['Repair generators', 'Escape the trial'], catalog), null);
});
test('map session: locks after two reads, unlocks at scoreboard, cooldown blocks re-lock', () => {
  const s = createSession(catalog); const cur = { id: null, locked: false };
  assert.equal(s.onLines(['Blood Lodge'], cur, 0), null);
  const ev = s.onLines(['Blood Lodge'], cur, 2000);
  assert.ok(ev.lock); cur.id = ev.lock; cur.locked = true;
  assert.deepEqual(s.onLines(['SCOREBOARD', 'Blood Lodge'], cur, 60000), { unlock: true }); cur.locked = false;
  assert.equal(s.onLines(['Blood Lodge'], cur, 62000), null);
  assert.equal(s.onLines(['Blood Lodge'], cur, 64000), null);
  s.onLines(['Gas Heaven'], cur, 90000);
  assert.ok(s.onLines(['Gas Heaven'], cur, 92000).lock);
});

test('timer: score round goes to the longer run', () => {
  const s = defaultState();
  s.timer.slots[0].base = 40000; s.timer.slots[1].base = 52000;
  dispatch(s, 'timer.scoreRound', {}, ctx(0));
  assert.deepEqual(s.timer.rounds, [0, 1]);
  assert.equal(s.timer.history.length, 1);
  assert.equal(s.timer.slots[1].base, 0);
});
test('stats entry can move streak and challenge', () => {
  const s = defaultState();
  dispatch(s, 'stats.add', { result: 'win', streak: true, challenge: true }, ctx(1));
  assert.deepEqual([s.streak.current, s.challenge.wins, s.stats.matches.length], [1, 1, 1]);
});

test('scoreboard target mode: killer needs the win condition', () => {
  const s = defaultState(); dispatch(s, 'score.set', { mode: 'target', targetStages: '9' }, ctx(0));
  dispatch(s, 'score.current', { stages: 9 }, ctx(0)); dispatch(s, 'score.endGame', {}, ctx(0));
  dispatch(s, 'score.current', { stages: 8 }, ctx(0)); dispatch(s, 'score.endGame', {}, ctx(0));
  assert.deepEqual(scoreSummary(s.score).sets, [2, 0]);
});

test('scoreboard logs finished games to stats for my team', () => {
  const s = defaultState(); dispatch(s, 'score.set', { myTeam: '1' }, ctx(0));
  dispatch(s, 'score.hook', { i: 0, dead: true }, ctx(0)); dispatch(s, 'score.endGame', {}, ctx(5));
  assert.deepEqual([s.stats.matches[0].role, s.stats.matches[0].result], ['survivor', 'win']);
});
test('crosshair profiles: save, change, cycle back', () => {
  const s = defaultState(); dispatch(s, 'crosshair.saveProfile', { name: 'Huntress' }, ctx(1));
  dispatch(s, 'crosshair.set', { size: 60, offsetY: 12 }, ctx(2)); dispatch(s, 'crosshair.saveProfile', { name: 'Slinger' }, ctx(3));
  dispatch(s, 'crosshair.next', {}, ctx(4));
  assert.deepEqual([s.crosshair.size, s.crosshair.offsetY, s.crosshair.profiles.length], [24, 0, 2]);
});
