/* window.HLGWallet — монети й закриті кнопки.

   Конституція платформи називає фішками головної «закриті ігри, внутрішня
   валюта». Це вони. Учень починає з однієї відкритої гри; за перемоги
   отримує монети; монетами відкриває решту.

   ДВА РІШЕННЯ, ЯКІ ТУТ НЕСУЧІ.

   1. Початково відкрита гра названа у window.GAMES_FREE (data/games-registry.js),
      а НЕ записана в localStorage. Якби вона жила в сховищі, очищення сховища
      робило б платформу непрохідною: баланс нуль, усе замкнено, заробити ніде.

   2. Гра мусить працювати без гаманця. Виклики звідусіль ідуть під перевіркою
      `if (window.HLGWallet)`, так само як аналітика (export.md E4).

   Приклад — вікторина платить за шкалою (plan1.md §5): 100 % — повна сума,
   від 70 % — половина, менше — нуль, але результат однаково записується:

     var gained = window.HLGWallet
       ? HLGWallet.award('03-rus-ukraina:dates', { score: 7, total: 9 })
       : 0;                                    // 7/9 = 78 % -> 5 монет

   Без score/total поведінка стара: won: true = 100 %.

   Гра, яку немає сенсу перегравати, додає once — тоді нагорода одна назавжди:

     HLGWallet.award('puzzle-hetmany:MZP', { won: true, once: true });

   Приклад — головна:

     HLGWallet.onChange(function (state) { render(state.balance); });
     if (!HLGWallet.unlock('05-dates')) { сказати, що монет бракує; }

   API:
     getBalance()             -> number
     award(id, {won, once, score, total})
                              -> number   скільки нараховано (0, якщо нічого)
     resultOf(id)             -> {best, bestTotal, last, total, attempts, at} | null
     isUnlocked(id)           -> boolean
     unlock(id)               -> boolean  false, якщо монет бракує
     priceOf(id)              -> number
     isPersistent()           -> boolean  false = сховище недоступне
     onChange(cb)             -> undefined
     reset()                  -> undefined
*/

(function () {
  'use strict';

  var KEY = 'histgame_wallet';

  /* Ставки. Перша безкоштовна гра з першого разу дає рівно на одну кнопку —
     платформа розкривається з першої перемоги, а не з десятої. */
  var REWARD_WIN = 10;
  var REWARD_FIRST = 20;
  var DEFAULT_PRICE = 30;

  /* Шкала (plan1.md §5). Бонус за першу перемогу — лише за 100 %: інакше
     перші 70 % спалили б його наполовину, і решти учень не добрав би ніколи. */
  var PASS_RATIO = 0.7;
  var PARTIAL_SHARE = 0.5;

  var listeners = [];

  /* Сховище недоступне у приватному режимі, а через file:// його ділять усі
     локальні сторінки. Тому кожне звернення — у try/catch, а стан живе в
     пам'яті й лише дзеркалиться на диск. */
  var persistent = true;
  var state = null;

  function blank() {
    return { balance: 0, unlocked: [], firstWins: [], results: {} };
  }

  function load() {
    var raw = null;
    try {
      raw = window.localStorage.getItem(KEY);
    } catch (e) {
      persistent = false;
      return blank();
    }
    if (!raw) { return blank(); }

    var parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      /* Пошкоджений запис. Мовчки почати з нуля — це тихо стерти покупки,
         тому кажемо вголос у консоль і починаємо з нуля явно. */
      warn('запис гаманця пошкоджено, починаємо з нуля');
      return blank();
    }
    if (!parsed || typeof parsed !== 'object') { return blank(); }

    return {
      balance: typeof parsed.balance === 'number' && parsed.balance >= 0
        ? Math.floor(parsed.balance) : 0,
      unlocked: Array.isArray(parsed.unlocked) ? parsed.unlocked.slice() : [],
      firstWins: Array.isArray(parsed.firstWins) ? parsed.firstWins.slice() : [],
      /* Запис попередньої версії не має results — він лишається дійсним. */
      results: parsed.results && typeof parsed.results === 'object'
        && !Array.isArray(parsed.results) ? parsed.results : {}
    };
  }

  function save() {
    if (!persistent) { return; }
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* Квота вичерпана або приватний режим почався посеред сесії. Далі
         працюємо в пам'яті, але користувач має про це дізнатися. */
      persistent = false;
      warn('сховище недоступне — покупки не переживуть перезавантаження');
      notify();
    }
  }

  function warn(message) {
    if (window.console && console.warn) {
      console.warn('HLGWallet: ' + message);
    }
  }

  function ensure() {
    if (state === null) { state = load(); }
    return state;
  }

  function notify() {
    var snapshot = {
      balance: ensure().balance,
      persistent: persistent
    };
    listeners.forEach(function (callback) {
      try {
        callback(snapshot);
      } catch (e) {
        warn('обробник onChange кинув виняток: ' + e.message);
      }
    });
  }

  /* --- реєстр ------------------------------------------------------------

     Гаманець читає реєстр, але не вимагає його: сторінка гри підключає
     wallet.js без games-registry.js і мусить уміти нарахувати монети.

     Id кнопки — '<slug теми>:<id шаблону>'. Ціна лежить у шаблоні, тому
     беремо частину після двокрапки. */

  function template(id) {
    var registry = window.GAMES_REGISTRY;
    if (!registry) { return null; }
    var key = String(id).split(':').pop();
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].id === key) { return registry[i]; }
    }
    return null;
  }

  function priceOf(id) {
    var found = template(id);
    return found && typeof found.price === 'number' ? found.price : DEFAULT_PRICE;
  }

  function isFree(id) {
    return !!window.GAMES_FREE && window.GAMES_FREE === id;
  }

  /* --- публічне ---------------------------------------------------------- */

  function getBalance() {
    return ensure().balance;
  }

  function isPersistent() {
    ensure();
    return persistent;
  }

  function isUnlocked(id) {
    if (!id) { return false; }
    if (isFree(id)) { return true; }
    return ensure().unlocked.indexOf(id) !== -1;
  }

  /* Нарахування. `id` тут — той самий moduleId, що й в аналітиці; реєстр і
     аналітика не мають розходитися (конвенція CLAUDE.md).

     Два режими, бо гри бувають двох сортів:

       типовий            шкала за часткою правильних (score/total):
                            100 %   10 + 20 за першу повну перемогу
                            ≥ 70 %  половина від 10, firstWins не чіпаємо
                            < 70 %  нуль — але результат записується
                          Перегравання вікторини — справжня практика, і воно
                          має лишатися вигідним, просто менше за нову тему.

       once: true         тільки перший раз, далі нуль. Для ігор, де
                          повторне проходження нічого не тренує: пазл із
                          трьох портретів запам'ятовується з другого разу
                          й далі був би чистою фермою монет.

     Без score/total діє старе правило: won: true — це 100 %, інакше нуль.
  */
  function award(id, options) {
    if (!id || !options) { return 0; }

    var hasScore = typeof options.total === 'number' && options.total > 0
      && typeof options.score === 'number';
    var ratio = hasScore
      ? Math.max(0, Math.min(1, options.score / options.total))
      : (options.won ? 1 : 0);

    var current = ensure();
    if (hasScore) { record(current, id, options.score, options.total); }

    var gained = 0;
    var first = current.firstWins.indexOf(id) === -1;

    if (ratio >= 1) {
      if (options.once) {
        gained = first ? REWARD_WIN + REWARD_FIRST : 0;
      } else {
        gained = REWARD_WIN + (first ? REWARD_FIRST : 0);
      }
      if (first) { current.firstWins.push(id); }
    } else if (ratio >= PASS_RATIO && !options.once) {
      gained = Math.round(REWARD_WIN * PARTIAL_SHARE);
    }

    /* Забіг нижче порога теж зберігається й сповіщає: учень, що набрав п'ять
       із дев'яти, мусить бачити, що спроба врахована (plan1.md §5). */
    if (!gained && !hasScore) { return 0; }
    current.balance += gained;
    save();
    notify();
    return gained;
  }

  /* results — це «збереження прогресу». Живе в тому ж ключі, що й монети:
     другий ключ означав би другий стан, який тихо розійдеться з першим. */
  function record(current, id, score, total) {
    var previous = current.results[id];
    var best = previous && typeof previous.best === 'number' ? previous.best : -1;
    var bestTotal = previous && typeof previous.bestTotal === 'number'
      ? previous.bestTotal : (previous && previous.total) || total;
    var better = best < 0 || score / total > best / bestTotal;
    current.results[id] = {
      best: better ? score : best,
      bestTotal: better ? total : bestTotal,
      last: score,
      total: total,
      attempts: (previous && previous.attempts || 0) + 1,
      at: Date.now()
    };
  }

  function resultOf(id) {
    var found = id ? ensure().results[id] : null;
    if (!found || typeof found !== 'object') { return null; }
    return {
      best: found.best,
      bestTotal: found.bestTotal || found.total,
      last: found.last,
      total: found.total,
      attempts: found.attempts,
      at: found.at
    };
  }

  function unlock(id) {
    if (!id || isUnlocked(id)) { return true; }

    var current = ensure();
    var price = priceOf(id);
    if (current.balance < price) { return false; }

    current.balance -= price;
    current.unlocked.push(id);
    save();
    notify();
    return true;
  }

  function onChange(callback) {
    if (typeof callback === 'function') { listeners.push(callback); }
  }

  function reset() {
    state = blank();
    if (persistent) {
      try {
        window.localStorage.removeItem(KEY);
      } catch (e) { /* нічого не вдієш — стан у пам'яті вже чистий */ }
    }
    notify();
  }

  window.HLGWallet = {
    getBalance: getBalance,
    award: award,
    resultOf: resultOf,
    isUnlocked: isUnlocked,
    unlock: unlock,
    priceOf: priceOf,
    isPersistent: isPersistent,
    onChange: onChange,
    reset: reset
  };
})();
