/* window.QuizGame — вікторина як гра, а не тест (plan1.md §6).

   Один екран — одне питання. Відповідь фіксується одразу, відгук миттєвий,
   назад ходу немає. Після КОЖНОЇ відповіді — і правильної теж — показується
   факт, з якого питання зроблено: учень, що вгадав, інакше не побачив би
   того, що мав запам'ятати (docs/review-evidence.md, п. 1).

   Реалізовано РІВНО ДВА типи питань: 'text' і 'choice'. Якщо колись з'являться
   інші — їх спершу треба дозволити в tools/facts_schema.py, інакше формат
   опише більше, ніж уміє код (пастка N10).

   Приклад:

     QuizGame.init({
       data: FactsAdapter.toQuiz('03-rus-ukraina', { seed: 42 }),
       containerId: 'quizStage',
       moduleId: '03-rus-ukraina:dates',      // ключ гаманця = moduleId аналітики
       passwordBlockId: 'passwordBlock',
       passwordDisplayId: 'password',
       statusId: 'status',                    // role="status" для скрін-рідера
       homeUrl: '../index.html',
       onNewSet: function () { перейти на інший seed; },   // без нього кнопки немає
       onFinish: function (r) { … }    // r = {score, total, ratio, gained, won}
     });

   Два необов'язкові поля даних — не нові типи питань, а подача 'choice':
     data.layout = 'cards'      варіанти сіткою 2 × 2 (games/zaiva.html)
     data.unit = 'Раунд'        слово в шапці замість «Питання»
     question.reveal            { варіант: підпис } — з'являється на кожному
                                варіанті після відповіді (дата події)

   API:
     init(config)                 -> undefined   будує й показує перше питання
     restart()                    -> undefined   той самий набір із початку
     setTheme('light' | 'dark')   -> undefined

   ТРИ СВІДОМІ ВІДМІННОСТІ ВІД export.md E1 — не «лагодьте» їх назад:
   1. Замість alert() — інлайнове повідомлення з role="status". alert
      недоступний зі скрін-рідера на мобільних і блокує сторінку.
   2. У 'text' є необов'язкове поле aliases: «1918 р.» мусить зараховуватися
      нарівні з «1918». Нового типу питання це не створює.
   3. Ні списку з кнопкою «Перевірити», ні оцінювання «все або нічого»
      (правило 6 CLAUDE.md). Монети платяться за шкалою 70/100 %
      (HLGWallet.award з score/total). ПАРОЛЬ лишається все-або-нічого: це
      вчительський артефакт, видима різниця між «склав» і «склав бездоганно». */

(function () {
  'use strict';

  var config = null;
  var questions = [];
  var layout = null;
  var unit = 'Питання';
  var stage = null;
  var step = 0;
  var outcomes = [];         // true / false на кожне пройдене питання
  var streak = 0;
  var attempts = 0;          // скільки разів набір пройдено до кінця
  var sessionStarted = false;

  /* --- порівняння відповідей ---------------------------------------------

     Український апостроф трапляється щонайменше в чотирьох кодових позиціях
     (' ’ ʼ ‘), і учень уведе будь-яку з них. Так само тире й дефіс. */

  function normalize(value) {
    return String(value === undefined || value === null ? '' : value)
      .toLowerCase()
      .replace(/[’ʼ‘`´]/g, "'")
      .replace(/[–—−]/g, '-')
      .replace(/[.,;:!?"«»()]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function matches(given, question) {
    var normalized = normalize(given);
    if (!normalized) { return false; }
    if (normalized === normalize(question.correct)) { return true; }

    var aliases = question.aliases || [];
    for (var i = 0; i < aliases.length; i++) {
      if (normalized === normalize(aliases[i])) { return true; }
    }
    return false;
  }

  /* --- DOM -----------------------------------------------------------------

     Тільки createElement + textContent. Ніякого innerHTML: тексти питань
     пишуть люди в .md-файлах, і будь-який `<` став би дірою (export.md B4). */

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = text; }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function button(label, className, onClick) {
    var node = element('button', className, label);
    node.type = 'button';
    node.addEventListener('click', onClick);
    return node;
  }

  /* Два канали. say() — видимий рядок статусу сторінки, лише для того, чого
     на картці немає («спершу введіть відповідь»). announce() — прихована
     live-область для скрін-рідера: вердикт і підсумок уже видно на картці, і
     видимий дубль під нею був би шумом. */
  function say(message) {
    var status = config.statusId && document.getElementById(config.statusId);
    if (status) { status.textContent = message; }
  }

  var live = null;

  function announce(message) {
    if (!live) {
      live = element('p', 'visually-hidden');
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'polite');
      stage.parentNode.insertBefore(live, stage.nextSibling);
    }
    live.textContent = message;
  }

  function correctCount() {
    return outcomes.filter(Boolean).length;
  }

  /* --- шапка: «Питання 3 з 9», крапки, рахунок і серія ------------------ */

  function renderProgress() {
    var bar = element('div', 'quiz-progress');
    bar.appendChild(element('p', 'quiz-progress__label',
      unit + ' ' + (step + 1) + ' з ' + questions.length));

    var dots = element('ol', 'quiz-dots');
    dots.setAttribute('aria-hidden', 'true');
    questions.forEach(function (question, index) {
      var state = index < outcomes.length
        ? (outcomes[index] ? ' quiz-dot--correct' : ' quiz-dot--wrong')
        : (index === step ? ' quiz-dot--current' : '');
      dots.appendChild(element('li', 'quiz-dot' + state));
    });
    bar.appendChild(dots);

    var score = correctCount();
    bar.appendChild(element('p', 'quiz-progress__score',
      score + ' ' + plural(score, 'правильна', 'правильні', 'правильних')
      + (streak > 1 ? ' · серія ' + streak : '')));
    return bar;
  }

  function plural(n, one, few, many) {
    var mod10 = n % 10;
    var mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) { return one; }
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) { return few; }
    return many;
  }

  /* --- одне питання --------------------------------------------------------- */

  function showQuestion() {
    clear(stage);
    stage.appendChild(renderProgress());

    var question = questions[step];
    var card = element('section', 'quiz-question');
    var headingId = 'quizQuestionText';

    var heading = element('h2', 'quiz-question__text', question.text);
    heading.id = headingId;
    heading.tabIndex = -1;
    card.appendChild(heading);

    /* Уривок-умова: без нього питання «Прочитайте уривок…» не існує,
       тому він частина завдання, а не оздоблення. */
    if (question.quote) {
      card.appendChild(element('blockquote', 'quiz-quote', question.quote));
    }

    if (question.type === 'choice') {
      card.appendChild(renderChoice(question, headingId, card));
    } else {
      card.appendChild(renderText(question, headingId, card));
    }

    stage.appendChild(card);
    say('');
    focusLater(question.type === 'choice' ? heading : card.querySelector('.quiz-input'));
  }

  function renderChoice(question, headingId, card) {
    var group = element('div', 'quiz-options'
      + (layout === 'cards' ? ' quiz-options--cards' : ''));
    group.setAttribute('role', 'group');
    group.setAttribute('aria-labelledby', headingId);

    question.options.forEach(function (option) {
      var node = button(option, 'quiz-option', function () {
        answer(question, option, card);
      });
      /* Значення окремо від тексту: після відповіді на кнопку дописується
         підпис (reveal), і textContent перестає дорівнювати варіанту. */
      node.setAttribute('data-value', option);
      group.appendChild(node);
    });
    return group;
  }

  function renderText(question, headingId, card) {
    var form = element('div', 'quiz-text-answer');
    var input = element('input', 'quiz-input');
    input.type = 'text';
    input.autocomplete = 'off';
    input.setAttribute('aria-labelledby', headingId);
    if (question.placeholder) { input.placeholder = question.placeholder; }

    var submit = button('Відповісти', 'button', function () {
      if (!normalize(input.value)) {
        say('Спершу введіть відповідь.');
        input.focus();
        return;
      }
      answer(question, input.value, card);
    });

    /* preventDefault обов'язковий: без нього той самий Enter у Firefox
       (активація кнопки на keypress) натиснув би й «Далі», щойно фокус
       туди переїде, і учень проскочив би відгук. */
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit.click();
      }
    });

    form.appendChild(input);
    form.appendChild(submit);
    return form;
  }

  /* --- відповідь: фіксується одразу, назад ходу немає -------------------- */

  function answer(question, given, card) {
    if (outcomes.length > step) { return; }      // подвійний клік

    var correct = matches(given, question);
    outcomes.push(correct);
    streak = correct ? streak + 1 : 0;

    lockAnswer(question, given, correct, card);
    card.classList.add(correct ? 'is-correct' : 'is-wrong');

    /* Шапку перебудовуємо, щоб крапка й рахунок оновилися одразу. */
    stage.replaceChild(renderProgress(), stage.firstChild);

    var feedback = element('div', 'quiz-feedback '
      + (correct ? 'quiz-feedback--correct' : 'quiz-feedback--wrong'));
    feedback.appendChild(element('p', 'quiz-feedback__verdict',
      correct ? 'Правильно.' : 'Ні. Правильна відповідь: ' + question.correct));

    /* Факт показується завжди, а не лише при помилці. Текст — лише з
       facts.md; пояснень osvita.ua платформа не бере. */
    if (question.explain) {
      feedback.appendChild(element('p', 'quiz-explain', question.explain));
    }
    if (question.detail) {
      feedback.appendChild(element('p', 'quiz-explain quiz-explain--detail', question.detail));
    }

    var last = step === questions.length - 1;
    var next = button(last ? 'Підсумок' : 'Далі', 'button quiz-next', function () {
      step++;
      if (step < questions.length) { showQuestion(); } else { finish(); }
    });
    var actions = element('div', 'actions');
    actions.appendChild(next);
    feedback.appendChild(actions);
    card.appendChild(feedback);

    say('');
    announce(correct ? 'Правильно.' : 'Неправильно. Правильна відповідь: ' + question.correct);
    focusLater(next);
  }

  function lockAnswer(question, given, correct, card) {
    if (question.type === 'choice') {
      var options = card.querySelectorAll('.quiz-option');
      for (var i = 0; i < options.length; i++) {
        var option = options[i];
        var value = option.getAttribute('data-value');
        option.disabled = true;
        if (matches(value, question)) {
          option.classList.add('is-correct');
        } else if (value === given) {
          option.classList.add('is-wrong');
        }
        if (question.reveal && question.reveal[value]) {
          option.appendChild(element('span', 'quiz-option__reveal', question.reveal[value]));
        }
      }
      return;
    }
    var input = card.querySelector('.quiz-input');
    var submit = card.querySelector('.quiz-text-answer .button');
    if (input) {
      input.readOnly = true;
      input.classList.add(correct ? 'is-correct' : 'is-wrong');
    }
    if (submit) { submit.disabled = true; }
  }

  /* --- фінал ---------------------------------------------------------------- */

  function finish() {
    attempts++;
    var score = correctCount();
    var total = questions.length;
    var ratio = total ? score / total : 0;
    var won = total > 0 && score === total;

    /* Гаманець і аналітика — під перевіркою присутності: гра мусить
       працювати й без них. Повернене число НЕ відкидається: учень мусить
       бачити, що монети прийшли (скарга першого живого проходження). */
    var gained = window.HLGWallet
      ? HLGWallet.award(config.moduleId, { score: score, total: total })
      : 0;

    if (window.HLGAnalytics && sessionStarted) {
      HLGAnalytics.endSession({ score: score, won: won, attempts: attempts });
      sessionStarted = false;
    }

    clear(stage);
    var result = element('section', 'quiz-result');
    var heading = element('h2', 'quiz-result__score',
      score + ' із ' + total + ' (' + Math.round(ratio * 100) + ' %)');
    heading.tabIndex = -1;
    result.appendChild(heading);

    var dots = element('ol', 'quiz-dots quiz-dots--result');
    dots.setAttribute('aria-hidden', 'true');
    outcomes.forEach(function (ok) {
      dots.appendChild(element('li', 'quiz-dot ' + (ok ? 'quiz-dot--correct' : 'quiz-dot--wrong')));
    });
    result.appendChild(dots);

    result.appendChild(element('p', 'quiz-result__coins', coinsLine(gained)));

    if (!won) {
      result.appendChild(element('p', 'quiz-result__note',
        'Пароль відкривається лише за повністю правильний набір.'));
    }

    var actions = element('div', 'actions');
    actions.appendChild(button('Ще раз', 'button', restart));
    if (typeof config.onNewSet === 'function') {
      actions.appendChild(button('Інший набір', 'button button--quiet', config.onNewSet));
    }
    if (config.homeUrl) {
      var home = element('a', 'button button--quiet', 'На головну');
      home.href = config.homeUrl;
      actions.appendChild(home);
    }
    result.appendChild(actions);
    stage.appendChild(result);

    if (won) { revealPassword(); }
    announce(score + ' із ' + total + '. ' + coinsLine(gained));
    focusLater(heading);

    if (typeof config.onFinish === 'function') {
      config.onFinish({ score: score, total: total, ratio: ratio, gained: gained, won: won });
    }
  }

  function coinsLine(gained) {
    if (!window.HLGWallet) { return ''; }
    if (gained > 0) {
      return '+' + gained + ' ' + plural(gained, 'монета', 'монети', 'монет');
    }
    return 'Монет не нараховано: потрібно щонайменше 70 %.';
  }

  function passwordBlock() {
    return config.passwordBlockId && document.getElementById(config.passwordBlockId);
  }

  function revealPassword() {
    var block = passwordBlock();
    var display = config.passwordDisplayId
      && document.getElementById(config.passwordDisplayId);
    if (display) { display.textContent = config.password; }
    if (block && config.password) { block.hidden = false; }
  }

  /* Фокус переноситься після того, як вузол уже в документі; інакше
     скрін-рідер лишається на кнопці, якої більше немає. */
  function focusLater(node) {
    if (!node) { return; }
    setTimeout(function () {
      try { node.focus({ preventScroll: false }); } catch (e) { node.focus(); }
    }, 0);
  }

  /* --- життєвий цикл -------------------------------------------------------- */

  function restart() {
    step = 0;
    outcomes = [];
    streak = 0;
    var block = passwordBlock();
    if (block) { block.hidden = true; }

    if (window.HLGAnalytics && !sessionStarted) {
      HLGAnalytics.startSession(config.moduleId);
      sessionStarted = true;
    }
    showQuestion();
  }

  function init(userConfig) {
    var data = userConfig.data || {};
    config = {
      password: userConfig.password || data.password || '',
      passwordBlockId: userConfig.passwordBlockId || 'passwordBlock',
      passwordDisplayId: userConfig.passwordDisplayId || 'password',
      statusId: userConfig.statusId || null,
      moduleId: userConfig.moduleId || data.slug || null,
      homeUrl: userConfig.homeUrl || null,
      onNewSet: userConfig.onNewSet || null,
      onFinish: userConfig.onFinish || null
    };
    layout = data.layout || null;
    unit = data.unit || 'Питання';
    questions = (data.questions || []).filter(function (question) {
      return question.type === 'choice' || question.type === 'text';
    });
    attempts = 0;

    stage = document.getElementById(userConfig.containerId);
    if (!stage) {
      throw new Error('QuizGame.init: немає елемента #' + userConfig.containerId);
    }
    if (!questions.length) {
      throw new Error('QuizGame.init: у наборі немає жодного питання');
    }
    if (data.theme && data.theme.accentColor) {
      document.body.style.setProperty('--game-accent', data.theme.accentColor);
    }
    restart();
  }

  /* База платформи — світла пастель, тому міткою позначається ВІДХИЛЕННЯ, а
     не типовий стан: setTheme('light') просто знімає мітку. */
  function setTheme(mode) {
    document.body.classList.toggle('theme-dark', mode === 'dark');
    document.documentElement.toggleAttribute('data-theme-dark', mode === 'dark');
  }

  window.QuizGame = {
    init: init,
    restart: restart,
    setTheme: setTheme
  };
})();
