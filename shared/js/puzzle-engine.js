/* window.PuzzleGame — складання портрета з фрагментів 3×3.

   Один рушій на два місця вжитку. У попередньому репозиторії міні-пазл на
   головній і повна гра були двома незалежними копіями коду — саме той дубль,
   який розходиться через півроку. Тут різницю задає лише mode.

     compact — один набір, деталі лише цього набору, сітка під колонку
               головної сторінки. Виграш -> onWin, поле лишається на місці.
     full    — усі набори поспіль; у лотку перемішані фрагменти ВСІХ наборів,
               тому спершу треба впізнати постать. Між пазлами — onSolved
               із довідкою, після останнього — onFinish.

   Приклад:

     PuzzleGame.init({
       containerId: 'miniGame',
       sets: window.PUZZLE_HETMANY.sets,
       basePath: 'games/puzzle-hetmany/assets/',
       mode: 'compact',
       onWin: function (set) { … }
     });

   API:
     init(config)   -> undefined
     restart()      -> undefined   почати спочатку тим самим config

   Керування — миша, дотик і «клік-щоб-поставити». Третій спосіб не забаганка:
   без нього гра недоступна з клавіатури й важка на тачпаді.

   Жодного innerHTML (export.md B4). */

(function () {
  'use strict';

  var SIZE = 3;
  var CELLS = SIZE * SIZE;

  var config = null;
  var cells = [];
  var tray = null;
  var board = null;
  var setIndex = 0;
  var selected = null;
  var solvedNames = [];

  /* Фрагменти — пазлові, з «вушками»: при клітинці 133px файл має 170px, і
     кутові фрагменти менші за серединні. Отже, вписати кожен у клітинку
     через max-width не можна — вони масштабувалися б різними коефіцієнтами
     й не зійшлися б краями. Замість цього всі отримують ОДИН коефіцієнт
     (ширина поля / розмір оригіналу) і виходять за межі своєї клітинки. */
  function applyScale() {
    if (!board) { return; }
    var width = board.clientWidth;
    if (!width) { return; }
    board.style.setProperty('--puzzle-scale', width / config.boardSize);
  }

  /* --- службове ---------------------------------------------------------- */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  function shuffle(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var swap = out[i];
      out[i] = out[j];
      out[j] = swap;
    }
    return out;
  }

  function pieceSrc(set, number) {
    return config.basePath + set.id + '_' + number + '.png';
  }

  function portraitSrc(set) {
    return config.basePath + set.id + '_0.jpg';
  }

  function currentSet() {
    return config.sets[setIndex];
  }

  /* --- побудова ---------------------------------------------------------- */

  function build() {
    var root = document.getElementById(config.containerId);
    if (!root) { return; }
    clear(root);
    selected = null;

    var set = currentSet();
    var wrap = el('div', 'puzzle puzzle--' + config.mode);

    if (config.mode === 'full') {
      var hud = el('div', 'puzzle__hud');
      hud.appendChild(el('span', 'puzzle__hud-title',
        'Пазл ' + (setIndex + 1) + ' з ' + config.sets.length));
      hud.appendChild(el('span', 'puzzle__hud-count', 'Розміщено: 0 / ' + CELLS));
      wrap.appendChild(hud);
      wrap.appendChild(el('p', 'puzzle__clue', set.clue));
    }

    board = el('div', 'puzzle__board');
    cells = [];
    for (var i = 1; i <= CELLS; i++) {
      var cell = el('div', 'puzzle__cell');
      cell.dataset.index = String(i);
      cell.appendChild(el('span', 'puzzle__cell-num', i));
      board.appendChild(cell);
      cells.push(cell);
    }
    wrap.appendChild(board);

    tray = el('div', 'puzzle__tray');
    buildPieces(set);
    wrap.appendChild(tray);

    var actions = el('div', 'puzzle__actions');
    var reset = el('button', 'puzzle__btn', 'Скинути');
    reset.type = 'button';
    reset.addEventListener('click', resetBoard);
    actions.appendChild(reset);
    actions.appendChild(el('span', 'puzzle__progress', 'Розміщено: 0 / ' + CELLS));
    wrap.appendChild(actions);

    root.appendChild(wrap);
    applyScale();
    updateProgress();
  }

  /* У compact лоток містить лише фрагменти поточного набору — це коротка
     розвага збоку від головного змісту сторінки. У full туди йдуть усі
     набори: впізнати постать серед чужих фрагментів і є завданням. */
  function buildPieces(set) {
    clear(tray);
    var pieces = [];
    var sets = config.mode === 'full' ? config.sets : [set];

    sets.forEach(function (item) {
      for (var i = 1; i <= CELLS; i++) {
        pieces.push({ set: item, number: i });
      }
    });

    shuffle(pieces).forEach(function (piece) {
      var node = el('div', 'puzzle__piece');
      node.dataset.piece = String(piece.number);
      node.dataset.set = piece.set.id;

      var img = document.createElement('img');
      img.src = pieceSrc(piece.set, piece.number);
      img.alt = piece.set.name + ', фрагмент ' + piece.number;
      img.draggable = false;
      /* Відсутній фрагмент не має тихо зникати: інакше пазл стає нерозв'язним
         без жодного натяку чому (та сама думка, що в AssetValidator). */
      img.addEventListener('error', function () {
        node.classList.add('puzzle__piece--broken');
        node.title = 'Немає файлу: ' + img.getAttribute('src');
      });
      node.appendChild(img);
      tray.appendChild(node);
    });
  }

  /* --- переміщення фрагмента --------------------------------------------- */

  function place(piece, cell) {
    var occupant = cell.querySelector('.puzzle__piece');
    if (occupant === piece) { return; }
    if (occupant) { tray.appendChild(occupant); }

    var num = cell.querySelector('.puzzle__cell-num');
    if (num) { num.hidden = true; }
    cell.appendChild(piece);
    updateProgress();
  }

  function returnToTray(piece) {
    var parent = piece.parentElement;
    tray.appendChild(piece);
    if (parent && parent.classList.contains('puzzle__cell')) {
      var num = parent.querySelector('.puzzle__cell-num');
      if (num) { num.hidden = false; }
    }
    updateProgress();
  }

  function cellFromPoint(x, y) {
    for (var i = 0; i < cells.length; i++) {
      var rect = cells[i].getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return cells[i];
      }
    }
    return null;
  }

  function highlight(cell) {
    cells.forEach(function (item) {
      item.classList.toggle('puzzle__cell--over', item === cell);
    });
  }

  function startDrag(piece, startX, startY, isTouch) {
    var img = piece.querySelector('img');
    var rect = (img || piece).getBoundingClientRect();

    var ghost = el('div', 'puzzle__ghost');
    var ghostImg = document.createElement('img');
    ghostImg.src = img ? img.src : '';
    ghostImg.alt = '';
    ghost.appendChild(ghostImg);
    ghost.style.width = rect.width + 'px';
    ghost.style.height = rect.height + 'px';
    document.body.appendChild(ghost);
    piece.classList.add('puzzle__piece--dragging');

    function move(x, y) {
      ghost.style.left = (x - rect.width / 2) + 'px';
      ghost.style.top = (y - rect.height / 2) + 'px';
      highlight(cellFromPoint(x, y));
    }
    move(startX, startY);

    function finish(x, y) {
      ghost.remove();
      piece.classList.remove('puzzle__piece--dragging');
      highlight(null);
      var target = cellFromPoint(x, y);
      if (target) { place(piece, target); } else { returnToTray(piece); }
    }

    if (isTouch) {
      var onTouchMove = function (event) {
        event.preventDefault();
        move(event.touches[0].clientX, event.touches[0].clientY);
      };
      var onTouchEnd = function (event) {
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        finish(event.changedTouches[0].clientX, event.changedTouches[0].clientY);
      };
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    } else {
      var onMouseMove = function (event) { move(event.clientX, event.clientY); };
      var onMouseUp = function (event) {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        finish(event.clientX, event.clientY);
      };
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    }
  }

  function bindInput(root) {
    root.addEventListener('mousedown', function (event) {
      var piece = event.target.closest('.puzzle__piece');
      if (!piece) { return; }
      event.preventDefault();
      startDrag(piece, event.clientX, event.clientY, false);
    });

    root.addEventListener('touchstart', function (event) {
      var piece = event.target.closest('.puzzle__piece');
      if (!piece) { return; }
      event.preventDefault();
      startDrag(piece, event.touches[0].clientX, event.touches[0].clientY, true);
    }, { passive: false });

    /* Клік-щоб-поставити: обрати фрагмент, потім клітинку. Єдиний спосіб,
       доступний із клавіатури, тому фрагменти мусять бути фокусовними. */
    root.addEventListener('click', function (event) {
      var piece = event.target.closest('.puzzle__piece');
      if (piece) {
        if (selected) { selected.classList.remove('puzzle__piece--selected'); }
        selected = selected === piece ? null : piece;
        if (selected) { selected.classList.add('puzzle__piece--selected'); }
        return;
      }
      var cell = event.target.closest('.puzzle__cell');
      if (cell && selected) {
        selected.classList.remove('puzzle__piece--selected');
        place(selected, cell);
        selected = null;
      }
    });
  }

  /* --- прогрес і перемога -------------------------------------------------- */

  function updateProgress() {
    var placed = 0;
    var solved = true;
    var set = currentSet();

    cells.forEach(function (cell, index) {
      var piece = cell.querySelector('.puzzle__piece');
      if (!piece) { solved = false; return; }
      placed += 1;
      if (piece.dataset.set !== set.id
          || parseInt(piece.dataset.piece, 10) !== index + 1) {
        solved = false;
      }
    });

    var text = 'Розміщено: ' + placed + ' / ' + CELLS;
    var progress = document.querySelector('.puzzle__progress');
    if (progress) { progress.textContent = text; }
    var hudCount = document.querySelector('.puzzle__hud-count');
    if (hudCount) { hudCount.textContent = text; }

    if (placed === CELLS && solved) {
      /* Пауза, щоб гравець побачив останній фрагмент на місці, а не стрибок
         одразу в екран перемоги. */
      setTimeout(onSolved, 400);
    }
  }

  function onSolved() {
    if (board) { board.classList.add('puzzle__board--solved'); }
    var set = currentSet();
    if (!solvedNames.length || solvedNames[solvedNames.length - 1] !== set.name) {
      solvedNames.push(set.name);
    }

    if (typeof config.onWin === 'function') { config.onWin(set); }

    setTimeout(function () {
      if (config.mode === 'full') { showCard(set); } else { showCompact(set); }
    }, 900);
  }

  /* compact: портрет, ім'я і кнопка «ще раз». Місця на довідку тут немає — за
     нею є окрема сторінка гри. */
  function showCompact(set) {
    var root = document.getElementById(config.containerId);
    clear(root);

    var box = el('div', 'puzzle__done');
    var img = document.createElement('img');
    img.className = 'puzzle__portrait';
    img.src = portraitSrc(set);
    img.alt = set.name;
    box.appendChild(img);
    box.appendChild(el('p', 'puzzle__done-name', set.name));
    box.appendChild(el('p', 'puzzle__done-years', set.years));

    var again = el('button', 'puzzle__btn', 'Ще один портрет');
    again.type = 'button';
    again.addEventListener('click', function () {
      setIndex = Math.floor(Math.random() * config.sets.length);
      build();
    });
    box.appendChild(again);
    root.appendChild(box);
  }

  function showCard(set) {
    var root = document.getElementById(config.containerId);
    clear(root);
    var last = setIndex >= config.sets.length - 1;

    var box = el('div', 'puzzle__done');
    var img = document.createElement('img');
    img.className = 'puzzle__portrait';
    img.src = portraitSrc(set);
    img.alt = set.name;
    box.appendChild(img);
    box.appendChild(el('h2', 'puzzle__done-name', set.name));
    box.appendChild(el('p', 'puzzle__done-years', set.years));
    box.appendChild(el('p', 'puzzle__done-text', set.description));

    var next = el('button', 'puzzle__btn puzzle__btn--primary',
      last ? 'Результати' : 'Наступний пазл');
    next.type = 'button';
    next.addEventListener('click', function () {
      if (last) { showFinish(); } else { setIndex += 1; build(); }
    });
    box.appendChild(next);
    root.appendChild(box);
  }

  function showFinish() {
    var root = document.getElementById(config.containerId);
    clear(root);

    var box = el('div', 'puzzle__done');
    box.appendChild(el('h2', 'puzzle__done-name', 'Усі портрети зібрано'));
    var list = el('ul', 'puzzle__summary');
    solvedNames.forEach(function (name) {
      list.appendChild(el('li', null, name));
    });
    box.appendChild(list);

    var again = el('button', 'puzzle__btn puzzle__btn--primary', 'Грати знову');
    again.type = 'button';
    again.addEventListener('click', restart);
    box.appendChild(again);
    root.appendChild(box);

    if (typeof config.onFinish === 'function') { config.onFinish(solvedNames); }
  }

  function resetBoard() {
    cells.forEach(function (cell) {
      var piece = cell.querySelector('.puzzle__piece');
      if (piece) { tray.appendChild(piece); }
      var num = cell.querySelector('.puzzle__cell-num');
      if (num) { num.hidden = false; }
    });
    if (board) { board.classList.remove('puzzle__board--solved'); }
    shuffle(Array.prototype.slice.call(tray.children))
      .forEach(function (piece) { tray.appendChild(piece); });
    updateProgress();
  }

  /* --- публічне ------------------------------------------------------------ */

  function init(userConfig) {
    var sets = (userConfig && userConfig.sets) || [];
    if (!sets.length) {
      if (window.console) { console.warn('PuzzleGame: жодного набору'); }
      return;
    }

    config = {
      containerId: userConfig.containerId || 'puzzle',
      sets: sets,
      basePath: userConfig.basePath || '',
      mode: userConfig.mode === 'full' ? 'full' : 'compact',
      /* Розмір оригінального портрета в пікселях. Від нього рахується
         коефіцієнт масштабу фрагментів; підмінити набір картинок іншого
         розміру можна, не чіпаючи рушій. */
      boardSize: userConfig.boardSize || 400,
      onWin: userConfig.onWin || null,
      onFinish: userConfig.onFinish || null
    };

    /* compact бере випадковий портрет — щоб при кожному відкритті головної
       випадав інший. full завжди йде по порядку. */
    setIndex = config.mode === 'compact'
      ? Math.floor(Math.random() * config.sets.length) : 0;
    solvedNames = [];

    var root = document.getElementById(config.containerId);
    if (!root) {
      if (window.console) {
        console.warn('PuzzleGame: немає елемента #' + config.containerId);
      }
      return;
    }
    bindInput(root);
    window.addEventListener('resize', applyScale);
    build();
  }

  function restart() {
    if (!config) { return; }
    setIndex = 0;
    solvedNames = [];
    build();
  }

  window.PuzzleGame = { init: init, restart: restart };
})();
