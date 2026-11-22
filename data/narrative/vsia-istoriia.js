// Наративна гра «Вся історія». РУЧНИЙ файл — редагувати можна і треба.
//
// Та сама сцена, що «Гетьманщина 1918» (games/viraska.html), але інший шлях:
// сторінка відкривається як games/viraska.html?story=vsia-istoriia і бере
// цей запис замість VIRASKA_DATA. Усього, чого тут немає (сітка, резерв,
// голоси, маніфест спрайтів, basePath), сторінка позичає з VIRASKA_DATA —
// тому ворог той самий: скелет, спрайти з набору `a1 enemy_*` в assets/
// (копії в games/viraska/assets/enemy-*).
//
// Завдання — Wordwall першої теми набору: семінар 11 (Національно-визвольна
// війна середини XVII ст., тема НМТ 08), вісім вбудувань із
// «Wordwall посилання для html.md», у тому ж порядку.
//
// Додати тему = дописати локації в кінець locations.

(function () {
  'use strict';

  window.NARRATIVE_STORIES = window.NARRATIVE_STORIES || {};

  function wordwall(id, query) {
    return 'https://wordwall.net/embed/' + id + '?' + query + '&fontStackId=0';
  }

  /* Чотири доріжки по колу: низ → право, верх → ліво, змійка, підйом.
     Кожна має один пост ворога. */
  var PATHS = [
    [
      { x: 0.02, y: 0.98 },
      { x: 0.50, y: 0.98, fight: 'skeleton', zone: 2 },
      { x: 0.98, y: 0.98 },
      { x: 0.98, y: 0.02, wait: true }
    ],
    [
      { x: 0.98, y: 0.02 },
      { x: 0.50, y: 0.02, fight: 'skeleton', zone: 2 },
      { x: 0.02, y: 0.02 },
      { x: 0.02, y: 0.98, wait: true }
    ],
    [
      { x: 0.02, y: 0.98 },
      { x: 0.98, y: 0.98 },
      { x: 0.98, y: 0.50, fight: 'skeleton', zone: 2 },
      { x: 0.98, y: 0.02, wait: true }
    ],
    [
      { x: 0.98, y: 0.98 },
      { x: 0.50, y: 0.98, fight: 'skeleton', zone: 2 },
      { x: 0.02, y: 0.50 },
      { x: 0.50, y: 0.02, wait: true }
    ]
  ];

  var TASKS = [
    { name: 'Січ, січень 1648', id: '531678c9395849b7b6425599ede5d8d5', q: 'themeId=52&templateId=25' },
    { name: 'Жовті Води', id: '0bae8ec84a954655ac3b892703574386', q: 'themeId=22&templateId=45' },
    { name: 'Корсунь', id: 'a3b72d1893e8478cb3328c38f77c6c41', q: 'themeId=46&templateId=48' },
    { name: 'Пилявці', id: '5e00b481ccdd45ce842ef5ce36341cc0', q: 'themeId=1&templateId=22' },
    { name: 'Зборів', id: 'b832e07a00e542768608bb9c9795eec1', q: 'themeId=44&templateId=73' },
    { name: 'Берестечко', id: '512971572a604fc8855df420051df7ff', q: 'themeId=1&templateId=36' },
    { name: 'Батіг', id: '81086c481a0a4fa3b43c666f54ea67e5', q: 'themeId=1&templateId=81' },
    { name: 'Переяслав', id: '1c9835d21ba04c759f4466f273bf67f2', q: 'themeId=1&templateId=22' }
  ];

  window.NARRATIVE_STORIES['vsia-istoriia'] = {
    title: 'Вся історія',
    meta: 'Шлях Міри крізь історію України, тема за темою. Перша — '
      + 'Національно-визвольна війна середини XVII ст. Ця гра нічого не '
      + 'оцінює й не платить монет — вона розповідає, а не перевіряє.',
    locations: TASKS.map(function (t, i) {
      return {
        id: 's11-' + (i + 1),
        name: t.name,
        tint: 'var(--block-4-bg)',
        path: PATHS[i % PATHS.length],
        task: {
          label: 'Семінар 11 · завдання ' + (i + 1) + ' з ' + TASKS.length,
          embed: wordwall(t.id, t.q)
        },
        next: i === TASKS.length - 1 ? 'Завершити тему' : 'Продовжити шлях'
      };
    })
  };
})();
