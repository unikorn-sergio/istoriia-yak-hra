/* engine.js — «Три дати в ряд»: match-3 обміном, фішка = дата, колір = тема.
   window.TryVRiad. Canvas, фіксований крок 1/120 с, без бібліотек (file://).

   Механіка «Века Японии» (Робоча30): обмін двох сусідніх фішок; три й більше
   однієї теми в ряд чи стовпець зникають; комбінація над золотою клітинкою
   робить її срібною, над срібною — порожньою. Перемога — усі клітинки
   очищено до кінця ходів. Хід без комбінації повертається і ходу не коштує.
   Показ кольору — режимами bobble-shooter (easy / modern / impossible).

   Приклад:
     TryVRiad.init({
       canvasId: 'board',
       topics: [{ name: '04', color: '#d64545', tiles: [{ label, fact, req }] }],
       mask: ['..s..', ...], moves: 30, mode: 'easy',
       onMatch: function (info) {},    // { tiles, byPlayer, chain }
       onInvalid: function (info) {},  // { a, b } — фішки хибного обміну
       onChange: function (st) {},     // { moves, cleared, total, matches }
       onFinish: function (r) {}       // { won, cleared, total, movesUsed, invalid, matches, hints, seconds }
     });
     TryVRiad.start();
     TryVRiad.setMode('impossible');
     TryVRiad.hint();                  // підсвітити можливий обмін
     TryVRiad.debug.findMove();        // стенд: [[r,c],[r,c]] або null
     TryVRiad.debug.swap(r1, c1, r2, c2); TryVRiad.debug.step(1);
*/
(function () {
  'use strict';

  var STEP = 1 / 120;
  var SWAP_T = 0.16;
  var CLEAR_T = 0.28;
  var FALL_SPEED = 11;   // клітинок за секунду
  var HINT_T = 1.6;

  var config = null;
  var canvas = null;
  var ctx = null;
  var s = null;
  var size = { cell: 60, w: 480, h: 480, dpr: 1 };
  /* Звичайна клітинка — колір сторінки (тема світла чи темна), щоб
     виділялися лише золоті й срібні. Читається з CSS на кожному resize. */
  var plainBg = '#ece7dc';
  var press = null;
  var last = 0;
  var acc = 0;
  var running = false;

  function shuffle(list) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* --- ініціалізація ----------------------------------------------------- */

  function init(cfg) {
    config = cfg;
    canvas = document.getElementById(cfg.canvasId);
    ctx = canvas.getContext('2d');
    window.addEventListener('resize', resize);
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', function () { press = null; });
  }

  function resize() {
    if (!canvas || !s) { return; }
    var box = canvas.parentNode.getBoundingClientRect();
    var w = Math.max(240, Math.min(box.width, 920));
    size.cell = Math.floor(w / s.cols);
    size.w = size.cell * s.cols;
    size.h = size.cell * s.rows;
    size.dpr = window.devicePixelRatio || 1;
    plainBg = getComputedStyle(document.body).getPropertyValue('--color-bg-deep').trim() || plainBg;
    canvas.style.width = size.w + 'px';
    canvas.style.height = size.h + 'px';
    canvas.width = Math.round(size.w * size.dpr);
    canvas.height = Math.round(size.h * size.dpr);
    draw();
  }

  function randomTile(t) {
    if (t === undefined) { t = Math.floor(Math.random() * config.topics.length); }
    var src = config.topics[t].tiles;
    var p = src[Math.floor(Math.random() * src.length)];
    return { t: t, label: p.label, fact: p.fact, req: p.req, id: p.id, oy: 0, clearing: false };
  }

  function start() {
    var mask = config.mask;
    s = {
      rows: mask.length,
      cols: mask[0].length,
      grid: [],
      layer: [],
      total: 0,
      moves: config.moves,
      movesUsed: 0,
      invalid: 0,
      matches: 0,
      hints: 0,
      phase: 'idle',
      t: 0,
      swap: null,
      selected: null,
      hint: null,
      hintT: 0,
      clear: null,
      chain: 0,
      mode: config.mode || 'easy',
      t0: Date.now(),
      fx: []
    };
    for (var r = 0; r < s.rows; r++) {
      s.layer.push([]);
      for (var c = 0; c < s.cols; c++) {
        var ch = mask[r].charAt(c);
        var l = ch === 'g' ? 2 : ch === 's' ? 1 : 0;
        s.layer[r].push(l);
        s.total += l;
      }
    }
    fillFresh();
    resize();
    changed();
    if (!running) {
      running = true;
      last = 0;
      window.requestAnimationFrame(frame);
    }
  }

  /* Нове поле без готових трійок і з принаймні одним можливим ходом. */
  function fillFresh() {
    for (var tries = 0; tries < 200; tries++) {
      s.grid = [];
      for (var r = 0; r < s.rows; r++) {
        s.grid.push([]);
        for (var c = 0; c < s.cols; c++) {
          var options = [];
          for (var t = 0; t < config.topics.length; t++) {
            var h = c >= 2 && s.grid[r][c - 1].t === t && s.grid[r][c - 2].t === t;
            var v = r >= 2 && s.grid[r - 1][c].t === t && s.grid[r - 2][c].t === t;
            if (!h && !v) { options.push(t); }
          }
          s.grid[r].push(randomTile(options[Math.floor(Math.random() * options.length)]));
        }
      }
      if (findMove()) { return; }
    }
  }

  /* --- правила ----------------------------------------------------------- */

  function topicAt(r, c) {
    var tile = s.grid[r] && s.grid[r][c];
    return tile ? tile.t : -1;
  }

  /* Усі клітинки, що стоять у ряду/стовпці з 3+ однієї теми. */
  function findMatches() {
    var hit = {};
    var list = [];
    function mark(r, c) {
      var key = r + ',' + c;
      if (!hit[key]) { hit[key] = true; list.push([r, c]); }
    }
    var r, c, k, run;
    for (r = 0; r < s.rows; r++) {
      run = 1;
      for (c = 1; c <= s.cols; c++) {
        if (c < s.cols && topicAt(r, c) !== -1 && topicAt(r, c) === topicAt(r, c - 1)) { run++; continue; }
        if (run >= 3) { for (k = c - run; k < c; k++) { mark(r, k); } }
        run = 1;
      }
    }
    for (c = 0; c < s.cols; c++) {
      run = 1;
      for (r = 1; r <= s.rows; r++) {
        if (r < s.rows && topicAt(r, c) !== -1 && topicAt(r, c) === topicAt(r - 1, c)) { run++; continue; }
        if (run >= 3) { for (k = r - run; k < r; k++) { mark(k, c); } }
        run = 1;
      }
    }
    return list;
  }

  function swapCells(a, b) {
    var t = s.grid[a[0]][a[1]];
    s.grid[a[0]][a[1]] = s.grid[b[0]][b[1]];
    s.grid[b[0]][b[1]] = t;
  }

  function findMove() {
    for (var r = 0; r < s.rows; r++) {
      for (var c = 0; c < s.cols; c++) {
        var dirs = [[0, 1], [1, 0]];
        for (var d = 0; d < 2; d++) {
          var r2 = r + dirs[d][0], c2 = c + dirs[d][1];
          if (r2 >= s.rows || c2 >= s.cols) { continue; }
          swapCells([r, c], [r2, c2]);
          var ok = findMatches().length > 0;
          swapCells([r, c], [r2, c2]);
          if (ok) { return [[r, c], [r2, c2]]; }
        }
      }
    }
    return null;
  }

  function adjacent(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
  }

  function trySwap(a, b) {
    if (!s || s.phase !== 'idle' || !adjacent(a, b)) { return false; }
    s.selected = null;
    s.hint = null;
    s.swap = { a: a, b: b, back: false };
    s.phase = 'swap';
    s.t = 0;
    return true;
  }

  function cleared() {
    var left = 0;
    for (var r = 0; r < s.rows; r++) {
      for (var c = 0; c < s.cols; c++) { left += s.layer[r][c]; }
    }
    return s.total - left;
  }

  function beginClear(cells, byPlayer) {
    s.chain = byPlayer ? 1 : s.chain + 1;
    s.clear = cells;
    cells.forEach(function (p) { s.grid[p[0]][p[1]].clearing = true; });
    s.phase = 'clear';
    s.t = 0;
    s.matches += 1;
    if (config.onMatch) {
      config.onMatch({
        tiles: cells.map(function (p) { return s.grid[p[0]][p[1]]; }),
        byPlayer: byPlayer,
        chain: s.chain
      });
    }
  }

  function finishClear() {
    s.clear.forEach(function (p) {
      var tile = s.grid[p[0]][p[1]];
      burst(p[0], p[1], config.topics[tile.t].color);
      s.grid[p[0]][p[1]] = null;
      if (s.layer[p[0]][p[1]] > 0) { s.layer[p[0]][p[1]] -= 1; }
    });
    s.clear = null;
    /* Гравітація: стовпець осідає, згори падають нові фішки. */
    for (var c = 0; c < s.cols; c++) {
      var write = s.rows - 1;
      for (var r = s.rows - 1; r >= 0; r--) {
        var tile = s.grid[r][c];
        if (tile) {
          if (write !== r) {
            s.grid[write][c] = tile;
            s.grid[r][c] = null;
            tile.oy -= (write - r);
          }
          write--;
        }
      }
      var spawned = 0;
      for (var w = write; w >= 0; w--) {
        spawned++;
        var fresh = randomTile();
        fresh.oy = -(write + 1);
        s.grid[w][c] = fresh;
      }
    }
    s.phase = 'fall';
    changed();
  }

  function settle() {
    var m = findMatches();
    if (m.length) { beginClear(m, false); return; }
    s.phase = 'idle';
    s.chain = 0;
    if (cleared() >= s.total) { finish(true); return; }
    if (s.moves <= 0) { finish(false); return; }
    if (!findMove()) { reshuffle(); }
  }

  /* Ходів не лишилося — перемішати фішки, клітинки лишаються. */
  function reshuffle() {
    var tiles = [];
    s.grid.forEach(function (row) { row.forEach(function (t) { tiles.push(t); }); });
    for (var tries = 0; tries < 100; tries++) {
      var mixed = shuffle(tiles);
      for (var r = 0; r < s.rows; r++) {
        for (var c = 0; c < s.cols; c++) { s.grid[r][c] = mixed[r * s.cols + c]; }
      }
      if (!findMatches().length && findMove()) { break; }
    }
    if (config.onReshuffle) { config.onReshuffle(); }
  }

  function finish(won) {
    s.phase = 'over';
    if (config.onFinish) {
      config.onFinish({
        won: won,
        cleared: cleared(),
        total: s.total,
        movesUsed: s.movesUsed,
        invalid: s.invalid,
        matches: s.matches,
        hints: s.hints,
        seconds: Math.round((Date.now() - s.t0) / 1000)
      });
    }
  }

  function changed() {
    if (config.onChange) {
      config.onChange({ moves: s.moves, cleared: cleared(), total: s.total, matches: s.matches });
    }
  }

  /* --- крок симуляції ---------------------------------------------------- */

  function update(dt) {
    if (s.hint) {
      s.hintT -= dt;
      if (s.hintT <= 0) { s.hint = null; }
    }
    s.fx = s.fx.filter(function (p) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 9 * dt;
      return p.life > 0;
    });

    if (s.phase === 'swap') {
      s.t += dt / SWAP_T;
      if (s.t < 1) { return; }
      if (s.swap.back) {
        /* Повернення догралося; сітка вже в початковому стані. */
        s.swap = null;
        s.phase = 'idle';
        return;
      }
      swapCells(s.swap.a, s.swap.b);
      var m = findMatches();
      if (!m.length) {
        /* Хибний обмін повертається й ходу не коштує. a — фішка, яку
           рухав гравець (вона тепер у клітинці b). */
        s.invalid += 1;
        if (config.onInvalid) {
          config.onInvalid({ a: s.grid[s.swap.b[0]][s.swap.b[1]], b: s.grid[s.swap.a[0]][s.swap.a[1]] });
        }
        swapCells(s.swap.a, s.swap.b);
        s.swap = { a: s.swap.a, b: s.swap.b, back: true };
        s.t = 0;
        return;
      }
      s.swap = null;
      s.moves -= 1;
      s.movesUsed += 1;
      beginClear(m, true);
      changed();
      return;
    }

    if (s.phase === 'clear') {
      s.t += dt / CLEAR_T;
      if (s.t >= 1) { finishClear(); }
      return;
    }

    if (s.phase === 'fall') {
      var moving = false;
      for (var r = 0; r < s.rows; r++) {
        for (var c = 0; c < s.cols; c++) {
          var tile = s.grid[r][c];
          if (tile && tile.oy < 0) {
            tile.oy = Math.min(0, tile.oy + FALL_SPEED * dt);
            if (tile.oy < 0) { moving = true; }
          }
        }
      }
      if (!moving) { settle(); }
    }
  }

  function burst(r, c, color) {
    var x = (c + 0.5), y = (r + 0.5);
    for (var i = 0; i < 6; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = 1.5 + Math.random() * 2;
      s.fx.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 1.5, life: 0.5, color: color });
    }
  }

  function frame(now) {
    if (!running) { return; }
    if (!last) { last = now; }
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    while (acc >= STEP) {
      if (s) { update(STEP); }
      acc -= STEP;
    }
    draw();
    window.requestAnimationFrame(frame);
  }

  /* --- малювання --------------------------------------------------------- */

  function roundRect(x, y, w, h, rad) {
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function tilePos(r, c, tile) {
    var y = r + (tile ? tile.oy : 0);
    var x = c;
    if (s.swap && s.phase === 'swap') {
      var a = s.swap.a, b = s.swap.b;
      var k = Math.min(1, s.t);
      if (s.swap.back) { k = 1 - k; }
      if (r === a[0] && c === a[1]) { x = c + (b[1] - c) * k; y = r + (b[0] - r) * k; }
      else if (r === b[0] && c === b[1]) { x = c + (a[1] - c) * k; y = r + (a[0] - r) * k; }
    }
    return { x: x, y: y };
  }

  function drawTile(tile, px, py, cs, scale) {
    var pad = cs * 0.07;
    var w = (cs - pad * 2) * scale;
    var x = px + (cs - w) / 2, y = py + (cs - w) / 2;
    var color = config.topics[tile.t].color;
    var rad = w * 0.22;

    if (s.mode === 'easy') {
      roundRect(x, y, w, w, rad);
      ctx.fillStyle = color;
      ctx.fill();
      var g = ctx.createLinearGradient(x, y, x, y + w);
      g.addColorStop(0, 'rgba(255,255,255,0.28)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
    } else if (s.mode === 'modern') {
      roundRect(x, y, w, w, rad);
      ctx.fillStyle = '#2a2f3a';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, cs * 0.07);
      ctx.stroke();
      ctx.fillStyle = '#fff';
    } else {
      roundRect(x, y, w, w, rad);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#222';
    }

    if (scale > 0.35) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var fit = layoutLabel(tile.label, w * 0.86, w * 0.86, Math.floor(w * 0.3));
      ctx.font = 'bold ' + fit.size + 'px "Segoe UI", Arial, sans-serif';
      var lh = fit.size * 1.08;
      var top = y + w / 2 - (fit.lines.length - 1) * lh / 2;
      fit.lines.forEach(function (line, i) { ctx.fillText(line, x + w / 2, top + i * lh + 1); });
    }
  }

  /* Мітка в квадрат: найбільший шрифт, за якого слова (і половинки діапазону
     «1238–1264») стають у рядки ширини maxW і загалом не вищі за maxH.
     Дати бувають довгими — «середина ІІІ тис. до н. е.» — і без переносу
     налазили на сусідню фішку. */
  var labelCache = {};
  function layoutLabel(text, maxW, maxH, start) {
    var key = text + '|' + Math.round(maxW);
    if (labelCache[key]) { return labelCache[key]; }
    var words = text.replace(/–/g, '– ').split(/\s+/).filter(Boolean);
    var MIN = 6;
    for (var fs = start; fs >= MIN; fs--) {
      ctx.font = 'bold ' + fs + 'px "Segoe UI", Arial, sans-serif';
      var lines = [];
      var cur = '';
      var ok = true;
      for (var i = 0; i < words.length; i++) {
        var joiner = cur && cur.charAt(cur.length - 1) !== '–' ? ' ' : '';
        var next = cur ? cur + joiner + words[i] : words[i];
        if (ctx.measureText(next).width <= maxW) { cur = next; continue; }
        if (!cur) { ok = false; break; }
        lines.push(cur);
        cur = words[i];
        if (ctx.measureText(cur).width > maxW) { ok = false; break; }
      }
      if (cur) { lines.push(cur); }
      if (ok && (lines.length * fs * 1.08 <= maxH || fs === MIN)) {
        labelCache[key] = { size: fs, lines: lines };
        return labelCache[key];
      }
    }
    /* Навіть найменшим шрифтом слово ширше за фішку (вузький телефон):
       кожне слово окремим рядком — краще, ніж налізти на сусіда. */
    labelCache[key] = { size: MIN, lines: words };
    return labelCache[key];
  }

  function draw() {
    if (!s || !ctx) { return; }
    var cs = size.cell;
    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.fillStyle = '#3b2a1e';
    ctx.fillRect(0, 0, size.w, size.h);

    var r, c;
    for (r = 0; r < s.rows; r++) {
      for (c = 0; c < s.cols; c++) {
        var l = s.layer[r][c];
        ctx.fillStyle = l === 2 ? '#e0b52b' : l === 1 ? '#b9c1cc' : plainBg;
        ctx.fillRect(c * cs + 1, r * cs + 1, cs - 2, cs - 2);
      }
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    ctx.clip();
    for (r = 0; r < s.rows; r++) {
      for (c = 0; c < s.cols; c++) {
        var tile = s.grid[r][c];
        if (!tile) { continue; }
        var p = tilePos(r, c, tile);
        var scale = tile.clearing && s.phase === 'clear' ? Math.max(0, 1 - s.t) : 1;
        drawTile(tile, p.x * cs, p.y * cs, cs, scale);
      }
    }
    ctx.restore();

    function outline(cell, color, width) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      roundRect(cell[1] * cs + 2, cell[0] * cs + 2, cs - 4, cs - 4, cs * 0.2);
      ctx.stroke();
    }
    if (s.selected) { outline(s.selected, '#ffffff', 4); }
    if (s.hint) {
      var pulse = 3 + 2 * Math.sin(s.hintT * 12);
      outline(s.hint[0], '#ffd54a', pulse);
      outline(s.hint[1], '#ffd54a', pulse);
    }

    s.fx.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, p.life * 2);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x * cs, p.y * cs, cs * 0.06, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }

  /* --- керування: клік-клік або протяг на сусіда ------------------------ */

  function cellAt(e) {
    var rect = canvas.getBoundingClientRect();
    var c = Math.floor((e.clientX - rect.left) / size.cell);
    var r = Math.floor((e.clientY - rect.top) / size.cell);
    if (r < 0 || c < 0 || r >= s.rows || c >= s.cols) { return null; }
    return [r, c];
  }

  function onDown(e) {
    if (!s || s.phase !== 'idle') { return; }
    var cell = cellAt(e);
    if (!cell) { return; }
    press = { cell: cell, x: e.clientX, y: e.clientY, used: false };
  }

  function onMove(e) {
    if (!press || press.used) { return; }
    var dx = e.clientX - press.x, dy = e.clientY - press.y;
    var lim = size.cell * 0.35;
    if (Math.abs(dx) < lim && Math.abs(dy) < lim) { return; }
    var to = Math.abs(dx) > Math.abs(dy)
      ? [press.cell[0], press.cell[1] + (dx > 0 ? 1 : -1)]
      : [press.cell[0] + (dy > 0 ? 1 : -1), press.cell[1]];
    press.used = true;
    if (to[0] >= 0 && to[1] >= 0 && to[0] < s.rows && to[1] < s.cols) { trySwap(press.cell, to); }
  }

  function onUp() {
    if (!press) { return; }
    var p = press;
    press = null;
    if (p.used || !s || s.phase !== 'idle') { return; }
    var cell = p.cell;
    if (s.selected && adjacent(s.selected, cell)) { trySwap(s.selected, cell); return; }
    if (s.selected && s.selected[0] === cell[0] && s.selected[1] === cell[1]) { s.selected = null; return; }
    s.selected = cell;
  }

  function hint() {
    if (!s || s.phase !== 'idle') { return false; }
    var m = findMove();
    if (!m) { return false; }
    s.hint = m;
    s.hintT = HINT_T;
    s.hints += 1;
    return true;
  }

  function setMode(mode) {
    if (s) { s.mode = mode; }
    config.mode = mode;
  }

  var debug = {
    findMove: function () { return findMove(); },
    swap: function (r1, c1, r2, c2) { return trySwap([r1, c1], [r2, c2]); },
    step: function (seconds) {
      var n = Math.round((seconds || 1) / STEP);
      for (var i = 0; i < n; i++) { update(STEP); }
      draw();
      return debug.snapshot();
    },
    snapshot: function () {
      return { phase: s.phase, moves: s.moves, cleared: cleared(), total: s.total,
               matches: s.matches, invalid: s.invalid };
    },
    grid: function () { return s.grid.map(function (row) { return row.map(function (t) { return t ? t.t : -1; }); }); },
    layer: function () { return s.layer; }
  };

  window.TryVRiad = { init: init, start: start, hint: hint, setMode: setMode, debug: debug };
})();
