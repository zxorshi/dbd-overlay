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
