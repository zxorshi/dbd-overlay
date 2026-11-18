// Tool state and actions. Pure logic: no Electron imports, so it runs under `node --test`.
// Every action mutates `state` and returns nothing. `ctx` supplies { now, perks, characters, random }.

const OVERLAY_IDS = ['timer', 'crosshair', 'perks', 'streak', 'perkShuffle', 'killerShuffle'];

const overlayDefaults = (i) => ({
  open: false, locked: false, x: 80 + i * 30, y: 80 + i * 30, w: 360, h: 140,
  color: '#d7e3c5', scale: 1, opacity: 1,
});

function defaultState() {
  return {
    version: 1,
    overlays: Object.fromEntries(OVERLAY_IDS.map((id, i) => [id, overlayDefaults(i)])),
    hotkeys: {
      'timer.toggle': 'F1', 'timer.switch': 'F2', 'timer.reset': 'F3',
      'perks.fireAll': 'F4', 'streak.win': '', 'streak.loss': '',
      'perkShuffle.roll': '', 'killerShuffle.roll': '', 'overlays.toggleLock': 'F8',
    },
    timer: {
      layout: 'dual', // single | dual | compact
      active: 0,
      labels: ['You', 'Opponent'],
      slots: [{ base: 0, startedAt: null }, { base: 0, startedAt: null }],
      rounds: [0, 0],
      bestOf: 3,
    },
    crosshair: { shape: 'cross', size: 24, thickness: 2, gap: 4, dot: false, outline: true, offsetX: 0, offsetY: 0 },
    perks: {
      // Durations are defaults taken from community data. Editable. Check against the current patch.
      list: [
        { id: 'endurance', name: 'Unhook Endurance', seconds: 10, armed: true, tone: 440, endsAt: null },
        { id: 'bt', name: 'Borrowed Time', seconds: 20, armed: false, tone: 520, endsAt: null },
        { id: 'ds', name: 'Decisive Strike', seconds: 60, armed: true, tone: 660, endsAt: null },
        { id: 'otr', name: 'Off the Record', seconds: 40, armed: false, tone: 780, endsAt: null },
      ],
    },
    streak: { label: 'Streak', rule: '3k', current: 0, best: 0, attempts: 1, history: [] },
    perkShuffle: { role: 'survivor', excluded: [], locked: [false, false, false, false], result: [null, null, null, null] },
    killerShuffle: { excluded: [], noRepeat: true, played: [], result: null },
  };
}

const STREAK_RULES = {
  '3k': 'Killer: 3 kills or more is a win',
  '4k': 'Killer: 4 kills only',
  gate: 'Killer: any exit gate escape is a loss',
  escape: 'Survivor: escape is a win',
  custom: 'Custom',
};

const slotMs = (slot, now) => slot.base + (slot.startedAt ? now - slot.startedAt : 0);

function pick(arr, random) { return arr[Math.floor(random() * arr.length)]; }

const actions = {
  // ---- overlays
  'overlay.set'(s, { id, ...fields }) { if (s.overlays[id]) Object.assign(s.overlays[id], fields); },
  'overlay.toggle'(s, { id }) { if (s.overlays[id]) s.overlays[id].open = !s.overlays[id].open; },
  'overlays.toggleLock'(s) {
    const open = Object.values(s.overlays).filter((o) => o.open);
    const lock = open.some((o) => !o.locked);
    open.forEach((o) => { o.locked = lock; });
  },
  'hotkey.set'(s, { action, key }) { s.hotkeys[action] = key; },

  // ---- 1v1 timer
  'timer.toggle'(s, _p, { now }) {
    const slot = s.timer.slots[s.timer.active];
    if (slot.startedAt) { slot.base += now - slot.startedAt; slot.startedAt = null; } else slot.startedAt = now;
  },
  'timer.switch'(s, _p, { now }) {
    const cur = s.timer.slots[s.timer.active];
    if (cur.startedAt) { cur.base += now - cur.startedAt; cur.startedAt = null; }
    s.timer.active = s.timer.active ? 0 : 1;
  },
  'timer.reset'(s) { s.timer.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); s.timer.active = 0; },
  'timer.penalty'(s, { ms = 5000 }) {
    // Out-of-sight time is deducted from the survivor's run.
    const slot = s.timer.slots[s.timer.active];
    slot.base = Math.max(slot.startedAt ? -Infinity : 0, slot.base - ms);
  },
  'timer.round'(s, { slot, delta = 1 }) { s.timer.rounds[slot] = Math.max(0, s.timer.rounds[slot] + delta); },
  'timer.set'(s, fields) { Object.assign(s.timer, fields); },

  // ---- crosshair
  'crosshair.set'(s, fields) { Object.assign(s.crosshair, fields); },

  // ---- perk timers
  'perks.fireAll'(s, _p, { now }) { s.perks.list.forEach((p) => { if (p.armed) p.endsAt = now + p.seconds * 1000; }); },
  'perks.fire'(s, { id }, { now }) { const p = s.perks.list.find((x) => x.id === id); if (p) p.endsAt = now + p.seconds * 1000; },
  'perks.clear'(s) { s.perks.list.forEach((p) => { p.endsAt = null; }); },
  'perks.update'(s, { id, ...fields }) { const p = s.perks.list.find((x) => x.id === id); if (p) Object.assign(p, fields); },
  'perks.add'(s, { name = 'New timer', seconds = 30 }, { now }) {
    s.perks.list.push({ id: 't' + now, name, seconds, armed: true, tone: 600, endsAt: null });
  },
  'perks.remove'(s, { id }) { s.perks.list = s.perks.list.filter((p) => p.id !== id); },

  // ---- streak
  'streak.win'(s) {
    const k = s.streak; k.history.push({ current: k.current, best: k.best, attempts: k.attempts });
    k.current += 1; k.best = Math.max(k.best, k.current);
  },
  'streak.loss'(s) {
    const k = s.streak; k.history.push({ current: k.current, best: k.best, attempts: k.attempts });
    k.current = 0; k.attempts += 1;
  },
  'streak.undo'(s) { const prev = s.streak.history.pop(); if (prev) Object.assign(s.streak, prev); },
  'streak.set'(s, fields) { Object.assign(s.streak, fields); },

  // ---- perk shuffle
  'perkShuffle.set'(s, fields) { Object.assign(s.perkShuffle, fields); },
  'perkShuffle.roll'(s, _p, { perks, random }) {
    const ps = s.perkShuffle;
    const kept = ps.result.filter((id, i) => ps.locked[i] && id);
    let pool = perks.filter((p) => p.role === ps.role && !ps.excluded.includes(p.id) && !kept.includes(p.id));
    ps.result = ps.result.map((id, i) => {
      if (ps.locked[i] && id) return id;
      if (!pool.length) return null;
      const p = pick(pool, random); pool = pool.filter((x) => x !== p); return p.id;
    });
  },

  // ---- killer shuffle
  'killerShuffle.set'(s, fields) { Object.assign(s.killerShuffle, fields); },
  'killerShuffle.roll'(s, _p, { characters, random }) {
    const ks = s.killerShuffle;
    const roster = characters.filter((c) => c.role === 'killer' && !ks.excluded.includes(c.id));
    if (!roster.length) { ks.result = null; return; }
    let pool = ks.noRepeat ? roster.filter((c) => !ks.played.includes(c.id)) : roster;
    if (!pool.length) { ks.played = []; pool = roster; }
    if (pool.length > 1) pool = pool.filter((c) => c.id !== ks.result);
    ks.result = pick(pool, random).id;
    if (ks.noRepeat) ks.played.push(ks.result);
  },
  'killerShuffle.resetPlayed'(s) { s.killerShuffle.played = []; },
};

function dispatch(state, name, payload, ctx) {
  const fn = actions[name];
  if (!fn) return false;
  fn(state, payload || {}, ctx);
  return true;
}

// Fill in keys added by newer versions without discarding saved values.
function merge(base, saved) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return saved === undefined ? base : saved;
  const out = { ...base };
  for (const k of Object.keys(saved || {})) out[k] = k in base ? merge(base[k], saved[k]) : saved[k];
  return out;
}

module.exports = { defaultState, dispatch, merge, slotMs, OVERLAY_IDS, STREAK_RULES };
