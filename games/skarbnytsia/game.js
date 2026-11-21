/* game.js — «Таємниці скарбниці»: сортування монет-понять за категоріями.
   window.Skarbnytsia. DOM, без Canvas і без бібліотек (file://).

   Перенос coin-sorter.html з першої версії; що змінено і чому — у шапці
   data/arcade/skarbnytsia.js.

   Правила рушія:
     * Брати можна лише ВЕРХ комірки: верхню монету, а якщо вона пофарбована —
       разом із пофарбованими монетами її категорії під нею (перевірений стос).
     * Класти можна в порожню комірку (без перевірки) або на монету. Якщо
       категорії збігаються, обидві фарбуються; якщо ні — монети відскакують
       назад, це помилка.
     * combo пофарбованих монет однієї категорії поспіль згори → вони зникають,
       а натомість лягають comboResult пофарбованих монет наступної категорії
       (порядок категорій — випадковий на гру) і +10 очок.
     * «?» — прихована монета; відкривається, щойно опиниться нагорі.

   Приклад:
     Skarbnytsia.init({
       data: window.SKARBNYTSIA_DATA,
       gridId: 'cells', ghostId: 'ghost',
       onMove: function (info) {},      // { ok, coins, target: category|null }
       onConvert: function (info) {},   // { from, to, score }
       onChange: function (state) {},   // { score, moves, mistakes, coins }
       onFinish: function (r) {}        // { won, score, moves, mistakes, conversions, seconds }
     });
     Skarbnytsia.start();
     Skarbnytsia.deal();
     Skarbnytsia.finish();               // завершити достроково
     Skarbnytsia.debug.move(from, to);   // стенд: перенести верх комірки
*/
(function () {
  'use strict';

  var DRAG_PX = 6;

  var config = null;
  var data = null;
  var s = null;
  var press = null;

  function $(id) { return document.getElementById(id); }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  function category(id) {
    for (var i = 0; i < data.categories.length; i++) {
      if (data.categories[i].id === id) { return data.categories[i]; }
    }
    return null;
  }

  function init(cfg) {
    config = cfg;
    data = cfg.data;
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', function () {
      /* Браузер забрав жест собі (прокрутка) — перетягування скасовано. */
      if (press && press.dragging && s) { s.selected = null; render(); }
      press = null;
      $(config.ghostId).hidden = true;
    });
  }

  function start() {
    s = {
      cells: [],
      order: shuffle(data.categories.map(function (c) { return c.id; })),
      score: 0,
      moves: 0,
      mistakes: 0,
      conversions: 0,
      dealt: false,
      selected: null,
      state: 'play',
      t0: Date.now()
    };
    for (var i = 0; i < data.cells; i++) { s.cells.push([]); }
    render();
    changed();
  }

  /* --- роздача ----------------------------------------------------------- */

  function newCoin() {
    var cat = pick(data.categories);
    return { cat: cat.id, label: pick(cat.items), known: false, hidden: false };
  }

  function coinCount() {
    var n = 0;
    s.cells.forEach(function (c) { n += c.length; });
    return n;
  }

  function deal() {
    if (!s || s.state !== 'play') { return 0; }
    var target = Math.floor(data.cells * data.capacity * data.fill);
    var need = Math.max(0, target - coinCount());
    var added = 0;
    var tries = need * 20;
    while (added < need && tries-- > 0) {
      var cell = s.cells[Math.floor(Math.random() * data.cells)];
      if (cell.length < data.capacity) { cell.push(newCoin()); added += 1; }
    }
    if (!s.dealt && added) {
      s.dealt = true;
      hideSome(data.hiddenAtStart);
    }
    reveal();
    s.selected = null;
    render();
    changed();
    return added;
  }

  /* Ховає монети з нижньої половини стосів — як оригінал після першої роздачі. */
  function hideSome(count) {
    var spots = [];
    s.cells.forEach(function (cell, ci) {
      for (var i = 0; i < Math.floor(cell.length / 2); i++) { spots.push([ci, i]); }
    });
    shuffle(spots).slice(0, count).forEach(function (p) { s.cells[p[0]][p[1]].hidden = true; });
  }

  function reveal() {
    s.cells.forEach(function (cell) {
      if (cell.length) { cell[cell.length - 1].hidden = false; }
    });
  }

  /* --- хід --------------------------------------------------------------- */

  /* Скільки монет забирається з верху комірки. */
  function runLength(cell) {
    if (!cell.length) { return 0; }
    var top = cell[cell.length - 1];
    if (top.hidden) { return 0; }
    if (!top.known) { return 1; }
    var n = 0;
    for (var i = cell.length - 1; i >= 0; i--) {
      if (cell[i].known && !cell[i].hidden && cell[i].cat === top.cat) { n += 1; } else { break; }
    }
    return n;
  }

  function move(from, to) {
    if (!s || s.state !== 'play' || from === to) { return null; }
    var src = s.cells[from];
    var dst = s.cells[to];
    var n = runLength(src);
    if (!n) { return null; }
    if (dst.length + n > data.capacity) {
      if (config.onFull) { config.onFull(); }
      return null;
    }

    var coins = src.slice(src.length - n);
    var head = coins[0];
    var top = dst.length ? dst[dst.length - 1] : null;
    var info;

    if (top && top.cat !== head.cat) {
      /* Помилка: монети лишаються, де були. */
      s.mistakes += 1;
      info = { ok: false, coins: coins, target: category(top.cat), targetCoin: top };
    } else {
      src.splice(src.length - n, n);
      if (top) {
        top.known = true;
        coins.forEach(function (c) { c.known = true; });
      }
      coins.forEach(function (c) { dst.push(c); });
      s.moves += 1;
      info = { ok: true, coins: coins, target: top ? category(top.cat) : null };
      reveal();
    }
    s.selected = null;
    if (config.onMove) { config.onMove(info); }
    if (info.ok) { convert(to); }
    render(info.ok ? to : from, !info.ok);
    changed();
    if (s.state === 'play' && s.score >= data.winScore) { finish(true); }
    return info;
  }

  function convert(ci) {
    var cell = s.cells[ci];
    if (!cell.length) { return; }
    var top = cell[cell.length - 1];
    if (!top.known) { return; }
    var n = 0;
    for (var i = cell.length - 1; i >= 0; i--) {
      if (cell[i].known && cell[i].cat === top.cat) { n += 1; } else { break; }
    }
    if (n < data.combo) { return; }

    cell.splice(cell.length - data.combo, data.combo);
    var next = s.order[(s.order.indexOf(top.cat) + 1) % s.order.length];
    var nextCat = category(next);
    for (var k = 0; k < data.comboResult; k++) {
      cell.push({ cat: next, label: pick(nextCat.items), known: true, hidden: false });
    }
    s.score += 10;
    s.conversions += 1;
    reveal();
    if (config.onConvert) { config.onConvert({ from: category(top.cat), to: nextCat, score: s.score }); }
    convert(ci);
  }

  function finish(won) {
    if (!s || s.state !== 'play') { return; }
    s.state = 'over';
    s.selected = null;
    render();
    if (config.onFinish) {
      config.onFinish({
        won: !!won || s.score >= data.winScore,
        score: s.score,
        moves: s.moves,
        mistakes: s.mistakes,
        conversions: s.conversions,
        seconds: Math.round((Date.now() - s.t0) / 1000)
      });
    }
  }

  function changed() {
    if (config.onChange) {
      config.onChange({ score: s.score, moves: s.moves, mistakes: s.mistakes, coins: coinCount(),
                        order: s.order.map(category) });
    }
  }

  /* --- малювання --------------------------------------------------------- */

  function render(flashCell, bad) {
    var grid = $(config.gridId);
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    s.cells.forEach(function (cell, ci) {
      var box = document.createElement('div');
      box.className = 'cell';
      if (s.selected === ci) { box.classList.add('cell--selected'); }
      if (flashCell === ci) { box.classList.add(bad ? 'cell--bad' : 'cell--ok'); }
      box.dataset.cell = String(ci);
      box.setAttribute('role', 'button');
      box.setAttribute('tabindex', '0');
      box.setAttribute('aria-label', 'Комірка ' + (ci + 1) + ': ' + (cell.length
        ? cell.length + ' монет, згори ' + (cell[cell.length - 1].hidden ? 'прихована' : cell[cell.length - 1].label)
        : 'порожня'));

      var count = document.createElement('span');
      count.className = 'cell__count';
      count.textContent = cell.length + '/' + data.capacity;
      box.appendChild(count);

      var stack = document.createElement('div');
      stack.className = 'cell__stack';
      var run = runLength(cell);
      cell.forEach(function (coin, k) {
        var c = document.createElement('div');
        c.className = 'coin';
        if (coin.hidden) {
          c.classList.add('coin--hidden');
          c.textContent = '?';
        } else {
          c.textContent = coin.label;
          if (coin.known) {
            c.classList.add('coin--known');
            c.style.setProperty('--coin', category(coin.cat).color);
            c.title = coin.label + ' — ' + category(coin.cat).name.toLowerCase();
          }
        }
        if (s.selected === ci && k >= cell.length - run) { c.classList.add('coin--lifted'); }
        stack.appendChild(c);
      });
      box.appendChild(stack);

      box.addEventListener('pointerdown', function (e) { onPointerDown(ci, e); });
      box.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTap(ci); }
      });
      grid.appendChild(box);
    });
  }

  /* --- керування: клік (вибрати → покласти) і перетягування -------------- */

  function onTap(ci) {
    if (!s || s.state !== 'play') { return; }
    if (s.selected === null) {
      if (runLength(s.cells[ci])) { s.selected = ci; render(); }
      return;
    }
    if (s.selected === ci) { s.selected = null; render(); return; }
    move(s.selected, ci);
  }

  function onPointerDown(ci, e) {
    if (!s || s.state !== 'play') { return; }
    press = { cell: ci, x: e.clientX, y: e.clientY, dragging: false };
  }

  function cellAt(x, y) {
    var ghost = $(config.ghostId);
    ghost.hidden = true;
    var el = document.elementFromPoint(x, y);
    var box = el && el.closest ? el.closest('.cell') : null;
    return box ? parseInt(box.dataset.cell, 10) : -1;
  }

  function onPointerMove(e) {
    if (!press) { return; }
    var ghost = $(config.ghostId);
    if (!press.dragging) {
      if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) < DRAG_PX) { return; }
      var cell = s.cells[press.cell];
      var n = runLength(cell);
      if (!n) { press = null; return; }
      press.dragging = true;
      s.selected = press.cell;
      render();
      ghost.textContent = cell[cell.length - 1].label + (n > 1 ? ' ×' + n : '');
    }
    ghost.hidden = false;
    ghost.style.left = (e.clientX + 8) + 'px';
    ghost.style.top = (e.clientY + 8) + 'px';
  }

  function onPointerUp(e) {
    if (!press) { return; }
    var p = press;
    press = null;
    $(config.ghostId).hidden = true;
    if (!p.dragging) { onTap(p.cell); return; }
    var to = cellAt(e.clientX, e.clientY);
    if (to >= 0 && to !== p.cell) { move(p.cell, to); }
    else { s.selected = null; render(); }
  }

  var debug = {
    move: function (from, to) { return move(from, to); },
    cells: function () { return s.cells; },
    run: function (ci) { return runLength(s.cells[ci]); },
    snapshot: function () {
      return { state: s.state, score: s.score, moves: s.moves, mistakes: s.mistakes,
               conversions: s.conversions, coins: coinCount() };
    }
  };

  window.Skarbnytsia = { init: init, start: start, deal: deal, finish: function () { finish(false); }, debug: debug };
})();
