/* games/rozkopky/game.js — window.Rozkopky.

   «Розкопки»: ділянка cols×rows клітинок, під частиною закопано знахідки.
   Клітинка розкопується кліком (або Enter/пробілом); знахідку треба покласти
   в кошик своєї культури — кліком по кошику або перетягуванням. Хибний кошик
   коштує життя; правильна відповідь показується одразу, разом із фактом.
   Гра закінчується, коли всі знахідки розкладено або життя скінчилися.
   Перенос archaeology.html з першої версії; рушій DOM, без Canvas.

   Рушій про історію не знає: культури й знахідки — з data, малюнки — з
   window.RozkopkyArt, а що показати учневі й що записати — справа сторінки.

     Rozkopky.init({
       data: window.ROZKOPKY_DATA,
       gridId: 'grid',
       binsId: 'bins',
       onDig: function (find) {},            // find — артефакт або null (порожньо)
       onSelect: function (find) {},         // знахідку взято в руки
       onClassify: function (info) {},       // {find, chosen, culture, ok, lives}
       onFinish: function (result) {}        // {correct, wrong, total, lives, digs, seconds}
     });
     Rozkopky.start();
     Rozkopky.debug.reveal();  // стенд: показати, де що лежить
*/
(function () {
  'use strict';

  var config = null;
  var s = null;

  function $(id) { return document.getElementById(id); }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function cultureOf(id) {
    var list = config.data.cultures;
    for (var i = 0; i < list.length; i++) { if (list[i].id === id) { return list[i]; } }
    return null;
  }

  function emit(name, payload) {
    if (typeof config[name] === 'function') {
      try { config[name](payload); } catch (e) {
        if (window.console) { console.error('[Rozkopky] ' + name + ': ' + e.message); }
      }
    }
  }

  /* Набір на гру: щонайменше perCulture з кожної культури, решта навмання.
     Без цього правила траплялися партії без жодного слов'янського горщика —
     і кошик, у який нічого не лягало, нічого й не навчав. */
  function pickFinds() {
    var d = config.data;
    var byCulture = {};
    d.artifacts.forEach(function (a) { (byCulture[a.culture] = byCulture[a.culture] || []).push(a); });
    var chosen = [];
    d.cultures.forEach(function (c) {
      shuffle(byCulture[c.id] || []).slice(0, d.perCulture || 1).forEach(function (a) { chosen.push(a); });
    });
    var rest = shuffle(d.artifacts.filter(function (a) { return chosen.indexOf(a) === -1; }));
    while (chosen.length < d.finds && rest.length) { chosen.push(rest.shift()); }
    return shuffle(chosen.slice(0, d.finds));
  }

  /* --- ділянка ------------------------------------------------------------ */

  function buildGrid() {
    var grid = $(config.gridId);
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    grid.style.setProperty('--cols', String(config.data.cols));

    s.cells.forEach(function (cell, idx) {
      var btn = el('button', 'dig');
      btn.type = 'button';
      btn.setAttribute('data-cell', String(idx));
      btn.setAttribute('aria-label', 'Ділянка ' + (idx + 1) + ': не розкопано');
      btn.addEventListener('click', function () { onCell(idx); });
      btn.addEventListener('dragstart', function (e) {
        if (!s.cells[idx].find || s.cells[idx].done) { e.preventDefault(); return; }
        select(idx);
        try { e.dataTransfer.setData('text/plain', String(idx)); } catch (err) { /* IE-подібні */ }
      });
      cell.node = btn;
      grid.appendChild(btn);
    });
  }

  function onCell(idx) {
    if (s.state !== 'play') { return; }
    var cell = s.cells[idx];
    if (!cell.dug) { dig(idx); return; }
    if (cell.find && !cell.done) {
      if (s.selected === idx) { deselect(); } else { select(idx); }
    }
  }

  function dig(idx) {
    var cell = s.cells[idx];
    cell.dug = true;
    s.digs += 1;
    var btn = cell.node;
    btn.classList.add('dig--open');
    if (cell.find) {
      btn.classList.add('dig--find');
      btn.setAttribute('draggable', 'true');
      btn.setAttribute('aria-label', 'Ділянка ' + (idx + 1) + ': знахідка — ' + cell.find.name);
      btn.appendChild(window.RozkopkyArt
        ? RozkopkyArt.draw(cell.find.art, cell.find.name)
        : el('span', 'dig__name', cell.find.name));
      emit('onDig', cell.find);
      select(idx);
    } else {
      btn.setAttribute('aria-label', 'Ділянка ' + (idx + 1) + ': порожньо');
      emit('onDig', null);
    }
  }

  function select(idx) {
    if (s.selected !== null && s.selected !== idx) {
      s.cells[s.selected].node.classList.remove('dig--selected');
    }
    s.selected = idx;
    s.cells[idx].node.classList.add('dig--selected');
    $(config.binsId).classList.add('bins--active');
    emit('onSelect', s.cells[idx].find);
  }

  function deselect() {
    if (s.selected !== null) { s.cells[s.selected].node.classList.remove('dig--selected'); }
    s.selected = null;
    $(config.binsId).classList.remove('bins--active');
    emit('onSelect', null);
  }

  /* --- кошики ------------------------------------------------------------- */

  function buildBins() {
    var bins = $(config.binsId);
    while (bins.firstChild) { bins.removeChild(bins.firstChild); }
    s.binCount = {};
    config.data.cultures.forEach(function (c) {
      s.binCount[c.id] = 0;
      var bin = el('button', 'bin');
      bin.type = 'button';
      bin.setAttribute('data-culture', c.id);
      bin.appendChild(el('span', 'bin__name', c.name));
      bin.appendChild(el('span', 'bin__hint', c.hint));
      var count = el('span', 'bin__count', '0');
      bin.appendChild(count);
      c.countNode = count;

      bin.addEventListener('click', function () {
        if (s.selected !== null) { classify(s.selected, c.id); }
      });
      bin.addEventListener('dragover', function (e) { e.preventDefault(); bin.classList.add('bin--over'); });
      bin.addEventListener('dragleave', function () { bin.classList.remove('bin--over'); });
      bin.addEventListener('drop', function (e) {
        e.preventDefault();
        bin.classList.remove('bin--over');
        var idx = parseInt(e.dataTransfer.getData('text/plain'), 10);
        if (!isNaN(idx)) { classify(idx, c.id); }
      });
      bins.appendChild(bin);
    });
  }

  function classify(idx, cultureId) {
    var cell = s.cells[idx];
    if (s.state !== 'play' || !cell.find || cell.done) { return; }
    var ok = cell.find.culture === cultureId;
    cell.done = true;
    deselect();

    var btn = cell.node;
    btn.removeAttribute('draggable');
    btn.classList.add(ok ? 'dig--ok' : 'dig--bad');
    btn.appendChild(el('span', 'dig__mark', ok ? '✓' : '✗'));

    if (ok) {
      s.correct += 1;
      s.binCount[cultureId] += 1;
      cultureOf(cultureId).countNode.textContent = String(s.binCount[cultureId]);
    } else {
      s.wrong += 1;
      s.lives -= 1;
    }

    emit('onClassify', {
      find: cell.find,
      chosen: cultureOf(cultureId),
      culture: cultureOf(cell.find.culture),
      ok: ok,
      lives: s.lives
    });

    if (s.lives <= 0 || s.correct + s.wrong >= s.total) { finish(); }
  }

  function finish() {
    s.state = 'over';
    deselect();
    emit('onFinish', {
      correct: s.correct,
      wrong: s.wrong,
      total: s.total,
      lives: s.lives,
      digs: s.digs,
      seconds: Math.round((Date.now() - s.t0) / 1000)
    });
  }

  /* --- публічне ------------------------------------------------------------ */

  function init(options) {
    config = options || {};
    if (!config.data || !config.data.artifacts || !config.data.cultures) {
      throw new Error('Rozkopky: немає data.artifacts або data.cultures');
    }
  }

  function start() {
    var d = config.data;
    var size = d.cols * d.rows;
    var finds = pickFinds();
    var spots = shuffle(Array.apply(null, { length: size }).map(function (_, i) { return i; }))
      .slice(0, finds.length);

    s = {
      state: 'play',
      cells: [],
      selected: null,
      correct: 0,
      wrong: 0,
      digs: 0,
      lives: d.lives,
      total: finds.length,
      t0: Date.now(),
      binCount: {}
    };
    for (var i = 0; i < size; i++) { s.cells.push({ find: null, dug: false, done: false, node: null }); }
    spots.forEach(function (spot, k) { s.cells[spot].find = finds[k]; });

    buildGrid();
    buildBins();
  }

  var debug = {
    reveal: function () {
      return s.cells.map(function (c, i) { return c.find ? i + ':' + c.find.id : null; })
        .filter(Boolean);
    },
    dig: function (idx) { onCell(idx); return debug.snapshot(); },
    classify: function (idx, cultureId) { classify(idx, cultureId); return debug.snapshot(); },
    snapshot: function () {
      return { state: s.state, correct: s.correct, wrong: s.wrong, lives: s.lives,
               total: s.total, digs: s.digs, selected: s.selected };
    },
    cells: function () { return s.cells; }
  };

  window.Rozkopky = { init: init, start: start, debug: debug };
})();
