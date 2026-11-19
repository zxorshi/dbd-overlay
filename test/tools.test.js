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
  dispatch(s, 'score.bump', { field: 'stages', delta: 20 }, ctx(0));
  assert.equal(s.score.current.stages, 12);
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
