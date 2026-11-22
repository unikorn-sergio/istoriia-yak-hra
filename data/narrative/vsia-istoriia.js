// Наративна гра «Вся історія». РУЧНИЙ файл — редагувати можна і треба.
//
// Та сама сцена, що «Гетьманщина 1918» (games/viraska.html), але інший шлях:
// сторінка відкривається як games/viraska.html?story=vsia-istoriia і бере
// цей запис замість VIRASKA_DATA. Усього, чого тут немає (сітка, резерв,
// голоси, маніфест спрайтів, basePath), сторінка позичає з VIRASKA_DATA —
// тому ворог той самий: скелет, спрайти з набору `a1 enemy_*` в assets/
// (копії в games/viraska/assets/enemy-*).
//
// --- Звідки завдання ----------------------------------------------------------
//
// ЄДИНЕ джерело — репозиторій курсу:
//   D:\Корн_новий\Робоча16_ЗНО-НМТ\Підготовчий курс_2026\Wordwall\
//   «Семінар N — …, розподіл.md» (таблиця «Створені активності»)
//   і «Семінар N_k — <шаблон>.md» (посилання й стан доступу).
// Номер семінару = номер лекції у варіанті на 35 тем. Файли
// «Wordwall посилання …» і «Wordwall 6 частин.md» у корені платформи —
// старий набір (2025, семінари 11–33); сюди їх НЕ беремо.
//
// Кожне завдання має:
//   resource  https://wordwall.net/resource/… — як у репозиторії курсу
//   embed     адреса для <iframe> (https://wordwall.net/embed/<guid>?…).
//             З'являється лише після Share у Wordwall, а Share натискає тільки
//             автор. Поки embed порожній, сторінка показує заглушку з
//             посиланням resource, і шлях Міри йде далі.
//
// Приватність: активності курсу містять зображення УЦОЯО / osvita.ua і
// лишаються Private (правило курсу «Wordwall — алгоритми семінарів.md»,
// розділ «Доступ і приватність»). Платформа має публічне видання
// (tools/public-export.py) — перш ніж вписувати embed, вирішити, чи цей
// шлях іде в публічне видання.
//
// Додати тему = дописати семінар у SEMINARS.

(function () {
  'use strict';

  window.NARRATIVE_STORIES = window.NARRATIVE_STORIES || {};

  var WW = 'https://wordwall.net/resource/';

  /* Семінар 1 — демоваріант НМТ 2026; створено 08.11.2026, усі Private.
     Порядок — як у таблиці «Створені активності» репозиторію курсу. */
  var SEMINARS = [
    {
      n: 1,
      tint: 'var(--block-1-bg)',
      tasks: [
        { code: '1_1', name: 'Картки', template: 'Flash cards', id: '123350120' },
        { code: '1_2', name: 'Пара чи не пара', template: 'Pair or No Pair', id: '123332416' },
        { code: '1_3', name: 'Групи', template: 'Group sort', id: '123350553' },
        { code: '1_4.1', name: 'Порядок: Русь', template: 'Rank order', id: '123350636' },
        { code: '1_4.2', name: 'Порядок: радянська доба', template: 'Rank order', id: '123350656' },
        { code: '1_4.3', name: 'Порядок: плакати', template: 'Rank order', id: '123350807' },
        { code: '1_5', name: 'Карта', template: 'Labelled diagram', id: '123350952' },
        { code: '1_7', name: 'Упізнай зображення', template: 'Gameshow quiz', id: '123351207' },
        { code: '1_8', name: 'Пропущені слова', template: 'Complete the sentence', id: '123351641' }
      ]
    }
  ];

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

  var locations = [];
  SEMINARS.forEach(function (sem) {
    sem.tasks.forEach(function (t) {
      locations.push({
        id: 's' + t.code,
        name: t.name,
        tint: sem.tint,
        path: PATHS[locations.length % PATHS.length],
        task: {
          label: 'Семінар ' + sem.n + ' · ' + t.code + ' ' + t.template,
          resource: WW + t.id,
          embed: t.embed || ''
        },
        next: 'Продовжити шлях'
      });
    });
  });
  if (locations.length) { locations[locations.length - 1].next = 'Завершити шлях'; }

  window.NARRATIVE_STORIES['vsia-istoriia'] = {
    title: 'Вся історія',
    meta: 'Шлях Міри крізь історію України, тема за темою. Перша — '
      + 'демоваріант НМТ 2026. Ця гра нічого не оцінює й не платить монет — '
      + 'вона розповідає, а не перевіряє.',
    locations: locations
  };
})();
