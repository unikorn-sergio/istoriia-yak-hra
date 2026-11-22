/*
 * BoardTasks — чотири види завдань на клітинках (словник полів — як у «каркасі
 * гри» курсу: bins/items/bin, steps/extra, parts/t/fake, why).
 *
 * Приклад:
 *   BoardTasks.run(task, mountEl, function (ok) { … });
 *
 * Спільні правила (довідкова картка «Чотири каркаси», розділ а):
 *  - помилка НЕ показує правильної відповіді — інакше друга спроба є пам'яттю,
 *    а не знанням (завдання може повернутися пізніше);
 *  - пояснення why — лише після успіху;
 *  - варіанти й елементи щоразу перемішуються (вада «завжди Б»).
 */
(function () {
  'use strict';

  var LABEL = { choice: 'Питання', sort: 'Сортування', sequence: 'Послідовність', forgery: 'Підробка' };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function shuffle(a) {
    var r = a.slice();
    for (var i = r.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = r[i]; r[i] = r[j]; r[j] = t;
    }
    return r;
  }

  function run(task, mount, done) {
    var box = el('div', 'task task-' + task.kind);
    box.appendChild(el('p', 'task-kind', LABEL[task.kind] || 'Завдання'));
    box.appendChild(el('p', 'task-text', task.text));
    var body = el('div', 'task-body');
    box.appendChild(body);
    var result = el('div', 'task-result');
    result.setAttribute('role', 'status');
    result.setAttribute('aria-live', 'polite');
    box.appendChild(result);
    mount.appendChild(box);

    var finished = false;
    function finish(ok, note) {
      if (finished) return;
      finished = true;
      box.classList.add(ok ? 'task-ok' : 'task-fail');
      Array.prototype.forEach.call(body.querySelectorAll('button'), function (b) { b.disabled = true; });
      result.appendChild(el('p', 'task-verdict', ok ? 'Правильно.' : 'Не вдалося.'));
      if (ok && task.why) result.appendChild(el('p', 'task-why', task.why));
      if (!ok) result.appendChild(el('p', 'task-why', note || 'Правильну відповідь гра не показує: завдання ще може повернутися.'));
      done(ok);
    }

    KINDS[task.kind](task, body, finish);
    var first = body.querySelector('button');
    if (first) first.focus();
  }

  var KINDS = {
    choice: function (t, body, finish) {
      var list = el('div', 'opts');
      shuffle(t.options).forEach(function (opt) {
        var b = el('button', 'btn opt', opt);
        b.type = 'button';
        b.addEventListener('click', function () {
          b.classList.add('picked');
          finish(opt === t.correct);
        });
        list.appendChild(b);
      });
      body.appendChild(list);
    },

    sort: function (t, body, finish) {
      var items = shuffle(t.items);
      var i = 0;
      var progress = el('p', 'task-progress');
      var card = el('p', 'sort-item');
      var bins = el('div', 'opts opts-row');
      body.appendChild(progress);
      body.appendChild(card);
      body.appendChild(bins);
      t.bins.forEach(function (name) {
        var b = el('button', 'btn bin', name);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (items[i].bin !== name) { finish(false); return; }
          i++;
          if (i >= items.length) { card.textContent = 'Усе розкладено.'; finish(true); return; }
          show();
        });
        bins.appendChild(b);
      });
      function show() {
        progress.textContent = 'Елемент ' + (i + 1) + ' з ' + items.length + '. Куди його покласти?';
        card.textContent = items[i].text;
      }
      show();
    },

    sequence: function (t, body, finish) {
      var extra = shuffle(t.extra || []).slice(0, 2);
      var pool = shuffle(t.steps.concat(extra));
      var chain = el('ol', 'seq-chain');
      var hint = el('p', 'task-progress', 'Натискайте кроки по черзі, від першого. Серед них може бути чужий.');
      var cards = el('div', 'opts');
      body.appendChild(hint);
      body.appendChild(chain);
      body.appendChild(cards);
      var next = 0;
      pool.forEach(function (s) {
        var b = el('button', 'btn opt', s);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (s !== t.steps[next]) { finish(false); return; }
          chain.appendChild(el('li', null, s));
          b.remove();
          next++;
          if (next >= t.steps.length) finish(true);
        });
        cards.appendChild(b);
      });
    },

    forgery: function (t, body, finish) {
      var need = t.parts.filter(function (p) { return p.fake; }).length;
      var found = 0;
      var hint = el('p', 'task-progress');
      var doc = el('div', 'forg-doc');
      body.appendChild(hint);
      body.appendChild(doc);
      function count() {
        hint.textContent = 'Натисніть фрагменти, яких не могло бути в цьому документі. Знайдено: ' + found + ' з ' + need + '.';
      }
      t.parts.forEach(function (p) {
        var b = el('button', 'forg-part', p.t);
        b.type = 'button';
        b.addEventListener('click', function () {
          if (!p.fake) { finish(false, 'Цей фрагмент справжній. Які саме підроблені, гра не показує.'); return; }
          b.disabled = true;
          b.classList.add('forg-found');
          found++;
          count();
          if (found >= need) finish(true);
        });
        doc.appendChild(b);
        doc.appendChild(document.createTextNode(' '));
      });
      count();
    }
  };

  window.BoardTasks = { run: run, LABEL: LABEL };
})();
