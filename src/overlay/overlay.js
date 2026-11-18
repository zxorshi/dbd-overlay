// Renders one overlay from live state. URL: /overlay/<id>   (?win=1 when shown as an app window)
const id = location.pathname.split('/').pop();
const isWindow = new URLSearchParams(location.search).has('win');
const root = document.getElementById('root');
let state = null;
let data = { perks: [], characters: [] };
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
    const cell = (i) => `<div class="col ${t.active === i ? '' : 'dim'}"><span class="lab">${esc(t.labels[i])}</span><span class="num">${fmt(slotMs(t.slots[i]))}</span></div>`;
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
      return `<div class="plate ${left !== null && left <= 0 ? 'done' : ''}"><span class="lab">${esc(p.name)}</span><span class="num sm">${txt}</span></div>`;
    });
    return `<div class="rows">${rows.join('')}</div>`;
  },
  streak(s) {
    const k = s.streak;
    return `<div class="plate"><div class="col"><span class="lab">${esc(k.label)}</span><span class="num">${k.current}</span></div><div class="col"><span class="lab">Best</span><span class="num sm">${k.best}</span></div><div class="col"><span class="lab">Attempt</span><span class="num sm">${k.attempts}</span></div></div>`;
  },
  perkShuffle(s) {
    return `<div class="rows">${s.perkShuffle.result.map((p) => `<div class="plate"><span class="name">${p ? esc(nameOf(data.perks, p)) : '...'}</span></div>`).join('')}</div>`;
  },
  killerShuffle(s) {
    const k = s.killerShuffle;
    return `<div class="plate"><div class="col"><span class="lab">Next killer</span><span class="name">${k.result ? esc(nameOf(data.characters, k.result)) : '...'}</span></div></div>`;
  },
};

// A short tone when a perk timer ends. App window only, so OBS does not record it twice.
const played = new Set();
let audio = null;
function beep(freq) {
  try {
    audio = audio || new AudioContext();
    const o = audio.createOscillator(); const g = audio.createGain();
    o.frequency.value = freq; o.connect(g); g.connect(audio.destination);
    g.gain.setValueAtTime(0.2, audio.currentTime); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
    o.start(); o.stop(audio.currentTime + 0.5);
  } catch { /* no audio device */ }
}
function sounds() {
  if (!isWindow || id !== 'perks') return;
  for (const p of state.perks.list) {
    const key = p.id + ':' + p.endsAt;
    if (p.endsAt && Date.now() >= p.endsAt && !played.has(key)) { played.add(key); if (Date.now() - p.endsAt < 1000) beep(p.tone); }
  }
}

function draw() {
  if (!state || !render[id]) return;
  const o = state.overlays[id];
  document.documentElement.style.setProperty('--c', o.color);
  document.documentElement.style.setProperty('--scale', o.scale);
  document.body.classList.toggle('unlocked', isWindow && !o.locked && id !== 'crosshair');
  if (!isWindow) document.body.style.opacity = o.opacity;
  const html = render[id](state);
  if (root.innerHTML !== html) root.innerHTML = html;
  sounds();
}

fetch('/data').then((r) => r.json()).then((d) => { data = d; draw(); });
new EventSource('/events').onmessage = (e) => { state = JSON.parse(e.data); draw(); };
setInterval(draw, 100);
