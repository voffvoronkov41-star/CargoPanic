(() => {
  "use strict";

  const SAVE_KEY = "nightLineSaveV1";
  const STATION_SRC = window.STATION_IMAGE || "assets/station-07.png";
  const CORRIDOR_SRC = window.CORRIDOR_IMAGE || "assets/corridor-07.png";
  const ANYA_SRC = window.ANYA_IMAGE || "assets/anya-archive.png";
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
    ending: null,
    version: 2
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
        { text: "РАЗРЫВ — выключить передатчик", midpoint: "break" },
        { text: "УДЕРЖАНИЕ — сохранить линию", midpoint: "hold" },
        { text: "ПЕРЕХОД — вывести Аню в 2026 год", midpoint: "cross" }
      ]
    },
    after_break: {
      contact: "Канал 07",
      messages: [
        { type: "system", text: "ПЕРЕДАТЧИК ОСТАНОВЛЕН. НЕСУЩАЯ ЧАСТОТА ОТСУТСТВУЕТ.", delay: 700 },
        { text: "Ты сделал это.", delay: 1300 },
        { text: "Здесь стало тихо. Слишком тихо.", delay: 1200 },
        { text: "Подожди… телефон в аппаратной всё ещё звонит, хотя питание отключено.", delay: 1500 },
        { type: "system", text: "ОБНАРУЖЕН СЛАБЫЙ СИГНАЛ: КАНАЛ 12 / 2011 ГОД.", delay: 900 }
      ],
      choices: [{ text: "Подключить канал 12", next: "dimaIntro" }]
    },
    after_hold: {
      contact: "Аня / Канал 07",
      messages: [
        { type: "system", text: "РЕЖИМ УДЕРЖАНИЯ. ДОПУСТИМАЯ ДЛИТЕЛЬНОСТЬ ПРЕВЫШЕНА.", delay: 700 },
        { text: "Я вышла из аппаратной. Коридор выглядит длиннее, чем раньше.", delay: 1150 },
        { text: "За каждой дверью слышу один и тот же телефонный звонок.", delay: 1300 },
        { text: "На стене появилась фотография. На ней ты стоишь у входа в станцию.", delay: 1350 },
        { type: "system", text: "ПАРАЛЛЕЛЬНОЕ ПОДКЛЮЧЕНИЕ: КАНАЛ 12 / 2011 ГОД.", delay: 900 }
      ],
      choices: [{ text: "Принять параллельный канал", next: "dimaIntro" }]
    },
    after_cross: {
      contact: "Аня / 2026?",
      messages: [
        { type: "system", text: "ПЕРЕХОД ВЫПОЛНЕН. КОНТРОЛЬНАЯ ТОЧКА НЕ ОПРЕДЕЛЕНА.", delay: 700 },
        { text: "{name}, я вижу комнату. Наверное, твою.", delay: 1100 },
        { text: "Но здесь никого нет. На столе лежит телефон, и на нём открыт наш разговор.", delay: 1300 },
        { text: "В отражении экрана кто-то стоит у меня за спиной.", delay: 1400 },
        { type: "system", text: "ВХОДЯЩЕЕ СООБЩЕНИЕ: КАНАЛ 12 / 2011 ГОД.", delay: 900 }
      ],
      choices: [{ text: "Открыть сообщение", next: "dimaIntro" }]
    },
    dimaIntro: {
      contact: "Дима / Канал 12",
      messages: [
        { text: "Если читаешь это — не верь тому, кто называет себя Аней.", delay: 1050 },
        { text: "Я дежурил на седьмом ретрансляторе в ноябре 2011-го.", delay: 1200 },
        { text: "Станция выбирает голос, которому ты доверяешь, и держит тебя на линии.", delay: 1350 },
        { text: "В списках персонала за 1998 год Ани нет.", delay: 1100 },
        { text: "Есть только фотография без фамилии.", delay: 900 },
        { type: "photo", src: ANYA_SRC, delay: 1200 }
      ],
      archive: "personnel",
      choices: [
        { text: "Аня существует. Я с ней разговаривал.", next: "anyaReturns", set: { alliance: "anya" }, trust: 1 },
        { text: "Докажи, что ты настоящий.", next: "dimaProof", set: { alliance: "dima" } },
        { text: "Я не доверяю ни одному из вас.", next: "neutralPath", set: { alliance: "none" } }
      ]
    },
    anyaReturns: {
      contact: "Аня / Канал 07",
      messages: [
        { type: "system", text: "КАНАЛ 12 ПРИНУДИТЕЛЬНО ОТКЛЮЧЁН.", delay: 500 },
        { text: "Он уже нашёл тебя?", delay: 800 },
        { text: "Дима — предыдущий оператор. Я видела его имя в журнале, но запись появилась только после твоего выбора.", delay: 1250 },
        { text: "Если он попросит настроиться на 87.2 — не делай этого. Там записаны голоса тех, кто ответил.", delay: 1300 },
        { text: "Я покажу тебе коридор. Посчитай красные лампы.", delay: 1000 },
        { type: "photo", src: CORRIDOR_SRC, delay: 1200 }
      ],
      choices: [
        { text: "Я вижу три красные лампы.", next: "corridorSolved", set: { lamps: 3 }, trust: 1 },
        { text: "Кажется, две.", next: "corridorMistake", set: { lamps: 2 } },
        { text: "Четыре. Одна возле телефона.", next: "corridorMistake", set: { lamps: 4 } }
      ]
    },
    dimaProof: {
      contact: "Дима / Канал 12",
      messages: [
        { text: "Хорошо. Открой архив и сравни время всех сообщений.", delay: 950 },
        { text: "Первый контакт всегда происходит в 00:17 — независимо от времени на телефоне.", delay: 1200 },
        { text: "В моём сеансе было так же. И в журнале за 1998-й тоже.", delay: 1200 },
        { text: "Аня сейчас пришлёт коридор. Она всегда это делает.", delay: 1000 },
        { type: "system", text: "ПОЛУЧЕН ФАЙЛ С КАНАЛА 07.", delay: 650 },
        { type: "photo", src: CORRIDOR_SRC, delay: 1200 }
      ],
      archive: "cycle",
      choices: [
        { text: "Три красные лампы. Телефон за дверью.", next: "corridorSolved", set: { lamps: 3 } },
        { text: "Что означает время 00:17?", next: "timeClue", trust: 1 }
      ]
    },
    neutralPath: {
      contact: "Канал 00",
      messages: [
        { type: "system", text: "КАНАЛЫ 07 И 12 ЗАБЛОКИРОВАНЫ ПОЛЬЗОВАТЕЛЕМ.", delay: 600 },
        { text: "{name}.", delay: 1200 },
        { text: "Правильно. Не доверяй голосам.", delay: 1200 },
        { text: "Доверяй повторениям.", delay: 1100 },
        { type: "photo", src: CORRIDOR_SRC, delay: 1100 },
        { text: "Три огня. Четыре цифры. Одно и то же время.", delay: 1100 }
      ],
      choices: [{ text: "00:17", next: "timeClue", set: { noticedLoop: true } }]
    },
    corridorMistake: {
      contact: "Аня / Канал 07",
      messages: [
        { text: "Нет. Посмотри ещё раз, не на телефон — на левую стену.", delay: 900 },
        { text: "Три лампы. Они мигают группами: ноль, семь, один, семь.", delay: 1200 },
        { text: "Это не азбука Морзе. Это время первого сообщения.", delay: 1100 }
      ],
      choices: [{ text: "00:17. Значит, код 0717.", next: "timeClue", set: { noticedLoop: true } }]
    },
    corridorSolved: {
      messages: [
        { text: "Да. Три лампы, но на записи слышны четыре группы импульсов.", delay: 900 },
        { type: "audio", delay: 750 },
        { text: "0 — 7 — 1 — 7. Время, когда линия впервые проснулась.", delay: 1150 }
      ],
      archive: "corridor",
      choices: [{ text: "Использовать 0717 как код архива", next: "awaitVault", action: "openCode", code: "0717", codeTitle: "Код архивного сейфа", codeNext: "vaultOpen" }]
    },
    timeClue: {
      messages: [
        { text: "00:17 повторяется в каждом сеансе.", delay: 900 },
        { text: "Если убрать двоеточие, получится код сейфа в комнате дежурного.", delay: 1050 }
      ],
      archive: "corridor",
      choices: [{ text: "Ввести 0717", next: "awaitVault", action: "openCode", code: "0717", codeTitle: "Код архивного сейфа", codeNext: "vaultOpen" }]
    },
    awaitVault: { messages: [], event: "awaitVault" },
    vaultOpen: {
      contact: "Общий канал",
      messages: [
        { type: "system", text: "АРХИВНЫЙ СЕЙФ ОТКРЫТ. ВОССТАНОВЛЕНО 11 СЕАНСОВ.", delay: 650 },
        { text: "1998 — Анна, канал 07.", delay: 850 },
        { text: "2011 — Дмитрий, канал 12.", delay: 850 },
        { text: "2026 — {name}, оператор 03.", delay: 900 },
        { text: "У всех записей одинаковая последняя фраза: «Я слышу тебя своим голосом».", delay: 1300 },
        { text: "Станция сохраняет не людей. Она сохраняет последнее, чему поверили.", delay: 1300 }
      ],
      archive: "eleven",
      choices: [
        { text: "Аня, скажи то, чего станция не может знать.", next: "anyaSecret", set: { alliance: "anya" } },
        { text: "Дима, как остановить повторение?", next: "dimaPlan", set: { alliance: "dima" } },
        { text: "Пусть оба замолчат на десять секунд.", next: "silenceTest", set: { alliance: "none" }, trust: 1 }
      ]
    },
    anyaSecret: {
      contact: "Аня / Канал 07",
      messages: [
        { text: "Я не могу доказать, что я — это я.", delay: 950 },
        { text: "Но станция боится тишины. Когда я перестала отвечать, стены вернулись на место.", delay: 1200 },
        { text: "Настрой 90.7. Там не голос — промежутки между словами.", delay: 1200 },
        { text: "И если я начну просить открыть переход, отключи меня.", delay: 1100 }
      ],
      archive: "anya_note",
      choices: [{ text: "Я запомню.", next: "secondCallWarning", set: { targetFrequency: 907, frequencyNext: "finalSignalAnya" } }]
    },
    dimaPlan: {
      contact: "Дима / Канал 12",
      messages: [
        { text: "У станции два передатчика. 88.4 хранит речь. 87.2 хранит момент до ответа.", delay: 1100 },
        { text: "На 87.2 ты услышишь оригинал, а не копию.", delay: 1100 },
        { text: "Но после прослушивания один из нас исчезнет.", delay: 1000 },
        { text: "Не позволяй Ане позвонить тебе раньше.", delay: 1000 }
      ],
      archive: "dima_note",
      choices: [{ text: "Настроюсь на 87.2.", next: "secondCallWarning", set: { targetFrequency: 872, frequencyNext: "finalSignalDima" } }]
    },
    silenceTest: {
      contact: "Общий канал",
      messages: [
        { type: "system", text: "ТАЙМЕР ТИШИНЫ: 10", delay: 500 },
        { type: "system", text: "9… 8… 7…", delay: 1200 },
        { type: "system", text: "6… 5… 4…", delay: 1200 },
        { type: "system", text: "КАНАЛ 00 ПЫТАЕТСЯ ИМИТИРОВАТЬ ВХОДЯЩИЙ ВЫЗОВ.", delay: 900 },
        { type: "system", text: "3… 2… 1… ТИШИНА ПОДТВЕРЖДЕНА.", delay: 1400 },
        { text: "Ты нашёл единственное, чего здесь не было в одиннадцати сеансах.", delay: 1100 }
      ],
      archive: "silence",
      choices: [{ text: "Слушать пустую частоту 90.7", next: "secondCallWarning", set: { targetFrequency: 907, frequencyNext: "finalSignalSilence", silenceFound: true } }]
    },
    secondCallWarning: {
      messages: [
        { type: "system", text: "ВХОДЯЩИЙ ВЫЗОВ: «АНЯ / 2026». ИДЕНТИФИКАЦИЯ НЕВОЗМОЖНА.", delay: 800 }
      ],
      event: "secondCall"
    },
    secondCallAnswered: {
      messages: [
        { type: "system", text: "ВЫЗОВ ЗАВЕРШЁН. В ГОЛОСЕ ОБНАРУЖЕНО ДВА ИСТОЧНИКА.", delay: 700 },
        { text: "Ты слышал паузы? Второй голос говорил только тогда, когда первый молчал.", delay: 1050 },
        { text: "Теперь приёмник покажет нужную частоту. Не слушай дольше семи секунд.", delay: 1100 }
      ],
      choices: [{ text: "Открыть приёмник", next: "awaitFinalFrequency", action: "prepareFrequency" }]
    },
    secondCallDeclined: {
      messages: [
        { type: "system", text: "ВЫЗОВ ОТКЛОНЁН. КАНАЛ 00 ПОТЕРЯЛ СИНХРОНИЗАЦИЮ.", delay: 650 },
        { text: "Хорошо. Ты не дал ему ещё один образец голоса.", delay: 950 },
        { text: "Теперь настрой частоту, которую выбрал.", delay: 1000 }
      ],
      choices: [{ text: "Открыть приёмник", next: "awaitFinalFrequency", action: "prepareFrequency" }]
    },
    awaitFinalFrequency: { messages: [], event: "awaitFinalFrequency" },
    finalSignalAnya: {
      contact: "Частота 90.7",
      messages: [
        { type: "system", text: "90.7 МГц. РАСПОЗНАНЫ ИНТЕРВАЛЫ ТИШИНЫ.", delay: 600 },
        { type: "audio", delay: 700 },
        { text: "В паузах слышен настоящий коридор: дождь, шаги Ани и пожарная сирена.", delay: 1100 },
        { text: "А её голос продолжает говорить даже после того, как шаги прекращаются.", delay: 1200 }
      ],
      archive: "original",
      choices: [{ text: "Вернуться к щиту управления", next: "finalChoice" }]
    },
    finalSignalDima: {
      contact: "Частота 87.2",
      messages: [
        { type: "system", text: "87.2 МГц. ВОССТАНОВЛЕН ИСХОДНЫЙ СЕАНС 2011 ГОДА.", delay: 600 },
        { type: "audio", delay: 700 },
        { text: "На записи Дима предупреждает тебя твоим голосом — за пятнадцать лет до установки приложения.", delay: 1250 },
        { text: "В конце он произносит код, которого ещё не знает: 0717.", delay: 1100 }
      ],
      archive: "original",
      choices: [{ text: "Вернуться к щиту управления", next: "finalChoice" }]
    },
    finalSignalSilence: {
      contact: "Пустая частота",
      messages: [
        { type: "system", text: "90.7 МГц. РЕЧЕВОЙ СИГНАЛ ОТСУТСТВУЕТ.", delay: 600 },
        { type: "audio", delay: 700 },
        { text: "Семь секунд нет ни голоса, ни помех.", delay: 1000 },
        { text: "Затем все одиннадцать сохранённых собеседников одновременно делают вдох.", delay: 1300 },
        { text: "Но никто не успевает заговорить.", delay: 950 }
      ],
      archive: "original",
      choices: [{ text: "Вернуться к щиту управления", next: "finalChoice" }]
    },
    finalChoice: {
      contact: "Щит управления",
      messages: [
        { type: "system", text: "ДО КОНЦА ЦИКЛА: 00:01:17.", delay: 650 },
        { text: "На щите появились пять команд.", delay: 850 },
        { text: "Станция ждёт не правильного ответа. Она ждёт, что ты снова выберешь чей-то голос.", delay: 1200 },
        { text: "{name}, это последний выбор.", delay: 950 }
      ],
      choices: [
        { text: "ОБЕСТОЧИТЬ — оставить линию в полной тишине", ending: "silence" },
        { text: "КАНАЛ 07 — вывести Аню", ending: "save_anya" },
        { text: "КАНАЛ 12 — вывести Диму", ending: "save_dima" },
        { text: "УДЕРЖАНИЕ — остаться новым оператором", ending: "operator" },
        { text: "КАНАЛ 00 — ответить всем голосам", ending: "chorus" }
      ]
    }
  };

  const archiveCatalog = {
    shift: { title: "ЖУРНАЛ СМЕНЫ / 17.10.98", time: "23:41", text: "Основная частота — 88.4 МГц. При нарушении синхронизации использовать тональный резерв. Не отвечать на линию 00." },
    protocol: { title: "ПРОТОКОЛ 4—1—9", time: "00:07", text: "Три группы импульсов управляют ручной коммутацией. Код меняется после каждого завершённого сеанса." },
    operator: { title: "ЛИЧНОЕ ДЕЛО / ОПЕРАТОР 03", time: "2026", text: "Имя совпадает с текущим пользователем. Дата первого подключения отсутствует. Статус: активен." },
    personnel: { title: "КАРТОТЕКА / НЕОПОЗНАННЫЙ СОТРУДНИК", time: "1998", text: "Фотография найдена в личном деле без имени и табельного номера. На обороте карандашом: «не давать ей телефон»." },
    cycle: { title: "СВОДКА ПОВТОРЕНИЙ", time: "00:17", text: "Все зарегистрированные сеансы начинаются в 00:17 по локальному времени принимающего устройства." },
    corridor: { title: "КОРИДОР / КАМЕРА 03", time: "00:17", text: "Три красных индикатора передают четыре группы: 0—7—1—7. Источник изображения отсутствует." },
    eleven: { title: "АРХИВ 11 СЕАНСОВ", time: "1998—2026", text: "Каждый оператор слышал знакомый голос. Ни один не завершил связь до появления канала 00." },
    anya_note: { title: "ЗАПИСКА КАНАЛА 07", time: "90.7", text: "Содержимое речи копируется. Промежутки тишины остаются оригинальными." },
    dima_note: { title: "ЗАПИСКА КАНАЛА 12", time: "87.2", text: "Резервный передатчик хранит семь секунд до первого ответа оператора." },
    silence: { title: "ТЕСТ ТИШИНЫ", time: "00:10", text: "Впервые зафиксирован интервал, в котором ни один участник не ответил линии." },
    original: { title: "ИСХОДНЫЙ СИГНАЛ", time: "7 сек.", text: "Различие между копией и человеком обнаруживается только в паузах между словами." }
  };

  const endings = {
    silence: {
      title: "Семь секунд тишины",
      text: "Ты обесточиваешь оба передатчика и не отвечаешь на последний вопрос. Одиннадцать голосов произносят твоё имя, но ты позволяешь им исчезнуть. Утром приложение пусто. Только в архиве остаётся семисекундная запись дождя — без слов.",
      label: "КОНЦОВКА 1/5 · ТИШИНА"
    },
    save_anya: {
      title: "Девушка без фамилии",
      text: "Ты открываешь канал 07. Аня выходит из станции в ночь 2026 года и присылает фотографию мокрой дороги. Через минуту сообщение исчезает, но на исходной архивной фотографии появляется её фамилия. Неизвестно, кого именно ты спас — человека или память, научившуюся молчать.",
      label: "КОНЦОВКА 2/5 · КАНАЛ 07"
    },
    save_dima: {
      title: "Опоздавший на пятнадцать лет",
      text: "Ты выводишь канал 12. Дима появляется возле закрытой станции в 2026 году, не постарев ни на день. Он благодарит тебя и просит никогда больше не открывать приложение. Но последнее сообщение приходит с канала 07: «Это не Дима».",
      label: "КОНЦОВКА 3/5 · КАНАЛ 12"
    },
    operator: {
      title: "Дежурный 03",
      text: "Ты удерживаешь линию, чтобы Аня и Дима не исчезли. Таймер сбрасывается на 00:17, а твой голос становится спокойнее и старше. На другом телефоне кто-то впервые открывает «Ночную линию» и видит сообщение: «Пожалуйста, ответь».",
      label: "КОНЦОВКА 4/5 · НОВЫЙ ОПЕРАТОР"
    },
    chorus: {
      title: "Все голоса сразу",
      text: "Ты отвечаешь каналу 00. Станция получает то, чего ей не хватало: твой добровольный голос. Аня, Дима и ещё девять человек начинают говорить одновременно, складываясь в одну идеальную копию. Приложение закрывается. Затем звонит обычный телефон.",
      label: "КОНЦОВКА 5/5 · ХОР"
    }
  };

  function save() {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (saved && saved.name && Array.isArray(saved.history)) {
        state = saved;
        state.flags = { ...freshState().flags, ...(state.flags || {}) };
        state.entered = Array.isArray(state.entered) ? state.entered : [];
        state.archives = Array.isArray(state.archives) ? state.archives : [];
        if (!state.version) {
          const oldEnding = ["break", "hold", "cross"].includes(state.ending) ? state.ending : null;
          state.version = 2;
          if (oldEnding) {
            state.flags.midpoint = oldEnding;
            state.ending = null;
            state.node = `after_${oldEnding}`;
          }
          save();
        }
      }
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
    if (choice.set) Object.assign(state.flags, choice.set);
    save();
    if (choice.action === "openFrequency") switchView("frequency-view");
    if (choice.action === "prepareFrequency") prepareFinalFrequency();
    if (choice.action === "openCode") openCode(choice.code, choice.codeTitle, choice.codeNext);
    if (choice.midpoint) return beginMidpoint(choice.midpoint);
    if (choice.ending) return showEnding(choice.ending);
    if (choice.next) runNode(choice.next);
  }

  function handleEvent(event) {
    if (event === "incomingCall") openIncomingCall("first");
    if (event === "secondCall") openIncomingCall("second");
    if (event === "awaitSignal" && state.flags.signalFound) runNode("signalFound");
    if (event === "awaitCode" && state.flags.codeAccepted) runNode("codeAccepted");
    if (event === "awaitVault" && state.flags.vaultAccepted) runNode("vaultOpen");
    if (event === "awaitFinalFrequency" && state.flags.finalSignalFound) runNode(state.flags.frequencyNext);
  }

  function beginMidpoint(id) {
    state.flags.midpoint = id;
    state.ending = null;
    state.version = 2;
    save();
    runNode(`after_${id}`);
  }

  function openIncomingCall(mode = "first") {
    if (mode === "first" && state.flags.callResolved) return;
    if (mode === "second" && state.flags.secondCallResolved) return;
    state.flags.callMode = mode;
    $("#caller-name").textContent = mode === "second" ? "АНЯ / 2026" : "НЕИЗВЕСТНЫЙ";
    $("#call-number").textContent = mode === "second" ? "Канал 07 + Канал 00" : "+7 ••• ••• 07 07";
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
    if (state.flags.callMode === "second") {
      state.flags.secondCallResolved = true;
      state.flags.secondAnswered = false;
      save();
      addHistory({ type: "system", text: "ВТОРОЙ ВЫЗОВ ОТКЛОНЁН ПОЛЬЗОВАТЕЛЕМ." });
      return runNode("secondCallDeclined");
    }
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
    if (state.flags.callMode === "second") {
      state.flags.secondCallResolved = true;
      state.flags.secondAnswered = true;
    } else {
      state.flags.answered = true;
      state.flags.callResolved = true;
    }
    save();
    startActiveCall();
  }

  function startActiveCall() {
    let seconds = 0;
    const transcript = $("#call-transcript");
    const second = state.flags.callMode === "second";
    const lines = second ? [
      "…не говори ничего…",
      "слушай только паузы между словами…",
      "я — Аня… я — Дима… я — ты…",
      "оно не умеет молчать…"
    ] : [
      "…слышишь меня?",
      `${state.name}… не включай переход…`,
      "это не Аня… она уже вышла…",
      "ты говоришь моим голосом…"
    ];
    $("#call-timer").textContent = "00:00";
    transcript.textContent = lines[0];
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
    const second = state.flags.callMode === "second";
    addHistory({ type: "system", text: second ? "ДЛИТЕЛЬНОСТЬ ВТОРОГО ВЫЗОВА: 00:11." : "ДЛИТЕЛЬНОСТЬ ВЫЗОВА: 00:11." });
    runNode(second ? "secondCallAnswered" : "answered");
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
    const target = state.flags.finalFrequencyActive ? Number(state.flags.targetFrequency || 907) : 884;
    drawWave($("#waveform"), Number($("#frequency-range").value) === target, Date.now() / 300);
  }

  function drawCallWave() {
    drawWave($("#call-waveform"), true, Date.now() / 120);
    waveformFrame = requestAnimationFrame(drawCallWave);
  }

  function listenFrequency() {
    const value = Number($("#frequency-range").value);
    const finalStage = Boolean(state.flags.finalFrequencyActive);
    const target = finalStage ? Number(state.flags.targetFrequency || 907) : 884;
    playDrone();
    if (value === target) {
      playSignal({ textContent: "" });
      haptic([40, 70, 40, 70, 120]);
      $("#code-hint").textContent = finalStage ? (target / 10).toFixed(1) : "419";
      $("#code-hint").classList.add("revealed");
      $("#listen-button").textContent = finalStage ? `СИГНАЛ НАЙДЕН · ${(target / 10).toFixed(1)}` : "СИГНАЛ НАЙДЕН · 4—1—9";
      if (finalStage && !state.flags.finalSignalFound) {
        state.flags.finalSignalFound = true;
        save();
        setTimeout(() => {
          switchView("chat-view");
          runNode(state.flags.frequencyNext || "finalSignalSilence");
        }, 1700);
      } else if (!finalStage && !state.flags.signalFound) {
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

  function prepareFinalFrequency() {
    state.flags.finalFrequencyActive = true;
    state.flags.finalSignalFound = false;
    const range = $("#frequency-range");
    range.value = state.flags.targetFrequency === 872 ? 884 : 895;
    $("#frequency-number").textContent = (Number(range.value) / 10).toFixed(1);
    $("#code-hint").textContent = "███";
    $("#code-hint").classList.remove("revealed");
    $("#listen-button").textContent = "СЛУШАТЬ СИГНАЛ";
    save();
    switchView("frequency-view");
    drawFrequency();
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

  function openCode(expected = "419", title = "Введите резервный код", nextNode = "codeAccepted") {
    code = "";
    state.flags.expectedCode = expected || "419";
    state.flags.codeNext = nextNode || "codeAccepted";
    const digits = $("#code-digits");
    digits.replaceChildren();
    for (let index = 0; index < state.flags.expectedCode.length; index += 1) {
      digits.appendChild(document.createElement("span"));
    }
    $("#code-overlay h2").textContent = title || "Введите резервный код";
    updateCode();
    $("#code-error").textContent = "";
    $("#code-overlay").classList.remove("hidden");
  }

  function pressKey(key) {
    haptic(12);
    if (key === "←") code = code.slice(0, -1);
    else if (key === "✓") {
      if (code === state.flags.expectedCode) {
        const nextNode = state.flags.codeNext || "codeAccepted";
        if (code === "419") state.flags.codeAccepted = true;
        if (code === "0717") state.flags.vaultAccepted = true;
        save();
        $("#code-overlay").classList.add("hidden");
        switchView("chat-view");
        return runNode(nextNode);
      }
      state.flags.mistakes += 1;
      save();
      $("#code-error").textContent = "КОД НЕ ПРИНЯТ";
      haptic([60, 50, 60]);
      code = "";
    } else if (code.length < String(state.flags.expectedCode || "419").length) code += key;
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
      const disabled = event.target.value.trim().length < 2;
      $("#profile-submit").disabled = disabled;
      $("#checkpoint-start").disabled = disabled;
    });
    $("#profile-submit").addEventListener("click", () => {
      state = freshState();
      state.name = $("#player-name").value.trim();
      save();
      resumeGame();
    });
    $("#checkpoint-start").addEventListener("click", () => $("#checkpoint-overlay").classList.remove("hidden"));
    $("#close-checkpoint").addEventListener("click", () => $("#checkpoint-overlay").classList.add("hidden"));
    $$("#checkpoint-overlay [data-midpoint]").forEach(button => button.addEventListener("click", () => {
      state = freshState();
      state.name = $("#player-name").value.trim();
      state.flags.midpoint = button.dataset.midpoint;
      state.node = `after_${button.dataset.midpoint}`;
      state.history.push({
        type: "system",
        text: `ПРОЛОГ ВОССТАНОВЛЕН. ПОСЛЕДНИЙ ВЫБОР: ${button.textContent}.`,
        time: now()
      });
      save();
      $("#checkpoint-overlay").classList.add("hidden");
      resumeGame();
    }));
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
