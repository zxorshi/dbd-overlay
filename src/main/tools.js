// Tool state and actions. Pure logic: no Electron imports, so it runs under `node --test`.
// Every action mutates `state` and returns nothing. `ctx` supplies { now, perks, characters, random }.

const OVERLAY_IDS = ['timer', 'crosshair', 'perks', 'streak', 'perkShuffle', 'killerShuffle', 'builds', 'lobby', 'score', 'stats', 'challenge', 'map'];

const SIZES = { map: [420, 440], lobby: [380, 260], score: [900, 120], builds: [420, 150], stats: [520, 110], challenge: [380, 200], perkShuffle: [400, 150], perks: [300, 200] };
const overlayDefaults = (i, id) => ({
  open: false, locked: false, x: 80 + i * 30, y: 80 + i * 30, w: (SIZES[id] || [360])[0], h: (SIZES[id] || [0, 140])[1],
  color: '#d7e3c5', scale: 1, opacity: 1,
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
    },
    crosshair: { shape: 'cross', size: 24, thickness: 2, gap: 4, dot: false, outline: true, offsetX: 0, offsetY: 0 },
    perks: {
      // Durations are defaults taken from community data. Editable. Check against the current patch.
      list: [
        { id: 'endurance', name: 'Unhook Endurance', seconds: 10, armed: true, tone: 440, endsAt: null },
        { id: 'bt', name: 'Borrowed Time', seconds: 20, armed: false, tone: 520, endsAt: null },
        { id: 'ds', name: 'Will to Live (DS)', seconds: 60, armed: true, tone: 660, endsAt: null },
        { id: 'otr', name: 'Off the Record', seconds: 80, armed: false, tone: 780, endsAt: null },
      ],
    },
    streak: { label: 'Streak', rule: '3k', current: 0, best: 0, attempts: 1, history: [] },
    perkShuffle: { role: 'survivor', excluded: [], locked: [false, false, false, false], result: [null, null, null, null] },
    killerShuffle: { excluded: [], noRepeat: true, played: [], result: null },
    builds: { list: [], activeId: null, rulesetId: null, vsKiller: null },
    rulesets: { list: [] },
    lobby: { survivors: [0, 1, 2, 3].map((i) => ({ name: 'Survivor ' + (i + 1), perks: [null, null, null, null] })) },
    score: {
      teams: ['Team A', 'Team B'], bestOf: 3, games: [],
      current: newGame(0),
    },
    stats: { matches: [] },
    challenge: { name: 'Challenge', rules: [], played: 0, wins: 0, target: 0 },
    league: { name: 'My League', members: [] }, // roles: owner | admin | referee | caster | player
    map: { current: null, locked: false, auto: true, region: 'full', lastText: '', lastError: '', download: '' },
    settings: { closeToTray: false, hideFromCapture: false, overlaysHidden: false, onlyWhenGameRuns: true, scanSeconds: 2 },
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
  // Award the round to the longer run, keep both times in the history, and clear the clocks.
  'timer.scoreRound'(s, _p, { now }) {
    const t = s.timer; const [a, b] = t.slots.map((x) => slotMs(x, now));
    if (a === b) return;
    const winner = a > b ? 0 : 1;
    t.rounds[winner] += 1; t.history = [...(t.history || []), { a, b, winner }].slice(-20);
    t.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); t.active = 0;
  },
  'timer.newMatch'(s) { const t = s.timer; t.rounds = [0, 0]; t.history = []; t.slots.forEach((x) => { x.base = 0; x.startedAt = null; }); t.active = 0; },
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
  'lobby.clear'(s) { s.lobby.survivors.forEach((v) => { v.perks = [null, null, null, null]; }); },

  // ---- match scoreboard
  'score.set'(s, f) { if (f.bestOf) f.bestOf = Number(f.bestOf); Object.assign(s.score, f); },
  'score.current'(s, f) { Object.assign(s.score.current, f); },
  'score.bump'(s, { field, delta }) {
    const lim = SCORE_LIMITS[field]; if (!lim) return;
    s.score.current[field] = clamp(s.score.current[field] + delta, lim[0], lim[1]);
  },
  'score.endGame'(s) {
    const c = s.score.current; s.score.games.push({ ...c });
    s.score.current = newGame(c.killerTeam ? 0 : 1);
  },
  // Per-survivor hook states (0 to 3). Stages and kills follow from them; a dead survivor counts as 3.
  'score.hook'(s, { i, delta = 1, dead = false }) {
    const c = s.score.current; if (!c.hooks) c.hooks = [0, 0, 0, 0];
    c.hooks[i] = dead ? 3 : clamp(c.hooks[i] + delta, 0, 3);
    c.stages = c.hooks.reduce((a, b) => a + b, 0); c.kills = c.hooks.filter((h) => h === 3).length;
  },
  'score.undoGame'(s) { const g = s.score.games.pop(); if (g) s.score.current = g; },
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
  'settings.set'(s, f) { Object.assign(s.settings, f); },
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
function scoreSummary(score) {
  const sets = [0, 0]; const history = [];
  for (let i = 0; i + 1 < score.games.length; i += 2) {
    const a = score.games[i]; const b = score.games[i + 1];
    const cmp = (a.stages - b.stages) || (a.gensLeft - b.gensLeft) || (a.kills - b.kills);
    const winner = cmp > 0 ? a.killerTeam : cmp < 0 ? b.killerTeam : null;
    if (winner !== null) sets[winner] += 1;
    history.push({ winner, games: [a, b] });
  }
  const need = Math.floor(score.bestOf / 2) + 1;
  const champion = sets[0] >= need ? 0 : sets[1] >= need ? 1 : null;
  return { sets, history, need, champion, pending: score.games.length % 2 === 1 ? score.games[score.games.length - 1] : null };
}
function statsSummary(matches) {
  const row = () => ({ played: 0, wins: 0, losses: 0, draws: 0 });
  const total = row(); const by = {};
  for (const m of matches) {
    const key = m.character || m.role;
    for (const r of [total, (by[key] = by[key] || row())]) { r.played += 1; r[m.result === 'win' ? 'wins' : m.result === 'loss' ? 'losses' : 'draws'] += 1; }
  }
  const rate = (r) => (r.played ? Math.round((r.wins / r.played) * 100) : 0);
  const list = Object.entries(by).map(([key, r]) => ({ key, ...r, rate: rate(r) })).sort((a, b) => b.rate - a.rate || b.played - a.played);
  return { total: { ...total, rate: rate(total) }, by: list };
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

module.exports = { defaultState, dispatch, merge, slotMs, derive, scoreSummary, statsSummary, buildIssues, teamIssues, OVERLAY_IDS, STREAK_RULES, CHALLENGE_PRESETS };
