/* analytics.js — «Архів»: що учень робить на платформі. window.HLGAnalytics.

   Перенесено з першої версії (Робоча19/HistoryLikeGame/shared/js/analytics.js)
   і доповнено трьома речами, яких вимагає доказова база
   (docs/review-evidence.md, п. 6):
     1. запис по ЕЛЕМЕНТУ (факт, вимога програми), а не лише по сесії —
        answer(id, ok);
     2. покинута гра пишеться так само, як завершена, з прапорцем x: 1 —
        «кинув на півдорозі» і є найчесніший сигнал;
     3. seed набору (?seed=) пишеться в запис — той самий набір через кілька
        днів дає відкладене вимірювання.
   І ще одне — слухачі впливають на розвиток платформи (рішення куратора
   2026-11-20): rate() — оцінка гри одним дотиком і коментар.

   Приватність. Жодної мережі, жодних cookies, жодних імен. Пристрій має
   випадковий код із шести символів — щоб викладач не рахував двічі один і
   той самий лист. Дані йдуть до викладача лише тоді, коли учень сам натисне
   «Надіслати викладачу» (mailto — рішення куратора 2026-11-20).

   Підключення — ОДИН рядок у хвості сторінки:
     <script src="../shared/js/analytics.js"></script>
   Сам по собі він пише ВІЗИТ сторінки (k: 'v' — що відкривали і скільки
   там пробули). Гра з результатом додає сесію:

     if (window.HLGAnalytics) HLGAnalytics.startSession('03-rus-ukraina:kara-vikinha');
     if (window.HLGAnalytics) HLGAnalytics.answer('P03.T14', false);
     if (window.HLGAnalytics) HLGAnalytics.endSession({ score: 12, total: 15, won: true });

   Запис гри (~120 байт без f):
     { k:'g', m, t0, dt, s, n, w, a, x, sd, f: { 'P03.T14': [ok, bad] } }

   Ключі: histgame_analytics (масив записів), histgame_feedback (оцінки),
   histgame_device (код пристрою). Кожен доступ — у try/catch; без сховища
   модуль працює в пам'яті й каже про це isPersistent().
*/
(function () {
  'use strict';

  var KEY = 'histgame_analytics';
  var FEEDBACK_KEY = 'histgame_feedback';
  var DEVICE_KEY = 'histgame_device';
  var MAX_RECORDS = 10000;
  var MAX_FEEDBACK = 500;
  var TEACHER_EMAIL = 'korniienko.serhii@kdpu.edu.ua';
  /* Частина поштових клієнтів обрізає mailto після ~2000 символів. */
  var MAIL_LIMIT = 1800;

  var RATINGS = [
    { value: 'like', label: 'Цікаво' },
    { value: 'boring', label: 'Нудно' },
    { value: 'hard', label: 'Заскладно' },
    { value: 'easy', label: 'Заслабко' }
  ];

  var memory = { records: [], feedback: [], device: null };
  var persistent = true;
  var session = null;
  var visit = null;

  /* --- сховище ----------------------------------------------------------- */

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(key);
      if (raw === null) { return fallback; }
      var parsed = JSON.parse(raw);
      return parsed === null ? fallback : parsed;
    } catch (e) {
      persistent = false;
      return fallback;
    }
  }

  function write(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      persistent = false;
      return false;
    }
  }

  function loadRecords() {
    var arr = read(KEY, null);
    if (Array.isArray(arr)) { return arr; }
    return memory.records;
  }

  function saveRecords(arr) {
    if (arr.length > MAX_RECORDS) { arr.splice(0, arr.length - MAX_RECORDS); }
    memory.records = arr;
    if (!write(KEY, arr) && arr.length > 100) {
      /* Квота: віддаємо найстаріші сто й пробуємо ще раз. */
      arr.splice(0, 100);
      write(KEY, arr);
    }
  }

  function push(record) {
    var arr = loadRecords();
    arr.push(record);
    saveRecords(arr);
  }

  function loadFeedback() {
    var arr = read(FEEDBACK_KEY, null);
    return Array.isArray(arr) ? arr : memory.feedback;
  }

  function deviceId() {
    var id = read(DEVICE_KEY, null) || memory.device;
    if (typeof id === 'string' && id) { return id; }
    var alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    id = '';
    for (var i = 0; i < 6; i++) {
      id += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    memory.device = id;
    write(DEVICE_KEY, id);
    return id;
  }

  /* --- що це за сторінка -------------------------------------------------- */

  function param(name) {
    var match = new RegExp('[?&]' + name + '=([^&#]*)').exec(window.location.search);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  }

  /* Ідентифікатор сторінки: ім'я файла + те, що розрізняє варіанти гри.
     ?game= — той самий id, що й у гаманці (CLAUDE.md: «registry id =
     moduleId»), тож він перший. */
  function pageId() {
    /* ?game= — уже повний id гри; з ним візит і сесія лягають в один рядок
       зведення, а не в два. */
    var game = param('game');
    if (game) { return game; }
    var match = window.location.pathname.match(/([^\/]+?)(?:\.html?)?$/);
    var name = match ? decodeURIComponent(match[1]) : 'index';
    var variant = param('facts') || param('pic') || param('block');
    return variant ? name + '?' + variant : name;
  }

  /* --- сесія гри --------------------------------------------------------- */

  function startSession(moduleId, opts) {
    opts = opts || {};
    /* Нова сесія поверх незакритої — це теж покинута гра. */
    if (session) { closeSession({ abandoned: true }); }
    session = {
      m: moduleId || pageId(),
      t0: Date.now(),
      sd: opts.seed !== undefined ? opts.seed : param('seed'),
      f: {},
      a: opts.attempts || 0
    };
  }

  function answer(itemId, correct) {
    if (!session || !itemId) { return; }
    var pair = session.f[itemId] || (session.f[itemId] = [0, 0]);
    pair[correct ? 0 : 1] += 1;
  }

  function closeSession(opts) {
    if (!session) { return; }
    opts = opts || {};
    var record = {
      k: 'g',
      m: session.m,
      t0: session.t0,
      dt: Date.now() - session.t0,
      s: typeof opts.score === 'number' ? opts.score : 0,
      w: !!opts.won,
      a: opts.attempts || session.a || 1
    };
    if (typeof opts.total === 'number') { record.n = opts.total; }
    if (opts.abandoned) { record.x = 1; }
    if (session.sd !== null && session.sd !== undefined && session.sd !== '') {
      record.sd = session.sd;
    }
    if (Object.keys(session.f).length) { record.f = session.f; }
    session = null;
    push(record);
  }

  function endSession(opts) {
    closeSession(opts || {});
  }

  function cancelSession() {
    session = null;
  }

  /* --- візит сторінки й вихід ------------------------------------------- */

  function startVisit() {
    visit = { m: pageId(), t0: Date.now() };
  }

  /* pagehide, а не beforeunload: на телефоні вкладку частіше вбивають, ніж
     закривають, і beforeunload тоді не приходить. */
  function onLeave() {
    if (session) { closeSession({ abandoned: true }); }
    if (visit) {
      push({ k: 'v', m: visit.m, t0: visit.t0, dt: Date.now() - visit.t0 });
      visit = null;
    }
  }

  function onShow(event) {
    /* Повернення з кешу «назад/вперед» — новий візит. */
    if (event && event.persisted) { startVisit(); }
  }

  /* --- оцінка гри ------------------------------------------------------- */

  function rate(moduleId, value, comment) {
    var arr = loadFeedback();
    var entry = { m: moduleId || pageId(), t: Date.now(), r: value };
    if (comment) { entry.c = String(comment).slice(0, 500); }
    arr.push(entry);
    if (arr.length > MAX_FEEDBACK) { arr.splice(0, arr.length - MAX_FEEDBACK); }
    memory.feedback = arr;
    write(FEEDBACK_KEY, arr);
  }

  /* --- зведення ----------------------------------------------------------- */

  function getSessions() {
    return loadRecords().slice();
  }

  function getFeedback() {
    return loadFeedback().slice();
  }

  function getOverview() {
    var arr = loadRecords();
    var games = 0, abandoned = 0, time = 0, modules = {};
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      time += r.dt || 0;
      if (r.k === 'g' || !r.k) {
        games += 1;
        if (r.x) { abandoned += 1; }
        modules[r.m] = true;
      }
    }
    return {
      totalSessions: games,
      abandoned: abandoned,
      totalTime: time,
      uniqueModules: Object.keys(modules).length,
      visits: arr.length - games
    };
  }

  function getModuleSummary(id) {
    var arr = loadRecords();
    var out = { plays: 0, finished: 0, abandoned: 0, visits: 0, time: 0,
                bestScore: 0, bestTotal: 0 };
    for (var i = 0; i < arr.length; i++) {
      var r = arr[i];
      if (r.m !== id) { continue; }
      out.time += r.dt || 0;
      if (r.k === 'v') { out.visits += 1; continue; }
      out.plays += 1;
      if (r.x) { out.abandoned += 1; } else { out.finished += 1; }
      if ((r.s || 0) >= out.bestScore) { out.bestScore = r.s || 0; out.bestTotal = r.n || 0; }
    }
    return out;
  }

  /* Елементи, на яких помиляються найчастіше, — по всіх сесіях. */
  function getItemErrors(limit) {
    var arr = loadRecords();
    var totals = {};
    for (var i = 0; i < arr.length; i++) {
      var f = arr[i].f;
      if (!f) { continue; }
      for (var id in f) {
        if (!Object.prototype.hasOwnProperty.call(f, id)) { continue; }
        var t = totals[id] || (totals[id] = [0, 0]);
        t[0] += f[id][0] || 0;
        t[1] += f[id][1] || 0;
      }
    }
    var list = Object.keys(totals).map(function (id) {
      return { id: id, ok: totals[id][0], bad: totals[id][1] };
    }).filter(function (x) { return x.bad > 0; });
    list.sort(function (a, b) { return b.bad - a.bad; });
    return list.slice(0, limit || 10);
  }

  /* --- експорт ----------------------------------------------------------- */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function formatDuration(ms) {
    var s = Math.floor((ms || 0) / 1000);
    var m = Math.floor(s / 60);
    return m + ':' + pad(s % 60);
  }

  function formatDate(ts) {
    var d = new Date(ts);
    return pad(d.getDate()) + '.' + pad(d.getMonth() + 1) + '.' + d.getFullYear()
      + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function csvCell(value) {
    var text = String(value === undefined || value === null ? '' : value);
    return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function exportCSV() {
    var lines = ['device,kind,module,date,duration_sec,score,total,won,abandoned,seed,items'];
    var device = deviceId();
    loadRecords().forEach(function (r) {
      var items = r.f ? Object.keys(r.f).map(function (id) {
        return id + ':' + r.f[id][0] + '/' + r.f[id][1];
      }).join(' ') : '';
      lines.push([device, r.k || 'g', r.m, formatDate(r.t0),
        Math.round((r.dt || 0) / 1000), r.s || 0, r.n || '', r.w ? 1 : 0,
        r.x ? 1 : 0, r.sd || '', items].map(csvCell).join(','));
    });
    return lines.join('\n');
  }

  function exportJSON() {
    return JSON.stringify({
      device: deviceId(),
      exported: Date.now(),
      records: loadRecords(),
      feedback: loadFeedback()
    }, null, 2);
  }

  function downloadFile(format) {
    var csv = format === 'csv';
    var blob = new Blob([csv ? exportCSV() : exportJSON()],
      { type: (csv ? 'text/csv' : 'application/json') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'istoriia-yak-hra-' + deviceId() + '.' + (csv ? 'csv' : 'json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Лист — ЗВЕДЕННЯ, а не сирий CSV: тисяча записів у тілі mailto обрізалася
     б мовчки. Повні дані — кнопкою «Зберегти файл». */
  function mailBody() {
    var arr = loadRecords();
    var byModule = {};
    arr.forEach(function (r) {
      var m = byModule[r.m] || (byModule[r.m] = { v: 0, g: 0, done: 0, x: 0, t: 0, best: '' });
      m.t += r.dt || 0;
      if (r.k === 'v') { m.v += 1; return; }
      m.g += 1;
      if (r.x) { m.x += 1; } else { m.done += 1; }
      if (!r.x && r.n) { m.best = r.s + '/' + r.n; }
    });

    var overview = getOverview();
    var lines = [
      'Історія як гра — дані слухача',
      'Пристрій: ' + deviceId() + ' · Ігор: ' + overview.totalSessions
        + ' (кинуто ' + overview.abandoned + ') · Час: ' + formatDuration(overview.totalTime),
      '',
      'Сторінки й ігри (відкрито / зіграно / завершено / кинуто / час):'
    ];
    Object.keys(byModule).forEach(function (id) {
      var m = byModule[id];
      lines.push('- ' + id + ': ' + m.v + ' / ' + m.g + ' / ' + m.done + ' / ' + m.x
        + ' / ' + formatDuration(m.t) + (m.best ? ' · останній ' + m.best : ''));
    });

    var errors = getItemErrors(10);
    if (errors.length) {
      lines.push('', 'Найчастіші помилки (вимога: правильно/хибно):');
      errors.forEach(function (e) { lines.push('- ' + e.id + ': ' + e.ok + '/' + e.bad); });
    }

    var feedback = loadFeedback();
    if (feedback.length) {
      lines.push('', 'Оцінки ігор:');
      feedback.slice(-15).forEach(function (f) {
        lines.push('- ' + f.m + ': ' + f.r + (f.c ? ' — ' + f.c : ''));
      });
    }

    var body = lines.join('\n');
    if (body.length > MAIL_LIMIT) {
      body = body.slice(0, MAIL_LIMIT) + '\n… (обрізано; повні дані — кнопкою «Зберегти файл»)';
    }
    return body;
  }

  function sendToTeacher() {
    window.location.href = 'mailto:' + TEACHER_EMAIL
      + '?subject=' + encodeURIComponent('Історія як гра — дані ' + deviceId())
      + '&body=' + encodeURIComponent(mailBody());
  }

  function clearAll() {
    memory.records = [];
    memory.feedback = [];
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem(FEEDBACK_KEY);
    } catch (e) { persistent = false; }
  }

  /* --- розмітка ----------------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function button(text, className, onClick) {
    var b = el('button', className, text);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  /* Картка «Мій архів» на головній. Стилі — shared/css/index.css
     (.archive*), кольори лише через var(--color-*). */
  function renderDashboard(containerId) {
    var container = document.getElementById(containerId);
    if (!container) { return; }
    while (container.firstChild) { container.removeChild(container.firstChild); }

    var overview = getOverview();
    var stats = el('div', 'archive__stats');
    [
      ['Ігор зіграно', overview.totalSessions],
      ['Кинуто', overview.abandoned],
      ['Час на платформі', formatDuration(overview.totalTime)],
      ['Різних ігор', overview.uniqueModules]
    ].forEach(function (pair) {
      var cell = el('div', 'archive__stat');
      cell.appendChild(el('span', 'archive__value', pair[1]));
      cell.appendChild(el('span', 'archive__label', pair[0]));
      stats.appendChild(cell);
    });
    container.appendChild(stats);

    container.appendChild(el('p', 'archive__note',
      'Тут лише те, що ви робили на цьому пристрої: без імені й без мережі. '
      + 'Надішліть викладачеві — так ви вирішуєте, які ігри з’являться далі.'
      + (persistent ? '' : ' Сховище недоступне: дані зникнуть після закриття вкладки.')));

    var row = el('div', 'archive__actions');
    row.appendChild(button('Надіслати викладачу', 'game', sendToTeacher));
    row.appendChild(button('Зберегти файл', 'game game--plain', function () {
      downloadFile('json');
    }));

    /* Очищення в два кроки замість confirm(): модальне вікно блокує
       сторінку, а тут досить другого натиску. */
    var clear = button('Очистити', 'game game--plain', function () {
      if (clear.getAttribute('data-armed') === '1') {
        clearAll();
        renderDashboard(containerId);
        return;
      }
      clear.setAttribute('data-armed', '1');
      clear.textContent = 'Точно очистити?';
    });
    row.appendChild(clear);
    container.appendChild(row);

    /* Прозорість: слухач бачить дослівно те, що піде в листі. */
    var details = el('details', 'archive__details');
    details.appendChild(el('summary', null, 'Що саме надсилається'));
    details.appendChild(el('pre', 'archive__preview', mailBody()));
    container.appendChild(details);
  }

  /* Оцінка гри одним дотиком + необов'язковий коментар. Гра кладе
     контейнер у свій підсумок і кличе renderRating(id, moduleId). */
  function renderRating(containerId, moduleId) {
    var container = document.getElementById(containerId);
    if (!container) { return; }
    while (container.firstChild) { container.removeChild(container.firstChild); }

    container.appendChild(el('p', 'rating__title', 'Як вам гра?'));
    var row = el('div', 'rating__row');
    var comment = el('textarea', 'rating__comment');
    comment.rows = 2;
    comment.maxLength = 500;
    comment.placeholder = 'Що змінити? (необов’язково)';
    comment.setAttribute('aria-label', 'Коментар до гри');

    RATINGS.forEach(function (item) {
      row.appendChild(button(item.label, 'rating__button', function () {
        rate(moduleId, item.value, comment.value.trim());
        while (container.firstChild) { container.removeChild(container.firstChild); }
        container.appendChild(el('p', 'rating__thanks',
          'Дякуємо! Оцінка піде викладачеві разом з архівом.'));
      }));
    });
    container.appendChild(row);
    container.appendChild(comment);
  }

  /* --- старт ------------------------------------------------------------- */

  startVisit();
  window.addEventListener('pagehide', onLeave);
  window.addEventListener('pageshow', onShow);

  window.HLGAnalytics = {
    startSession: startSession,
    answer: answer,
    endSession: endSession,
    cancelSession: cancelSession,
    rate: rate,
    getSessions: getSessions,
    getFeedback: getFeedback,
    getOverview: getOverview,
    getModuleSummary: getModuleSummary,
    getItemErrors: getItemErrors,
    mailBody: mailBody,
    exportCSV: exportCSV,
    exportJSON: exportJSON,
    downloadFile: downloadFile,
    sendToTeacher: sendToTeacher,
    renderDashboard: renderDashboard,
    renderRating: renderRating,
    clearAll: clearAll,
    isPersistent: function () { return persistent; },
    deviceId: deviceId
  };
})();
