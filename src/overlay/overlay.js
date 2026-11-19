// Renders one overlay from live state. URL: /overlay/<id>   (?win=1 when shown as an app window)
const id = location.pathname.split('/').pop();
const isWindow = new URLSearchParams(location.search).has('win');
const root = document.getElementById('root');
let state = null;
let data = { perks: [], characters: [], art: { perks: [], portraits: [] } };
const icon = (kind, key, cls) => (key && data.art[kind].includes(key) ? `<img class="${cls}" src="/art/${kind}/${key}.png" alt="">` : '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nameOf = (list, key) => (list.find((x) => x.id === key) || {}).name || '';

function fmt(ms) {
  const neg = ms < 0; const s = Math.abs(ms) / 1000;
  return (neg ? '-' : '') + Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
}
const slotMs = (slot) => slot.base + (slot.startedAt ? Date.now() - slot.startedAt : 0);

const render = {
  timer(s) {
    const t = s.timer;
    // Chasing the first run's time: warn in the last seconds, switch to the win color once it is beaten.
    const a = slotMs(t.slots[0]); const b = slotMs(t.slots[1]);
    const chase = t.slots[1].startedAt && a > 0 ? (b >= a ? 'ok' : a - b <= t.warnSeconds * 1000 ? 'warn' : '') : '';
    const cell = (i) => `<div class="col ${t.active === i ? '' : 'dim'} ${i === 1 ? chase : ''}"><span class="lab">${esc(t.labels[i])}</span><span class="num">${fmt(slotMs(t.slots[i]))}</span></div>`;
    if (t.layout === 'single') return `<div class="plate">${cell(t.active)}</div>`;
    if (t.layout === 'compact') return `<div class="plate"><span class="num sm">${fmt(slotMs(t.slots[0]))}</span><span class="lab">vs</span><span class="num sm">${fmt(slotMs(t.slots[1]))}</span></div>`;
    return `<div class="plate">${cell(0)}<div class="col"><span class="lab">Rounds</span><span class="num sm">${t.rounds[0]} : ${t.rounds[1]}</span></div>${cell(1)}</div>`;
  },
  crosshair(s) {
    const c = s.crosshair; const r = c.size / 2; const box = c.size + 8; const m = box / 2;
    const sw = c.thickness; let shape = '';
    if (c.shape === 'cross') shape = `<path d="M${m} ${m - r}V${m - c.gap}M${m} ${m + c.gap}V${m + r}M${m - r} ${m}H${m - c.gap}M${m + c.gap} ${m}H${m + r}"/>`;
    if (c.shape === 'circle') shape = `<circle cx="${m}" cy="${m}" r="${r}"/>`;
    if (c.shape === 't') shape = `<path d="M${m} ${m + c.gap}V${m + r}M${m - r} ${m}H${m - c.gap}M${m + c.gap} ${m}H${m + r}"/>`;
    const dot = c.dot || c.shape === 'dot' ? `<circle cx="${m}" cy="${m}" r="${Math.max(1, sw)}" fill="currentColor" stroke="none"/>` : '';
    const g = (stroke, w) => `<g fill="none" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round">${shape}</g>`;
    return `<svg width="${box}" height="${box}" style="transform:translate(${c.offsetX}px,${c.offsetY}px)">${c.outline ? g('#000', sw + 2) : ''}${g('currentColor', sw)}${dot}</svg>`;
  },
  perks(s) {
    const now = Date.now();
    const rows = s.perks.list.filter((p) => p.armed || p.endsAt).map((p) => {
      const left = p.endsAt ? (p.endsAt - now) / 1000 : null;
      const txt = left === null ? 'armed' : left > 0 ? left.toFixed(1) : 'done';
      const pct = left === null ? 100 : Math.max(0, Math.min(100, (left / p.seconds) * 100));
      return `<div class="plate bar ${left !== null && left <= 0 ? 'done' : left !== null && left <= 5 ? 'warn' : ''}" style="--pct:${pct.toFixed(1)}%"><span class="lab">${esc(p.name)}</span><span class="num sm">${txt}</span></div>`;
    });
    return `<div class="rows">${rows.join('')}</div>`;
  },
  streak(s) {
    const k = s.streak;
    return `<div class="plate">${icon('portraits', k.character, 'portrait')}<div class="col"><span class="lab">${esc(k.label)}</span><span class="num">${k.current}</span></div><div class="col"><span class="lab">Best</span><span class="num sm">${k.best}</span></div><div class="col"><span class="lab">Attempt</span><span class="num sm">${k.attempts}</span></div></div>`;
  },
  perkShuffle(s) {
    return `<div class="perkrow">${s.perkShuffle.result.map((p) => `<div class="perk">${icon('perks', p, 'pi') || '<div class="pi empty"></div>'}<span class="lab">${p ? esc(nameOf(data.perks, p)) : ''}</span></div>`).join('')}</div>`;
  },
  killerShuffle(s) {
    const k = s.killerShuffle;
    return `<div class="plate">${icon('portraits', k.result, 'portrait')}<div class="col"><span class="lab">Next killer</span><span class="name">${k.result ? esc(nameOf(data.characters, k.result)) : '...'}</span></div></div>`;
  },
};

// A short tone when a perk timer ends. App window only, so OBS does not record it twice.
const played = new Set();
let audio = null;
function beep(freq, len = 0.5) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.2, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + len);
    o.start(); o.stop(audio.currentTime + len);
  } catch { /* no audio device */ }
}
function sounds() {
  if (!isWindow || id !== 'perks') return;
  const now = Date.now();
  for (const p of state.perks.list) {
    if (!p.endsAt) continue;
    const end = p.id + ':' + p.endsAt; const warn = 'w' + end; const w = state.perks.warnAt * 1000;
    if (w > 0 && now >= p.endsAt - w && now < p.endsAt && !played.has(warn)) { played.add(warn); if (p.endsAt - now > w - 1000) beep(p.tone * 1.5, 0.12); }
    if (now >= p.endsAt && !played.has(end)) { played.add(end); if (now - p.endsAt < 1000) beep(p.tone); }
  }
}

function draw() {
  if (!state || !render[id]) return;
  const o = state.overlays[id];
  document.documentElement.style.setProperty('--c', o.color);
  document.documentElement.style.setProperty('--scale', o.scale);
  document.documentElement.style.setProperty('--plate', `rgba(12, 18, 14, ${o.bg ?? 0.72})`);
  const editing = isWindow && !o.locked && id !== 'crosshair';
  document.body.classList.toggle('unlocked', editing);
  bar.hidden = !editing; handle.hidden = !editing; curScale = o.scale;
  document.getElementById('frame').dataset.name = id;
  if (!isWindow) document.body.style.opacity = o.opacity;
  const html = render[id](state);
  if (root.innerHTML !== html) root.innerHTML = html;
  if (window.parent !== window) { // preview inside the app: shrink to fit
    root.style.transform = '';
    const k = Math.min(1, (innerWidth - 16) / root.getBoundingClientRect().width, (innerHeight - 12) / root.getBoundingClientRect().height);
    root.style.transform = k < 1 ? `scale(${k})` : '';
  }
  sounds();
  fit();
}

// App windows size themselves to their content, so only position and the Size slider need setting.
let lastSize = '';
function fit() {
  if (!isWindow || id === 'crosshair') return;
  const r = root.getBoundingClientRect(); const b = bar.hidden ? { width: 0, height: 0 } : bar.getBoundingClientRect();
  const w = Math.ceil(Math.max(r.width, b.width)); const h = Math.ceil(r.height + (bar.hidden ? 0 : b.height + 6));
  const size = w + 'x' + h;
  if (size === lastSize || r.width < 2) return;
  lastSize = size;
  fetch('/size/' + id, { method: 'POST', body: JSON.stringify({ w, h }) }).catch(() => {});
}

// Edit mode controls. They exist only in app windows and only do anything while the overlay is unlocked.
const bar = document.getElementById('bar'); const handle = document.getElementById('handle');
let curScale = 1;
const edit = (body) => fetch('/edit/' + id, { method: 'POST', body: JSON.stringify(body) }).catch(() => {});
document.getElementById('minus').onclick = () => edit({ scale: curScale - 0.1 });
document.getElementById('plus').onclick = () => edit({ scale: curScale + 0.1 });
document.getElementById('done').onclick = () => edit({ done: true });
// Corner handle: drag away from the overlay to grow it, toward it to shrink.
let dragFrom = null; let lastSent = 0;
handle.addEventListener('pointerdown', (e) => { dragFrom = { x: e.screenX, y: e.screenY, scale: curScale }; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
handle.addEventListener('pointermove', (e) => {
  if (!dragFrom || Date.now() - lastSent < 40) return;
  lastSent = Date.now();
  edit({ scale: dragFrom.scale + ((e.screenX - dragFrom.x) + (e.screenY - dragFrom.y)) / 300 });
});
const endDrag = () => { dragFrom = null; };
handle.addEventListener('pointerup', endDrag); handle.addEventListener('pointercancel', endDrag);

fetch('/data').then((r) => r.json()).then((d) => { data = d; draw(); });
new EventSource('/events').onmessage = (e) => { state = JSON.parse(e.data); draw(); };
setInterval(draw, 100);

// ---- phase 3 overlays
const perkStrip = (ids, cls) => `<div class="perkrow tight">${ids.map((p) => icon('perks', p, cls) || `<div class="${cls} empty"></div>`).join('')}</div>`;
Object.assign(render, {
  builds(s) {
    const b = s.builds.list.find((x) => x.id === s.builds.activeId);
    if (!b) return '<div class="plate"><span class="lab">No build selected</span></div>';
    const issues = (s.derived.buildIssues[b.id] || []);
    const status = s.derived.ruleset ? `<span class="lab ${issues.length ? 'done' : 'ok'}">${issues.length ? esc(issues[0]) : 'Legal: ' + esc(s.derived.ruleset)}</span>` : '';
    return `<div class="plate">${icon('portraits', b.killer, 'portrait')}<div class="col"><span class="lab">${esc(b.name)}</span>${perkStrip(b.perks, 'pi mdm')}${status}</div></div>`;
  },
  lobby(s) {
    const L = s.lobby; const who = (v) => (L.names ? `<span class="lab who">${esc(v.name)}</span>` : '');
    if (L.layout === 'strip') return `<div class="plate">${L.survivors.map((v) => `<div class="col">${who(v)}${perkStrip(v.perks, 'pi sm')}</div>`).join('')}</div>`;
    if (L.layout === 'grid') return `<div class="lgrid">${L.survivors.map((v) => `<div class="plate"><div class="col">${who(v)}${perkStrip(v.perks, 'pi sm')}</div></div>`).join('')}</div>`;
    return `<div class="rows">${L.survivors.map((v) => `<div class="plate">${who(v)}${perkStrip(v.perks, 'pi sm')}</div>`).join('')}</div>`;
  },
  score(s) {
    const sc = s.score; const d = s.derived.score; const c = sc.current;
    const team = (i) => `<div class="col ${c.killerTeam === i ? '' : 'dim'}"><span class="lab">${c.killerTeam === i ? 'Killer' : 'Survivors'}</span><span class="name">${esc(sc.teams[i])}</span></div>`;
    return `<div class="plate">${team(0)}<span class="num">${d.sets[0]} : ${d.sets[1]}</span>${team(1)}
      ${icon('portraits', c.killer, 'portrait')}
      <div class="col"><span class="lab">Hooks</span><span class="hooks">${(c.hooks || []).map((h) => `<span class="sv ${h === 3 ? 'dead' : ''}">${[1, 2, 3].map((n) => `<i class="${h >= n ? 'on' : ''}"></i>`).join('')}</span>`).join('')}</span></div>
      <div class="col"><span class="lab">Stages</span><span class="num sm">${c.stages}/12</span></div>
      <div class="col"><span class="lab">Gens left</span><span class="num sm">${c.gensLeft}</span></div>
      <div class="col"><span class="lab">Kills</span><span class="num sm">${c.kills}</span></div>
      ${d.goal ? `<div class="col"><span class="lab">Killer needs</span><span class="name">${esc(d.goal)}</span></div>` : ''}
      ${d.pending ? `<div class="col"><span class="lab">To beat</span><span class="num sm">${d.pending.stages}</span></div>` : ''}
      ${d.champion !== null ? `<div class="col"><span class="lab ok">Winner</span><span class="name">${esc(sc.teams[d.champion])}</span></div>` : ''}</div>`;
  },
  stats(s) {
    const t = s.derived.stats.total; const top = s.derived.stats.by[0];
    return `<div class="plate"><div class="col"><span class="lab">Record</span><span class="num sm">${t.wins} W · ${t.losses} L</span></div>
      <div class="col"><span class="lab">Win rate</span><span class="num sm">${t.rate}%</span></div>
      ${top ? `${icon('portraits', top.key, 'portrait')}<div class="col"><span class="lab">Top</span><span class="name">${esc(nameOf(data.characters, top.key) || top.key)} ${top.rate}%</span></div>` : ''}</div>`;
  },
  challenge(s) {
    const c = s.challenge;
    return `<div class="plate"><div class="col"><span class="lab">${esc(c.name)}</span><span class="num sm">${c.wins}${c.target ? ' / ' + c.target : ''} wins · ${c.played} played</span>
      ${c.rules.map((r) => `<span class="rule">${esc(r)}</span>`).join('')}</div></div>`;
  },
});

render.map = (s) => {
  const m = (data.maps || []).find((x) => x.id === s.map.current);
  // Over the game the callout shows only while locked onto a map. Otherwise the detector, which reads the
  // screen, would read the old map's name off this overlay and lock onto it again.
  if (isWindow && !s.map.locked) return s.overlays.map.locked ? '' : '<div class="plate"><span class="lab">Map callout: waiting for a map</span></div>';
  if (!m) return '<div class="plate"><span class="lab">Waiting for map</span></div>';
  const head = `<div class="plate slim"><span class="lab">${esc(m.realm)}</span><span class="name">${esc(m.name)}</span></div>`;
  if ((s.calloutIds || []).includes(m.id)) return `<div class="mapbox"><img class="callout" src="/callout/${m.id}" alt=""></div>`;
  let marks = '';
  for (let i = 1; i <= 12; i++) { const a = ((i * 30 - 90) * Math.PI) / 180; marks += `<text x="${100 + 84 * Math.cos(a)}" y="${100 + 84 * Math.sin(a)}">${i}</text>`; }
  return `<div class="mapbox"><svg class="ring" viewBox="0 0 200 200"><circle cx="100" cy="100" r="96" fill="rgba(12,18,14,0.55)" stroke="currentColor" stroke-width="1.5"/><g fill="currentColor" font-size="13" font-weight="700" text-anchor="middle" dominant-baseline="central">${marks}</g></svg>${head}</div>`;
};

// Controller support: report button presses (rising edge) to the app. Runs in app windows only.
if (isWindow) {
  const held = new Set();
  setInterval(() => {
    for (const pad of navigator.getGamepads ? navigator.getGamepads() : []) {
      if (!pad) continue;
      pad.buttons.forEach((b, i) => {
        const k = pad.index + ':' + i;
        if (b.pressed && !held.has(k)) { held.add(k); fetch('/pad/' + i, { method: 'POST' }).catch(() => {}); }
        else if (!b.pressed) held.delete(k);
      });
    }
  }, 16);
}
