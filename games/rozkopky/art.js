/* games/rozkopky/art.js — window.RozkopkyArt: власні малюнки знахідок.

   Навіщо малювати, а не брати фото: фото в оригіналі «Розкопок» були
   невідомого походження (і одне — пам'ятна монета замість пекторалі), а
   платформа йде в публічну версію лише з тим, що не має чужого авторського
   права. Малюнок умовний, але впізнаваний за ОЗНАКОЮ, яку перевіряє НМТ:
   спіраль трипільської кераміки, півмісяць пекторалі, ручки амфори.

   Усе будується createElementNS — без innerHTML (CLAUDE.md, правило 4).

     var svg = RozkopkyArt.draw('pectoral', 'Золота пектораль');
     cell.appendChild(svg);

   Невідомий ключ дає видиму заглушку з назвою ключа, а не порожнечу — та
   сама ідея, що в AssetValidator (export.md).
*/
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  var C = {
    ink: '#2b211a',
    clay: '#c8743f',
    clayLight: '#e6a56b',
    clayDark: '#8a4a22',
    flint: '#8f8a80',
    flintDark: '#5f5a52',
    stone: '#a39e93',
    gold: '#e0b23a',
    goldDark: '#a77c16',
    copper: '#c46b3a',
    iron: '#6d6f73',
    marble: '#ece6da',
    silver: '#c9ccd1',
    paint: '#3b2618',
    white: '#f6efe2'
  };

  function node(tag, attrs, parent) {
    var el = document.createElementNS(NS, tag);
    for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k)) { el.setAttribute(k, String(attrs[k])); }
    }
    if (parent) { parent.appendChild(el); }
    return el;
  }

  function stroke(extra) {
    var base = { stroke: C.ink, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' };
    for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) { base[k] = extra[k]; } }
    return base;
  }

  var DRAW = {
    /* Крем'яне рубило: мигдалеподібне, зі сколами. */
    flint: function (g) {
      node('path', stroke({ d: 'M50 10 C68 24 74 52 66 74 C61 86 39 86 34 74 C26 52 32 24 50 10 Z', fill: C.flint }), g);
      node('path', stroke({ d: 'M50 18 L44 34 M58 30 L50 46 M42 48 L54 60 M46 66 L58 72', fill: 'none', stroke: C.flintDark }), g);
    },

    /* Браслет із меандром: смуга з ламаним орнаментом. */
    bracelet: function (g) {
      node('ellipse', stroke({ cx: 50, cy: 54, rx: 36, ry: 26, fill: C.white }), g);
      node('ellipse', stroke({ cx: 50, cy: 54, rx: 24, ry: 15, fill: '#d9cbb3' }), g);
      node('path', stroke({ d: 'M18 50 h6 v-6 h6 v6 h6 M64 44 h6 v6 h6 v-6 h6 M30 72 h6 v-6 h6 v6 h6 v-6 h6 v6 h6',
        fill: 'none', 'stroke-width': 1.6 }), g);
    },

    /* Наконечники стріл. */
    arrows: function (g) {
      [[30, 0], [52, 8], [74, -4]].forEach(function (p) {
        var x = p[0], y = 20 + p[1];
        node('path', stroke({ d: 'M' + x + ' ' + y + ' L' + (x + 10) + ' ' + (y + 30) + ' L' + x + ' ' + (y + 24) +
          ' L' + (x - 10) + ' ' + (y + 30) + ' Z', fill: C.flint }), g);
        node('line', stroke({ x1: x, y1: y + 24, x2: x, y2: y + 60, stroke: '#7a5a34', 'stroke-width': 3 }), g);
      });
    },

    /* Шліфована кам'яна сокира з просвердленим отвором. */
    stoneaxe: function (g) {
      node('path', stroke({ d: 'M18 40 C30 30 70 30 86 44 C90 52 86 60 76 62 C60 66 34 64 20 58 C14 54 14 46 18 40 Z', fill: C.stone }), g);
      node('circle', stroke({ cx: 40, cy: 48, r: 6, fill: '#e9e2d4' }), g);
      node('line', stroke({ x1: 40, y1: 54, x2: 40, y2: 92, stroke: '#7a5a34', 'stroke-width': 5 }), g);
    },

    /* Трипільська посудина зі спіраллю. */
    potspiral: function (g) {
      node('path', stroke({ d: 'M34 18 L66 18 L64 26 C84 34 88 62 74 80 C66 88 34 88 26 80 C12 62 16 34 36 26 Z', fill: C.clayLight }), g);
      node('path', stroke({ d: 'M38 52 C38 40 54 40 54 50 C54 58 44 58 44 52 C44 48 49 48 49 51', fill: 'none', stroke: C.paint, 'stroke-width': 3 }), g);
      node('path', stroke({ d: 'M58 62 C58 50 74 50 74 60 C74 68 64 68 64 62', fill: 'none', stroke: C.paint, 'stroke-width': 3 }), g);
      node('path', stroke({ d: 'M26 36 C40 30 60 30 74 36', fill: 'none', stroke: C.paint, 'stroke-width': 2 }), g);
    },

    /* Глиняна жіноча статуетка. */
    figurine: function (g) {
      node('circle', stroke({ cx: 50, cy: 20, r: 9, fill: C.clayLight }), g);
      node('path', stroke({ d: 'M44 28 C30 40 34 52 40 58 C30 70 34 88 50 90 C66 88 70 70 60 58 C66 52 70 40 56 28 Z', fill: C.clayLight }), g);
      node('path', stroke({ d: 'M42 66 C46 62 54 62 58 66 M42 74 C46 70 54 70 58 74', fill: 'none', stroke: C.paint, 'stroke-width': 1.6 }), g);
    },

    /* Мідна сокира-тесло. */
    copperaxe: function (g) {
      node('path', stroke({ d: 'M30 30 L62 26 C76 26 84 34 84 48 C84 62 76 70 62 70 L30 66 Z', fill: C.copper }), g);
      node('path', stroke({ d: 'M70 34 C76 40 76 56 70 62', fill: 'none', stroke: '#e9a77b' }), g);
      node('rect', stroke({ x: 12, y: 42, width: 20, height: 12, rx: 3, fill: '#7a5a34' }), g);
    },

    /* Пектораль: півмісяць у кілька ярусів. */
    pectoral: function (g) {
      node('path', stroke({ d: 'M8 30 C20 86 80 86 92 30 C80 70 20 70 8 30 Z', fill: C.gold }), g);
      node('path', stroke({ d: 'M18 36 C28 74 72 74 82 36', fill: 'none', stroke: C.goldDark }), g);
      node('path', stroke({ d: 'M26 40 C34 64 66 64 74 40', fill: 'none', stroke: C.goldDark }), g);
      [30, 42, 50, 58, 70].forEach(function (x, i) {
        node('circle', stroke({ cx: x, cy: 58 + (i === 2 ? 4 : 0), r: 3, fill: C.goldDark, 'stroke-width': 1 }), g);
      });
    },

    /* Гребінь із фігурами вершників. */
    comb: function (g) {
      node('rect', stroke({ x: 18, y: 50, width: 64, height: 10, fill: C.gold }), g);
      for (var x = 22; x <= 78; x += 6) {
        node('line', stroke({ x1: x, y1: 60, x2: x, y2: 88, stroke: C.goldDark, 'stroke-width': 2.4 }), g);
      }
      node('path', stroke({ d: 'M26 50 L30 30 L38 26 L44 34 L42 50 M56 50 L56 32 L64 22 L72 30 L74 50', fill: C.gold }), g);
      node('circle', stroke({ cx: 38, cy: 20, r: 5, fill: C.gold }), g);
      node('circle', stroke({ cx: 64, cy: 16, r: 5, fill: C.gold }), g);
    },

    /* Акінак: короткий меч із серцеподібним перехрестям. */
    akinak: function (g) {
      node('path', stroke({ d: 'M50 28 L56 34 L54 88 L50 94 L46 88 L44 34 Z', fill: C.iron }), g);
      node('path', stroke({ d: 'M36 30 C40 22 46 26 50 28 C54 26 60 22 64 30 Z', fill: C.gold }), g);
      node('rect', stroke({ x: 46, y: 10, width: 8, height: 18, fill: '#7a5a34' }), g);
      node('rect', stroke({ x: 40, y: 6, width: 20, height: 6, rx: 2, fill: C.gold }), g);
    },

    /* Амфора: дві ручки, гостре дно. */
    amphora: function (g) {
      node('path', stroke({ d: 'M42 10 L58 10 L58 22 C76 30 76 58 62 80 L50 94 L38 80 C24 58 24 30 42 22 Z', fill: C.clay }), g);
      node('path', stroke({ d: 'M42 16 C30 16 28 30 36 34 M58 16 C70 16 72 30 64 34', fill: 'none', 'stroke-width': 3 }), g);
      node('path', stroke({ d: 'M32 44 L68 44', fill: 'none', stroke: C.ink }), g);
    },

    /* Уламок мармурової колони з канелюрами й капітеллю. */
    column: function (g) {
      node('rect', stroke({ x: 24, y: 14, width: 52, height: 10, fill: C.marble }), g);
      node('path', stroke({ d: 'M30 24 L70 24 L68 34 L32 34 Z', fill: C.marble }), g);
      node('path', stroke({ d: 'M34 34 L66 34 L66 76 L58 84 L50 78 L42 88 L34 80 Z', fill: C.marble }), g);
      [40, 46, 52, 58].forEach(function (x) {
        node('line', stroke({ x1: x, y1: 36, x2: x, y2: 76, stroke: '#b8ad98', 'stroke-width': 1.6 }), g);
      });
    },

    /* Срібна монета з дельфіном. */
    coin: function (g) {
      node('circle', stroke({ cx: 50, cy: 52, r: 34, fill: C.silver }), g);
      node('circle', stroke({ cx: 50, cy: 52, r: 28, fill: 'none', stroke: '#8d9096', 'stroke-width': 1.4 }), g);
      node('path', stroke({ d: 'M30 58 C38 40 58 38 70 46 L76 40 L74 52 L66 52 C56 50 44 54 36 62 Z', fill: '#9da1a8' }), g);
    },

    /* Чотиригранний кам'яний стовп-ідол із шапкою. */
    idol: function (g) {
      node('path', stroke({ d: 'M36 8 C40 4 60 4 64 8 L66 22 L34 22 Z', fill: C.stone }), g);
      node('rect', stroke({ x: 34, y: 22, width: 32, height: 70, fill: '#b9b3a6' }), g);
      node('circle', stroke({ cx: 44, cy: 30, r: 2, fill: C.ink, 'stroke-width': 1 }), g);
      node('circle', stroke({ cx: 56, cy: 30, r: 2, fill: C.ink, 'stroke-width': 1 }), g);
      /* Ряди-яруси, як на Збруцькому ідолі, і руки, складені на поясі. */
      node('path', stroke({ d: 'M34 48 L66 48 M34 70 L66 70 M44 38 L56 38 M36 56 C42 64 48 62 50 58 C52 62 58 64 64 56',
        fill: 'none', 'stroke-width': 1.6 }), g);
    },

    /* Простий ліплений горщик без розпису. */
    slavpot: function (g) {
      node('path', stroke({ d: 'M30 22 L70 22 L66 32 C80 44 78 70 66 84 C58 90 42 90 34 84 C22 70 20 44 34 32 Z', fill: '#9c7a5b' }), g);
      node('path', stroke({ d: 'M34 34 C46 30 54 30 66 34', fill: 'none', stroke: '#6b4f37' }), g);
    }
  };

  function draw(kind, label) {
    var svg = node('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': label || kind });
    var g = node('g', {}, svg);
    var painter = DRAW[kind];
    if (painter) {
      painter(g);
    } else {
      /* Видима заглушка: відсутній малюнок не має зникати мовчки. */
      node('rect', { x: 4, y: 4, width: 92, height: 92, fill: '#e00' }, g);
      var t = node('text', { x: 50, y: 54, 'text-anchor': 'middle', fill: '#fff', 'font-size': 12 }, g);
      t.textContent = 'немає: ' + kind;
    }
    return svg;
  }

  window.RozkopkyArt = { draw: draw, kinds: Object.keys(DRAW) };
})();
