import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const source = fs.readFileSync(new URL("../www/app.js", import.meta.url), "utf8");
const sandbox = {
  window: {},
  document: { addEventListener() {} },
  navigator: {},
  localStorage: { getItem() { return null; }, setItem() {} },
  location: { protocol: "file:" },
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame() { return 1; },
  cancelAnimationFrame() {}
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const { scenes, endings, archiveCatalog } = sandbox.window.NIGHT_LINE_STORY;
assert.ok(scenes.start, "Есть стартовая сцена");
assert.equal(Object.keys(endings).length, 3, "В первой главе три концовки");
assert.equal(Object.keys(archiveCatalog).length, 3, "Есть три архивных документа");

for (const [id, scene] of Object.entries(scenes)) {
  for (const choice of scene.choices || []) {
    if (choice.next) assert.ok(scenes[choice.next], `${id} ссылается на существующую сцену ${choice.next}`);
    if (choice.ending) assert.ok(endings[choice.ending], `${id} ссылается на существующую концовку`);
  }
  if (scene.archive) assert.ok(archiveCatalog[scene.archive], `${id} открывает существующий архив`);
}

const canonicalPath = ["start", "who", "truth", "declined", "figure", "awaitSignal", "signalFound", "awaitCode", "codeAccepted"];
canonicalPath.forEach(id => assert.ok(scenes[id], `Основной путь содержит сцену ${id}`));
assert.ok(scenes.codeAccepted.choices.every(choice => choice.ending), "Каждый финальный выбор завершает главу");

console.log("Night Line story graph: OK");
