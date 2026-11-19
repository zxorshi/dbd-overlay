// Windows' built-in OCR (Windows.Media.Ocr) through one long-lived PowerShell process.
// Fast and already on every Windows 10/11 install. Any failure makes the caller fall back to Tesseract.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

function createWinOcr(tmpDir) {
  let proc = null; let ready = null; let waiting = null; let seq = 0; let dead = process.platform !== 'win32';
  const script = path.join(__dirname, 'winocr.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
  const img = path.join(tmpDir, 'ocr-frame.png');

  function start() {
    if (ready) return ready;
    ready = new Promise((resolve, reject) => {
      const fail = (why) => { dead = true; if (waiting) { waiting.reject(new Error(why)); waiting = null; } reject(new Error(why)); };
      try { proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] }); }
      catch (err) { return fail(err.message); }
      try { require('node:os').setPriority(proc.pid, require('node:os').constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
      const timer = setTimeout(() => fail('Windows OCR did not start'), 20000);
      proc.on('error', (err) => { clearTimeout(timer); fail(err.message); });
      proc.on('exit', () => { clearTimeout(timer); fail('Windows OCR stopped'); });
      proc.stdin.on('error', () => {});
      readline.createInterface({ input: proc.stdout }).on('line', (line) => {
        if (line === 'READY') { clearTimeout(timer); return resolve(); }
        if (line.startsWith('ERR')) { clearTimeout(timer); return fail(line.slice(4)); } // start-up failure
        const m = line.match(/^(\d+) (OK|ERR) ?(.*)$/);
        if (!m || !waiting || Number(m[1]) !== waiting.id) return; // stray output or a reply to a timed-out request
        const w = waiting; waiting = null; clearTimeout(w.timer);
        if (m[2] === 'OK') { try { const v = JSON.parse(m[3]); w.resolve(Array.isArray(v) ? v.map(String) : [String(v)]); } catch { w.resolve([]); } }
        else w.reject(new Error(m[3] || 'Windows OCR error'));
      });
    });
    ready.catch(() => {});
    return ready;
  }

  return {
    get available() { return !dead; },
    async recognize(png) {
      if (dead) throw new Error('Windows OCR unavailable');
      await start();
      if (waiting) throw new Error('Windows OCR busy');
      await fs.promises.writeFile(img, png);
      return new Promise((resolve, reject) => {
        const id = ++seq;
        waiting = { id, resolve, reject, timer: setTimeout(() => { waiting = null; reject(new Error('Windows OCR timed out')); }, 8000) };
        proc.stdin.write(id + ' ' + img + '\n');
      });
    },
    close() { dead = true; try { if (proc) proc.kill(); } catch { /* already gone */ } },
  };
}

module.exports = { createWinOcr };
