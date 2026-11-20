/*
 * VidminnostiGame — «знайди, що підробив копіїст» на двох зв'язаних рамках PanZoom.
 *
 * Ліворуч оригінал, праворуч той самий оригінал + латки поверх (<img> на
 * своїх місцях): підробку збирає браузер, окремого edited-файла немає.
 * Клік по будь-якій половині перевіряється сіткою клітинок із даних
 * (data.grid, рядок символів: '.' — порожньо, інакше номер зміни base36),
 * а не пікселями: на file:// Chrome не дає читати пікселі з canvas.
 * Сітку будує tools/vidminnosti-build.py — там і пояснення, чому зона
 * належить верхній латці.
 *
 * Правила (plan_vidminnosti.md):
 *   знахідка — зелений еліпс на обох половинах і коментар автора;
 *   промах    — хрестик, +PENALTY_S секунд до часу й коротка пауза LOCK_MS:
 *               помилка коштує часу, а не прогресу;
 *   підказка  — як у Кромвеля: наїзд до однієї випадкової незнайденої зміни
 *               й пульсуючий контур на обох половинах; зміну все одно треба
 *               клацнути. Перезарядка росте з кожним використанням
 *               (HINT_COOLDOWN_S: 1; 1,5; 2; 2,5; 3, далі 5 хв): підказка не
 *               замикає гру, але й не дає пройти все підказками. Частина змін
 *               (тонкі, як обрій у «Дівчині з Поділля») задумана саме під неї;
 *   кінець    — паспорт картини (назва, автор, ліцензія, опис).
 * Гаманця немає: гра поки окреме посилання, не шаблон реєстру.
 *
 * Латки (data.patches) і зміни (data.changes) — різні списки: одна зміна
 * може складатися з кількох латок (рядок «6+7» у зміни.md).
 *
 * Приклад:
 *
 *   VidminnostiGame.init({
 *     data: window.VIDMINNOSTI['divchyna-z-podillia'],
 *     ids: {
 *       viewLeft: 'viewLeft', sceneLeft: 'sceneLeft',
 *       viewRight: 'viewRight', sceneRight: 'sceneRight',
 *       found: 'found', timer: 'timer', zoom: 'zoomLabel',
 *       note: 'note', status: 'status', finish: 'finish',
 *       btnIn: 'btnIn', btnOut: 'btnOut', btnFit: 'btnFit', btnAgain: 'btnAgain',
 *       btnHint: 'btnHint'
 *     }
 *   });
 *
 * Без модулів і без innerHTML: SVG — createElementNS, текст — textContent.
 */
(function () {
  'use strict';

  var SVG = 'http://www.w3.org/2000/svg';
  var PENALTY_S = 5;
  var LOCK_MS = 900;
  var MISS_MS = 1400;
  var HINT_COOLDOWN_S = [60, 90, 120, 150, 180, 300];   // після 1-ї, 2-ї… підказки
  var HINT_SHOW_MS = 3200;
  var HINT_FILL = 0.45;   // яку частку рамки займає зона після наїзду

  function el(id) { return document.getElementById(id); }

  function svgEl(name, attrs) {
    var n = document.createElementNS(SVG, name);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    return n;
  }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = document.createElement('img');
      img.alt = '';
      img.draggable = false;
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function clock(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function init(cfg) {
    var d = cfg.data;
    var ids = cfg.ids;
    var W = d.width, H = d.height;
    var total = d.changes.length;
    var byN = {};
    d.changes.forEach(function (c) { byN[c.n] = c; });

    var found = {};
    var foundCount = 0;
    var started = 0, penalty = 0, finishedAt = 0, timerId = 0;
    var lockedUntil = 0;
    var scale = 1;
    var layers = [];
    var misses = [];
    var missCount = 0;
    var hintsUsed = 0, hintReadyAt = 0, hintTimer = 0;
    var hintMarks = [];
    var left = null;
    var status = el(ids.status);
    var btnHint = el(ids.btnHint);

    function elapsed() {
      if (!started) { return 0; }
      return Math.floor(((finishedAt || Date.now()) - started) / 1000) + penalty;
    }

    /* Кнопка підказки показує перезарядку тим самим тиком, що й годинник. */
    function renderHint() {
      if (!btnHint) { return; }
      var left_s = Math.ceil((hintReadyAt - Date.now()) / 1000);
      if (finishedAt) {
        btnHint.disabled = true;
        btnHint.textContent = 'Підказка';
      } else if (left_s > 0) {
        btnHint.disabled = true;
        btnHint.textContent = 'Підказка через ' + clock(left_s);
      } else {
        btnHint.disabled = false;
        btnHint.textContent = 'Підказка';
      }
    }

    function tick() {
      el(ids.timer).textContent = clock(elapsed());
      renderHint();
    }

    function mount(sceneId, base, patches) {
      var scene = el(sceneId);
      base.width = W;
      base.height = H;
      scene.appendChild(base);
      (patches || []).forEach(function (p) { scene.appendChild(p); });
      var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true', 'class': 'vd-marks' });
      scene.appendChild(svg);
      return svg;
    }

    function patchImg(c, img) {
      img.className = 'vd-patch';
      img.style.left = c.x + 'px';
      img.style.top = c.y + 'px';
      img.style.width = c.w + 'px';
      img.style.height = c.h + 'px';
      return img;
    }

    function markFound(c) {
      layers.forEach(function (svg) {
        svg.appendChild(svgEl('ellipse', {
          'class': 'vd-found', cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry,
          transform: 'rotate(' + c.angle + ' ' + c.cx + ' ' + c.cy + ')',
          'vector-effect': 'non-scaling-stroke'
        }));
      });
    }

    function clearHint() {
      clearTimeout(hintTimer);
      hintMarks.forEach(function (n) { if (n.parentNode) { n.parentNode.removeChild(n); } });
      hintMarks = [];
    }

    /* Підказка не знаходить зміну за учня: наїжджає до неї й обводить, а
       клацнути все одно треба самому — інакше це не гра, а перегляд. */
    function useHint() {
      if (finishedAt || Date.now() < hintReadyAt) { return; }
      var left_ = d.changes.filter(function (c) { return !found[c.n]; });
      if (!left_.length) { return; }
      var c = left_[Math.floor(Math.random() * left_.length)];
      hintReadyAt = Date.now() + 1000 * HINT_COOLDOWN_S[Math.min(hintsUsed, HINT_COOLDOWN_S.length - 1)];
      hintsUsed += 1;
      clearHint();
      layers.forEach(function (svg) {
        var e = svgEl('ellipse', {
          'class': 'vd-hint-ring', cx: c.cx, cy: c.cy, rx: c.rx, ry: c.ry,
          transform: 'rotate(' + c.angle + ' ' + c.cx + ' ' + c.cy + ')',
          'vector-effect': 'non-scaling-stroke'
        });
        svg.appendChild(e);
        hintMarks.push(e);
      });
      hintTimer = setTimeout(clearHint, HINT_SHOW_MS);
      var span = 2 * Math.max(c.rx, c.ry);
      var zoom = Math.max(1, Math.min(4, HINT_FILL * Math.min(W, H) / span));
      left.setView({ zoom: zoom, cx: c.cx, cy: c.cy }, { animate: true });
      status.textContent = 'Підказка: зміна в обведеному місці — клацніть по ній.';
      renderHint();
    }

    function placeMiss(m) {
      m.g.forEach(function (g) {
        g.setAttribute('transform', 'translate(' + m.x + ' ' + m.y + ') scale(' + (1 / scale) + ')');
      });
    }

    function markMiss(x, y) {
      var m = { x: x, y: y, g: [] };
      layers.forEach(function (svg) {
        var g = svgEl('g', { 'class': 'vd-miss' });
        g.appendChild(svgEl('line', { x1: -10, y1: -10, x2: 10, y2: 10 }));
        g.appendChild(svgEl('line', { x1: -10, y1: 10, x2: 10, y2: -10 }));
        svg.appendChild(g);
        m.g.push(g);
      });
      placeMiss(m);
      misses.push(m);
      setTimeout(function () {
        m.g.forEach(function (g) { if (g.parentNode) { g.parentNode.removeChild(g); } });
        misses.splice(misses.indexOf(m), 1);
      }, MISS_MS);
    }

    function showNote(c) {
      var box = el(ids.note);
      while (box.firstChild) { box.removeChild(box.firstChild); }
      var h = document.createElement('p');
      h.className = 'vd-note__title';
      h.textContent = 'Знайдено: ' + (c.now || 'зміна ' + c.n) + '.';
      box.appendChild(h);
      if (c.was) {
        var w = document.createElement('p');
        w.textContent = 'В оригіналі: ' + c.was + '.';
        box.appendChild(w);
      }
      if (c.comment) {
        var t = document.createElement('p');
        t.className = 'vd-note__comment';
        t.textContent = c.comment;
        box.appendChild(t);
      }
      box.hidden = false;
    }

    function owner(x, y) {
      var col = Math.floor(x / d.cell), row = Math.floor(y / d.cell);
      if (col < 0 || row < 0 || col >= d.cols || row >= d.rows) { return 0; }
      var ch = d.grid.charAt(row * d.cols + col);
      return ch === '.' ? 0 : parseInt(ch, 36);
    }

    function finish() {
      finishedAt = Date.now();
      clearInterval(timerId);
      clearHint();
      tick();
      if (window.HLGAnalytics) {
        HLGAnalytics.endSession({ score: foundCount, won: true, attempts: missCount });
      }
      var box = el(ids.finish);
      var set = function (key, val) {
        var n = box.querySelector('[data-f="' + key + '"]');
        if (!n) { return; }
        n.textContent = val || '';
        var row = n.closest('[data-row]');
        if (row) { row.hidden = !val; }
      };
      set('time', clock(elapsed()) + (penalty ? ' (з них штраф ' + penalty + ' с)' : ''));
      set('hints', hintsUsed ? String(hintsUsed) : '');
      set('title', d.title);
      set('author', d.author);
      set('year', d.year);
      set('created', d.created);
      set('place', d.place);
      set('license', d.license);
      set('source', d.source);
      set('description', d.description);
      box.hidden = false;
      status.textContent = 'Усі ' + total + ' змін знайдено за ' + clock(elapsed()) + '.';
    }

    function onTap(x, y) {
      if (finishedAt) { return; }
      var now = Date.now();
      if (now < lockedUntil) { return; }
      var n = owner(x, y);
      if (n && !found[n]) {
        found[n] = true;
        foundCount += 1;
        clearHint();
        markFound(byN[n]);
        showNote(byN[n]);
        el(ids.found).textContent = foundCount + ' з ' + total;
        status.textContent = total - foundCount === 1 ? 'Лишилася одна зміна.'
          : 'Знайдено ' + foundCount + ' з ' + total + '.';
        if (foundCount === total) { finish(); }
        return;
      }
      if (n) {
        status.textContent = 'Цю зміну вже знайдено.';
        return;
      }
      penalty += PENALTY_S;
      missCount += 1;
      lockedUntil = now + LOCK_MS;
      markMiss(x, y);
      tick();
      status.textContent = 'Тут копія збігається з оригіналом. +' + PENALTY_S + ' с.';
    }

    var srcs = [d.image].concat(d.patches.map(function (p) { return p.file; }));
    status.textContent = 'Завантаження картини…';
    return Promise.all([loadImage(d.image), loadImage(d.image)].concat(
      d.patches.map(function (p) { return loadImage(p.file); })
    )).then(function (imgs) {
      var missing = [];
      imgs.forEach(function (img, i) { if (!img) { missing.push(srcs[Math.max(0, i - 1)]); } });
      if (missing.length) {
        status.textContent = 'Не вдалося завантажити: ' + missing.join(', ') +
          '. Зберіть картину: python tools/vidminnosti-build.py --all';
        status.classList.add('vd-error');
        return null;
      }
      layers = [
        mount(ids.sceneLeft, imgs[0]),
        mount(ids.sceneRight, imgs[1], d.patches.map(function (p, i) { return patchImg(p, imgs[i + 2]); }))
      ];

      var common = {
        width: W, height: H, maxZoom: 6,
        onTap: function (x, y) { onTap(x, y); }
      };
      left = PanZoom.create(Object.assign({
        viewport: el(ids.viewLeft), content: el(ids.sceneLeft),
        onChange: function (v) {
          scale = v.scale;
          el(ids.zoom).textContent = '×' + v.zoom.toFixed(1).replace('.', ',');
          misses.forEach(placeMiss);
        }
      }, common));
      var right = PanZoom.create(Object.assign({
        viewport: el(ids.viewRight), content: el(ids.sceneRight)
      }, common));
      PanZoom.link([left, right]);

      el(ids.btnIn).addEventListener('click', function () { left.zoomBy(1.25); });
      el(ids.btnOut).addEventListener('click', function () { left.zoomBy(0.8); });
      el(ids.btnFit).addEventListener('click', function () { left.fit({ animate: true }); });
      el(ids.btnAgain).addEventListener('click', function () { location.reload(); });
      if (btnHint) { btnHint.addEventListener('click', useHint); }

      el(ids.found).textContent = '0 з ' + total;
      started = Date.now();
      timerId = setInterval(tick, 1000);
      tick();
      if (window.HLGAnalytics) { HLGAnalytics.startSession('vidminnosti:' + d.slug); }
      status.textContent = 'Знайдіть ' + total + ' змін. Клацайте по будь-якій половині.';

      var api = {
        left: left, right: right,
        found: function () { return Object.keys(found).map(Number); },
        elapsed: elapsed,
        tap: onTap,
        hint: useHint,
        hintsUsed: function () { return hintsUsed; },
        hintReadyIn: function () { return Math.max(0, hintReadyAt - Date.now()); }
      };
      return api;
    });
  }

  window.VidminnostiGame = { init: init };
})();
