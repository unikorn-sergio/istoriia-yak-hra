/*
 * BoardData — дані гри: перевірка, злиття із зразком, завантаження файлу.
 *
 * Дані за замовчуванням — window.BOARD_DEFAULT (data/default-game.js).
 * Файл користувача читається FileReader-ом: так працює і з file://, і з Pages,
 * бо читання ініціює сам користувач, а fetch не потрібен.
 *
 * Приклад:
 *   BoardData.loadFile(input.files[0], BoardData.current(), function (res) {
 *     if (res.errors.length) { показати res.errors; return; }
 *     BoardData.setCurrent(res.data);   // res.warnings — показати, але не блокувати
 *   });
 *
 * Обов'язкове в файлі лише tasks. Чого у файлі немає — береться з поточних даних
 * (дошка, групи, налаштування, події), тому файл «лише із завданнями» працює.
 */
(function () {
  'use strict';

  var TASK_KINDS = ['choice', 'sort', 'sequence', 'forgery'];
  var EVENT_KINDS = ['card', 'decision', 'news'];
  var CELL_TYPES = ['start', 'land', 'trade', 'chronicle', 'archive', 'tax', 'jail', 'gotojail', 'slow'];
  var SETTINGS_DEFAULT = {
    startMoney: 1000, passBonus: 200, timeLimitMin: 20, dice: 2,
    archiveBonus: 50, jailFine: 50, tradeRent: [25, 60, 120]
  };

  var current = null;

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isStr(s) { return typeof s === 'string' && s.trim() !== ''; }
  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function q(s) { return '«' + String(s).slice(0, 60) + '»'; }

  /* ---------- злиття ---------- */

  function merge(obj, base) {
    var d = clone(base);
    // Опис і джерела належать змістові, а зміст файл замінює завжди (tasks
    // обов'язкові) — тому від зразка їх не успадковуємо, інакше чужі завдання
    // їхали б під підписом і джерелами зразкового набору.
    d.title = obj.title !== undefined ? obj.title : 'Власний набір завдань';
    d.subtitle = obj.subtitle || '';
    d.conditional = obj.conditional || '';
    d.sources = Array.isArray(obj.sources) ? obj.sources.slice() : [];
    if (obj.events === undefined && obj.cells === undefined && (base.events || []).length) {
      d.sources.push('Події «Хроніки» взято зі зразкового набору шаблону «Земля і грамота».');
    }
    d.settings = d.settings || {};
    Object.keys(SETTINGS_DEFAULT).forEach(function (k) {
      if (d.settings[k] === undefined) d.settings[k] = SETTINGS_DEFAULT[k];
    });
    if (obj.settings && typeof obj.settings === 'object') {
      Object.keys(obj.settings).forEach(function (k) { d.settings[k] = obj.settings[k]; });
    }
    var ownBoard = obj.cells !== undefined;
    if (ownBoard) {
      d.cells = obj.cells;
      d.groups = obj.groups !== undefined ? obj.groups : d.groups;
      d.board = obj.board !== undefined ? obj.board : { layout: 'ring' };
    } else {
      if (obj.groups !== undefined) d.groups = obj.groups;
      if (obj.board !== undefined) d.board = obj.board;
    }
    d.tasks = obj.tasks;
    if (obj.events !== undefined) d.events = obj.events;
    return d;
  }

  /* ---------- перевірка ---------- */

  function validateTask(t, at, groupIds, e, w) {
    if (!t || typeof t !== 'object') { e.push(at + ': запис має бути об\'єктом {…}.'); return; }
    if (TASK_KINDS.indexOf(t.kind) < 0) {
      e.push(at + ': невідомий kind ' + q(t.kind) + '. Можливі: ' + TASK_KINDS.join(', ') + '.');
      return;
    }
    if (!isStr(t.text)) e.push(at + ': немає тексту завдання (text).');
    if (t.group !== undefined && groupIds.indexOf(t.group) < 0) {
      w.push(at + ': групи ' + q(t.group) + ' немає на дошці — завдання піде в загальний пул.');
    }
    if (t.kind === 'choice') {
      if (!Array.isArray(t.options) || t.options.length < 2) e.push(at + ': потрібно щонайменше два варіанти (options).');
      else if (t.options.indexOf(t.correct) < 0) e.push(at + ': правильної відповіді ' + q(t.correct) + ' немає серед options (має збігатися дослівно).');
    }
    if (t.kind === 'sort') {
      if (!Array.isArray(t.bins) || t.bins.length < 2) e.push(at + ': для сортування потрібно щонайменше дві скрині (bins).');
      if (!Array.isArray(t.items) || t.items.length < 2) e.push(at + ': потрібно щонайменше два елементи (items).');
      (t.items || []).forEach(function (it, i) {
        if (!it || !isStr(it.text)) e.push(at + '.items[' + i + ']: немає тексту.');
        else if ((t.bins || []).indexOf(it.bin) < 0) e.push(at + '.items[' + i + '] ' + q(it.text) + ': скрині ' + q(it.bin) + ' немає в bins.');
      });
    }
    if (t.kind === 'sequence') {
      if (!Array.isArray(t.steps) || t.steps.length < 3) e.push(at + ': потрібно щонайменше три кроки (steps).');
      if (t.extra !== undefined && !Array.isArray(t.extra)) e.push(at + ': extra має бути списком […].');
    }
    if (t.kind === 'forgery') {
      if (!Array.isArray(t.parts) || t.parts.length < 3) e.push(at + ': потрібно щонайменше три фрагменти (parts).');
      else {
        var fakes = t.parts.filter(function (p) { return p && p.fake === true; }).length;
        if (!fakes) e.push(at + ': жодного фрагмента з fake: true — нема чого викривати.');
        if (fakes === t.parts.length) e.push(at + ': усі фрагменти підроблені — має лишитися справжній текст.');
        t.parts.forEach(function (p, i) { if (!p || !isStr(p.t)) e.push(at + '.parts[' + i + ']: немає тексту (t).'); });
      }
    }
  }

  function validateEffects(o, at, cellsLen, e) {
    if (o.money !== undefined && !isNum(o.money)) e.push(at + ': money має бути числом.');
    if (o.move !== undefined && !isNum(o.move)) e.push(at + ': move має бути числом.');
    if (o.perUpgrade !== undefined && !isNum(o.perUpgrade)) e.push(at + ': perUpgrade має бути числом.');
    if (o.goto !== undefined && o.goto !== 'jail' && !(isNum(o.goto) && o.goto >= 0 && o.goto < cellsLen)) {
      e.push(at + ': goto має бути "jail" або номером клітинки від 0 до ' + (cellsLen - 1) + '.');
    }
  }

  function validateEvent(ev, at, groupIds, cellsLen, e, w) {
    if (!ev || typeof ev !== 'object') { e.push(at + ': запис має бути об\'єктом {…}.'); return; }
    if (EVENT_KINDS.indexOf(ev.kind) < 0) {
      e.push(at + ': невідомий kind ' + q(ev.kind) + '. Можливі: ' + EVENT_KINDS.join(', ') + '.');
      return;
    }
    if (ev.kind === 'card') {
      if (!isStr(ev.story)) e.push(at + ': немає історії (story).');
      if (!isStr(ev.effect)) e.push(at + ': немає короткого опису наслідку (effect).');
      validateEffects(ev, at, cellsLen, e);
    }
    if (ev.kind === 'decision') {
      if (!isStr(ev.text)) e.push(at + ': немає тексту (text).');
      if (!Array.isArray(ev.options) || ev.options.length < 2) e.push(at + ': потрібно щонайменше два варіанти (options).');
      (ev.options || []).forEach(function (o, i) {
        if (!o || !isStr(o.label)) e.push(at + '.options[' + i + ']: немає підпису (label).');
        else validateEffects(o, at + '.options[' + i + ']', cellsLen, e);
      });
    }
    if (ev.kind === 'news') {
      if (!isStr(ev.text)) e.push(at + ': немає тексту (text).');
      if (groupIds.indexOf(ev.group) < 0) w.push(at + ': групи ' + q(ev.group) + ' немає на дошці — новина нічого не змінить.');
      if (!isNum(ev.mult) || ev.mult < 0) e.push(at + ': mult має бути числом ≥ 0 (0 — оренди немає, 0.5 — половина, 2 — подвійна).');
    }
  }

  function validateBoard(d, e) {
    var groups = Array.isArray(d.groups) ? d.groups : [];
    if (!Array.isArray(d.groups)) e.push('groups: має бути списком […].');
    var ids = [];
    groups.forEach(function (g, i) {
      if (!g || !isStr(g.id)) e.push('groups[' + i + ']: немає id.');
      else if (ids.indexOf(g.id) >= 0) e.push('groups[' + i + ']: id ' + q(g.id) + ' повторюється.');
      else ids.push(g.id);
      if (g && !isStr(g.name)) e.push('groups[' + i + ']: немає назви (name).');
    });
    var cells = d.cells;
    if (!Array.isArray(cells) || cells.length < 8) { e.push('cells: потрібно щонайменше 8 клітинок.'); return ids; }
    if (cells.length > 48) e.push('cells: забагато клітинок (' + cells.length + '), найбільше 48.');
    var layout = (d.board && d.board.layout) || 'ring';
    if (layout !== 'ring' && layout !== 'map') e.push('board.layout: має бути "ring" або "map".');
    if (layout === 'ring' && cells.length % 4 !== 0) {
      e.push('cells: для кільця кількість клітинок має ділитися на 4 (20, 24, 28, 32…), зараз ' + cells.length + '.');
    }
    if (layout === 'map' && !(d.board && isStr(d.board.map))) e.push('board.map: для розкладки "map" потрібне зображення карти.');
    var count = {};
    cells.forEach(function (c, i) {
      var at = 'cells[' + i + ']';
      if (!c || CELL_TYPES.indexOf(c.type) < 0) {
        e.push(at + ': невідомий type ' + q(c && c.type) + '. Можливі: ' + CELL_TYPES.join(', ') + '.');
        return;
      }
      count[c.type] = (count[c.type] || 0) + 1;
      if (c.type === 'land') {
        if (!isStr(c.name)) e.push(at + ': немає назви землі (name).');
        if (ids.indexOf(c.group) < 0) e.push(at + ' ' + q(c.name) + ': групи ' + q(c.group) + ' немає в groups.');
        if (!isNum(c.price) || c.price <= 0) e.push(at + ': ціна (price) має бути додатним числом.');
        if (!Array.isArray(c.rent) || !c.rent.length || c.rent.length > 3 || !c.rent.every(isNum)) {
          e.push(at + ': rent — список з 1–3 чисел: оренда без укріплень, з одним, з двома.');
        }
      }
      if (c.type === 'trade') {
        if (!isStr(c.name)) e.push(at + ': немає назви промислу (name).');
        if (!isNum(c.price) || c.price <= 0) e.push(at + ': ціна (price) має бути додатним числом.');
      }
      if (c.type === 'tax' && !isNum(c.amount)) e.push(at + ': для мита потрібна сума (amount).');
      if (layout === 'map' && (!isNum(c.x) || !isNum(c.y) || c.x < 0 || c.x > 100 || c.y < 0 || c.y > 100)) {
        e.push(at + ': для карти потрібні x і y від 0 до 100 (відсотки ширини й висоти).');
      }
    });
    if (cells[0] && cells[0].type !== 'start') e.push('cells[0]: перша клітинка має бути "start".');
    if (count.start !== 1) e.push('cells: клітинка "start" має бути рівно одна.');
    if (count.jail !== 1) e.push('cells: клітинка "jail" (в\'язниця) має бути рівно одна — туди ведуть "gotojail" і картки.');
    if (!count.land) e.push('cells: немає жодної землі ("land").');
    return ids;
  }

  function validate(obj, base) {
    var e = [], w = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      return { errors: ['Файл має містити один об\'єкт {…} з полем tasks.'], warnings: [], data: null };
    }
    if (!Array.isArray(obj.tasks) || !obj.tasks.length) {
      e.push('tasks: немає завдань. Поле tasks обов\'язкове — це список […] завдань.');
    }
    var d = merge(obj, base);
    var ids = validateBoard(d, e);
    var s = d.settings;
    if (!isNum(s.startMoney) || s.startMoney <= 0) e.push('settings.startMoney: має бути додатним числом.');
    if (s.dice !== 1 && s.dice !== 2) e.push('settings.dice: 1 або 2 кубики.');
    if (!isNum(s.timeLimitMin) || s.timeLimitMin < 1) e.push('settings.timeLimitMin: щонайменше 1 хвилина.');
    (d.tasks || []).forEach(function (t, i) { validateTask(t, 'tasks[' + i + ']', ids, e, w); });
    if (!Array.isArray(d.events)) d.events = [];
    if (!d.events.length) w.push('events: подій немає — «Хроніка» лише показуватиме, що нічого не сталося.');
    d.events.forEach(function (ev, i) { validateEvent(ev, 'events[' + i + ']', ids, (d.cells || []).length, e, w); });
    var seq = (d.tasks || []).filter(function (t) { return t && t.kind === 'sequence'; }).length;
    if (!seq) w.push('tasks: немає жодної «послідовності» — з в\'язниці можна буде вийти лише грошима або очікуванням.');
    if (!isStr(d.title)) d.title = 'Настільна гра';
    return { errors: e, warnings: w, data: e.length ? null : d };
  }

  /* ---------- завантаження ---------- */

  function parseText(text, base) {
    var obj;
    try {
      obj = JSON.parse(String(text).replace(/^﻿/, ''));
    } catch (err) {
      var m = /position (\d+)/.exec(err.message);
      var where = '';
      if (m) {
        var pos = +m[1];
        var line = String(text).slice(0, pos).split('\n').length;
        where = ' Рядок ' + line + '.';
      }
      // Chrome не завжди називає позицію — найчастішу помилку шукаємо самі.
      var tc = /,\s*[\]}]/.exec(String(text));
      if (tc) where += ' Схоже, зайва кома в рядку ' + String(text).slice(0, tc.index).split('\n').length + ' — перед закривною дужкою коми бути не має.';
      return {
        errors: ['Це не JSON: ' + err.message + '.' + where +
          ' Часті причини — кома після останнього елемента, лапки «ялинки» замість "прямих", пропущена кома між записами.'],
        warnings: [], data: null
      };
    }
    return validate(obj, base);
  }

  function loadFile(file, base, cb) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { cb(parseText(reader.result, base), file.name); };
    reader.onerror = function () { cb({ errors: ['Не вдалося прочитати файл.'], warnings: [], data: null }, file.name); };
    reader.readAsText(file, 'utf-8');
  }

  function download(data, filename) {
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'gra.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 500);
  }

  function defaults() {
    var res = validate(window.BOARD_DEFAULT, { settings: {}, groups: [], cells: [], events: [] });
    if (res.errors.length) {
      // Зразок мусить бути чистим; якщо ні — це помилка шаблону, показуємо вголос.
      throw new Error('Зразковий набір не пройшов перевірку:\n' + res.errors.join('\n'));
    }
    return res.data;
  }

  function setCurrent(d) { current = d; }
  function getCurrent() { if (!current) current = defaults(); return current; }

  window.BoardData = {
    validate: validate,
    parseText: parseText,
    loadFile: loadFile,
    download: download,
    defaults: defaults,
    setCurrent: setCurrent,
    current: getCurrent,
    TASK_KINDS: TASK_KINDS
  };
})();
