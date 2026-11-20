/* window.ChainLock — замок ланцюга «(не)історична історія».

   Шість частин ідуть по черзі: наступна відкривається посиланням у кінці
   попередньої. Замок робить це правилом, а не лише розкладкою посилань.

   ЧОТИРИ РІШЕННЯ, ЯКІ ТУТ НЕСУЧІ.

   1. Замок ПАДАЄ ВІДЧИНЕНИМ, а не зачиненим. Сховище недоступне у приватному
      режимі й на частині шляхів file:// — а саме file:// і є основним
      способом, яким учень відкриває теку з флешки. Замок, що в цьому разі
      зачиняється, замуровує учня на першій частині назавжди, без учителя
      поруч. Тому будь-який збій читання = все відчинено + видима записка.

   2. Ключ їде в АДРЕСІ, коли сховище не може його втримати. Читання може
      працювати, а запис падати (вичерпана квота): тоді учень тисне «далі»,
      потрапляє на наступну частину — і вона замкнена, бо запис не дійшов.
      У цьому разі посилання дописує #dali, і сторінка-адресат його приймає.

   3. Вихід ВИДИМИЙ. У панелі замка є кнопка «Все одно відкрити». Це не діра,
      а призначення: замок веде учня по черзі, але вчителеві, який показує
      матеріал, і учневі, який повернувся, він не має заважати. Схований
      обхід був би нечесним; видимий — це просто ще одні двері.

   4. Рішення ухвалюється в <head>, ДО <body>. Інакше закрита сторінка встигає
      почати завантаження тринадцяти чужих <iframe>. Через це скрипт не чіпає
      document.body (його ще немає), а ставить атрибут на <html>, і ховає все
      CSS. Друга половина того самого — loading="lazy" на кожному кадрі:
      всередині display:none лінивий кадр не вантажиться взагалі.

   Розмітка, якої скрипт очікує (решта — його не обходить):

     <html data-chain-locked>      ставить сам, коли частина закрита
     <html data-chain-nostore>     ставить сам, коли порядок не зберігається
     <a data-chain-next href=…>    посилання «далі» в кінці частини
     <button data-chain-open>      «Все одно відкрити» в панелі замка

   API (для консолі й майбутнього прогресу на головній):
     part()        -> number|null  номер цієї частини
     reached()     -> number       найдальша відкрита частина
     open(n)       -> boolean      відкрити частину n; false = запис не вдався
     isPersistent()-> boolean      false = сховище недоступне
     reset()       -> undefined    замкнути все, крім першої
*/

(function () {
  'use strict';

  var KEY = 'histgame_chain';
  var FIRST = 1;
  var PASS = '#dali';

  /* Номер частини беремо з імені файла, а не з атрибута <body>: скрипт
     працює в <head>, де <body> ще не розібрано. */
  var match = /neistorychna-(\d+)\.html/.exec(window.location.pathname);
  var part = match ? parseInt(match[1], 10) : null;

  var persistent = true;
  var root = document.documentElement;

  function warn(message) {
    if (window.console && console.warn) {
      console.warn('ChainLock: ' + message);
    }
  }

  function reached() {
    var raw;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      persistent = false;
      return null;              /* null = «невідомо», а не «перша» */
    }
    var n = parseInt(raw, 10);
    return (n >= FIRST) ? n : FIRST;
  }

  function open(n) {
    var have = reached();
    if (have === null) { return false; }
    if (n <= have) { return true; }
    try {
      window.localStorage.setItem(KEY, String(n));
    } catch (e) {
      persistent = false;
      warn('сховище не приймає запис — далі ключ поїде в адресі');
      return false;
    }
    return true;
  }

  /* --- рішення, до першого малювання ------------------------------------- */

  function decide() {
    if (part === null) { return; }        /* скрипт на чужій сторінці */
    if (part <= FIRST) { return; }        /* перша відчинена завжди */

    if (window.location.hash === PASS) {
      /* Ключ приїхав в адресі, бо сховище не змогло його втримати. */
      root.setAttribute('data-chain-nostore', '1');
      open(part);
      return;
    }

    var have = reached();
    if (have === null) {
      /* Сховища немає. Падаємо ВІДЧИНЕНИМИ і кажемо про це вголос. */
      root.setAttribute('data-chain-nostore', '1');
      return;
    }
    if (part > have) {
      root.setAttribute('data-chain-locked', String(part));
    }
  }

  decide();

  /* --- дроти, коли <body> уже є ------------------------------------------ */

  function wire() {
    if (part === null) { return; }

    var next = document.querySelector('[data-chain-next]');
    if (next) {
      next.addEventListener('click', function (event) {
        if (open(part + 1)) { return; }   /* записалося — переходимо як є */
        /* Не записалося. Щоб наступна частина не зустріла учня замком,
           дозвіл їде в адресі. */
        event.preventDefault();
        window.location.href = next.getAttribute('href') + PASS;
      });
    }

    var escape = document.querySelector('[data-chain-open]');
    if (escape) {
      escape.addEventListener('click', function () {
        open(part);
        root.removeAttribute('data-chain-locked');
        if (!persistent) { root.setAttribute('data-chain-nostore', '1'); }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }

  window.ChainLock = {
    part: function () { return part; },
    reached: function () {
      var have = reached();
      return have === null ? FIRST : have;
    },
    open: open,
    isPersistent: function () { reached(); return persistent; },
    reset: function () {
      try {
        window.localStorage.removeItem(KEY);
      } catch (e) { /* нічого не вдієш */ }
      root.removeAttribute('data-chain-locked');
    }
  };
})();
