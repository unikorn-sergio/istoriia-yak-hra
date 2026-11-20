/*
 * PanZoom — вільне переміщення й масштаб зображення всередині рамки.
 *
 * Навіщо: у «Детективі Кромвелі» камера їде сама — клік по точці запускає
 * наїзд до одного з чотирьох квадрантів мапи, а перетягування там почато й не
 * доведено (Робоча30/_зразки/README.md, розділ «Кромвель»). Тут навпаки:
 * рухає користувач, а наїзд лишається як допоміжна дія (setView з animate).
 *
 * Що вміє:
 *   миша       — тягнути лівою кнопкою, коліщатко — масштаб довкола курсора;
 *   палець     — тягнути одним, масштабувати двома (щипок);
 *   клавіатура — стрілки, + і −, 0 — уся картина, Enter — «клік» у центрі рамки;
 *   onTap      — клік БЕЗ перетягування, у координатах картини (px оригіналу).
 *
 * Клік і перетягування розділяє поріг TAP_SLOP: зсув більший за нього — це
 * вже перетягування, і onTap не прийде. Для гри у відмінності це несуче:
 * інакше кожне відпускання миші після руху рахувалося б як хибна спроба.
 *
 * Межі: картина, менша за рамку в якомусь вимірі, стоїть по центру в ньому,
 * більша — не відривається від країв. Тому, поки картина нижча за рамку,
 * точка під курсором при масштабуванні зсувається по вертикалі (центрування
 * сильніше за «якір»); щойно картина заповнила рамку, точка стоїть точно.
 * Хочете без порожніх смуг — дайте рамці пропорції картини.
 *
 * Координати: екран = картина * s + t. View описується масштабом відносно
 * «вся картина в рамці» (zoom = 1) і точкою картини в центрі рамки (cx, cy),
 * тому дві рамки різного розміру показують одне й те саме місце (link).
 *
 * Приклад:
 *
 *   var left = PanZoom.create({
 *     viewport: document.getElementById('viewLeft'),   // рамка, overflow: hidden
 *     content:  document.getElementById('sceneLeft'),  // те, що рухається: <img> + <svg>
 *     width: 1200, height: 900,                        // природний розмір картини, px
 *     maxZoom: 6,                                      // необов'язково, типово 6
 *     onTap: function (x, y, how) { ... },             // how: 'pointer' | 'key'
 *     onChange: function (view) { ... }                // {zoom, cx, cy, scale}
 *   });
 *   var right = PanZoom.create({ ... });
 *   PanZoom.link([left, right]);                       // рухаються разом
 *
 *   left.zoomBy(1.25);                                 // довкола центру рамки
 *   left.fit();                                        // уся картина
 *   left.setView({ zoom: 3, cx: 610, cy: 235 }, { animate: true });  // наїзд
 *   left.getView();                                    // {zoom, cx, cy, scale}
 *   left.destroy();
 *
 * Без бібліотек, без модулів: працює з file://. Анімацію наїзду вимикає
 * .reduce-motion на <html> або prefers-reduced-motion.
 */
(function () {
  'use strict';

  var TAP_SLOP = 6;        // px екрана
  var WHEEL_K = 0.0015;    // чутливість коліщатка
  var KEY_STEP = 48;       // px екрана за натискання стрілки
  var KEY_ZOOM = 1.25;
  var ANIM_MS = 320;

  function reduceMotion() {
    if (document.documentElement.classList.contains('reduce-motion')) { return true; }
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function create(opts) {
    var vp = opts.viewport;
    var ct = opts.content;
    var W = opts.width;
    var H = opts.height;
    var maxZoom = opts.maxZoom || 6;

    var s = 1, tx = 0, ty = 0;      // поточне перетворення
    var fitScale = 1;
    var vw = 0, vh = 0;
    var pointers = {};              // pointerId -> {x, y}
    var count = 0;
    var g = null;                   // поточний жест
    var animId = 0;
    var linked = [];                // слухачі для link(), лише на «не тихі» зміни
    var off = [];                   // зняття обробників у destroy()

    ct.style.transformOrigin = '0 0';
    ct.style.width = W + 'px';
    ct.style.height = H + 'px';
    vp.style.touchAction = 'none';

    function measure() {
      vw = vp.clientWidth;
      vh = vp.clientHeight;
      fitScale = Math.min(vw / W, vh / H) || 1;
    }

    /* Тримаємо картину в рамці: менша за рамку — по центру, більша — без порожніх країв. */
    function constrain() {
      s = clamp(s, fitScale, fitScale * maxZoom);
      var cw = W * s, ch = H * s;
      tx = cw <= vw ? (vw - cw) / 2 : clamp(tx, vw - cw, 0);
      ty = ch <= vh ? (vh - ch) / 2 : clamp(ty, vh - ch, 0);
    }

    function view() {
      return { zoom: s / fitScale, cx: (vw / 2 - tx) / s, cy: (vh / 2 - ty) / s, scale: s };
    }

    function apply(silent) {
      constrain();
      ct.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
      var v = view();
      if (opts.onChange) { opts.onChange(v); }
      if (!silent) {
        for (var i = 0; i < linked.length; i++) { linked[i](v); }
      }
    }

    function stopAnim() {
      if (animId) { cancelAnimationFrame(animId); animId = 0; }
    }

    function place(zoom, cx, cy) {
      s = fitScale * clamp(zoom, 1, maxZoom);
      tx = vw / 2 - cx * s;
      ty = vh / 2 - cy * s;
    }

    function setView(v, o) {
      o = o || {};
      stopAnim();
      var to = { zoom: v.zoom == null ? s / fitScale : v.zoom,
                 cx: v.cx == null ? view().cx : v.cx,
                 cy: v.cy == null ? view().cy : v.cy };
      if (!o.animate || reduceMotion()) {
        place(to.zoom, to.cx, to.cy);
        apply(o.silent);
        return;
      }
      var from = view();
      var t0 = 0;
      function step(now) {
        if (!t0) { t0 = now; }
        var k = Math.min(1, (now - t0) / ANIM_MS);
        var e = 1 - Math.pow(1 - k, 3);
        place(from.zoom + (to.zoom - from.zoom) * e,
              from.cx + (to.cx - from.cx) * e,
              from.cy + (to.cy - from.cy) * e);
        apply(o.silent);
        animId = k < 1 ? requestAnimationFrame(step) : 0;
      }
      animId = requestAnimationFrame(step);
    }

    /* Масштаб довкола точки рамки (px): точка картини під нею лишається на місці. */
    function zoomAt(factor, px, py) {
      var ix = (px - tx) / s, iy = (py - ty) / s;
      s = clamp(s * factor, fitScale, fitScale * maxZoom);
      tx = px - ix * s;
      ty = py - iy * s;
      apply();
    }

    function local(ev) {
      var r = vp.getBoundingClientRect();
      return { x: ev.clientX - r.left - vp.clientLeft, y: ev.clientY - r.top - vp.clientTop };
    }

    function firstTwo() {
      var out = [];
      for (var id in pointers) {
        if (Object.prototype.hasOwnProperty.call(pointers, id)) { out.push(pointers[id]); }
        if (out.length === 2) { break; }
      }
      return out;
    }

    function pinchState() {
      var p = firstTwo();
      return { dist: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y) || 1,
               mx: (p[0].x + p[1].x) / 2, my: (p[0].y + p[1].y) / 2 };
    }

    function on(el, type, fn, o) {
      el.addEventListener(type, fn, o || false);
      off.push(function () { el.removeEventListener(type, fn, o || false); });
    }

    on(vp, 'pointerdown', function (ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) { return; }
      stopAnim();
      try { vp.setPointerCapture(ev.pointerId); } catch (e) { /* старий браузер — жест однаково працює */ }
      var p = local(ev);
      pointers[ev.pointerId] = p;
      count += 1;
      if (count === 1) {
        g = { x0: p.x, y0: p.y, lx: p.x, ly: p.y, moved: false, multi: false };
      } else if (g) {
        g.multi = true;
        g.pinch = pinchState();
      }
    });

    on(vp, 'pointermove', function (ev) {
      if (!pointers[ev.pointerId] || !g) { return; }
      var p = local(ev);
      pointers[ev.pointerId] = p;
      if (count >= 2) {
        var now = pinchState();
        var was = g.pinch || now;
        var ix = (was.mx - tx) / s, iy = (was.my - ty) / s;
        s = clamp(s * now.dist / was.dist, fitScale, fitScale * maxZoom);
        tx = now.mx - ix * s;
        ty = now.my - iy * s;
        g.pinch = now;
        apply();
        return;
      }
      if (!g.moved && Math.hypot(p.x - g.x0, p.y - g.y0) > TAP_SLOP) {
        g.moved = true;
        vp.classList.add('is-dragging');
        g.lx = g.x0; g.ly = g.y0;            // перший зсув — від точки натискання, без ривка
      }
      if (g.moved) {
        tx += p.x - g.lx;
        ty += p.y - g.ly;
        apply();
      }
      g.lx = p.x; g.ly = p.y;
    });

    function release(ev, canTap) {
      if (!pointers[ev.pointerId]) { return; }
      delete pointers[ev.pointerId];
      count -= 1;
      if (count > 0) {
        if (g && count === 1) {             // після щипка лишився один палець: тягнемо ним далі
          var rest = firstTwo()[0];
          g.lx = rest.x; g.ly = rest.y; g.moved = true; g.pinch = null;
        } else if (g) {
          g.pinch = pinchState();
        }
        return;
      }
      count = 0;
      var tap = canTap && g && !g.moved && !g.multi;
      var at = g;
      g = null;
      vp.classList.remove('is-dragging');
      if (tap && opts.onTap) {
        opts.onTap((at.x0 - tx) / s, (at.y0 - ty) / s, 'pointer');
      }
    }
    on(vp, 'pointerup', function (ev) { release(ev, true); });
    on(vp, 'pointercancel', function (ev) { release(ev, false); });
    on(vp, 'lostpointercapture', function (ev) { release(ev, false); });

    on(vp, 'wheel', function (ev) {
      ev.preventDefault();
      stopAnim();
      var unit = ev.deltaMode === 1 ? 16 : (ev.deltaMode === 2 ? vh : 1);
      var p = local(ev);
      zoomAt(Math.exp(-ev.deltaY * unit * WHEEL_K), p.x, p.y);
    }, { passive: false });

    /* Рідний drag зображення («привид» картинки) інакше перехоплює жест у Firefox і Chrome. */
    on(vp, 'dragstart', function (ev) { ev.preventDefault(); });

    on(vp, 'keydown', function (ev) {
      var k = ev.key;
      var done = true;
      if (k === 'ArrowLeft') { tx += KEY_STEP; apply(); }
      else if (k === 'ArrowRight') { tx -= KEY_STEP; apply(); }
      else if (k === 'ArrowUp') { ty += KEY_STEP; apply(); }
      else if (k === 'ArrowDown') { ty -= KEY_STEP; apply(); }
      else if (k === '+' || k === '=') { zoomAt(KEY_ZOOM, vw / 2, vh / 2); }
      else if (k === '-' || k === '_') { zoomAt(1 / KEY_ZOOM, vw / 2, vh / 2); }
      else if (k === '0') { setView({ zoom: 1, cx: W / 2, cy: H / 2 }); }
      else if (k === 'Enter' || k === ' ') {
        var v = view();
        if (opts.onTap) { opts.onTap(v.cx, v.cy, 'key'); }
      } else { done = false; }
      if (done) { ev.preventDefault(); stopAnim(); }
    });

    function onResize() {
      var v = vw ? view() : { zoom: 1, cx: W / 2, cy: H / 2 };
      measure();
      place(v.zoom, v.cx, v.cy);
      apply(true);
    }
    if (window.ResizeObserver) {
      var ro = new ResizeObserver(onResize);
      ro.observe(vp);
      off.push(function () { ro.disconnect(); });
    } else {
      on(window, 'resize', onResize);
    }

    measure();
    place(1, W / 2, H / 2);
    apply(true);

    return {
      setView: setView,
      getView: view,
      fit: function (o) { setView({ zoom: 1, cx: W / 2, cy: H / 2 }, o); },
      zoomBy: function (f) { stopAnim(); zoomAt(f, vw / 2, vh / 2); },
      toImage: function (clientX, clientY) {
        var p = local({ clientX: clientX, clientY: clientY });
        return { x: (p.x - tx) / s, y: (p.y - ty) / s };
      },
      _listen: function (fn) { linked.push(fn); },
      destroy: function () {
        stopAnim();
        while (off.length) { off.pop()(); }
        linked = [];
      }
    };
  }

  /* Зв'язує кілька рамок: рух однієї повторюють інші (тихо, без зворотного відлуння). */
  function link(list) {
    list.forEach(function (a) {
      a._listen(function (v) {
        list.forEach(function (b) {
          if (b !== a) { b.setView({ zoom: v.zoom, cx: v.cx, cy: v.cy }, { silent: true }); }
        });
      });
    });
  }

  window.PanZoom = { create: create, link: link };
})();
