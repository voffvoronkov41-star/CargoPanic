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
assert.equal(Object.keys(endings).length, 5, "В полной первой главе пять концовок");
assert.ok(Object.keys(archiveCatalog).length >= 10, "Есть расширенный архив улик");
assert.ok(Object.keys(scenes).length >= 35, "Глава содержит не менее 35 сцен");

for (const [id, scene] of Object.entries(scenes)) {
  for (const choice of scene.choices || []) {
    if (choice.next) assert.ok(scenes[choice.next], `${id} ссылается на существующую сцену ${choice.next}`);
    if (choice.ending) assert.ok(endings[choice.ending], `${id} ссылается на существующую концовку`);
    if (choice.codeNext) assert.ok(scenes[choice.codeNext], `${id} открывает существующую сцену после кода`);
  }
  if (scene.archive) assert.ok(archiveCatalog[scene.archive], `${id} открывает существующий архив`);
}

const canonicalPath = [
  "start", "who", "truth", "declined", "figure", "awaitSignal", "signalFound",
  "awaitCode", "codeAccepted", "after_break", "dimaIntro", "dimaProof",
  "timeClue", "awaitVault", "vaultOpen", "silenceTest", "secondCallWarning",
  "secondCallDeclined", "awaitFinalFrequency", "finalSignalSilence", "finalChoice"
];
canonicalPath.forEach(id => assert.ok(scenes[id], `Основной путь содержит сцену ${id}`));
assert.ok(scenes.codeAccepted.choices.every(choice => choice.midpoint), "Старый финал стал серединой главы");
assert.ok(scenes.finalChoice.choices.every(choice => choice.ending), "Каждый настоящий финальный выбор завершает главу");

console.log("Night Line story graph: OK");
