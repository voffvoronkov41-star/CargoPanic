import fs from "node:fs";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const html = fs.readFileSync(new URL("../www/index.html", import.meta.url), "utf8");
const app = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "https://night-line.local/", runScripts: "outside-only" });
const { window } = dom;

window.STATION_IMAGE = "station";
window.CORRIDOR_IMAGE = "corridor";
window.ANYA_IMAGE = "anya";
window.navigator.vibrate = () => true;
window.navigator.serviceWorker = { register: async () => ({}) };
window.requestAnimationFrame = () => 1;
window.cancelAnimationFrame = () => {};
window.HTMLCanvasElement.prototype.getContext = () => ({
  clearRect() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  stroke() {},
  set strokeStyle(value) {},
  set lineWidth(value) {}
});

window.eval(app);
window.document.dispatchEvent(new window.Event("DOMContentLoaded"));

const name = window.document.querySelector("#player-name");
name.value = "Алекс";
name.dispatchEvent(new window.Event("input", { bubbles: true }));
assert.equal(window.document.querySelector("#checkpoint-start").disabled, false);

window.document.querySelector("#checkpoint-start").click();
assert.equal(window.document.querySelector("#checkpoint-overlay").classList.contains("hidden"), false);
window.document.querySelector('[data-midpoint="break"]').click();

const saved = JSON.parse(window.localStorage.getItem("nightLineSaveV1"));
assert.equal(saved.node, "after_break");
assert.equal(saved.flags.midpoint, "break");
assert.equal(saved.version, 2);
assert.equal(window.document.querySelector("#game-screen").classList.contains("hidden"), false);

console.log("Night Line UI checkpoint: OK");
