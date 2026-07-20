import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'www/index.html'), 'utf8');
const js = readFileSync(join(root, 'www/game.js'), 'utf8');
const dom = new JSDOM(html, { url: 'https://cargopanic.local/', runScripts: 'outside-only' });
const { window } = dom;

const noop = () => {};
const gradient = { addColorStop: noop };
const ctx = new Proxy({ createLinearGradient: () => gradient, measureText: () => ({ width: 10 }) }, {
  get(target, key) { return key in target ? target[key] : noop; },
  set(target, key, value) { target[key] = value; return true; }
});

window.HTMLCanvasElement.prototype.getContext = () => ctx;
window.Image = class { constructor(){ this.complete = true; this.naturalWidth = 2105; this.naturalHeight = 747; } };
window.requestAnimationFrame = () => 1;
window.navigator.vibrate = noop;
window.navigator.serviceWorker = { register: () => Promise.resolve() };

window.eval(js);
window.document.querySelector('#startBtn').click();
window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'ArrowRight' }));
window.dispatchEvent(new window.KeyboardEvent('keydown', { code: 'Space' }));
window.document.querySelector('#pauseBtn').click();

if (!window.document.querySelector('#pauseScreen').classList.contains('visible')) {
  throw new Error('Pause screen did not open');
}
if (window.document.querySelector('#score').textContent !== '0') {
  throw new Error('Initial score is invalid');
}
console.log('Cargo Panic smoke test: OK');
