/* window.KafeNaHiltsi — рушій гри «Кафе на гілці».

   Схрещення: механіка «Голодные вороны 2» (Робоча30) + зміст «Характерного
   кафе» (HistoryLikeGame). Графіку, звук і тексти ворон НЕ перенесено —
   усе намальовано тут, на Canvas (межа з Робоча30/plan1.md).

   Як грається:
   * Клієнти-ворони сідають на гілку. Над кожною — табличка із замовленням і
     шампур: скільки шматків ще треба подати.
   * Кухар у віконці зліва підкидає круглі інгредієнти — лише ті, що зараз
     комусь замовлені, і не кидає, поки на таці щось є. Офіціант на скейті
     ходить за мишею (пальцем, ← →) і ловить їх на тацю — по одному.
   * Клік, дотик, пробіл або ↑ — підкинути впійманий інгредієнт угору. Над
     клієнтом, якому він потрібен, — шматок на шампур. Над чужим — відмова:
     інгредієнт падає й б'ється, клієнт втрачає терпіння, а рядок стану каже,
     ДО ЧОГО цей інгредієнт насправді (контекстна підтримка, review-evidence
     п. 1). Над порожньою гілкою — просто викинути непотрібне.
   * Хмаринка терпіння біла → сіра → грозова; гроза минула — клієнт іде
     голодним. Нагодований клієнт кидає монету; її треба підібрати, поки не
     прийшов злодій. Офіціант, що наїхав на злодія, його проганяє.
   * Після кожної повної страви рядок стану показує факт (plan1.md §6:
     факт після кожної відповіді).

   Рушій знає лише <canvas>. Замовлення, статус і рахунок — у DOM сторінки
   через колбеки; тексту в DOM рушій не пише, тож innerHTML тут нема де взятися.

   Приклад:

     var game = KafeNaHiltsi.init({
       canvasId: 'field',
       customers: [{ name: 'Пані Софія', trait: 'calm',        // 'hurry'|'calm'|'generous'|null
                     steps: [{ label: 'Конституційний борщ', emoji: '📜',
                               color: '#00798c',    // колір рецепта: смуга на табличці
                               need: ['28 червня 1996', 'Конституційна ніч'],
                               fact: 'Конституцію ухвалено 28 червня 1996 р.' }] }],
       owners: { '24 серпня 1991': 'Незалежність' },  // необов'язково: для підказок
       days: [{ count: 1, perches: 2, patience: 60, tossEvery: 2.4, flight: 2.8,
                maxAir: 1, thief: 5 }],
       seed: 42,                              // той самий seed — та сама партія
       moduleId: 'kafe-na-hiltsi',
       onOrders: function (list) {},  // [{name, trait, label, emoji, got, need, patience, state}]
       onStatus: function (text, kind) {},   // kind: 'ok' | 'bad' | 'fact' | 'info'
       onHud: function (hud) {},  // {day, days, served, total, money, hungry, dropped, stolen, mistakes}
       onState: function (state) {},         // 'ready' | 'play' | 'paused' | 'dayEnd' | 'over'
       onDayEnd: function (summary) {},      // {day, days, served, count, hungry, dropped, stolen, earned}
       onEnd: function (result) {}           // {served, total, money, mistakes, timeMs}
     });
     game.start(); game.pause(); game.resume(); game.nextDay(); game.restart(); game.destroy();
     game.debug.step(seconds);   // стенд: крок без rAF (вкладка без фокусу дає rAF раз на секунду)

   Кроки (steps) — це черга замовлень одного клієнта. В авторському наборі
   крок один — страва з трьох інгредієнтів, подаються в будь-якому порядку.
   З ?facts= кроків один-два, у кожному одна дата. Шампур показує ВСІ шматки
   всіх кроків, як у воронах: «скільки страв вона з'їсть».

   Поле логічне: 960 × 780 (альбомне) або 560 × 940 (книжкове, телефон —
   на гілці тоді два місця). ctx.font — у px: Canvas інакше не вміє, це
   єдиний дозволений виняток із var(--text-*); масштаб шрифту доступності
   рушій однаково враховує через розмір шрифту кореня. */

(function () {
  'use strict';

  var LAYOUTS = {
    wide: { w: 960, h: 780, branch: 400, hatchW: 120, maxPerches: 3, card: 104 },
    tall: { w: 560, h: 940, branch: 480, hatchW: 92, maxPerches: 2, card: 96 }
  };
  var TALL_BELOW = 640;

  var STEP = 1 / 120;
  var MAX_FRAME = 0.1;

  var WAITER_SPEED = 1100;
  var KEY_SPEED = 620;
  var TRAY_HALF = 52;
  var TOSS_V = 980;
  var TOSS_G = 1000;
  var BACK_G = 900;
  var ARRIVE_T = 1.0;
  var EAT_T = 1.1;
  var LEAVE_T = 1.3;
  var SPAWN_GAP = 2.2;
  var REJECT_COST = 0.12;      // частка терпіння за хибний кидок
  var STEP_REFILL = 0.3;       // частка терпіння, що повертається за крок
  var THIEF_SPEED = 150;
  var THIEF_SCARE = 46;
  var COIN_PICK = 46;

  var TRAITS = {
    hurry: { patience: 0.75, coins: 1 },
    calm: { patience: 1.35, coins: 1 },
    generous: { patience: 1, coins: 2 }
  };

  var SCARVES = ['#c1554a', '#1d7a8c', '#b8860b', '#6b4fa0', '#2f8f4e', '#d0731f'];

  /* --- службове --------------------------------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function makeRandom(seed) {
    if (seed === null || seed === undefined || seed === '') { return Math.random; }
    var h = 2166136261;
    var s = String(seed);
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    var a = h >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function pick(list, random) { return list[Math.floor(random() * list.length)]; }

  function rootClass(name) { return document.documentElement.classList.contains(name); }

  function reducedMotion() {
    if (rootClass('reduce-motion')) { return true; }
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  function fontScale() {
    var px = parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return clamp((px || 16) / 16, 1, 1.6);
  }

  function isDark() {
    return document.documentElement.hasAttribute('data-theme-dark')
      || (document.body && document.body.classList.contains('theme-dark'));
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* Перенос за словами. Слово, ширше за рядок, лишається цілим —
     обрізати історичний термін гірше, ніж вийти на кілька пікселів. */
  function wrap(ctx, text, maxW) {
    /* Ділимо лише за звичайним пробілом: нерозривний ( ) тримає
       «1990 р.» укупі — \s його теж ловив би. */
    var words = String(text).split(/[ \t\n]+/);
    var lines = [];
    var line = '';
    for (var i = 0; i < words.length; i++) {
      var probe = line ? line + ' ' + words[i] : words[i];
      if (line && ctx.measureText(probe).width > maxW) {
        lines.push(line);
        line = words[i];
      } else {
        line = probe;
      }
    }
    if (line) { lines.push(line); }
    return lines;
  }

  /* --- рушій ------------------------------------------------------------- */

  function init(config) {
    var canvas = document.getElementById(config.canvasId);
    var ctx = canvas.getContext('2d');
    var noop = function () {};
    var cb = {
      orders: config.onOrders || noop,
      status: config.onStatus || noop,
      hud: config.onHud || noop,
      state: config.onState || noop,
      dayEnd: config.onDayEnd || noop,
      end: config.onEnd || noop
    };

    var L = LAYOUTS.wide;
    var W = L.w, H = L.h;
    var FLOOR = H - 40, TRAY = FLOOR - 104, BRANCH = L.branch;
    var cssW = 0;
    var fs = 1;
    var calm = false;

    var s = null;         // стан партії
    var raf = 0;
    var last = 0;
    var acc = 0;
    var keys = { left: false, right: false };
    var lastOrdersSent = 0;
    var destroyed = false;

    /* Власники інгредієнтів — для підказки «це до …». Збираються з кроків
       і доповнюються config.owners (для зайвих, яких ніхто не замовляв). */
    var owners = {};
    (config.customers || []).forEach(function (c) {
      c.steps.forEach(function (st) {
        st.need.forEach(function (n) { owners[n] = st.label; });
      });
    });
    Object.keys(config.owners || {}).forEach(function (k) {
      if (!owners[k]) { owners[k] = config.owners[k]; }
    });

    var days = config.days && config.days.length ? config.days : [{ count: config.customers.length,
      perches: 3, patience: 60, tossEvery: 2, flight: 2.6, maxAir: 2, thief: 5 }];

    /* --- розкладка й масштаб ------------------------------------------- */

    function setLayout() {
      var parentW = canvas.parentNode ? canvas.parentNode.clientWidth : 960;
      L = config.layout ? LAYOUTS[config.layout] : (parentW < TALL_BELOW ? LAYOUTS.tall : LAYOUTS.wide);
      W = L.w; H = L.h;
      FLOOR = H - 40;
      TRAY = FLOOR - 104;
      BRANCH = L.branch;
    }

    function resize() {
      var parentW = canvas.parentNode ? canvas.parentNode.clientWidth : W;
      cssW = Math.max(240, parentW);
      var cssH = cssW * H / W;
      var dpr = window.devicePixelRatio || 1;
      canvas.style.width = cssW + 'px';
      canvas.style.height = cssH + 'px';
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      fs = fontScale();
      calm = reducedMotion();
      draw();
    }

    function perchX(i, n) {
      var lo = L.hatchW + 40;
      var hi = W - 40;
      return lo + (hi - lo) * (i + 0.5) / n;
    }

    /* --- партія -------------------------------------------------------- */

    function fresh() {
      var random = makeRandom(config.seed);
      return {
        random: random,
        state: 'ready',
        dayIndex: 0,
        queue: [],            // клієнти дня, що ще не сіли
        perches: [],          // місця: null або клієнт
        items: [],
        coins: [],
        thief: null,
        sparks: [],
        waiter: { x: W / 2, target: W / 2, held: null, tilt: 0 },
        chef: { t: 0, throwT: 0 },
        spawnT: 0,
        clock: 0,
        timeMs: 0,
        nextCustomer: 0,
        endT: -1,
        total: config.customers.length,
        served: 0, money: 0, hungry: 0, dropped: 0, stolen: 0, mistakes: 0,
        day: null,
        sessionStarted: false
      };
    }

    function dayCustomers(index) {
      var from = 0;
      for (var i = 0; i < index; i++) { from += days[i].count; }
      var count = index === days.length - 1 ? config.customers.length - from : days[index].count;
      return config.customers.slice(from, from + Math.max(0, count));
    }

    function beginDay(index) {
      var d = days[index];
      s.dayIndex = index;
      s.queue = dayCustomers(index).map(function (c, i) {
        var trait = TRAITS[c.trait] || { patience: 1, coins: 1 };
        var max = d.patience * trait.patience;
        return {
          name: c.name,
          trait: c.trait || null,
          coins: trait.coins,
          steps: c.steps.map(function (st) {
            return { label: st.label, emoji: st.emoji || '', color: st.color || null,
                     need: st.need.slice(), got: [], fact: st.fact || '' };
          }),
          stepIndex: 0,
          max: max,
          patience: max,
          scarf: SCARVES[(s.nextCustomer + i) % SCARVES.length],
          mode: 'queue', t: 0, perch: -1, x: 0, y: 0, shake: 0
        };
      });
      s.nextCustomer += s.queue.length;
      var n = Math.min(d.perches, L.maxPerches);
      s.perches = [];
      for (var p = 0; p < n; p++) { s.perches.push(null); }
      s.items = [];
      s.coins = [];
      s.thief = null;
      s.spawnT = 0.4;
      s.chef.t = 1.2;
      s.endT = -1;
      s.waiter.held = null;
      s.day = { served: 0, count: s.queue.length, hungry: 0, dropped: 0, stolen: 0, earned: 0 };
      cb.status('День ' + (index + 1) + ' з ' + days.length + '. Клієнти сідають на гілку.', 'info');
      hud();
      sendOrders(true);
    }

    function setState(st) {
      s.state = st;
      cb.state(st);
    }

    function hud() {
      cb.hud({
        day: s.dayIndex + 1, days: days.length, served: s.served, total: s.total,
        money: s.money, hungry: s.hungry, dropped: s.dropped, stolen: s.stolen, mistakes: s.mistakes
      });
    }

    function present() {
      return s.perches.filter(function (c) { return c; });
    }

    function sendOrders(force) {
      if (!force && s.clock - lastOrdersSent < 0.25) { return; }
      lastOrdersSent = s.clock;
      var list = [];
      s.perches.forEach(function (c) {
        if (!c) { return; }
        var st = c.steps[Math.min(c.stepIndex, c.steps.length - 1)];
        var got = 0, need = 0;
        c.steps.forEach(function (x) { got += x.got.length; need += x.need.length; });
        list.push({ name: c.name, trait: c.trait, label: st.label, emoji: st.emoji, color: st.color,
                    got: got, need: need, patience: c.patience / c.max, state: c.mode });
      });
      cb.orders(list);
    }

    /* Що зараз комусь потрібно: решта поточного кроку кожного, хто чекає. */
    function neededNow() {
      var out = [];
      s.perches.forEach(function (c) {
        if (!c || (c.mode !== 'wait' && c.mode !== 'arrive')) { return; }
        var st = c.steps[c.stepIndex];
        st.need.forEach(function (n) {
          if (st.got.indexOf(n) === -1 && out.indexOf(n) === -1) { out.push(n); }
        });
      });
      return out;
    }

    function inPlay(answer) {
      if (s.waiter.held && s.waiter.held.text === answer) { return true; }
      return s.items.some(function (it) { return it.text === answer && it.mode !== 'break'; });
    }

    /* --- кухар ---------------------------------------------------------- */

    function chefThrow() {
      var d = days[s.dayIndex];
      var airborne = s.items.filter(function (it) { return it.mode === 'fly'; }).length;
      if (airborne >= d.maxAir) { return false; }
      /* Кухар кидає ЛИШЕ те, що зараз замовлено, і не кидає, поки в офіціанта
         щось на таці: зайві інгредієнти й «другий у повітрі» здебільшого просто
         падали на підлогу (рішення куратора 2026-11-18). Помилитися однаково
         можна — кинути впійманий інгредієнт не тому клієнтові. */
      if (s.waiter.held) { return false; }
      var need = neededNow();
      var unthrown = need.filter(function (n) { return !inPlay(n); });
      if (!unthrown.length) { return false; }
      var text = pick(unthrown, s.random);
      var x0 = L.hatchW * 0.62;
      var y0 = FLOOR - 150;
      var apex = BRANCH + 50;
      var T = d.flight;
      var a = Math.sqrt(2 * (y0 - apex));
      var b = Math.sqrt(2 * (TRAY - apex));
      var g = Math.pow((a + b) / T, 2);
      var lo = L.hatchW + 60;
      var hi = W - 110;
      var tx = lo + (hi - lo) * s.random();
      s.items.push({
        text: text, mode: 'fly', x: x0, y: y0,
        vx: (tx - x0) / T, vy: -Math.sqrt(2 * g * (y0 - apex)), g: g, spin: 0, t: 0
      });
      s.chef.throwT = 0.35;
      return true;
    }

    /* --- кидок офіціанта ------------------------------------------------ */

    function toss() {
      if (s.state !== 'play') { return; }
      var it = s.waiter.held;
      if (!it) { return; }
      s.waiter.held = null;
      it.mode = 'up';
      it.x = s.waiter.x;
      it.y = TRAY - 20;
      it.vx = 0;
      it.vy = -TOSS_V;
      it.g = TOSS_G;
      s.items.push(it);
    }

    function customerAt(x) {
      for (var i = 0; i < s.perches.length; i++) {
        var c = s.perches[i];
        if (c && (c.mode === 'wait' || c.mode === 'arrive') && Math.abs(c.x - x) < 62) { return c; }
      }
      return null;
    }

    function deliver(it, c) {
      var st = c.steps[c.stepIndex];
      var ok = st.need.indexOf(it.text) !== -1 && st.got.indexOf(it.text) === -1;
      if (ok) {
        st.got.push(it.text);
        it.mode = 'gone';
        burst(c.x, BRANCH - 50, '#e0a526', 10);
        if (st.got.length === st.need.length) {
          c.stepIndex++;
          if (c.stepIndex >= c.steps.length) {
            c.mode = 'eat';
            c.t = 0;
            cb.status(st.fact || (st.label + ' — ' + st.need.join(', ')), 'fact');
          } else {
            c.patience = Math.min(c.max, c.patience + c.max * STEP_REFILL);
            cb.status(st.fact || (st.label + ' — ' + st.need.join(', ')), 'fact');
          }
        } else {
          cb.status('Так: «' + it.text + '» — до «' + st.label + '». Ще '
            + (st.need.length - st.got.length) + ' на шампур.', 'ok');
        }
      } else {
        s.mistakes++;
        c.patience = Math.max(0, c.patience - c.max * REJECT_COST);
        c.shake = 0.5;
        it.mode = 'back';
        it.vy = 160;
        it.g = BACK_G;
        var owner = owners[it.text];
        var already = st.got.indexOf(it.text) !== -1;
        cb.status(already
          ? c.name + ' уже має «' + it.text + '».'
          : '«' + it.text + '» — не до «' + st.label + '»'
            + (owner ? ', а до «' + owner + '».' : '.'), 'bad');
        hud();
      }
      sendOrders(true);
    }

    /* --- іскри ---------------------------------------------------------- */

    function burst(x, y, color, n) {
      if (calm) { return; }
      for (var i = 0; i < n; i++) {
        var a = s.random() * Math.PI * 2;
        var v = 80 + s.random() * 160;
        s.sparks.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
                        life: 0.6, color: color });
      }
    }

    /* --- крок фізики ---------------------------------------------------- */

    function update(dt) {
      if (s.state !== 'play') { return; }
      s.clock += dt;
      s.timeMs += dt * 1000;
      var d = days[s.dayIndex];
      var w = s.waiter;

      // офіціант
      if (keys.left) { w.target = w.x - KEY_SPEED * 0.12; }
      if (keys.right) { w.target = w.x + KEY_SPEED * 0.12; }
      w.target = clamp(w.target, L.hatchW + 30, W - 40);
      var dx = w.target - w.x;
      var stepMax = WAITER_SPEED * dt;
      var move = clamp(dx, -stepMax, stepMax);
      w.x += move;
      w.tilt += (clamp(move / stepMax, -1, 1) * 0.18 - w.tilt) * Math.min(1, dt * 10);

      // поява клієнтів
      s.spawnT -= dt;
      if (s.spawnT <= 0 && s.queue.length) {
        var free = [];
        s.perches.forEach(function (c, i) { if (!c) { free.push(i); } });
        if (free.length) {
          var slot = pick(free, s.random);
          var c = s.queue.shift();
          c.perch = slot;
          c.mode = 'arrive';
          c.t = 0;
          c.x = perchX(slot, s.perches.length);
          s.perches[slot] = c;
          s.spawnT = SPAWN_GAP;
          sendOrders(true);
        }
      }

      // клієнти
      s.perches.forEach(function (c, i) {
        if (!c) { return; }
        c.t += dt;
        if (c.shake > 0) { c.shake -= dt; }
        if (c.mode === 'arrive' && c.t >= ARRIVE_T) { c.mode = 'wait'; c.t = 0; }
        if (c.mode === 'wait') {
          c.patience -= dt;
          if (c.patience <= 0) {
            c.mode = 'leave'; c.t = 0; c.happy = false;
            s.hungry++; s.day.hungry++;
            cb.status(c.name + (/^Пан\s/.test(c.name)
              ? ' не дочекався і пішов голодним.'
              : ' не дочекалася і пішла голодною.'), 'bad');
            hud();
            sendOrders(true);
          }
        }
        if (c.mode === 'eat' && c.t >= EAT_T) {
          c.mode = 'leave'; c.t = 0; c.happy = true;
          s.served++; s.day.served++;
          for (var k = 0; k < c.coins; k++) {
            s.coins.push({ x: c.x + (k ? 26 : 0), y: BRANCH - 20, vy: -120, lying: false, age: 0,
                           value: 1 });
          }
          hud();
          sendOrders(true);
        }
        if (c.mode === 'leave' && c.t >= LEAVE_T) {
          s.perches[i] = null;
          sendOrders(true);
        }
      });

      // кухар
      s.chef.t -= dt;
      if (s.chef.throwT > 0) { s.chef.throwT -= dt; }
      if (s.chef.t <= 0) {
        s.chef.t = chefThrow() ? d.tossEvery : 0.4;
      }

      // інгредієнти
      var need = neededNow();
      s.items.forEach(function (it) {
        if (it.mode === 'gone' || it.mode === 'break') {
          if (it.mode === 'break') { it.t += dt; }
          return;
        }
        it.t += dt;
        it.vy += it.g * dt;
        it.x += it.vx * dt;
        it.y += it.vy * dt;
        it.spin += dt;
        if (it.mode === 'fly' && !w.held && it.vy > 0 && it.y >= TRAY - 24 && it.y <= FLOOR - 16
            && Math.abs(it.x - w.x) < TRAY_HALF + itemSize(it.text).r * 0.5) {
          it.mode = 'held';
          w.held = it;
          return;
        }
        if (it.mode === 'up') {
          if (it.y <= BRANCH - 42) {
            var c = customerAt(it.x);
            if (c) { deliver(it, c); }
            else {
              it.mode = 'back';
              it.vy = 140;
              it.g = BACK_G;
              if (need.indexOf(it.text) === -1) {
                cb.status('Нікому зараз не треба: «' + it.text + '» — викинуто.', 'info');
              }
            }
          }
          return;
        }
        if (it.y >= FLOOR - 10) {
          if (need.indexOf(it.text) !== -1) {
            s.dropped++; s.day.dropped++;
            hud();
          }
          it.mode = 'break';
          it.t = 0;
          it.y = FLOOR - 10;
          burst(it.x, FLOOR - 10, '#9a8f80', 8);
        }
      });
      s.items = s.items.filter(function (it) {
        return it.mode !== 'held' && it.mode !== 'gone' && !(it.mode === 'break' && it.t > 0.5);
      });

      // монети
      s.coins.forEach(function (coin) {
        if (!coin.lying) {
          coin.vy += 900 * dt;
          coin.y += coin.vy * dt;
          if (coin.y >= FLOOR - 12) { coin.y = FLOOR - 12; coin.lying = true; }
        } else {
          coin.age += dt;
        }
        if (coin.lying && Math.abs(coin.x - w.x) < COIN_PICK) {
          coin.taken = true;
          s.money += coin.value; s.day.earned += coin.value;
          burst(coin.x, coin.y, '#f0c419', 6);
          hud();
        }
      });
      s.coins = s.coins.filter(function (coin) { return !coin.taken; });

      // злодій
      updateThief(dt, d);

      // іскри
      s.sparks.forEach(function (p) {
        p.life -= dt; p.vy += 500 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      });
      s.sparks = s.sparks.filter(function (p) { return p.life > 0; });

      sendOrders(false);

      // кінець дня
      var busy = s.queue.length || present().length || s.coins.length || s.thief;
      if (!busy) {
        if (s.endT < 0) { s.endT = 0; }
        s.endT += dt;
        if (s.endT > 0.8) { finishDay(); }
      }
    }

    function updateThief(dt, d) {
      var w = s.waiter;
      var t = s.thief;
      if (!t) {
        var ripe = s.coins.filter(function (c) { return c.lying && c.age >= d.thief; });
        if (!ripe.length) { return; }
        var fromRight = ripe[0].x > W / 2;
        s.thief = t = { x: fromRight ? W + 40 : L.hatchW - 10, dir: fromRight ? -1 : 1,
                        mode: 'go', loot: 0, t: 0, from: fromRight ? W + 40 : -40 };
      }
      t.t += dt;
      if (t.mode === 'go') {
        var targets = s.coins.filter(function (c) { return c.lying; });
        if (!targets.length) { t.mode = 'away'; }
        else {
          targets.sort(function (a, b) { return Math.abs(a.x - t.x) - Math.abs(b.x - t.x); });
          var goal = targets[0];
          t.dir = goal.x > t.x ? 1 : -1;
          t.x += t.dir * THIEF_SPEED * dt;
          if (Math.abs(goal.x - t.x) < 10) {
            goal.taken = true;
            t.loot += goal.value;
            s.stolen += goal.value; s.day.stolen += goal.value;
            cb.status('Злодій поцупив монету. Підбирайте монети швидше — наїдьте на них.', 'bad');
            hud();
            t.mode = 'away';
          }
        }
        if (t.mode === 'go' && Math.abs(t.x - w.x) < THIEF_SCARE) {
          t.mode = 'away';
          cb.status('Злодія прогнано!', 'ok');
        }
      }
      if (t.mode === 'away') {
        t.dir = t.from > W / 2 ? 1 : -1;
        t.x += t.dir * THIEF_SPEED * 1.6 * dt;
        if (t.x > W + 60 || t.x < -60) { s.thief = null; }
      }
    }

    function finishDay() {
      var last = s.dayIndex >= days.length - 1;
      var summary = {
        day: s.dayIndex + 1, days: days.length, served: s.day.served, count: s.day.count,
        hungry: s.day.hungry, dropped: s.day.dropped, stolen: s.day.stolen, earned: s.day.earned
      };
      if (last) {
        setState('over');
        endSession();
        cb.end({ served: s.served, total: s.total, money: s.money, mistakes: s.mistakes,
                 timeMs: s.timeMs, summary: summary });
      } else {
        setState('dayEnd');
        cb.dayEnd(summary);
      }
    }

    function endSession() {
      if (window.HLGAnalytics && s.sessionStarted) {
        HLGAnalytics.endSession({ score: s.served, won: s.served === s.total,
                                  attempts: s.mistakes + 1 });
      }
      s.sessionStarted = false;
    }

    /* --- малювання ------------------------------------------------------ */

    function font(px, bold) {
      return (bold ? 'bold ' : '') + Math.round(px * fs) + 'px "Segoe UI", system-ui, sans-serif';
    }

    function drawBackground(t) {
      var dark = isDark();
      var sky = ctx.createLinearGradient(0, 0, 0, H);
      sky.addColorStop(0, dark ? '#1b2436' : '#cfe8f3');
      sky.addColorStop(0.7, dark ? '#24324a' : '#eef6e8');
      sky.addColorStop(1, dark ? '#2b3a2e' : '#dcebc8');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // далекі пагорби
      ctx.fillStyle = dark ? '#2c4034' : '#c4dfb0';
      ctx.beginPath();
      ctx.moveTo(0, FLOOR - 70);
      for (var x = 0; x <= W; x += 40) {
        ctx.lineTo(x, FLOOR - 70 - 22 * Math.sin(x / 130) - 12 * Math.sin(x / 47));
      }
      ctx.lineTo(W, FLOOR); ctx.lineTo(0, FLOOR); ctx.closePath(); ctx.fill();

      // стовбур праворуч і гілка через усю сцену
      ctx.fillStyle = dark ? '#5a4632' : '#8a6a48';
      ctx.fillRect(W - 46, BRANCH - 60, 40, FLOOR - BRANCH + 60);
      ctx.strokeStyle = dark ? '#5a4632' : '#8a6a48';
      ctx.lineCap = 'round';
      ctx.lineWidth = 16;
      ctx.beginPath();
      ctx.moveTo(L.hatchW - 10, BRANCH + 6);
      ctx.quadraticCurveTo(W / 2, BRANCH - 8, W - 30, BRANCH - 20);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.strokeStyle = dark ? '#3c2f22' : '#5e4630';
      ctx.stroke();
      // листя
      ctx.fillStyle = dark ? '#355a3c' : '#7fb069';
      for (var k = 0; k < 9; k++) {
        var lx = L.hatchW + (W - L.hatchW) * (k + 0.3) / 9;
        var ly = BRANCH - 4 - 10 * Math.sin(k * 1.7);
        ctx.beginPath();
        ctx.ellipse(lx, ly + 14, 14, 7, 0.6 * Math.sin(k), 0, Math.PI * 2);
        ctx.fill();
      }

      // підлога кафе
      ctx.fillStyle = dark ? '#3a3028' : '#e4d3b4';
      ctx.fillRect(0, FLOOR, W, H - FLOOR);
      ctx.strokeStyle = dark ? '#cdd3de' : '#14110f';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, FLOOR); ctx.lineTo(W, FLOOR); ctx.stroke();

      // кухня: будка з віконцем
      var hx = 6, hy = FLOOR - 230, hw = L.hatchW - 12, hh = 230;
      ctx.fillStyle = dark ? '#4a3b4f' : '#f3d9c6';
      roundRect(ctx, hx, hy, hw, hh, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = dark ? '#c1554a' : '#c1554a';
      ctx.beginPath();
      ctx.moveTo(hx - 4, hy + 6); ctx.lineTo(hx + hw / 2, hy - 30); ctx.lineTo(hx + hw + 4, hy + 6);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = dark ? '#cdd3de' : '#14110f';
      ctx.font = font(13, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('КУХНЯ', hx + hw / 2, hy + 20);
      ctx.fillStyle = dark ? '#1f1a22' : '#fff8ee';
      roundRect(ctx, hx + 10, hy + 40, hw - 20, 100, 8); ctx.fill(); ctx.stroke();
      drawChef(hx + hw / 2, hy + 140, t);

      // каса праворуч
      var kx = W - 104, ky = FLOOR - 58;
      ctx.fillStyle = dark ? '#3f5160' : '#bfd9e2';
      roundRect(ctx, kx, ky, 56, 58, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = dark ? '#cdd3de' : '#14110f';
      ctx.font = font(12, true);
      ctx.fillText('КАСА', kx + 28, ky + 14);
      ctx.font = font(16, true);
      ctx.fillText('₴ ' + s.money, kx + 28, ky + 38);
    }

    function drawChef(cx, by, t) {
      var lift = s.chef.throwT > 0 ? 1 : 0;
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#14110f';
      // тулуб
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, cx - 20, by - 40, 40, 40, 10); ctx.fill(); ctx.stroke();
      // голова
      ctx.fillStyle = '#f2c9a0';
      ctx.beginPath(); ctx.arc(cx, by - 52, 15, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // ковпак
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, cx - 13, by - 82, 26, 20, 6); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx - 8, by - 82, 8, 0, Math.PI * 2); ctx.arc(cx + 8, by - 82, 8, 0, Math.PI * 2);
      ctx.fill();
      // очі й вуса
      ctx.fillStyle = '#14110f';
      ctx.beginPath(); ctx.arc(cx - 5, by - 54, 1.8, 0, Math.PI * 2); ctx.arc(cx + 5, by - 54, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - 7, by - 46); ctx.quadraticCurveTo(cx, by - 41, cx + 7, by - 46); ctx.stroke();
      // рука: піднята, коли кидає
      ctx.beginPath();
      ctx.moveTo(cx + 18, by - 30);
      if (lift) { ctx.lineTo(cx + 34, by - 64); } else { ctx.lineTo(cx + 30, by - 14); }
      ctx.lineWidth = 6; ctx.strokeStyle = '#ffffff'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#14110f'; ctx.stroke();
      ctx.restore();
    }

    function drawCrow(c, t) {
      var x = c.x;
      var baseY = BRANCH - 2;
      var y = baseY;
      var alpha = 1;
      if (c.mode === 'arrive') {
        var k = clamp(c.t / ARRIVE_T, 0, 1);
        y = baseY - (1 - k) * (BRANCH + 60);
      } else if (c.mode === 'leave') {
        var q = clamp(c.t / LEAVE_T, 0, 1);
        y = baseY - q * (BRANCH + 80);
        x += (c.happy ? 1 : -1) * q * 120;
        alpha = 1 - q * 0.3;
      }
      if (c.shake > 0 && !calm) { x += Math.sin(c.shake * 60) * 4; }
      var flap = (c.mode === 'arrive' || c.mode === 'leave' || c.mode === 'eat') && !calm
        ? Math.sin(t * 22) : 0;
      var bob = (c.mode === 'wait' && !calm) ? Math.sin(t * 2 + c.perch) * 1.5 : 0;
      c.y = y;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(x, y + bob);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#14110f';
      // лапки
      ctx.beginPath(); ctx.moveTo(-8, -6); ctx.lineTo(-10, 2); ctx.moveTo(8, -6); ctx.lineTo(10, 2); ctx.stroke();
      // тулуб
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath(); ctx.ellipse(0, -34, 26, 30, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // крила
      ctx.fillStyle = '#3b3b48';
      ctx.beginPath(); ctx.ellipse(-24, -36 - flap * 10, 9, 20, -0.4 - flap * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(24, -36 - flap * 10, 9, 20, 0.4 + flap * 0.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // шарф
      ctx.fillStyle = c.scarf;
      roundRect(ctx, -20, -52, 40, 9, 4); ctx.fill(); ctx.stroke();
      // голова
      ctx.fillStyle = '#2a2a33';
      ctx.beginPath(); ctx.arc(0, -66, 17, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      // дзьоб
      ctx.fillStyle = '#e8a33a';
      ctx.beginPath();
      if (c.mode === 'eat') {
        ctx.moveTo(8, -70); ctx.lineTo(30, -72); ctx.lineTo(10, -66);
        ctx.moveTo(8, -64); ctx.lineTo(28, -58); ctx.lineTo(10, -62);
      } else {
        ctx.moveTo(10, -70); ctx.lineTo(32, -64); ctx.lineTo(10, -60);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      // око
      var angry = c.mode === 'wait' && c.patience / c.max < 0.3;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(5, -70, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#14110f';
      ctx.beginPath(); ctx.arc(6.5, -70, 2.4, 0, Math.PI * 2); ctx.fill();
      if (angry) {
        ctx.beginPath(); ctx.moveTo(-2, -79); ctx.lineTo(12, -74); ctx.lineWidth = 3; ctx.stroke();
      }
      ctx.restore();
    }

    function drawCloud(c, t) {
      if (c.mode !== 'wait' && c.mode !== 'arrive') { return; }
      var f = clamp(c.patience / c.max, 0, 1);
      var x = c.x - 52, y = c.y - 92;
      var col = f > 0.6 ? '#ffffff' : (f > 0.3 ? '#b9bec7' : '#5b6170');
      ctx.save();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#14110f';
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x - 10, y, 10, 0, Math.PI * 2);
      ctx.arc(x + 2, y - 6, 12, 0, Math.PI * 2);
      ctx.arc(x + 14, y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.fillRect(x - 12, y - 2, 28, 10);
      if (f <= 0.3 && (calm || Math.sin(t * 9) > -0.2)) {
        ctx.fillStyle = '#f6d32d';
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 6); ctx.lineTo(x - 4, y + 18); ctx.lineTo(x + 2, y + 17);
        ctx.lineTo(x - 2, y + 28); ctx.lineTo(x + 9, y + 13); ctx.lineTo(x + 3, y + 14); ctx.lineTo(x + 7, y + 6);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    /* Табличка із замовленням + шампур. Ширина — частка простору на місце. */
    function drawSign(c) {
      if (c.mode === 'leave') { return; }
      var st = c.steps[Math.min(c.stepIndex, c.steps.length - 1)];
      var n = s.perches.length;
      var span = (W - L.hatchW - 80) / n;
      var w = Math.min(250, span - 16);
      var pad = 8;
      ctx.save();
      ctx.font = font(15, true);
      var label = (st.emoji ? st.emoji + ' ' : '') + st.label;
      var lines = wrap(ctx, label, w - pad * 2);
      var lh = Math.round(18 * fs);
      var nameH = Math.round(16 * fs);
      var h = pad + nameH + lines.length * lh + 30 + pad;
      var x = clamp(c.x - w / 2, L.hatchW, W - w - 6);
      var bottom = BRANCH - 128;
      var y = bottom - h;
      if (y < 6) { y = 6; }
      if (c.mode === 'arrive') { ctx.globalAlpha = clamp(c.t / ARRIVE_T, 0, 1); }
      var dark = isDark();
      ctx.fillStyle = dark ? '#161b26' : '#fffdf6';
      ctx.strokeStyle = dark ? '#cdd3de' : '#14110f';
      ctx.lineWidth = 2;
      roundRect(ctx, x, y, w, h, 10); ctx.fill(); ctx.stroke();
      // колір рецепта — той самий, що в «Книзі рецептів» на сторінці
      if (st.color) {
        ctx.save();
        roundRect(ctx, x, y, w, h, 10); ctx.clip();
        ctx.fillStyle = st.color;
        ctx.fillRect(x, y, 8, h);
        ctx.restore();
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, w, h, 10); ctx.stroke();
      }
      // хвостик до ворони
      ctx.beginPath();
      ctx.moveTo(clamp(c.x, x + 14, x + w - 14) - 8, y + h);
      ctx.lineTo(clamp(c.x, x + 14, x + w - 14), y + h + 12);
      ctx.lineTo(clamp(c.x, x + 14, x + w - 14) + 8, y + h);
      ctx.fill(); ctx.stroke();

      ctx.fillStyle = c.scarf;
      ctx.fillRect(x + pad, y + pad + 3, 10, 10);
      ctx.fillStyle = dark ? '#a7b0c0' : '#4a4f58';
      ctx.font = font(12, false);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(c.name + (c.trait === 'hurry' ? ' · поспішає' : c.trait === 'calm' ? ' · терпляча душа'
        : c.trait === 'generous' ? ' · щедра душа' : ''), x + pad + 16, y + pad + 1);
      ctx.fillStyle = dark ? '#e9edf5' : '#1a1a1a';
      ctx.font = font(15, true);
      lines.forEach(function (ln, i) { ctx.fillText(ln, x + pad, y + pad + nameH + i * lh); });

      // шампур: усі шматки всіх кроків
      var pieces = [];
      c.steps.forEach(function (stp) {
        stp.need.forEach(function (nd) { pieces.push(stp.got.indexOf(nd) !== -1); });
      });
      var sy = y + h - pad - 11;
      ctx.strokeStyle = dark ? '#a7b0c0' : '#6b5a44';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x + pad, sy); ctx.lineTo(x + w - pad, sy); ctx.stroke();
      var step = Math.min(30, (w - pad * 2 - 20) / Math.max(1, pieces.length));
      pieces.forEach(function (got, i) {
        var px = x + pad + 18 + i * step;
        ctx.beginPath(); ctx.arc(px, sy, 9, 0, Math.PI * 2);
        ctx.fillStyle = got ? '#e0a526' : (dark ? '#161b26' : '#fffdf6');
        ctx.fill();
        ctx.lineWidth = 2; ctx.strokeStyle = dark ? '#cdd3de' : '#14110f'; ctx.stroke();
      });
      ctx.restore();
    }

    /* Інгредієнт — кругла «тарілочка»: радіус підбирається так, щоб прямокутник
       тексту вписався в коло. Розмір кешується за текстом і масштабом шрифту —
       measureText щокадру для кожного інгредієнта ні до чого. */
    var sizeCache = {};
    function itemSize(text) {
      var key = fs + '|' + text;
      if (sizeCache[key]) { return sizeCache[key]; }
      ctx.save();
      ctx.font = font(14, true);
      var lines = wrap(ctx, String(text).replace(/ (рр?\.)/g, ' $1'), L.card);
      var wmax = 0;
      lines.forEach(function (ln) { wmax = Math.max(wmax, ctx.measureText(ln).width); });
      ctx.restore();
      var lh = Math.round(16 * fs);
      var h = lines.length * lh;
      var r = Math.max(34, Math.ceil(Math.sqrt(wmax * wmax / 4 + h * h / 4)) + 8);
      sizeCache[key] = { lines: lines, r: r, lh: lh, h: h };
      return sizeCache[key];
    }

    function drawItem(it, x, y, rot) {
      var m = itemSize(it.text);
      ctx.save();
      ctx.translate(x, y);
      if (it.mode === 'break') { ctx.globalAlpha = clamp(1 - it.t / 0.5, 0, 1); }
      var fill = ctx.createRadialGradient(-m.r * 0.35, -m.r * 0.4, m.r * 0.1, 0, 0, m.r);
      fill.addColorStop(0, '#fffaf0');
      fill.addColorStop(0.75, '#ffe9b3');
      fill.addColorStop(1, '#f2cf7a');
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#14110f';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, m.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(20, 17, 15, 0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, m.r - 6, 0, Math.PI * 2); ctx.stroke();
      if (rot && !calm) { ctx.rotate(rot); }
      ctx.fillStyle = '#1a1a1a';
      ctx.font = font(14, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      m.lines.forEach(function (ln, i) {
        ctx.fillText(ln, 0, -m.h / 2 + m.lh / 2 + i * m.lh);
      });
      ctx.restore();
    }

    function drawWaiter(t) {
      var w = s.waiter;
      ctx.save();
      ctx.translate(w.x, FLOOR - 4);
      ctx.rotate(calm ? 0 : w.tilt);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#14110f';
      // скейт
      ctx.fillStyle = '#c1554a';
      roundRect(ctx, -34, -12, 68, 8, 4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#14110f';
      ctx.beginPath(); ctx.arc(-22, -2, 5, 0, Math.PI * 2); ctx.arc(22, -2, 5, 0, Math.PI * 2); ctx.fill();
      // ноги
      ctx.strokeStyle = '#1d3d5c'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(-8, -14); ctx.lineTo(-10, -40); ctx.moveTo(8, -14); ctx.lineTo(10, -40); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#14110f';
      // тулуб і фартух
      ctx.fillStyle = '#f7f3ea';
      roundRect(ctx, -18, -76, 36, 40, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d7a8c';
      roundRect(ctx, -12, -62, 24, 26, 4); ctx.fill(); ctx.stroke();
      // руки вгору до таці
      ctx.strokeStyle = '#f2c9a0'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(-16, -70); ctx.lineTo(-30, -96); ctx.moveTo(16, -70); ctx.lineTo(30, -96); ctx.stroke();
      ctx.lineWidth = 2; ctx.strokeStyle = '#14110f';
      // голова й кепка
      ctx.fillStyle = '#f2c9a0';
      ctx.beginPath(); ctx.arc(0, -86, 13, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1d7a8c';
      ctx.beginPath(); ctx.arc(0, -90, 13, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillRect(0, -92, 18, 4);
      // таця
      ctx.fillStyle = '#c9ccd2';
      roundRect(ctx, -TRAY_HALF, -102, TRAY_HALF * 2, 7, 3); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (w.held) {
        var m = itemSize(w.held.text);
        drawItem(w.held, w.x, TRAY - m.r + 4, 0);
      }
    }

    function drawCoin(coin, t) {
      ctx.save();
      ctx.translate(coin.x, coin.y);
      var pulse = coin.lying && !calm ? 1 + 0.08 * Math.sin(t * 8) : 1;
      ctx.scale(pulse, pulse);
      ctx.fillStyle = '#f0c419';
      ctx.strokeStyle = '#8a5310';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#8a5310';
      ctx.font = font(13, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('₴', 0, 1);
      ctx.restore();
    }

    function drawThief(t) {
      var th = s.thief;
      if (!th) { return; }
      var stepY = calm ? 0 : Math.abs(Math.sin(t * 14)) * 4;
      ctx.save();
      ctx.translate(th.x, FLOOR - stepY);
      ctx.scale(th.dir, 1);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#14110f';
      ctx.fillStyle = '#7a7f8a';
      roundRect(ctx, -16, -58, 32, 46, 10); ctx.fill(); ctx.stroke();
      // смугастий хвіст (єнот)
      ctx.fillStyle = '#5a5f6a';
      ctx.beginPath(); ctx.ellipse(-24, -28, 14, 6, -0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#9a9faa';
      ctx.beginPath(); ctx.arc(4, -70, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#14110f';
      roundRect(ctx, -6, -76, 24, 8, 3); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(9, -72, 2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#14110f'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-10, 0); ctx.moveTo(6, -12); ctx.lineTo(10, 0); ctx.stroke();
      if (th.loot) {
        ctx.fillStyle = '#c8b28a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(-14, -50, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      ctx.restore();
    }

    function draw() {
      if (!s) { return; }
      var t = s.clock;
      ctx.save();
      drawBackground(t);
      s.perches.forEach(function (c) { if (c) { drawCrow(c, t); } });
      s.perches.forEach(function (c) { if (c) { drawCloud(c, t); drawSign(c); } });
      s.coins.forEach(function (coin) { drawCoin(coin, t); });
      drawThief(t);
      drawWaiter(t);
      s.items.forEach(function (it) {
        drawItem(it, it.x, it.y, it.mode === 'fly' ? Math.sin(it.spin * 3) * 0.12 : 0);
      });
      s.sparks.forEach(function (p) {
        ctx.globalAlpha = clamp(p.life / 0.6, 0, 1);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
      });
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    /* --- цикл ----------------------------------------------------------- */

    function frame(now) {
      raf = 0;
      if (destroyed) { return; }
      var dt = last ? Math.min(MAX_FRAME, (now - last) / 1000) : 0;
      last = now;
      acc += dt;
      while (acc >= STEP) { update(STEP); acc -= STEP; }
      draw();
      if (s.state === 'play') { raf = requestAnimationFrame(frame); }
    }

    function loop() {
      if (!raf && !destroyed) { last = 0; acc = 0; raf = requestAnimationFrame(frame); }
    }

    /* --- введення ------------------------------------------------------- */

    function logicalX(ev) {
      var rect = canvas.getBoundingClientRect();
      return (ev.clientX - rect.left) * W / rect.width;
    }

    var down = null;
    function onPointerMove(ev) {
      if (!s || s.state !== 'play') { return; }
      if (ev.pointerType === 'mouse' || down) { s.waiter.target = logicalX(ev); }
      if (down && Math.abs(ev.clientX - down.x) > 10) { down.moved = true; }
    }
    function onPointerDown(ev) {
      if (!s || s.state !== 'play') { return; }
      down = { x: ev.clientX, moved: false, type: ev.pointerType };
      if (ev.pointerType !== 'mouse') { s.waiter.target = logicalX(ev); }
    }
    function onPointerUp() {
      if (!down) { return; }
      var tap = !down.moved;
      down = null;
      if (tap) { toss(); }
    }

    function onKey(ev, isDown) {
      var k = ev.key;
      if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'ф' || k === 'Ф') { keys.left = isDown; ev.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'в' || k === 'В') { keys.right = isDown; ev.preventDefault(); }
      else if (isDown && (k === ' ' || k === 'ArrowUp' || k === 'w' || k === 'W' || k === 'ц' || k === 'Ц')) {
        if (s && s.state === 'play') { ev.preventDefault(); toss(); }
      } else if (isDown && (k === 'p' || k === 'P' || k === 'з' || k === 'З' || k === 'Escape')) {
        if (s && s.state === 'play') { api.pause(); }
        else if (s && s.state === 'paused') { api.resume(); }
      }
    }
    function onKeyDown(ev) {
      var tag = ev.target && ev.target.tagName;
      if (tag === 'BUTTON' || tag === 'A' || tag === 'INPUT') {
        if (ev.key === ' ' || ev.key === 'Enter') { return; }
      }
      onKey(ev, true);
    }
    function onKeyUp(ev) { onKey(ev, false); }
    function onVisibility() { if (document.hidden && s && s.state === 'play') { api.pause(); } }
    var resizeTimer = 0;
    function onResize() {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 80);
    }

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    canvas.style.touchAction = 'none';

    /* --- API ------------------------------------------------------------ */

    var api = {
      start: function () {
        if (s.state !== 'ready') { return; }
        if (window.HLGAnalytics && !s.sessionStarted) {
          s.sessionStarted = true;
          HLGAnalytics.startSession(config.moduleId || 'kafe-na-hiltsi');
        }
        beginDay(0);
        setState('play');
        loop();
      },
      pause: function () {
        if (s.state !== 'play') { return; }
        setState('paused');
        keys.left = keys.right = false;
        draw();
      },
      resume: function () {
        if (s.state !== 'paused') { return; }
        setState('play');
        loop();
      },
      nextDay: function () {
        if (s.state !== 'dayEnd') { return; }
        beginDay(s.dayIndex + 1);
        setState('play');
        loop();
      },
      restart: function () {
        if (s && s.sessionStarted) { endSession(); }
        setLayout();
        s = fresh();
        resize();
        hud();
        sendOrders(true);
        setState('ready');
      },
      state: function () { return s.state; },
      destroy: function () {
        destroyed = true;
        if (raf) { cancelAnimationFrame(raf); }
        canvas.removeEventListener('pointermove', onPointerMove);
        canvas.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointerup', onPointerUp);
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('visibilitychange', onVisibility);
      },
      /* Стенд. step() женe фізику без rAF; snapshot() — що на полі;
         aim(x) ставить офіціанта; toss() — кидок. */
      debug: {
        step: function (sec) {
          var n = Math.round(sec / STEP);
          for (var i = 0; i < n && s.state === 'play'; i++) { update(STEP); }
          draw();
        },
        snapshot: function () {
          return {
            state: s.state, day: s.dayIndex + 1, waiter: s.waiter.x,
            held: s.waiter.held ? s.waiter.held.text : null,
            items: s.items.map(function (it) { return { text: it.text, mode: it.mode, x: Math.round(it.x), y: Math.round(it.y) }; }),
            customers: s.perches.map(function (c) {
              if (!c) { return null; }
              var st = c.steps[Math.min(c.stepIndex, c.steps.length - 1)];
              return { name: c.name, x: c.x, mode: c.mode, patience: +(c.patience / c.max).toFixed(2),
                       need: st.need.filter(function (n) { return st.got.indexOf(n) === -1; }) };
            }),
            coins: s.coins.map(function (c) { return { x: Math.round(c.x), lying: c.lying }; }),
            thief: s.thief ? { x: Math.round(s.thief.x), mode: s.thief.mode } : null,
            served: s.served, money: s.money, hungry: s.hungry, dropped: s.dropped,
            stolen: s.stolen, mistakes: s.mistakes, W: W, H: H
          };
        },
        aim: function (x) { s.waiter.target = x; s.waiter.x = x; },
        toss: function () { toss(); }
      }
    };

    setLayout();
    s = fresh();
    resize();
    hud();
    setState('ready');
    return api;
  }

  window.KafeNaHiltsi = { init: init };
})();
