/* game.js — «Стежка»: прокласти стежку вузлами від початку до кінця.
   window.Stezhka. DOM + SVG, без Canvas і без бібліотек (file://).

   Перенос shiwafornia-2.html з першої версії; що змінено і чому — у шапці
   data/arcade/stezhka.js.

   Приклад:
     Stezhka.init({
       wrapId: 'map',          // обгортка: початок, мережа, кінець і SVG
       networkId: 'network',   // сітка вузлів
       svgId: 'lines',         // SVG поверх обгортки (лінії)
       startId: 'start', finishId: 'finish',
       lives: 3, hints: 3, cols: 3,
       onStep: function (info) {},     // { step, index, total }
       onMistake: function (info) {},  // { kind: 'decoy'|'early', item, lives }
       onFinish: function (r) {}       // { won, steps, total, mistakes, hintsUsed, seconds }
     });
     Stezhka.start(path);      // path — один запис paths[] з даних
     Stezhka.hint();           // підсвітити наступний крок; false, якщо підказок нема
     Stezhka.debug.next();     // стенд: індекс вузла, правильного зараз
*/
(function () {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';
  var HINT_MS = 2000;

  var config = null;
  var s = null;

  function $(id) { return document.getElementById(id); }

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function init(cfg) {
    config = cfg;
    window.addEventListener('resize', function () { if (s) { drawLines(); } });
  }

  function start(path) {
    var items = path.steps.map(function (step, i) {
      return { kind: 'step', index: i, label: step.label, data: step };
    }).concat(path.decoys.map(function (decoy) {
      return { kind: 'decoy', label: decoy.label, data: decoy };
    }));

    s = {
      path: path,
      items: shuffle(items),
      next: 0,
      lives: config.lives,
      hints: config.hints,
      hintsUsed: 0,
      mistakes: 0,
      done: [],
      state: 'play',
      t0: Date.now()
    };

    $(config.startId).textContent = path.start;
    $(config.finishId).textContent = path.finish;
    $(config.finishId).classList.remove('stezhka-end--reached');

    var net = $(config.networkId);
    while (net.firstChild) { net.removeChild(net.firstChild); }
    net.style.setProperty('--cols', String(config.cols));

    s.items.forEach(function (item, i) {
      var node = document.createElement('button');
      node.type = 'button';
      node.className = 'node';
      node.textContent = item.label;
      node.dataset.index = String(i);
      node.addEventListener('click', function () { onNode(i); });
      item.el = node;
      item.row = Math.floor(i / config.cols);
      item.col = i % config.cols;
      net.appendChild(node);
    });

    /* Позиції відомі лише після розкладки. */
    window.requestAnimationFrame(drawLines);
  }

  function onNode(i) {
    if (!s || s.state !== 'play') { return; }
    var item = s.items[i];
    if (item.el.disabled) { return; }

    if (item.kind === 'step' && item.index === s.next) {
      item.el.disabled = true;
      item.el.classList.add('node--ok');
      s.done.push(item);
      s.next += 1;
      drawLines();
      if (config.onStep) {
        config.onStep({ step: item.data, index: item.index, total: s.path.steps.length });
      }
      if (s.next === s.path.steps.length) {
        $(config.finishId).classList.add('stezhka-end--reached');
        finish(true);
      }
      return;
    }

    /* Крок не той. Приманка гасне назавжди; справжній, але завчасний
       крок лише блимає — він ще знадобиться. */
    s.mistakes += 1;
    s.lives -= 1;
    var kind = item.kind === 'decoy' ? 'decoy' : 'early';
    if (kind === 'decoy') {
      item.el.disabled = true;
      item.el.classList.add('node--bad');
    } else {
      item.el.classList.remove('node--early');
      void item.el.offsetWidth; /* перезапуск анімації */
      item.el.classList.add('node--early');
    }
    if (config.onMistake) { config.onMistake({ kind: kind, item: item.data, lives: s.lives }); }
    if (s.lives <= 0) { finish(false); }
  }

  function finish(won) {
    s.state = 'over';
    s.items.forEach(function (item) { item.el.disabled = true; });
    if (config.onFinish) {
      config.onFinish({
        won: won,
        steps: s.next,
        total: s.path.steps.length,
        mistakes: s.mistakes,
        hintsUsed: s.hintsUsed,
        seconds: Math.round((Date.now() - s.t0) / 1000)
      });
    }
  }

  function hint() {
    if (!s || s.state !== 'play' || s.hints <= 0) { return false; }
    var target = null;
    s.items.forEach(function (item) {
      if (item.kind === 'step' && item.index === s.next) { target = item; }
    });
    if (!target) { return false; }
    s.hints -= 1;
    s.hintsUsed += 1;
    target.el.classList.add('node--hint');
    window.setTimeout(function () { target.el.classList.remove('node--hint'); }, HINT_MS);
    return s.hints;
  }

  /* --- лінії ------------------------------------------------------------- */

  function centerOf(el, box) {
    var r = el.getBoundingClientRect();
    return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 };
  }

  function line(svg, a, b, cls) {
    var l = document.createElementNS(SVG_NS, 'line');
    l.setAttribute('x1', a.x); l.setAttribute('y1', a.y);
    l.setAttribute('x2', b.x); l.setAttribute('y2', b.y);
    l.setAttribute('class', cls);
    svg.appendChild(l);
  }

  function drawLines() {
    var svg = $(config.svgId);
    var wrap = $(config.wrapId);
    while (svg.firstChild) { svg.removeChild(svg.firstChild); }
    var box = wrap.getBoundingClientRect();
    svg.setAttribute('width', box.width);
    svg.setAttribute('height', box.height);
    svg.setAttribute('viewBox', '0 0 ' + box.width + ' ' + box.height);

    /* Тло мережі: сусідні вузли з'єднані пунктиром. Нічого не підказує —
       з'єднано все з усім поруч. */
    s.items.forEach(function (a, i) {
      s.items.forEach(function (b, j) {
        if (j <= i) { return; }
        if (Math.abs(a.row - b.row) <= 1 && Math.abs(a.col - b.col) <= 1) {
          line(svg, centerOf(a.el, box), centerOf(b.el, box), 'link');
        }
      });
    });

    /* Пройдена стежка: від початку через зроблені кроки (і до кінця). */
    var points = [centerOf($(config.startId), box)];
    s.done.forEach(function (item) { points.push(centerOf(item.el, box)); });
    if (s.next === s.path.steps.length) { points.push(centerOf($(config.finishId), box)); }
    for (var k = 1; k < points.length; k++) { line(svg, points[k - 1], points[k], 'trail'); }
  }

  var debug = {
    next: function () {
      for (var i = 0; i < s.items.length; i++) {
        if (s.items[i].kind === 'step' && s.items[i].index === s.next) { return i; }
      }
      return -1;
    },
    decoy: function () {
      for (var i = 0; i < s.items.length; i++) {
        if (s.items[i].kind === 'decoy' && !s.items[i].el.disabled) { return i; }
      }
      return -1;
    },
    click: function (i) { onNode(i); return debug.snapshot(); },
    snapshot: function () {
      return { state: s.state, next: s.next, lives: s.lives, mistakes: s.mistakes, hints: s.hints };
    }
  };

  window.Stezhka = { init: init, start: start, hint: hint, debug: debug };
})();
