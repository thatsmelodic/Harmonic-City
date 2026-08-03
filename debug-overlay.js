// Opt-in diagnostic overlay for tracking down the "background freezes during
// normal foreground use" report -- a symptom that can't be reproduced in any
// automated test here, since it depends on real iOS Safari's video decoder and
// memory behavior over long sessions, which Playwright's Linux WebKit port
// doesn't simulate. This turns a real device into the debugging tool instead:
// visit with ?debug=1, use the site normally until it freezes, then screenshot
// or screen-record this panel.
//
// Invisible and fully inert unless ?debug=1 is present -- a single early-return
// check, no cost to any normal visitor. Purely observational: never changes
// playback, state, or anything else about how the page behaves.
(() => {
  if (!new URLSearchParams(location.search).has('debug')) return;

  const CHECK_MS = 1000;
  const LOG_LIMIT = 300;
  const logs = [];

  const panel = document.createElement('div');
  panel.id = 'diagOverlay';
  panel.style.cssText = 'position:fixed;inset:auto 0 0 0;max-height:45vh;overflow:auto;z-index:999999;background:rgba(0,0,0,.92);color:#8f8;font:11px/1.4 ui-monospace,Menlo,Consolas,monospace;padding:8px;white-space:pre-wrap;pointer-events:auto;-webkit-user-select:text;user-select:text';

  function mount() {
    if (!panel.isConnected) document.body.appendChild(panel);
  }
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);

  function log(msg) {
    const line = `[${new Date().toISOString().slice(11, 23)}] ${msg}`;
    logs.push(line);
    if (logs.length > LOG_LIMIT) logs.shift();
    panel.textContent = logs.join('\n');
    panel.scrollTop = panel.scrollHeight;
  }

  log(`overlay started. UA=${navigator.userAgent}`);
  log(`If this clock stops advancing entirely, JS execution itself stalled (memory/eviction). If it keeps ticking but shows STALL for a video, that video's decoder specifically stalled.`);

  window.addEventListener('error', e => log(`window error: ${e.message}`));
  document.addEventListener('visibilitychange', () => log(`visibilitychange -> hidden=${document.hidden}`));
  window.addEventListener('pageshow', e => log(`pageshow persisted=${e.persisted}`));
  window.addEventListener('focus', () => log('focus'));
  window.addEventListener('blur', () => log('blur'));

  const lastState = new WeakMap();
  function tick() {
    log(`tick`);
    document.querySelectorAll('video').forEach((v, i) => {
      if (!v.dataset.diagId) v.dataset.diagId = `video#${i}:${(v.currentSrc || v.src || '').split('/').pop().slice(0, 28) || 'unknown'}`;
      const id = v.dataset.diagId;
      const info = `paused=${v.paused} readyState=${v.readyState} networkState=${v.networkState} currentTime=${v.currentTime.toFixed(2)} error=${v.error ? v.error.code : 'none'}`;
      const prev = lastState.get(v);
      if (prev === undefined) {
        log(`tracking ${id}: ${info}`);
      } else {
        const stalled = !v.paused && !v.ended && prev.time === v.currentTime;
        if (stalled && !prev.reportedStall) log(`STALL DETECTED ${id}: currentTime unchanged (${v.currentTime.toFixed(2)}) for ~${CHECK_MS}ms while playing. ${info}`);
        else if (!stalled && prev.reportedStall) log(`RECOVERED ${id}: currentTime advancing again. ${info}`);
        lastState.set(v, { time: v.currentTime, reportedStall: stalled });
        return;
      }
      lastState.set(v, { time: v.currentTime, reportedStall: false });
    });
  }
  setInterval(tick, CHECK_MS);
})();
