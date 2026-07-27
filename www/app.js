(() => {
  "use strict";

  const SAVE_KEY = "nightLineSaveV1";
  const STATION_SRC = window.STATION_IMAGE || "assets/station-07.png";
  const $ = selector => document.querySelector(selector);
  const $$ = selector => [...document.querySelectorAll(selector)];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const now = () => new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });

  const freshState = () => ({
    name: "",
    node: "start",
    history: [],
    entered: [],
    archives: [],
    flags: { trust: 0, answered: false, toldTruth: false, sawFigure: false, signalFound: false, mistakes: 0 },
    startedAt: Date.now(),
    ending: null
  });

  let state = freshState();
  let busy = false;
  let audioContext = null;
  let ringTimer = null;
  let callTimer = null;
  let waveformFrame = null;
  let code = "";

  const scenes = {
    start: {
      messages: [
        { type: "system", text: "КАНАЛ 07 ВОССТАНОВЛЕН. ЗАДЕРЖКА ПАКЕТОВ: 27 ЛЕТ.", delay: 450 },
        { text: "Ты меня слышишь?", delay: 1050 },
        { text: "Пожалуйста, ответь. Здесь кто-то ходит по коридору.", delay: 1150 }
      ],
      choices: [
        { text: "Кто ты?", next: "who", trust: 1 },
        { text: "Откуда у тебя мой номер?", next: "number" }
      ]
    },
    who: {
      messages: [
        { text: "Аня. Дежурная на ретрансляторе №7.", delay: 750 },
        { text: "Я вышла на смену в 22:00. Связь пропала час назад.", delay: 900 },
        { text: "На календаре 17 октября 1998-го. У тебя ведь другая дата?", delay: 1100 }
      ],
      choices: [
        { text: "Сейчас 2026 год.", next: "truth", truth: true, trust: 1 },
        { text: "Тоже 1998-й. Наверное, сбой.", next: "lie" }
      ]
    },
    number: {
      messages: [
        { text: "Я ничего не набирала. Твой контакт уже был в терминале.", delay: 800 },
        { text: "Под именем «Оператор 03». Рядом — сегодняшняя дата.", delay: 1000 },
        { text: "Скажи честно: какой сейчас год?", delay: 900 }
      ],
      choices: [
        { text: "2026-й. Между нами 28 лет.", next: "truth", truth: true, trust: 1 },
        { text: "1998-й. Ты просто устала.", next: "lie", trust: -1 }
      ]
    },
    truth: {
      contact: "Аня / Канал 07",
      messages: [
        { text: "Я так и думала.", delay: 900 },
        { text: "В журнале есть запись моим почерком. Она датирована 2026 годом.", delay: 1050 },
        { text: "Там написано твоё имя: «{name}, не отвечай на следующий звонок».", delay: 1250 },
        { type: "system", text: "ВХОДЯЩИЙ ВЫЗОВ ПЕРЕХВАЧЕН С КАНАЛА 00", delay: 800 }
      ],
      event: "incomingCall"
    },
    lie: {
      contact: "Аня / Канал 07",
      messages: [
        { text: "Нет. Я слышу в твоей комнате цифровые помехи. У нас таких телефонов ещё нет.", delay: 900 },
        { text: "Ты мне не доверяешь — понимаю. Но хотя бы послушай.", delay: 900 },
        { text: "В журнале написано: «{name}, не отвечай на следующий звонок».", delay: 1250 },
        { type: "system", text: "ВХОДЯЩИЙ ВЫЗОВ ПЕРЕХВАЧЕН С КАНАЛА 00", delay: 800 }
      ],
      event: "incomingCall"
    },
    declined: {
      messages: [
        { text: "Спасибо. Он звонит каждый раз, когда линия находит нового оператора.", delay: 850 },
        { text: "Предыдущий дежурный ответил. После этого его голос шёл из всех динамиков сразу.", delay: 1100 },
        { text: "Я отправлю фотографию здания. Скажи, что видишь в верхнем окне.", delay: 900 },
        { type: "photo", src: STATION_SRC, delay: 1200 }
      ],
      choices: [
        { text: "Там стоит человек.", next: "figure", figure: true, trust: 1 },
        { text: "Только отражение света.", next: "reflection" }
      ]
    },
    answered: {
      messages: [
        { type: "system", text: "ВЫЗОВ ЗАВЕРШЁН. ИСТОЧНИК СИГНАЛА: ЭТО УСТРОЙСТВО.", delay: 700 },
        { text: "Ты ответил… Что он сказал?", delay: 800 },
        { text: "Не повторяй последние слова вслух. Он запоминает голос.", delay: 1100 },
        { text: "Смотри. Я отправляю фотографию станции.", delay: 850 },
        { type: "photo", src: STATION_SRC, delay: 1200 }
      ],
      choices: [
        { text: "В окне кто-то есть.", next: "figure", figure: true },
        { text: "Я никого не вижу.", next: "reflection", trust: -1 }
      ]
    },
    figure: {
      messages: [
        { text: "На втором этаже нет окон. Только глухая аппаратная.", delay: 1000 },
        { text: "Значит, фотография сделана не снаружи.", delay: 1000 },
        { type: "audio", delay: 800 },
        { text: "Это запись из аппаратной. Под шумом повторяются три цифры.", delay: 850 }
      ],
      archive: "shift",
      choices: [{ text: "Попробовать настроить приёмник", action: "openFrequency", next: "awaitSignal" }]
    },
    reflection: {
      messages: [
        { text: "Я тоже сначала решила, что это отражение.", delay: 900 },
        { text: "Но свет двигается, когда я стою неподвижно.", delay: 1000 },
        { type: "audio", delay: 800 },
        { text: "В этой записи спрятан резервный код. Настрой приёмник на частоту из журнала.", delay: 900 }
      ],
      archive: "shift",
      choices: [{ text: "Открыть приёмник", action: "openFrequency", next: "awaitSignal" }]
    },
    awaitSignal: { messages: [], event: "awaitSignal" },
    signalFound: {
      messages: [
        { type: "system", text: "ЧАСТОТА 88.4 МГц. ТОНАЛЬНАЯ ПОСЛЕДОВАТЕЛЬНОСТЬ РАСПОЗНАНА: 4—1—9.", delay: 500 },
        { text: "419. Это код двери аппаратной.", delay: 800 },
        { text: "Странно… Я ввела его здесь, и на твоей стороне тоже открылось соединение.", delay: 950 },
        { text: "Введи код. Только быстро.", delay: 650 }
      ],
      archive: "protocol",
      choices: [{ text: "Ввести 419", action: "openCode", next: "awaitCode" }]
    },
    awaitCode: { messages: [], event: "awaitCode" },
    codeAccepted: {
      messages: [
        { type: "system", text: "РУЧНАЯ КОММУТАЦИЯ: ДОСТУП РАЗРЕШЁН.", delay: 500 },
        { text: "Дверь открылась.", delay: 700 },
        { text: "Здесь стоит телефон. На дисплее твоё имя и таймер: 00:02:11.", delay: 1000 },
        { text: "Рядом три тумблера: «РАЗРЫВ», «УДЕРЖАНИЕ», «ПЕРЕХОД».", delay: 1000 },
        { text: "{name}, я не знаю, что будет. Решать тебе.", delay: 950 }
      ],
      archive: "operator",
      choices: [
        { text: "РАЗРЫВ — выключить передатчик", ending: "break" },
        { text: "УДЕРЖАНИЕ — сохранить линию", ending: "hold" },
        { text: "ПЕРЕХОД — вывести Аню в 2026 год", ending: "cross" }
      ]
    }
  };

  const archiveCatalog = {
    shift: { title: "ЖУРНАЛ СМЕНЫ / 17.10.98", time: "23:41", text: "Основная частота — 88.4 МГц. При нарушении синхронизации использовать тональный резерв. Не отвечать на линию 00." },
    protocol: { title: "ПРОТОКОЛ 4—1—9", time: "00:07", text: "Три группы импульсов управляют ручной коммутацией. Код меняется после каждого завершённого сеанса." },
    operator: { title: "ЛИЧНОЕ ДЕЛО / ОПЕРАТОР 03", time: "2026", text: "Имя совпадает с текущим пользователем. Дата первого подключения отсутствует. Статус: активен." }
  };

  const endings = {
    break: {
      title: "Линия разорвана",
      text: "Ты выключаешь передатчик. Голос Ани исчезает на полуслове, а таймер останавливается за секунду до нуля. Утром в архиве появляется новый файл: фотография станции после пожара. На обороте — «Спасибо, что поверил».",
      label: "КОНЦОВКА 1/3 · ТИШИНА"
    },
    hold: {
      title: "Новый оператор",
      text: "Ты удерживаешь канал. Аня успевает выйти из здания, но линия остаётся открытой. Через несколько секунд телефон звонит снова — теперь на экране номер человека, который ещё не установил приложение. В журнале твоё имя меняется на «Дежурный 03».",
      label: "КОНЦОВКА 2/3 · ДЕЖУРСТВО"
    },
    cross: {
      title: "Лишний пассажир",
      text: "Ты включаешь переход. В аппаратной становится тихо. Аня пишет: «Я вижу твой свет». Сообщение приходит уже с сегодняшней датой. За дверью слышатся три коротких стука — и четвёртый, слишком медленный, отвечает изнутри телефона.",
      label: "КОНЦОВКА 3/3 · ПЕРЕХОД"
    }
  };

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && saved.name && Array.isArray(saved.history)) state = saved;
    } catch (_) {}
  }

  function haptic(pattern = 30) {
    if (navigator.vibrate) navigator.vibrate(pattern);
  }

  function replaceName(text) {
    return String(text || "").replaceAll("{name}", state.name);
  }

  function addHistory(item) {
    const entry = { ...item, text: replaceName(item.text), time: now() };
    delete entry.delay;
    state.history.push(entry);
    save();
    renderMessage(entry);
    if (!$("#chat-view").classList.contains("active")) $("#unread-dot").classList.remove("hidden");
  }

  function renderMessage(item) {
    const wrap = document.createElement("article");
    wrap.className = `message ${item.outgoing ? "outgoing" : "incoming"}`;
    const bubble = document.createElement("div");
    bubble.className = `bubble${item.type === "system" ? " system" : ""}`;

    if (item.type === "photo") {
      bubble.classList.add("photo-message");
      const image = new Image();
      image.src = item.src;
      image.alt = "Фотография станции №7";
      image.addEventListener("click", () => openMedia(item.src));
      const label = document.createElement("div");
      label.className = "photo-label";
      label.innerHTML = "<span>ВОССТАНОВЛЕНО 86%</span><span>00:17</span>";
      bubble.append(image, label);
    } else if (item.type === "audio") {
      bubble.classList.add("audio-message");
      const play = document.createElement("button");
      play.className = "audio-play";
      play.textContent = "▶";
      play.setAttribute("aria-label", "Воспроизвести запись");
      play.addEventListener("click", () => playSignal(play));
      const bars = document.createElement("div");
      bars.className = "audio-bars";
      [22,52,36,78,45,64,30,88,55,34,69,42,25].forEach(height => {
        const bar = document.createElement("i");
        bar.style.setProperty("--h", `${height}%`);
        bars.appendChild(bar);
      });
      const duration = document.createElement("span");
      duration.className = "audio-duration";
      duration.textContent = "0:07";
      bubble.append(play, bars, duration);
    } else {
      const text = document.createElement("span");
      text.textContent = item.text;
      bubble.appendChild(text);
      const meta = document.createElement("small");
      meta.className = "meta";
      meta.textContent = item.time;
      bubble.appendChild(meta);
    }
    wrap.appendChild(bubble);
    $("#messages").appendChild(wrap);
    $("#messages").scrollTop = $("#messages").scrollHeight;
  }

  function renderHistory() {
    $("#messages").replaceChildren();
    state.history.forEach(renderMessage);
    renderArchive();
  }

  function renderArchive() {
    const list = $("#archive-list");
    list.replaceChildren();
    if (!state.archives.length) {
      const empty = document.createElement("div");
      empty.className = "archive-empty";
      empty.textContent = "Файлы появятся здесь после восстановления фрагментов линии.";
      list.appendChild(empty);
      return;
    }
    state.archives.forEach(id => {
      const data = archiveCatalog[id];
      if (!data) return;
      const item = document.createElement("article");
      item.className = "archive-item";
      const header = document.createElement("header");
      const title = document.createElement("strong");
      title.textContent = data.title;
      const time = document.createElement("time");
      time.textContent = data.time;
      const text = document.createElement("p");
      text.textContent = data.text;
      header.append(title, time);
      item.append(header, text);
      list.appendChild(item);
    });
  }

  function unlockArchive(id) {
    if (!id || state.archives.includes(id)) return;
    state.archives.push(id);
    save();
    renderArchive();
  }

  function setChoices(choices = []) {
    const holder = $("#choices");
    holder.replaceChildren();
    choices.forEach(choice => {
      const button = document.createElement("button");
      button.className = "choice-button";
      button.textContent = choice.text;
      button.addEventListener("click", () => selectChoice(choice));
      holder.appendChild(button);
    });
  }

  async function runNode(id, resume = false) {
    const scene = scenes[id];
    if (!scene || busy || state.ending) return;
    state.node = id;
    save();

    if (scene.contact) {
      $("#contact-name").textContent = scene.contact;
      $("#contact-status").textContent = "в сети · задержка 28 лет";
      $("#signal-button").classList.add("online");
    }

    if (!state.entered.includes(id)) {
      busy = true;
      setChoices([]);
      state.entered.push(id);
      save();
      for (const message of scene.messages || []) {
        $("#typing").classList.toggle("hidden", message.type === "system" || message.type === "photo" || message.type === "audio");
        await sleep(Math.min(message.delay || 500, resume ? 20 : 1400));
        $("#typing").classList.add("hidden");
        addHistory(message);
        if (message.type !== "system") haptic(18);
      }
      unlockArchive(scene.archive);
      busy = false;
    }

    setChoices(scene.choices || []);
    if (scene.event) handleEvent(scene.event);
  }

  function selectChoice(choice) {
    if (busy) return;
    haptic(25);
    addHistory({ text: choice.text, outgoing: true });
    setChoices([]);
    if (choice.trust) state.flags.trust += choice.trust;
    if (choice.truth) state.flags.toldTruth = true;
    if (choice.figure) state.flags.sawFigure = true;
    save();
    if (choice.action === "openFrequency") switchView("frequency-view");
    if (choice.action === "openCode") openCode();
    if (choice.ending) return showEnding(choice.ending);
    if (choice.next) runNode(choice.next);
  }

  function handleEvent(event) {
    if (event === "incomingCall") openIncomingCall();
    if (event === "awaitSignal" && state.flags.signalFound) runNode("signalFound");
    if (event === "awaitCode" && state.flags.codeAccepted) runNode("codeAccepted");
  }

  function openIncomingCall() {
    if (state.flags.callResolved) return;
    $("#call-overlay").classList.remove("hidden");
    startRing();
  }

  function startRing() {
    haptic([300, 350, 300, 1200]);
    ringTimer = setInterval(() => {
      haptic([300, 350, 300]);
      tone(392, .14, .035);
      setTimeout(() => tone(523, .2, .03), 220);
    }, 2100);
  }

  function stopRing() {
    clearInterval(ringTimer);
    ringTimer = null;
    if (navigator.vibrate) navigator.vibrate(0);
  }

  function declineCall() {
    stopRing();
    $("#call-overlay").classList.add("hidden");
    state.flags.callResolved = true;
    state.flags.trust += 1;
    save();
    addHistory({ type: "system", text: "ВЫЗОВ ОТКЛОНЁН ПОЛЬЗОВАТЕЛЕМ." });
    runNode("declined");
  }

  function acceptCall() {
    stopRing();
    $("#call-overlay").classList.add("hidden");
    $("#active-call").classList.remove("hidden");
    state.flags.answered = true;
    state.flags.callResolved = true;
    save();
    startActiveCall();
  }

  function startActiveCall() {
    let seconds = 0;
    const transcript = $("#call-transcript");
    const lines = [
      "…слышишь меня?",
      `${state.name}… не включай переход…`,
      "это не Аня… она уже вышла…",
      "ты говоришь моим голосом…"
    ];
    playDrone(true);
    drawCallWave();
    callTimer = setInterval(() => {
      seconds += 1;
      $("#call-timer").textContent = `00:${String(seconds).padStart(2, "0")}`;
      if (seconds === 2) transcript.textContent = lines[1];
      if (seconds === 5) transcript.textContent = lines[2];
      if (seconds === 8) transcript.textContent = lines[3];
      if (seconds >= 11) endActiveCall();
    }, 1000);
  }

  function endActiveCall() {
    if ($("#active-call").classList.contains("hidden")) return;
    clearInterval(callTimer);
    callTimer = null;
    cancelAnimationFrame(waveformFrame);
    $("#active-call").classList.add("hidden");
    addHistory({ type: "system", text: "ДЛИТЕЛЬНОСТЬ ВЫЗОВА: 00:11." });
    runNode("answered");
  }

  function openMedia(src) {
    $("#media-image").src = src;
    $("#media-overlay").classList.remove("hidden");
    haptic(12);
  }

  function switchView(id) {
    $$(".view").forEach(view => view.classList.toggle("active", view.id === id));
    $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.view === id));
    if (id === "chat-view") {
      $("#unread-dot").classList.add("hidden");
      requestAnimationFrame(() => { $("#messages").scrollTop = $("#messages").scrollHeight; });
    }
    if (id === "frequency-view") drawFrequency();
  }

  function getAudio() {
    if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === "suspended") audioContext.resume();
    return audioContext;
  }

  function tone(frequency, duration = .15, volume = .04, when = 0) {
    try {
      const ctx = getAudio();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(.0001, ctx.currentTime + when);
      gain.gain.exponentialRampToValueAtTime(volume, ctx.currentTime + when + .02);
      gain.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + when + duration);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + when);
      osc.stop(ctx.currentTime + when + duration + .03);
    } catch (_) {}
  }

  function playSignal(button) {
    button.textContent = "■";
    [0, .14, .28, .42, .85, 1.25, 1.4, 1.55, 1.7, 1.85, 2, 2.15, 2.3, 2.45].forEach((when, index) => {
      const frequency = index < 4 ? 520 : index < 5 ? 680 : 410;
      tone(frequency, .09, .045, when);
    });
    setTimeout(() => { button.textContent = "▶"; }, 2800);
  }

  function playDrone(withVoice = false) {
    try {
      const ctx = getAudio();
      const length = ctx.sampleRate * 2.5;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * .035 * (1 - i / length);
      const source = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.frequency.value = withVoice ? 620 : 1100;
      source.buffer = buffer;
      source.connect(filter).connect(ctx.destination);
      source.start();
    } catch (_) {}
  }

  function drawWave(canvas, tuned = false, phase = 0) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = tuned ? "#d85147" : "#56615d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 4) {
      const noise = Math.sin(x * .18 + phase) * (tuned ? 18 : 9) + Math.sin(x * .043 + phase * .7) * (tuned ? 42 : 20);
      const spike = tuned && x % 86 < 10 ? Math.sin((x % 86) / 10 * Math.PI) * 48 : 0;
      const y = h / 2 + noise + spike;
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
  }

  function drawFrequency() {
    drawWave($("#waveform"), Number($("#frequency-range").value) === 884, Date.now() / 300);
  }

  function drawCallWave() {
    drawWave($("#call-waveform"), true, Date.now() / 120);
    waveformFrame = requestAnimationFrame(drawCallWave);
  }

  function listenFrequency() {
    const value = Number($("#frequency-range").value);
    playDrone();
    if (value === 884) {
      playSignal({ textContent: "" });
      haptic([40, 70, 40, 70, 120]);
      $("#code-hint").textContent = "419";
      $("#code-hint").classList.add("revealed");
      $("#listen-button").textContent = "СИГНАЛ НАЙДЕН · 4—1—9";
      if (!state.flags.signalFound) {
        state.flags.signalFound = true;
        save();
        setTimeout(() => {
          switchView("chat-view");
          runNode("signalFound");
        }, 1700);
      }
    } else {
      $("#listen-button").textContent = "ТОЛЬКО ШУМ";
      setTimeout(() => { $("#listen-button").textContent = "СЛУШАТЬ СИГНАЛ"; }, 1200);
    }
  }

  function buildKeypad() {
    const keypad = $("#keypad");
    keypad.replaceChildren();
    ["1","2","3","4","5","6","7","8","9","←","0","✓"].forEach(key => {
      const button = document.createElement("button");
      button.textContent = key;
      button.addEventListener("click", () => pressKey(key));
      keypad.appendChild(button);
    });
  }

  function openCode() {
    code = "";
    updateCode();
    $("#code-error").textContent = "";
    $("#code-overlay").classList.remove("hidden");
  }

  function pressKey(key) {
    haptic(12);
    if (key === "←") code = code.slice(0, -1);
    else if (key === "✓") {
      if (code === "419") {
        state.flags.codeAccepted = true;
        save();
        $("#code-overlay").classList.add("hidden");
        switchView("chat-view");
        return runNode("codeAccepted");
      }
      state.flags.mistakes += 1;
      save();
      $("#code-error").textContent = "КОД НЕ ПРИНЯТ";
      haptic([60, 50, 60]);
      code = "";
    } else if (code.length < 3) code += key;
    updateCode();
  }

  function updateCode() {
    $$("#code-digits span").forEach((digit, index) => digit.textContent = code[index] || "—");
  }

  function showEnding(id) {
    const ending = endings[id];
    state.ending = id;
    save();
    $("#ending-title").textContent = ending.title;
    $("#ending-text").textContent = ending.text;
    const minutes = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
    $("#ending-stats").textContent = `${ending.label} · ДОВЕРИЕ ${state.flags.trust >= 2 ? "ВЫСОКОЕ" : "ХРУПКОЕ"} · ${minutes} МИН.`;
    $("#ending-overlay").classList.remove("hidden");
    haptic([80, 100, 80, 250, 160]);
    tone(220, 1.4, .045);
  }

  function restart() {
    const name = state.name;
    state = freshState();
    state.name = name;
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    $("#ending-overlay").classList.add("hidden");
    renderHistory();
    switchView("chat-view");
    runNode("start");
  }

  function resumeGame() {
    $("#boot-screen").classList.add("hidden");
    $("#profile-screen").classList.add("hidden");
    $("#game-screen").classList.remove("hidden");
    renderHistory();
    if (state.ending) return showEnding(state.ending);
    runNode(state.node, true);
  }

  function bind() {
    $("#boot-start").addEventListener("click", () => {
      haptic(30);
      load();
      if (state.name) return resumeGame();
      $("#boot-screen").classList.add("hidden");
      $("#profile-screen").classList.remove("hidden");
      setTimeout(() => $("#player-name").focus(), 200);
    });
    $("#profile-back").addEventListener("click", () => {
      $("#profile-screen").classList.add("hidden");
      $("#boot-screen").classList.remove("hidden");
    });
    $("#player-name").addEventListener("input", event => {
      $("#profile-submit").disabled = event.target.value.trim().length < 2;
    });
    $("#profile-submit").addEventListener("click", () => {
      state = freshState();
      state.name = $("#player-name").value.trim();
      save();
      resumeGame();
    });
    $$(".nav-button").forEach(button => button.addEventListener("click", () => switchView(button.dataset.view)));
    $("#frequency-range").addEventListener("input", event => {
      $("#frequency-number").textContent = (Number(event.target.value) / 10).toFixed(1);
      drawFrequency();
    });
    $("#listen-button").addEventListener("click", listenFrequency);
    $("#decline-call").addEventListener("click", declineCall);
    $("#accept-call").addEventListener("click", acceptCall);
    $("#end-call").addEventListener("click", endActiveCall);
    $("#close-media").addEventListener("click", () => $("#media-overlay").classList.add("hidden"));
    $("#close-code").addEventListener("click", () => $("#code-overlay").classList.add("hidden"));
    $("#restart-button").addEventListener("click", restart);
    $("#signal-button").addEventListener("click", () => switchView("frequency-view"));
    buildKeypad();
    drawFrequency();
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  window.NIGHT_LINE_STORY = { scenes, endings, archiveCatalog };
  document.addEventListener("DOMContentLoaded", bind);
})();
