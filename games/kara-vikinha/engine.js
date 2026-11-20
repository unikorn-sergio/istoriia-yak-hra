/* games/kara-vikinha/engine.js — window.KaraVikinha.

   «Кара вікінга»: вікінг із кошиком ловить яблука-терміни. Зараховується
   лише яблуко поточної категорії; чуже коштує очко. Категорія міняється
   кожні data.categorySeconds; гра йде до data.target правильних яблук.
   Перенос masachuchi з першої версії платформи на новий рушій.

   Рушій про історію не знає: він бере data.categories[].items[] і віддає
   сторінці події. Що показати учневі й що записати в аналітику — справа
   сторінки (games/kara-vikinha.html).

   Поле — Canvas 960×640 у логічних координатах, крок 1/120 с. Вікінг — НЕ
   на полотні, а DOM-елемент поверх нього: GIF ходи в drawImage() застигає
   на першому кадрі, а в <img> анімується сам.

     KaraVikinha.init({
       data: window.KARA_VIKINHA_DATA,
       canvasId: 'field',
       vikingId: 'viking',
       legsId: 'vikingLegs',
       stageId: 'stage',
       stillSrc: 'kara-vikinha/assets/viking-legs.png',
       moveSrc: 'kara-vikinha/assets/viking-legs-move.gif',
       onCategory: function (category) {},           // нова категорія
       onCatch: function (info) {},                  // {item, category, ok}
       onMiss: function (info) {},                   // своє яблуко впало: {item, category}
       onScore: function (state) {},                 // {score, correct, wrong, target}
       onFinish: function (result) {}                // {score, correct, wrong, misses, seconds}
     });
     KaraVikinha.start();   // pause(), resume(), restart()
     KaraVikinha.debug.step(2);  // стенд: прогнати 2 с симуляції без rAF
*/
(function () {
  'use strict';

  var W = 960;
  var H = 640;
  var STEP = 1 / 120;

  var VIKING_W = 128;          // ширина вікінга
  var VIKING_H = 102;          // висота одного шару; разом шари дають 1,5 × VIKING_H
  var VIKING_TOP = H - VIKING_H * 1.5 - 6;
  var KEY_SPEED = 620;         // px/с з клавіатури
  var FOLLOW = 10;             // наскільки швидко вікінг іде за мишею, 1/с

  var APPLE_R = 46;
  var LANES = [0.09, 0.25, 0.41, 0.59, 0.75, 0.91];
  var PALETTE = ['#e4574b', '#e98a3a', '#d9b43b', '#8fbf4d', '#c9564f', '#e0784a'];
  var FLASH_TIME = 0.22;

  var config = null;
  var ctx = null;
  var canvas = null;
  var vikingEl = null;
  var legsEl = null;
  var s = null;
  var keys = {};
  var rafId = null;
  var lastTime = 0;
  var acc = 0;

  /* --- стан --------------------------------------------------------------- */

  function fresh() {
    return {
      state: 'ready',
      x: W / 2,
      target: null,          // ціль миші/пальця; null — керує клавіатура
      moving: false,
      apples: [],
      spawnTimer: 0.4,
      categoryIndex: 0,
      categoryTimer: 0,
      correct: 0,
      wrong: 0,
      score: 0,
      misses: 0,             // свої яблука, що впали повз
      time: 0,
      flash: 0,
      flashOk: true,
      lastLane: -1,
      seed: 1
    };
  }

  function category() {
    return config.data.categories[s.categoryIndex];
  }

  /* --- випадковість ------------------------------------------------------- */

  function rand() {
    return Math.random();
  }

  function pick(list) {
    return list[Math.floor(rand() * list.length)];
  }

  /* --- яблука ------------------------------------------------------------- */

  function spawn(forced) {
    var cats = config.data.categories;
    var own = category();
    var cat;
    if (forced && forced.category) {
      cat = forced.category;
    } else if (rand() < (config.data.ownShare || 0.45)) {
      cat = own;
    } else {
      var others = cats.filter(function (c) { return c !== own; });
      cat = pick(others);
    }

    /* Одне й те саме слово двічі на екрані плутає: учень не розуміє, яке з
       двох він уже ловив. */
    var onScreen = {};
    s.apples.forEach(function (a) { onScreen[a.item.req] = true; });
    var pool = cat.items.filter(function (it) { return !onScreen[it.req]; });
    if (!pool.length) { pool = cat.items; }
    var item = forced && forced.item ? forced.item : pick(pool);

    var lane = forced && typeof forced.lane === 'number' ? forced.lane : -1;
    if (lane < 0) {
      do { lane = Math.floor(rand() * LANES.length); } while (lane === s.lastLane);
    }
    s.lastLane = lane;

    s.apples.push({
      x: LANES[lane] * W,
      y: -APPLE_R,
      speed: 95 + rand() * 50,
      item: item,
      category: cat,
      color: pick(PALETTE),
      lines: null
    });
  }

  /* --- крок симуляції ------------------------------------------------------- */

  function update(dt) {
    s.time += dt;

    /* Рух вікінга. Клавіатура має перевагу; миша/палець задають ціль. */
    var dir = 0;
    if (keys.left) { dir -= 1; }
    if (keys.right) { dir += 1; }
    var before = s.x;
    if (dir !== 0) {
      s.target = null;
      s.x += dir * KEY_SPEED * dt;
    } else if (s.target !== null) {
      s.x += (s.target - s.x) * Math.min(1, FOLLOW * dt);
    }
    s.x = Math.max(VIKING_W / 2, Math.min(W - VIKING_W / 2, s.x));
    s.moving = Math.abs(s.x - before) > 30 * dt;

    /* Категорія. */
    s.categoryTimer += dt;
    if (s.categoryTimer >= config.data.categorySeconds) {
      s.categoryTimer = 0;
      s.categoryIndex = (s.categoryIndex + 1) % config.data.categories.length;
      emit('onCategory', category());
    }

    /* Нові яблука. */
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      spawn();
      s.spawnTimer = config.data.spawnSeconds || 1.4;
    }

    /* Падіння й ловля. */
    var catchTop = VIKING_TOP + VIKING_H * 0.33;
    var catchBottom = VIKING_TOP + VIKING_H;
    for (var i = s.apples.length - 1; i >= 0; i--) {
      var a = s.apples[i];
      a.y += a.speed * dt;

      var hit = a.y + APPLE_R * 0.6 >= catchTop
        && a.y - APPLE_R * 0.6 <= catchBottom
        && Math.abs(a.x - s.x) <= VIKING_W / 2;

      if (hit) {
        s.apples.splice(i, 1);
        var ok = a.category === category();
        if (ok) {
          s.correct += 1;
          s.score += 1;
        } else {
          s.wrong += 1;
          s.score = Math.max(0, s.score - 1);
        }
        s.flash = FLASH_TIME;
        s.flashOk = ok;
        emit('onCatch', { item: a.item, category: a.category, current: category(), ok: ok });
        emit('onScore', scoreState());
        if (s.correct >= config.data.target) {
          finish();
          return;
        }
        continue;
      }

      if (a.y - APPLE_R > H) {
        s.apples.splice(i, 1);
        if (a.category === category()) {
          s.misses += 1;
          emit('onMiss', { item: a.item, category: a.category });
        }
      }
    }

    if (s.flash > 0) { s.flash = Math.max(0, s.flash - dt); }
  }

  function scoreState() {
    return { score: s.score, correct: s.correct, wrong: s.wrong,
             target: config.data.target };
  }

  function finish() {
    s.state = 'over';
    stopLoop();
    syncViking();
    draw();
    emit('onFinish', {
      score: s.score,
      correct: s.correct,
      wrong: s.wrong,
      misses: s.misses,
      seconds: Math.round(s.time)
    });
  }

  function emit(name, payload) {
    if (config && typeof config[name] === 'function') {
      try { config[name](payload); } catch (e) {
        if (window.console) { console.error('[KaraVikinha] ' + name + ': ' + e.message); }
      }
    }
  }

  /* --- малювання -------------------------------------------------------------- */

  function wrapLabel(text, maxWidth) {
    var size = 17;
    var lines;
    /* Зменшуємо шрифт, доки підпис не влізе в яблуко трьома рядками. */
    for (; size >= 11; size -= 1) {
      ctx.font = '700 ' + size + 'px system-ui, "Segoe UI", sans-serif';
      lines = [];
      var words = text.split(' ');
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var test = line ? line + ' ' + words[i] : words[i];
        if (ctx.measureText(test).width <= maxWidth || !line) {
          line = test;
        } else {
          lines.push(line);
          line = words[i];
        }
      }
      lines.push(line);
      var widest = 0;
      lines.forEach(function (l) { widest = Math.max(widest, ctx.measureText(l).width); });
      if (lines.length <= 3 && widest <= maxWidth) { break; }
    }
    return { size: size, lines: lines };
  }

  function drawApple(a) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.beginPath();
    ctx.arc(a.x + 4, a.y + 5, APPLE_R, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = a.color;
    ctx.beginPath();
    ctx.arc(a.x, a.y, APPLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#14110f';
    ctx.stroke();

    /* Світла пляма під текстом — щоб підпис читався на будь-якому кольорі. */
    ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
    ctx.beginPath();
    ctx.arc(a.x, a.y + 3, APPLE_R * 0.8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#2e7d32';
    ctx.beginPath();
    ctx.ellipse(a.x + 12, a.y - APPLE_R + 4, 9, 16, Math.PI / 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#14110f';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!a.lines) { a.lines = wrapLabel(a.item.label, APPLE_R * 1.5); }
    ctx.font = '700 ' + a.lines.size + 'px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = '#14110f';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lh = a.lines.size * 1.1;
    var y0 = a.y + 3 - (a.lines.lines.length - 1) * lh / 2;
    a.lines.lines.forEach(function (l, i) { ctx.fillText(l, a.x, y0 + i * lh); });
  }

  function draw() {
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#9fd3ec');
    sky.addColorStop(1, '#e7f5fb');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* Земля. */
    ctx.fillStyle = '#9cc46b';
    ctx.fillRect(0, H - 26, W, 26);
    ctx.fillStyle = '#7ea952';
    ctx.fillRect(0, H - 26, W, 4);

    for (var i = 0; i < s.apples.length; i++) { drawApple(s.apples[i]); }

    if (s.flash > 0) {
      ctx.fillStyle = s.flashOk ? 'rgba(47, 143, 78, 0.18)' : 'rgba(192, 57, 43, 0.28)';
      ctx.fillRect(0, 0, W, H);
    }
  }

  /* Вікінг — DOM поверх полотна, у відсотках від сцени, тож масштабується
     разом із полотном без перерахунку. */
  function syncViking() {
    if (!vikingEl) { return; }
    vikingEl.style.left = ((s.x - VIKING_W / 2) / W * 100) + '%';
    vikingEl.style.top = (VIKING_TOP / H * 100) + '%';
    vikingEl.style.width = (VIKING_W / W * 100) + '%';
    vikingEl.style.height = (VIKING_H * 1.5 / H * 100) + '%';
    if (legsEl) {
      var want = s.moving && s.state === 'play' ? config.moveSrc : config.stillSrc;
      if (legsEl.getAttribute('src') !== want) { legsEl.setAttribute('src', want); }
    }
  }

  /* --- цикл ----------------------------------------------------------------- */

  function frame(now) {
    rafId = null;
    if (s.state !== 'play') { return; }
    var dt = Math.min(0.25, (now - lastTime) / 1000);
    lastTime = now;
    acc += dt;
    while (acc >= STEP && s.state === 'play') {
      update(STEP);
      acc -= STEP;
    }
    if (s.state !== 'play') { return; }
    draw();
    syncViking();
    rafId = window.requestAnimationFrame(frame);
  }

  function startLoop() {
    if (rafId) { return; }
    lastTime = performance.now();
    acc = 0;
    rafId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId) { window.cancelAnimationFrame(rafId); rafId = null; }
  }

  /* --- керування --------------------------------------------------------------- */

  function pointerX(event) {
    var rect = canvas.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width * W;
  }

  function bindInput() {
    var stage = document.getElementById(config.stageId) || canvas;
    stage.addEventListener('pointermove', function (e) {
      if (s.state === 'play') { s.target = pointerX(e); }
    });
    stage.addEventListener('pointerdown', function (e) {
      if (s.state === 'play') { s.target = pointerX(e); }
    });

    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { keys.left = true; e.preventDefault(); }
      if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В') { keys.right = true; e.preventDefault(); }
      if (k === 'Escape' || k === 'p' || k === 'P' || k === 'з' || k === 'З') {
        if (s.state === 'play') { pause(); } else if (s.state === 'paused') { resume(); }
      }
    });
    document.addEventListener('keyup', function (e) {
      var k = e.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { keys.left = false; }
      if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В') { keys.right = false; }
    });

    /* Вкладка без фокусу — пауза: інакше яблука падали б без гравця. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden && s.state === 'play') { pause(); }
    });
  }

  /* --- публічне ---------------------------------------------------------------- */

  function init(options) {
    config = options || {};
    if (!config.data || !config.data.categories || !config.data.categories.length) {
      throw new Error('KaraVikinha: немає data.categories');
    }
    canvas = document.getElementById(config.canvasId);
    ctx = canvas.getContext('2d');
    canvas.width = W;
    canvas.height = H;
    vikingEl = document.getElementById(config.vikingId);
    legsEl = document.getElementById(config.legsId);
    s = fresh();
    bindInput();
    draw();
    syncViking();
  }

  function start() {
    s = fresh();
    s.state = 'play';
    emit('onCategory', category());
    emit('onScore', scoreState());
    startLoop();
  }

  function pause() {
    if (s.state !== 'play') { return; }
    s.state = 'paused';
    keys = {};
    stopLoop();
    syncViking();
    emit('onPause', true);
  }

  function resume() {
    if (s.state !== 'paused') { return; }
    s.state = 'play';
    emit('onPause', false);
    startLoop();
  }

  function restart() {
    stopLoop();
    start();
  }

  /* Стенд: вкладка без фокусу дає rAF раз на секунду, тож перевірки
     женуть симуляцію напряму. */
  var debug = {
    step: function (seconds) {
      var n = Math.round((seconds || 1) / STEP);
      for (var i = 0; i < n && s.state === 'play'; i++) { update(STEP); }
      draw();
      syncViking();
      return debug.snapshot();
    },
    snapshot: function () {
      return {
        state: s.state, x: Math.round(s.x), category: category().id,
        correct: s.correct, wrong: s.wrong, score: s.score, misses: s.misses,
        apples: s.apples.map(function (a) {
          return { label: a.item.label, cat: a.category.id, x: Math.round(a.x), y: Math.round(a.y) };
        })
      };
    },
    /* Покласти яблуко над вікінгом: own=true — поточної категорії. */
    drop: function (own) {
      var cats = config.data.categories;
      var cat = own ? category() : cats[(s.categoryIndex + 1) % cats.length];
      spawn({ category: cat, item: cat.items[0], lane: 0 });
      var a = s.apples[s.apples.length - 1];
      a.x = s.x;
      a.y = VIKING_TOP - APPLE_R;
      return debug.step(0.5);
    },
    moveTo: function (x) { s.x = x; s.target = x; syncViking(); }
  };

  window.KaraVikinha = {
    init: init,
    start: start,
    pause: pause,
    resume: resume,
    restart: restart,
    debug: debug
  };
})();
