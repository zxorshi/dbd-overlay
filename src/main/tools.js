// Tool state and actions. Pure logic: no Electron imports, so it runs under `node --test`.
// Every action mutates `state` and returns nothing. `ctx` supplies { now, perks, characters, random }.

const OVERLAY_IDS = ['timer', 'crosshair', 'perks', 'streak', 'perkShuffle', 'killerShuffle', 'builds', 'lobby', 'score', 'stats', 'challenge', 'map'];

const SIZES = { map: [420, 440], lobby: [380, 260], score: [900, 120], builds: [420, 150], stats: [520, 110], challenge: [380, 200], perkShuffle: [400, 150], perks: [300, 200] };
const overlayDefaults = (i, id) => ({
  open: false, locked: false, x: 80 + i * 30, y: 80 + i * 30, w: (SIZES[id] || [360])[0], h: (SIZES[id] || [0, 140])[1],
  color: '#d7e3c5', scale: 1, opacity: 1, bg: 0.72,
});

const newGame = (killerTeam) => ({ killerTeam, killer: null, stages: 0, gensLeft: 5, kills: 0, hooks: [0, 0, 0, 0] });

function defaultState() {
  return {
    version: 1,
    overlays: Object.fromEntries(OVERLAY_IDS.map((id, i) => [id, overlayDefaults(i, id)])),
    hotkeys: {
      'timer.toggle': 'F1', 'timer.switch': 'F2', 'timer.reset': 'F3',
      'perks.fireAll': 'F4', 'streak.win': '', 'streak.loss': '',
      'perkShuffle.roll': '', 'killerShuffle.roll': '', 'overlays.toggleLock': 'F10', 'overlays.toggleAll': 'F8',
      'map.nextVariant': 'F9', 'map.toggleLock': 'F11',
    },
    timer: {
      layout: 'dual', // single | dual | compact
      active: 0,
      labels: ['You', 'Opponent'],
      slots: [{ base: 0, startedAt: null }, { base: 0, startedAt: null }],
      rounds: [0, 0],
      history: [],
      bestOf: 3,
      startOnSelect: false,
      killer: null, map: '', log: [],
      warnSeconds: 20, // the second run changes color this many seconds before it reaches the first run's time
      penaltyMs: 5000,
    },
    crosshair: { shape: 'cross', size: 24, thickness: 2, gap: 4, dot: false, outline: true, offsetX: 0, offsetY: 0, profiles: [], profile: null },
    perks: {
      warnAt: 3, // seconds before the end for a short warning tone; 0 turns it off
      // Durations are defaults taken from community data. Editable. Check against the current patch.
      list: [
        { id: 'endurance', name: 'Unhook Endurance', seconds: 10, armed: true, tone: 440, endsAt: null },
        { id: 'bt', name: 'Borrowed Time', seconds: 20, armed: false, tone: 520, endsAt: null },
        { id: 'ds', name: 'Will to Live (DS)', seconds: 60, armed: true, tone: 660, endsAt: null },
        { id: 'otr', name: 'Off the Record', seconds: 80, armed: false, tone: 780, endsAt: null },
      ],
    },
    streak: { label: 'Streak', rule: '3k', current: 0, best: 0, attempts: 1, history: [], character: '', byChar: {} },
    perkShuffle: { role: 'survivor', excluded: [], locked: [false, false, false, false], result: [null, null, null, null] },
    killerShuffle: { excluded: [], noRepeat: true, played: [], result: null },
    builds: { list: [], activeId: null, rulesetId: null, vsKiller: null },
    rulesets: { list: [] },
    lobby: { layout: 'rows', names: true, survivors: [0, 1, 2, 3].map((i) => ({ name: 'Survivor ' + (i + 1), perks: [null, null, null, null] })) },
    score: {
      teams: ['Team A', 'Team B'], bestOf: 3, games: [],
      // mirror: both teams play killer, results are compared. target: the killer must reach a win condition each game.
      mode: 'mirror', targetType: 'stages', targetStages: 9, targetGens: 1,
      myTeam: '', // '0' or '1': finished games are also logged to Statistics from that team's side
      current: newGame(0),
    },
    stats: { matches: [] },
    challenge: { name: 'Challenge', rules: [], played: 0, wins: 0, target: 0 },
    league: { name: 'My League', members: [] }, // roles: owner | admin | referee | caster | player
    map: { current: null, locked: false, auto: true, region: 'full', lastText: '', lastError: '', download: '' },
    settings: { ocrEngine: 'auto', inputMode: 'standard', closeToTray: false, hideFromCapture: false, overlaysHidden: false, onlyWhenGameRuns: true, scanSeconds: 2 },
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
  'hotkey.set'(s, { action, key }) {
    // One binding per key: taking a key clears it from any other action.
    if (key) for (const a of Object.keys(s.hotkeys)) if (s.hotkeys[a] === key) s.hotkeys[a] = '';
    s.hotkeys[action] = key;
  },

  // ---- 1v1 timer
  'timer.toggle'(s, _p, { now }) {
    const slot = s.timer.slots[s.timer.active];
    if (slot.startedAt) { slot.base += now - slot.startedAt; slot.startedAt = null; } else slot.startedAt = now;
  },
  // One key for a whole run: start, then stop, then reset.
  'timer.cycle'(s, _p, { now }) {
    const slot = s.timer.slots[s.timer.active];
    if (slot.startedAt) { slot.base += now - slot.startedAt; slot.startedAt = null; } else if (slot.base > 0) slot.base = 0; else slot.startedAt = now;
  },
  'timer.select'(s, { i }, { now }) {
    const t = s.timer; if (i !== 0 && i !== 1) return;
    const cur = t.slots[t.active];
    if (i !== t.active && cur.startedAt) { cur.base += now - cur.startedAt; cur.startedAt = null; }
    t.active = i;
    if (t.startOnSelect && !t.slots[i].startedAt) t.slots[i].startedAt = now;
  },
  'timer.switch'(s, _p, { now }) {
    const cur = s.timer.slots[s.timer.active];
    if (cur.startedAt) { cur.base += now - cur.startedAt; cur.startedAt = null; }
    s.timer.active = s.timer.active ? 0 : 1;
  },
  'timer.reset'(s) { s.timer.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); s.timer.active = 0; },
  'timer.penalty'(s, { ms }) {
    ms = Number(ms) || s.timer.penaltyMs || 5000;
    // Out-of-sight time is deducted from the survivor's run.
    const slot = s.timer.slots[s.timer.active];
    slot.base = Math.max(slot.startedAt ? -Infinity : 0, slot.base - ms);
  },
  // Award the round to the longer run, keep both times in the history, and clear the clocks.
  'timer.scoreRound'(s, _p, { now }) {
    const t = s.timer; const [a, b] = t.slots.map((x) => slotMs(x, now));
    if (a === b) return;
    const winner = a > b ? 0 : 1;
    t.rounds[winner] += 1; t.history = [...(t.history || []), { a, b, winner }].slice(-20);
    // Long-term log for personal bests, tagged with the killer and map set in the timer panel.
    t.log = [...(t.log || []), { ts: now, killer: t.killer || null, map: t.map || '', a, b, winner }].slice(-2000);
    t.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); t.active = 0;
  },
  'timer.newMatch'(s) { const t = s.timer; t.rounds = [0, 0]; t.history = []; t.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); t.active = 0; },
  'timer.round'(s, { slot, delta = 1 }) { s.timer.rounds[slot] = Math.max(0, s.timer.rounds[slot] + delta); },
  'timer.set'(s, fields) { Object.assign(s.timer, fields); },

  // ---- crosshair
  'crosshair.set'(s, fields) {
    // The crosshair window is 400 px square: keep the mark inside it.
    for (const k of ['offsetX', 'offsetY']) if (k in fields) fields[k] = clamp(Number(fields[k]) || 0, -150, 150);
    if ('size' in fields) fields.size = clamp(Number(fields.size) || 24, 2, 90);
    if ('thickness' in fields) fields.thickness = clamp(Number(fields.thickness) || 1, 1, 12);
    if ('gap' in fields) fields.gap = clamp(Number(fields.gap) || 0, 0, 60);
    Object.assign(s.crosshair, fields);
  },
  // Profiles hold one crosshair per killer (shape, size, offsets, color).
  'crosshair.saveProfile'(s, { name }, { now }) {
    const c = s.crosshair; const { profiles, profile, ...shape } = c;
    const label = String(name || '').trim().slice(0, 40) || 'Profile ' + (profiles.length + 1);
    const existing = profiles.find((p) => p.name.toLowerCase() === label.toLowerCase());
    const data = { ...shape, color: s.overlays.crosshair.color };
    if (existing) Object.assign(existing, data); else profiles.push({ id: 'c' + now, name: label, ...data });
    c.profile = (existing || profiles[profiles.length - 1]).id;
  },
  'crosshair.loadProfile'(s, { id }) {
    const c = s.crosshair; const p = c.profiles.find((x) => x.id === id); if (!p) return;
    const { id: _i, name: _n, color, ...shape } = p; Object.assign(c, shape); c.profile = p.id;
    if (color) s.overlays.crosshair.color = color;
  },
  'crosshair.next'(s) {
    const c = s.crosshair; if (!c.profiles.length) return;
    const i = c.profiles.findIndex((p) => p.id === c.profile);
    actions['crosshair.loadProfile'](s, { id: c.profiles[(i + 1) % c.profiles.length].id });
  },
  'crosshair.deleteProfile'(s, { id }) { const c = s.crosshair; c.profiles = c.profiles.filter((p) => p.id !== id); if (c.profile === id) c.profile = null; },

  // ---- perk timers
  'perks.fireAll'(s, _p, { now }) { s.perks.list.forEach((p) => { if (p.armed) p.endsAt = now + p.seconds * 1000; }); },
  'perks.fire'(s, { id }, { now }) { const p = s.perks.list.find((x) => x.id === id); if (p) p.endsAt = now + p.seconds * 1000; },
  'perks.set'(s, f) { if ('warnAt' in f) f.warnAt = clamp(Number(f.warnAt) || 0, 0, 30); Object.assign(s.perks, f); },
  'perks.clear'(s) { s.perks.list.forEach((p) => { p.endsAt = null; }); },
  'perks.update'(s, { id, ...fields }) {
    if ('seconds' in fields) fields.seconds = clamp(Number(fields.seconds) || 1, 1, 3600);
    const p = s.perks.list.find((x) => x.id === id); if (p) Object.assign(p, fields);
  },
  'perks.add'(s, { name = 'New timer', seconds = 30 }, { now }) {
    s.perks.list.push({ id: 't' + now, name, seconds, armed: true, tone: 600, endsAt: null });
  },
  'perks.remove'(s, { id }) { s.perks.list = s.perks.list.filter((p) => p.id !== id); delete s.hotkeys['perks.fire:' + id]; },

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
  // Each character keeps its own streak. '' is the general streak.
  'streak.character'(s, { id = '' }) {
    const k = s.streak; if (!k.byChar) k.byChar = {};
    k.byChar[k.character || ''] = { current: k.current, best: k.best, attempts: k.attempts };
    const next = k.byChar[id] || { current: 0, best: 0, attempts: 1 };
    Object.assign(k, next, { character: id, history: [] });
  },

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

// Durations from deadbydaylight.wiki.gg at the time of writing. Perk values change between patches: all are editable.
const TIMER_PRESETS = [
  { name: 'Hook stage', seconds: 70 }, { name: 'Endgame collapse', seconds: 120 }, { name: 'Unhook Endurance', seconds: 10 },
  { name: 'Will to Live (DS)', seconds: 60 }, { name: 'Off the Record', seconds: 80 }, { name: 'Exhaustion', seconds: 40 },
  { name: 'Corrupt Intervention', seconds: 120 }, { name: 'Pop Goes the Weasel', seconds: 45 },
  { name: 'Grim Embrace (4 tokens)', seconds: 40 }, { name: 'No Holds Barred (Deadlock)', seconds: 25 },
];
const ctxMapName = (s, ctx) => ((ctx.catalog || []).find((m) => m.id === s.map.current) || {}).name || '';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const SCORE_LIMITS = { stages: [0, 12], gensLeft: [0, 5], kills: [0, 4] };
const CHALLENGE_PRESETS = {
  ironman: { name: 'Ironman', rules: ['One win on every killer', 'Killer picked at random, no repeats', 'A loss restarts the run'] },
  endless: { name: 'Endless Trials', rules: ['Add one rule after every match', 'Rules stay until the run ends'] },
  noslow: { name: 'No Slowdown', rules: ['No generator slowdown perks', 'No add-ons'] },
};

Object.assign(actions, {
  // ---- build library
  'builds.add'(s, { role = 'survivor', perks = [null, null, null, null], name }, { now }) {
    const id = 'b' + now + s.builds.list.length;
    s.builds.list.push({ id, name: name || 'New build', role, killer: null, perks: [...perks], tags: '' });
    s.builds.activeId = id;
  },
  'builds.update'(s, { id, ...f }) { const b = s.builds.list.find((x) => x.id === id); if (b) Object.assign(b, f); },
  'builds.setPerk'(s, { id, slot, perk }) { const b = s.builds.list.find((x) => x.id === id); if (b) b.perks[slot] = perk; },
  'builds.remove'(s, { id }) { s.builds.list = s.builds.list.filter((b) => b.id !== id); if (s.builds.activeId === id) s.builds.activeId = null; },
  'builds.set'(s, f) { Object.assign(s.builds, f); },

  // ---- rulesets
  'rules.add'(s, { name = 'New ruleset' }, { now }) {
    const id = 'r' + now; s.rulesets.list.push({ id, name, banned: [], uniquePerTeam: true, maxExhaustion: 0 }); s.builds.rulesetId = id;
  },
  'rules.update'(s, { id, ...f }) { const r = s.rulesets.list.find((x) => x.id === id); if (r) Object.assign(r, f); },
  'rules.toggleBan'(s, { id, perk }) {
    const r = s.rulesets.list.find((x) => x.id === id); if (!r) return;
    r.banned = r.banned.includes(perk) ? r.banned.filter((x) => x !== perk) : [...r.banned, perk];
  },
  'rules.remove'(s, { id }) { s.rulesets.list = s.rulesets.list.filter((r) => r.id !== id); if (s.builds.rulesetId === id) s.builds.rulesetId = null; },
  'rules.addImported'(s, { ruleset }, { now }) {
    const id = 'r' + now; s.rulesets.list = s.rulesets.list.filter((r) => !(r.source && r.name === ruleset.name));
    s.rulesets.list.push({ id, ...ruleset }); s.builds.rulesetId = id;
  },
  // Import accepts { name, banned: [perk id or perk name], uniquePerTeam, maxExhaustion }.
  'rules.import'(s, { json }, { now, perks }) {
    let d; try { d = JSON.parse(json); } catch { return; }
    if (!d || typeof d !== 'object') return;
    const low = String; const find = (x) => (perks.find((p) => p.id === x || [p.name, p.aka].some((n) => n && n.toLowerCase() === low(x).toLowerCase())) || {}).id;
    const id = 'r' + now;
    s.rulesets.list.push({
      id, name: String(d.name || 'Imported ruleset').slice(0, 80),
      banned: [...new Set((Array.isArray(d.banned) ? d.banned : []).map(find).filter(Boolean))],
      uniquePerTeam: d.uniquePerTeam !== false, maxExhaustion: Number(d.maxExhaustion) || 0,
    });
    s.builds.rulesetId = id;
  },

  // ---- lobby perks
  'lobby.setPerk'(s, { i, slot, perk }) { s.lobby.survivors[i].perks[slot] = perk; },
  'lobby.setName'(s, { i, name }) { s.lobby.survivors[i].name = name; },
  'lobby.loadBuild'(s, { i, id }) { const b = s.builds.list.find((x) => x.id === id); if (b) s.lobby.survivors[i].perks = [...b.perks]; },
  'lobby.set'(s, f) { Object.assign(s.lobby, f); },
  'lobby.clear'(s) { s.lobby.survivors.forEach((v) => { v.perks = [null, null, null, null]; }); },

  // ---- match scoreboard
  'score.set'(s, f) { for (const k of ['bestOf', 'targetStages', 'targetGens']) if (k in f) f[k] = Number(f[k]) || 0; Object.assign(s.score, f); },
  'score.current'(s, f) { Object.assign(s.score.current, f); },
  'score.bump'(s, { field, delta, id }) {
    if (id === 'gen') { field = 'gensLeft'; delta = -1; } // hotkey form: score.bump:gen
    const lim = SCORE_LIMITS[field]; if (!lim) return;
    s.score.current[field] = clamp(s.score.current[field] + delta, lim[0], lim[1]);
  },
  'score.endGame'(s, _p, ctx) {
    const c = s.score.current; const game = { ...c }; s.score.games.push(game);
    if (s.score.myTeam !== '' && s.score.myTeam !== undefined) {
      const asKiller = Number(s.score.myTeam) === c.killerTeam;
      // Target format: the win condition decides. Otherwise the common norm: 3+ kills killer win, 2 a draw.
      const killerResult = s.score.mode === 'target' ? (killerWon(s.score, c) ? 'win' : 'loss') : c.kills >= 3 ? 'win' : c.kills === 2 ? 'draw' : 'loss';
      const result = asKiller ? killerResult : killerResult === 'win' ? 'loss' : killerResult === 'loss' ? 'win' : 'draw';
      game.statTs = ctx.now; // lets Undo remove the logged match
      actions['stats.add'](s, { role: asKiller ? 'killer' : 'survivor', character: asKiller ? c.killer : null, map: ctxMapName(s, ctx), result, stages: c.stages, gensLeft: c.gensLeft, kills: c.kills }, ctx);
    }
    s.score.current = newGame(c.killerTeam ? 0 : 1);
  },
  // Per-survivor hook states (0 to 3). Stages and kills follow from them; a dead survivor counts as 3.
  'score.hook'(s, { i, delta = 1, dead = false }) {
    const c = s.score.current; if (!c.hooks) c.hooks = [0, 0, 0, 0];
    c.hooks[i] = dead ? 3 : clamp(c.hooks[i] + delta, 0, 3);
    c.stages = c.hooks.reduce((a, b) => a + b, 0); c.kills = c.hooks.filter((h) => h === 3).length;
  },
  // Disconnect rulings used by DBD Arena: killer leaves = 0 gens left; a survivor leaves = 12 stages and 4 kills.
  'score.dc'(s, { side }) {
    const c = s.score.current;
    if (side === 'killer') c.gensLeft = 0; else { c.hooks = [3, 3, 3, 3]; c.stages = 12; c.kills = 4; }
  },
  'score.undoGame'(s) {
    const g = s.score.games.pop(); if (!g) return;
    if (g.statTs) { s.stats.matches = s.stats.matches.filter((m) => m.ts !== g.statTs); delete g.statTs; }
    s.score.current = g;
  },
  'score.reset'(s) { s.score.games = []; s.score.current = newGame(0); },

  // ---- statistics
  'stats.add'(s, m, { now }) {
    s.stats.matches.push({ ts: now, role: m.role || 'killer', character: m.character || null, map: m.map || '',
      result: m.result || 'win', stages: Number(m.stages) || 0, gensLeft: Number(m.gensLeft) || 0, kills: Number(m.kills) || 0 });
    // One entry can also move the streak and the challenge, so a result is typed once.
    if (m.streak && m.result !== 'draw') actions[m.result === 'win' ? 'streak.win' : 'streak.loss'](s);
    if (m.challenge) actions['challenge.result'](s, { win: m.result === 'win' });
  },
  'stats.remove'(s, { ts }) { s.stats.matches = s.stats.matches.filter((m) => m.ts !== ts); },

  // ---- league roster (local now; the same actions go through the sync adapter once a server exists)
  'league.set'(s, f) { Object.assign(s.league, f); },
  'league.add'(s, { name, role = 'player', team = '' }, { now }) {
    if (!name || !name.trim()) return;
    const first = !s.league.members.length;
    s.league.members.push({ id: 'm' + now + s.league.members.length, name: name.trim().slice(0, 40), role: first ? 'owner' : role === 'owner' ? 'player' : role, team });
  },
  'league.update'(s, { id, ...f }) {
    const m = s.league.members.find((x) => x.id === id); if (!m) return;
    if (f.role === 'owner' || (m.role === 'owner' && f.role)) delete f.role; // ownership changes only by transfer
    Object.assign(m, f);
  },
  'league.transfer'(s, { id }) {
    const to = s.league.members.find((x) => x.id === id); if (!to) return;
    s.league.members.forEach((m) => { if (m.role === 'owner') m.role = 'admin'; }); to.role = 'owner';
  },
  'league.remove'(s, { id }) { s.league.members = s.league.members.filter((m) => m.id !== id || m.role === 'owner'); },

  // ---- map callouts
  'map.set'(s, f) { Object.assign(s.map, f); },
  // Picking a map by hand is an explicit choice, so it locks at once.
  'map.pick'(s, { id }) { s.map.current = id || null; s.map.locked = Boolean(id); },
  'map.toggleLock'(s) { if (s.map.current) s.map.locked = !s.map.locked; },
  'map.nextVariant'(s, _p, { catalog }) {
    const cur = catalog.find((m) => m.id === s.map.current); if (!cur) return;
    const fam = catalog.filter((m) => m.family === cur.family);
    s.map.current = fam[(fam.indexOf(cur) + 1) % fam.length].id;
  },
  'settings.set'(s, f) {
    if ('scanSeconds' in f) f.scanSeconds = clamp(Number(f.scanSeconds) || 2, 1, 10);
    Object.assign(s.settings, f);
  },
  'overlays.toggleAll'(s) { s.settings.overlaysHidden = !s.settings.overlaysHidden; },

  // ---- challenges
  'challenge.set'(s, f) { Object.assign(s.challenge, f); },
  'challenge.preset'(s, { id }) { const p = CHALLENGE_PRESETS[id]; if (p) s.challenge = { name: p.name, rules: [...p.rules], played: 0, wins: 0, target: 0 }; },
  'challenge.addRule'(s, { text }) { if (text && text.trim()) s.challenge.rules.push(text.trim().slice(0, 120)); },
  'challenge.removeRule'(s, { i }) { s.challenge.rules.splice(i, 1); },
  'challenge.result'(s, { win }) { s.challenge.played += 1; if (win) s.challenge.wins += 1; },
  'challenge.reset'(s) { s.challenge.played = 0; s.challenge.wins = 0; },
});

// ---- derived values (computed for the UI and overlays, never saved as source data)
const EXHAUSTION = ['Sprint Burst', 'Balanced Landing', 'Lithe', 'Dead Hard', 'Head On', 'Overcome', 'Smash Hit', 'Background Player', 'Dramaturgy'];
// `ctxKiller` is the killer the build is played as (killer builds) or against (survivor builds).
function buildIssues(build, rs, ctxKiller, names) {
  if (!rs) return [];
  const out = []; const perkIds = build.perks.filter(Boolean); const isKiller = build.role === 'killer';
  const k = (rs.killers || {})[isKiller ? (build.killer || ctxKiller) : ctxKiller] || null;
  if (k && k.disabled) out.push(`${k.name} is not allowed in this ruleset`);
  const allow = new Set(k ? (isKiller ? k.killerWhitelist : k.survWhitelist) : []);
  const banned = new Set([...(isKiller ? rs.killerBanned || [] : rs.banned || []), ...(k ? (isKiller ? k.killerBanned : k.survBanned) : [])]);
  perkIds.forEach((p) => { if (banned.has(p) && !allow.has(p)) out.push(`${names[p] || p} is banned${k ? ' on ' + k.name : ''}`); });
  const combos = [...(isKiller ? rs.killerCombos || [] : rs.combos || []), ...(k ? (isKiller ? k.killerCombos : k.survCombos) : [])];
  combos.forEach((c) => { if (c.every((p) => perkIds.includes(p))) out.push(`${c.map((p) => names[p] || p).join(' + ')} cannot be used together`); });
  if (!isKiller && rs.maxExhaustion > 0) { const n = perkIds.filter((p) => EXHAUSTION.includes(names[p])).length; if (n > rs.maxExhaustion) out.push(`${n} exhaustion perks, limit ${rs.maxExhaustion}`); }
  return out;
}
function teamIssues(survivors, rs, names) {
  const limit = rs ? (rs.maxRepetition || (rs.uniquePerTeam ? 1 : 0)) : 0;
  if (!limit) return [];
  const count = {};
  survivors.forEach((v) => v.perks.filter(Boolean).forEach((p) => { count[p] = (count[p] || 0) + 1; }));
  return Object.entries(count).filter(([, n]) => n > limit).map(([p, n]) => `${names[p] || p} used ${n} times, limit ${limit}`);
}
// A set is two games, one per team as killer. More hook stages wins; then more gens left; then more kills.
function killerWon(score, g) {
  return score.targetType === '4k' ? g.kills === 4 && g.gensLeft >= score.targetGens : g.stages >= score.targetStages;
}
function scoreSummary(score) {
  const sets = [0, 0]; const history = []; const target = score.mode === 'target';
  if (target) {
    for (const g of score.games) { const winner = killerWon(score, g) ? g.killerTeam : (g.killerTeam ? 0 : 1); sets[winner] += 1; history.push({ winner, games: [g] }); }
  } else {
    for (let i = 0; i + 1 < score.games.length; i += 2) {
      const a = score.games[i]; const b = score.games[i + 1];
      const cmp = (a.stages - b.stages) || (a.gensLeft - b.gensLeft) || (a.kills - b.kills);
      const winner = cmp > 0 ? a.killerTeam : cmp < 0 ? b.killerTeam : null;
      if (winner !== null) sets[winner] += 1;
      history.push({ winner, games: [a, b] });
    }
  }
  const need = Math.floor(score.bestOf / 2) + 1;
  const champion = sets[0] >= need ? 0 : sets[1] >= need ? 1 : null;
  const goal = target ? (score.targetType === '4k' ? `4K with ${score.targetGens}+ gens left` : `${score.targetStages} hook stages`) : null;
  return { sets, history, need, champion, goal, pending: !target && score.games.length % 2 === 1 ? score.games[score.games.length - 1] : null };
}
function statsSummary(matches) {
  const row = () => ({ played: 0, wins: 0, losses: 0, draws: 0, stages: 0 });
  const rate = (r) => (r.played ? Math.round((r.wins / r.played) * 100) : 0);
  const add = (r, m) => { r.played += 1; r[m.result === 'win' ? 'wins' : m.result === 'loss' ? 'losses' : 'draws'] += 1; r.stages += Number(m.stages) || 0; };
  const group = (keyOf) => {
    const by = {};
    for (const m of matches) { const k = keyOf(m); if (k) add((by[k] = by[k] || row()), m); }
    return Object.entries(by).map(([key, r]) => ({ key, ...r, rate: rate(r), avgStages: Math.round((r.stages / r.played) * 10) / 10 }))
      .sort((a, b) => b.rate - a.rate || b.played - a.played);
  };
  const total = row(); matches.forEach((m) => add(total, m));
  // Current run of identical results, newest first.
  let run = 0; for (let i = matches.length - 1; i >= 0 && matches[i].result === matches[matches.length - 1].result; i--) run += 1;
  return { total: { ...total, rate: rate(total) }, by: group((m) => m.character || m.role), byMap: group((m) => (m.map || '').trim()),
    run: matches.length ? { result: matches[matches.length - 1].result, count: run } : null };
}
// Per killer: rounds played, rounds won by player 1, player 1's longest run and shortest time conceded.
function chaseSummary(log) {
  const by = {};
  for (const r of log || []) {
    const k = r.killer || 'any'; const x = (by[k] = by[k] || { key: k, rounds: 0, won: 0, best: 0, avg: 0 });
    x.rounds += 1; if (r.winner === 0) x.won += 1; x.best = Math.max(x.best, r.a); x.avg += r.a;
  }
  return Object.values(by).map((x) => ({ ...x, avg: Math.round(x.avg / x.rounds) })).sort((a, b) => b.rounds - a.rounds);
}
function derive(state, perks) {
  const names = Object.fromEntries(perks.map((p) => [p.id, p.name]));
  const rs = state.rulesets.list.find((r) => r.id === state.builds.rulesetId) || null;
  const vs = state.builds.vsKiller || null;
  return {
    buildIssues: Object.fromEntries(state.builds.list.map((b) => [b.id, buildIssues(b, rs, vs, names)])),
    lobbyIssues: [...state.lobby.survivors.flatMap((v) => buildIssues({ role: 'survivor', perks: v.perks }, rs, vs, names).map((x) => `${v.name}: ${x}`)), ...teamIssues(state.lobby.survivors, rs, names)],
    ruleset: rs ? rs.name : null,
    score: scoreSummary(state.score),
    stats: statsSummary(state.stats.matches),
    chase: chaseSummary(state.timer.log),
  };
}

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

module.exports = { defaultState, dispatch, merge, slotMs, derive, scoreSummary, statsSummary, buildIssues, teamIssues, OVERLAY_IDS, STREAK_RULES, CHALLENGE_PRESETS, TIMER_PRESETS };
