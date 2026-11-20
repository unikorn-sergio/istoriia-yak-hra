/* window.FactsAdapter — атомарні факти -> дані для рушіїв.

   Це ЄДИНА точка входу фактів в ігри. Рушії про факти не знають: вони
   отримують звичні QUIZ_DATA / FALLING_DATA / TIMELINE_DATA.

   Перетворення відбувається в БРАУЗЕРІ, а не скриптом на етапі збірки.
   Тому немає згенерованих наборів питань — і немає чому розсинхронізуватися
   з facts.md (пастка N1 з export.md).

   Залежності (порядок <script> = граф залежностей):
     data/facts/_schema.js      -> window.FACTS_SCHEMA
     data/facts/_templates.js   -> window.FACTS_TEMPLATES
     data/facts/<topic>.js      -> window.FACTS['<topic>']

   Приклад:

     var data = FactsAdapter.toQuiz('06-ukr-revolution', {
       count: 10,           // скільки питань; 0 або undefined — усі
       types: ['DATE'],     // лишити тільки ці типи; undefined — усі
       difficulty: 'easy',  // undefined — будь-яка
       seed: 42,            // той самий seed -> той самий набір
       quoteMode: 'auto'    // 'auto' | 'stimulus' | 'options' | 'off'
     });
     QuizGame.init({ data: data, containerId: 'quizStage', moduleId: 'тема:шаблон' });

   Детермінізм. Без seed набір щоразу інший. З seed — стабільний: учень може
   перезавантажити сторінку й побачити те саме, а вчитель — надіслати
   посилання на конкретний варіант. */

(function () {
  'use strict';

  var FALLBACK_MIN_OPTIONS = 4;
  var FALLBACK_MIN_QUOTE_OPTIONS = 4;
  var FALLBACK_TEMPLATE = '{concept} — {predicate}?';

  var PLACEHOLDERS = {
    DATE: 'Введіть рік',
    PERSON: 'Введіть імʼя',
    PLACE: 'Введіть назву',
    DOCUMENT: 'Введіть назву',
    ORGANIZATION: 'Введіть назву'
  };

  /* --- службове --------------------------------------------------------- */

  function schema() {
    return window.FACTS_SCHEMA || null;
  }

  function minOptions() {
    var s = schema();
    return (s && s.minChoiceOptions) || FALLBACK_MIN_OPTIONS;
  }

  function isRenderable(type) {
    var s = schema();
    if (!s || !s.types || !s.types[type]) {
      return false;
    }
    return s.types[type].renderable === true;
  }

  function warn(message) {
    if (window.console && console.warn) {
      console.warn('[FactsAdapter] ' + message);
    }
  }

  function info(message) {
    if (window.console && console.info) {
      console.info('[FactsAdapter] ' + message);
    }
  }

  function getTopic(slug) {
    if (!schema()) {
      warn('не завантажено data/facts/_schema.js — без нього невідомо, які типи '
           + 'фактів уміє рушій');
      return null;
    }
    if (!window.FACTS) {
      warn('не завантажено жодного файлу теми (window.FACTS порожній)');
      return null;
    }
    var topic = window.FACTS[slug];
    if (!topic) {
      warn('теми "' + slug + '" немає. Доступні: '
           + Object.keys(window.FACTS).join(', '));
      return null;
    }
    return topic;
  }

  /* --- детермінований генератор ----------------------------------------- */

  function makeRandom(seed) {
    var state;
    if (seed === undefined || seed === null || seed === '') {
      state = Math.floor(Math.random() * 2147483645) + 1;
    } else {
      state = Math.abs(parseInt(seed, 10) || 1) % 2147483645 + 1;
    }
    return function () {
      state = (state * 16807) % 2147483647;
      return (state - 1) / 2147483646;
    };
  }

  function shuffled(list, random) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  /* --- вибірка фактів ---------------------------------------------------- */

  /* Усі факти теми, з яких рушій уміє зробити оцінюване питання.
     RELATION сюди не потрапляє — і про це говориться вголос, а не мовчки:
     формат уміє більше, ніж код, і це має бути видно (пастка N10). */
  function renderablePool(topic, announce) {
    var pool = [];
    var skipped = {};
    var drafts = 0;

    topic.facts.forEach(function (fact) {
      /* Чернетка з програми НМТ, у якій куратор ще не вписав відповідь.
         Такий факт не просто нерендерний — він зіпсує гру: 'TODO' поїде
         у варіанти як правдоподібний дистрактор. */
      if (fact.object === 'TODO' || fact.concept === 'TODO') {
        drafts += 1;
        return;
      }
      if (isRenderable(fact.type)) {
        pool.push(fact);
      } else {
        skipped[fact.type] = (skipped[fact.type] || 0) + 1;
      }
    });

    if (announce) {
      Object.keys(skipped).forEach(function (type) {
        info('тема "' + topic.slug + '": пропущено ' + skipped[type] + ' фактів типу '
             + type + ' — рушія для них немає. Вони доступні через '
             + 'FactsAdapter.toCards().');
      });
      if (drafts) {
        warn('тема "' + topic.slug + '": пропущено ' + drafts + ' незавершених фактів '
             + '(Object: TODO). Допишіть відповідь у facts.md і перезберіть.');
      }
    }
    return pool;
  }

  function applyFilters(pool, opts) {
    return pool.filter(function (fact) {
      if (opts.types && opts.types.length && opts.types.indexOf(fact.type) === -1) {
        return false;
      }
      if (opts.difficulty && fact.difficulty !== opts.difficulty) {
        return false;
      }
      return true;
    });
  }

  function take(list, count) {
    if (!count || count <= 0 || count >= list.length) {
      return list;
    }
    return list.slice(0, count);
  }

  /* --- формулювання ------------------------------------------------------ */

  function questionText(fact) {
    var templates = window.FACTS_TEMPLATES || {};
    var template = templates[fact.type + '|' + fact.predicate]
      || templates[fact.type]
      || templates._default
      || FALLBACK_TEMPLATE;

    return template
      .replace(/\{concept\}/g, fact.concept)
      .replace(/\{predicate\}/g, fact.predicate)
      .replace(/\{object\}/g, fact.object);
  }

  function placeholderFor(fact) {
    return PLACEHOLDERS[fact.type] || 'Введіть відповідь';
  }

  /* --- дистрактори -------------------------------------------------------

     Хибні варіанти — це Object ІНШИХ фактів того ж типу з тим самим
     предикатом. Вони гарантовано правдоподібні (той самий семантичний слот)
     і гарантовано хибні (інший концепт).

     Валідатор стежить, щоб пара (Concept, Predicate) не повторювалася в
     межах типу, тому «інший концепт» справді означає «інша відповідь». */

  function distractorsFor(pool, fact) {
    var seen = {};
    var out = [];
    seen[fact.object] = true;

    pool.forEach(function (other) {
      if (other.type !== fact.type) { return; }
      if (other.predicate !== fact.predicate) { return; }
      if (other.concept === fact.concept) { return; }
      if (seen[other.object]) { return; }
      seen[other.object] = true;
      out.push(other.object);
    });
    return out;
  }

  /* --- уривки -------------------------------------------------------------

     Факт із заповненим `quote` дає дві механіки — це робота з джерелом,
     окрема навичка НМТ:

       stimulus — уривок показується як умова, питають про факт. Формулювання
                  навмисно не називає концепт, інакше відповідь була б у
                  питанні.
       pick     — питають про концепт, а варіантами є САМІ уривки; хибні
                  беруться з `quote` інших фактів теми. Той самий механізм
                  сусідів, лише поле інше.

     `pick` вимагає minQuoteOptions фактів із цитатами. Менше — відкат на
     stimulus: вигаданого уривка не існує так само, як вигаданого дистрактора. */

  function minQuoteOptions() {
    var s = schema();
    return (s && s.minQuoteOptions) || FALLBACK_MIN_QUOTE_OPTIONS;
  }

  function quotedFacts(pool) {
    return pool.filter(function (fact) { return !!fact.quote; });
  }

  function quoteDistractors(quoted, fact) {
    var seen = {};
    var out = [];
    seen[fact.quote] = true;

    quoted.forEach(function (other) {
      if (other.concept === fact.concept) { return; }
      if (seen[other.quote]) { return; }
      seen[other.quote] = true;
      out.push(other.quote);
    });
    return out;
  }

  function quoteTemplate(key) {
    var templates = window.FACTS_TEMPLATES || {};
    return templates['QUOTE|' + key] || templates['QUOTE|_default']
      || 'Прочитайте уривок. Про що йдеться?';
  }

  /* --- QUIZ --------------------------------------------------------------- */

  function toQuiz(slug, opts) {
    opts = opts || {};
    var topic = getTopic(slug);
    if (!topic) { return null; }

    var random = makeRandom(opts.seed);
    var pool = renderablePool(topic, true);
    var chosen = take(shuffled(applyFilters(pool, opts), random), opts.count);

    if (!chosen.length) {
      warn('після фільтрів не лишилося жодного факту для теми "' + slug + '"');
      return null;
    }

    var need = minOptions() - 1;
    var quoteMode = opts.quoteMode || 'auto';
    var quoted = quotedFacts(pool);
    var canPick = quoteMode !== 'off' && quoted.length >= minQuoteOptions();

    if (quoteMode === 'options' && !canPick) {
      info('тема "' + topic.slug + '": фактів із уривками лише ' + quoted.length
           + ', для питань «у якому уривку» потрібно ' + minQuoteOptions()
           + '. Уривки працюватимуть як умова завдання.');
    }

    var questions = chosen.map(function (fact, index) {
      var group = 'q' + (index + 1) + '_' + fact.id;
      var question = {
        factId: fact.id,
        explain: fact.fact,
        detail: fact.detail || null,
        quote: null
      };

      /* --- уривки як варіанти відповіді */
      var wantsPick = fact.quote && canPick
        && (quoteMode === 'options'
            || (quoteMode === 'auto' && random() < 0.5));

      if (wantsPick) {
        var otherQuotes = quoteDistractors(quoted, fact);
        if (otherQuotes.length >= need) {
          question.type = 'choice';
          question.group = group;
          question.text = quoteTemplate('_pick').replace(/\{concept\}/g, fact.concept);
          question.correct = fact.quote;
          question.options = shuffled(
            [fact.quote].concat(shuffled(otherQuotes, random).slice(0, need)),
            random
          );
          return question;
        }
      }

      /* --- звичайне питання; уривок, якщо є, стає умовою */
      var distractors = distractorsFor(pool, fact);
      question.text = fact.quote && quoteMode !== 'off'
        ? quoteTemplate(fact.type)
        : questionText(fact);
      if (fact.quote && quoteMode !== 'off') {
        question.quote = fact.quote;
      }

      if (distractors.length >= need) {
        question.type = 'choice';
        question.group = group;
        question.correct = fact.object;
        question.options = shuffled(
          [fact.object].concat(shuffled(distractors, random).slice(0, need)),
          random
        );
      } else {
        /* Дистракторів не вистачає. Вигаданий дистрактор — це неправильно
           навчений учень, тому питання стає текстовим, а не поганим choice. */
        question.type = 'text';
        question.correct = fact.object;
        question.aliases = fact.aliases || [];
        question.placeholder = placeholderFor(fact);
      }
      return question;
    });

    return {
      title: topic.title,
      slug: topic.slug,
      background: null,
      theme: { accentColor: topic.accent || null },
      password: opts.password || topic.password,
      questions: questions
    };
  }

  /* --- ЗНАЙДИ ЗАЙВУ ----------------------------------------------------------

     Механіка «Детектива Кромвеля» (findImpair, Робоча30, розбір п. 7) на
     датах: три події теми й одна з іншої доби. Навичка — U01 програми,
     «співвідносити дати та історичні факти з періодами» (Mechanic: timeline).

     Віддає ЗВИЧАЙНІ QUIZ_DATA з питаннями 'choice' — нового типу питання
     немає (N10). Два необов'язкові поля, які рушій вікторини читає, але
     без яких обходиться:
       data.layout = 'cards'     варіанти сіткою 2 × 2, а не стовпцем
       question.reveal           { варіант: дата } — показується після відповіді

     Чужа подія береться з ІНШОЇ теми й лежить поза роками цієї теми з
     запасом `margin` років: перекриття тем (культура XIX ст. всередині
     імперських тем) інакше дало б «зайву», яка насправді своя. Серед
     придатних беруться `nearest` найближчих за роками — щоб чужа подія була
     з сусідньої доби, а не «860 р. проти 1991-го».

     Залежність: у window.FACTS мають бути завантажені й ІНШІ теми, а не
     лише ця. games/zaiva.html вантажить усі з FACTS_INDEX.

       var data = FactsAdapter.toOddOneOut('03-rus-ukraina', { rounds: 5, seed: 42 });
  */

  var ODD_DEFAULTS = { rounds: 5, margin: 25, nearest: 10 };
  var DATE_IN_TEXT = /\d{3,4}|[IVXL]+\s*ст/;

  /* Подія з роком у самій назві видала б відповідь — такі не беремо. */
  function oddUsable(topic, announce) {
    return renderablePool(topic, announce).filter(function (fact) {
      return fact.type === 'DATE' && typeof fact.date === 'number'
        && !DATE_IN_TEXT.test(fact.concept);
    });
  }

  /* «1652 р.» уже закінчується крапкою — друга дала б «1652 р..». */
  function sentence(text) {
    return /[.!?]$/.test(text) ? text : text + '.';
  }

  function toOddOneOut(slug, opts) {
    opts = opts || {};
    var topic = getTopic(slug);
    if (!topic) { return null; }

    var rounds = opts.rounds || ODD_DEFAULTS.rounds;
    var margin = typeof opts.margin === 'number' ? opts.margin : ODD_DEFAULTS.margin;
    var nearest = opts.nearest || ODD_DEFAULTS.nearest;
    var random = makeRandom(opts.seed);

    var own = oddUsable(topic, true);
    if (own.length < 3) {
      warn('тема "' + slug + '": датованих подій ' + own.length
           + ', для «знайди зайву» потрібно щонайменше 3');
      return null;
    }

    var lo = Infinity;
    var hi = -Infinity;
    own.forEach(function (fact) {
      lo = Math.min(lo, fact.date);
      hi = Math.max(hi, fact.date);
    });

    var ownConcepts = own.map(function (fact) { return fact.concept; });
    var foreign = [];
    Object.keys(window.FACTS).forEach(function (other) {
      /* Лише теми програми (NN-…): демонстраційні набори — не доба. */
      if (other === slug || !/^\d\d-/.test(other)) { return; }
      oddUsable(window.FACTS[other], false).forEach(function (fact) {
        var distance = fact.date < lo - margin ? lo - fact.date
          : fact.date > hi + margin ? fact.date - hi : 0;
        if (distance > 0 && ownConcepts.indexOf(fact.concept) === -1) {
          foreign.push({ fact: fact, topic: window.FACTS[other], distance: distance });
        }
      });
    });

    if (!foreign.length) {
      warn('тема "' + slug + '": не знайдено жодної події інших тем поза '
           + (lo - margin) + '–' + (hi + margin) + ' рр. Чи завантажено інші теми?');
      return null;
    }

    foreign.sort(function (a, b) { return a.distance - b.distance; });
    var candidates = shuffled(foreign.slice(0, nearest), random);

    /* Свої події йдуть чергою без повторів, доки черги вистачає; у раунді
       три різні. */
    var queue = [];
    function nextOwn(exclude) {
      for (var guard = 0; guard < own.length * 3; guard++) {
        if (!queue.length) { queue = shuffled(own, random); }
        var fact = queue.shift();
        if (exclude.indexOf(fact) === -1) { return fact; }
        queue.push(fact);
      }
      return null;
    }

    var questions = [];
    for (var r = 0; r < rounds; r++) {
      var picked = [];
      while (picked.length < 3) { picked.push(nextOwn(picked)); }
      var odd = candidates[r % candidates.length];

      var reveal = {};
      picked.forEach(function (fact) { reveal[fact.concept] = fact.object; });
      reveal[odd.fact.concept] = odd.fact.object;

      questions.push({
        type: 'choice',
        group: 'odd' + (r + 1) + '_' + odd.fact.id,
        factId: odd.fact.id,
        text: 'Три події — з теми «' + topic.title + '». Яка зайва?',
        quote: null,
        correct: odd.fact.concept,
        options: shuffled(picked.map(function (fact) { return fact.concept; })
          .concat(odd.fact.concept), random),
        reveal: reveal,
        explain: 'Зайва — «' + odd.fact.concept + '», ' + odd.fact.object
          + ': це тема «' + odd.topic.title + '».',
        detail: sentence('Решта три — «' + topic.title + '»: '
          + picked.map(function (fact) { return fact.object; }).join(', '))
      });
    }

    return {
      title: topic.title,
      slug: topic.slug,
      layout: 'cards',
      unit: 'Раунд',
      background: null,
      theme: { accentColor: topic.accent || null },
      password: opts.password || topic.password,
      questions: questions
    };
  }

  /* --- FALLING ------------------------------------------------------------ */

  function toFalling(slug, opts) {
    opts = opts || {};
    var topic = getTopic(slug);
    if (!topic) { return null; }

    var random = makeRandom(opts.seed);
    var pool = renderablePool(topic, true);
    var chosen = take(shuffled(applyFilters(pool, opts), random), opts.count);

    if (!chosen.length) {
      warn('після фільтрів не лишилося жодного факту для теми "' + slug + '"');
      return null;
    }

    return {
      title: topic.title,
      section: topic.title,
      winScore: opts.winScore || Math.min(15, chosen.length),
      lives: opts.lives || 3,
      winImage: opts.winImage || null,
      questions: chosen.map(function (fact) {
        return { question: questionText(fact), answer: fact.object };
      })
    };
  }

  /* --- TIMELINE -----------------------------------------------------------

     Порядок задає позиція в масиві, а не парсинг року (контракт E3): рік
     лишається вільним текстом ('бл. 1552', '1591–1593'), сортуємо ми за
     числовим полем date ще до віддачі рушієві.

     Події з ОДНАКОВИМ роком не можуть потрапити в один раунд: впорядкувати
     їх за роком неможливо, і будь-яка відповідь була б однаково правильною.
     Тому раунди збираються так, щоб роки всередині раунду не повторювалися. */

  function timelineRounds(facts, size, maxRounds) {
    var byYear = {};
    facts.forEach(function (fact) {
      var key = String(fact.date);
      if (!byYear[key]) { byYear[key] = []; }
      byYear[key].push(fact);
    });

    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var rounds = [];
    var dropped = [];
    var pass = 0;
    var moreLeft = true;

    while (moreLeft) {
      var layer = [];
      moreLeft = false;
      years.forEach(function (year) {
        var bucket = byYear[String(year)];
        if (bucket.length > pass) {
          layer.push(bucket[pass]);
          if (bucket.length > pass + 1) { moreLeft = true; }
        }
      });
      pass++;
      if (!layer.length) { break; }

      for (var i = 0; i < layer.length; i += size) {
        var chunk = layer.slice(i, i + size);
        /* Раунд з однієї події — не задача: упорядковувати нічого. */
        if (chunk.length >= 2) {
          rounds.push(chunk);
        } else {
          dropped = dropped.concat(chunk);
        }
      }
      if (maxRounds && rounds.length >= maxRounds) { break; }
    }

    if (maxRounds && rounds.length > maxRounds) {
      rounds.slice(maxRounds).forEach(function (chunk) {
        dropped = dropped.concat(chunk);
      });
      rounds = rounds.slice(0, maxRounds);
    }
    return { rounds: rounds, dropped: dropped };
  }

  function toTimeline(slug, opts) {
    opts = opts || {};
    var topic = getTopic(slug);
    if (!topic) { return null; }

    var dated = renderablePool(topic, true).filter(function (fact) {
      return fact.date !== null && fact.date !== undefined;
    });

    if (dated.length < 2) {
      warn('у темі "' + slug + '" менше двох фактів із числовим полем Date — '
           + 'хронологію не збудувати');
      return null;
    }

    var size = opts.size || 5;
    var built = timelineRounds(dated, size, opts.rounds);

    if (!built.rounds.length) {
      warn('у темі "' + slug + '" усі датовані факти припадають на той самий рік — '
           + 'впорядкувати їх неможливо');
      return null;
    }

    /* Події з тим самим роком не можуть опинитися в одному раунді, тому
       частина фактів у хронологію не потрапляє. Це не має відбуватися
       мовчки: автор теми мусить бачити, що саме випало. */
    if (built.dropped.length) {
      info('тема "' + topic.slug + '": у хронологію не потрапило '
           + built.dropped.length + ' фактів ('
           + built.dropped.map(function (f) { return f.id + ' ' + f.object; }).join(', ')
           + ') — для їхніх років уже зайнято місце в раунді.');
    }

    return {
      title: topic.title,
      section: topic.title,
      rounds: built.rounds.map(function (chunk, index) {
        return {
          name: 'Раунд ' + (index + 1),
          events: chunk.map(function (fact) {
            return {
              text: fact.concept,
              year: fact.object,
              detail: fact.detail || fact.fact
            };
          })
        };
      })
    };
  }

  /* --- КАРТКИ -------------------------------------------------------------

     Єдиний вихід, де RELATION не пропускається: картка не оцінює відповідь,
     тому кілька правильних об'єктів їй не заважають. */

  function toCards(slug, opts) {
    opts = opts || {};
    var topic = getTopic(slug);
    if (!topic) { return null; }

    var random = makeRandom(opts.seed);
    var chosen = applyFilters(topic.facts, opts);

    return shuffled(chosen, random).map(function (fact) {
      return {
        id: fact.id,
        type: fact.type,
        front: questionText(fact),
        back: fact.fact,
        quote: fact.quote || null,
        detail: fact.detail || null
      };
    });
  }

  /* --- довідка ------------------------------------------------------------ */

  function supportedTypes() {
    var s = schema();
    return s && s.renderable ? s.renderable.slice() : [];
  }

  function listTopics() {
    return (window.FACTS_INDEX || []).slice();
  }

  window.FactsAdapter = {
    toQuiz: toQuiz,
    toFalling: toFalling,
    toTimeline: toTimeline,
    toOddOneOut: toOddOneOut,
    toCards: toCards,
    supportedTypes: supportedTypes,
    listTopics: listTopics
  };
})();
