/* window.NarrativeStage — анімована сцена наративної гри.

   Екран розбитий на квадрати по 152 px, і персонажі переміщаються саме по них.
   Посередині — зарезервований блок (панель Wordwall плюс керування): його
   клітинки заблоковані, тому Міра фізично не може туди зайти, і панель
   лишається центром уваги. Міра йде доріжкою локації, б'ється на позначених
   постах, дістає шкоду, відступає, падає й підводиться. Учень тим часом
   проходить (або не проходить) завдання — сцена від нього не залежить.

   Приклад:

     NarrativeStage.init({
       containerId: 'stage',
       panelId: 'arena',                       // блок, який займає ~70 % екрана
       reserve: { w: 0.7, h: 0.7, anchor: 'center' },
       data: window.VIRASKA_DATA,
       basePath: '../' + window.VIRASKA_DATA.basePath,
       narrateId: 'stageStatus',
       onArrive: function (location, index) { ... },
       onFinish: function () { ... }
     });

     NarrativeStage.advance();     // кнопка «Продовжити шлях»

   API:
     init(config)     -> undefined
     advance()        -> boolean   false, якщо перехід уже триває
     locationIndex()  -> number
     relayout()       -> undefined   перерахувати сітку (кличеться сама на resize)
     destroy()        -> undefined

   ЧОМУ DOM, А НЕ <canvas>. Спрайти — анімовані .gif. ctx.drawImage() малює
   один кадр, і анімація завмирає. Тому актор — це <div> із вкладеним <img>.

   ЧОМУ BFS, А НЕ КРОК У БІК ЦІЛІ. Сітка має діру посередині, і жадібний крок
   застрягає об кут панелі. Застрягла Міра — та сама глуха стіна, від якої гру
   звільняли рішенням «впасти можна, застрягти ні». Сітка мала (12x7 на
   1920x1080), тож пошук у ширину коштує ніщо і не застрягає ніколи. Він же
   дасть майбутнє «відступити до безпечної зони».

   ЧОМУ ПРИВ'ЯЗКА ПО НИЗУ-ЦЕНТРУ. Спрайти різного розміру: enemy-attack
   166x128, enemy-jump 151x145, решта 128x128. Прив'язка по лівому-верхньому
   куту змушувала б персонажа підстрибувати на кожній зміні стану.

   БІЙ — ЦЕ ТЕАТР, І ЦЕ НАВМИСНО. Результат завдання Wordwall прочитати
   НЕМОЖЛИВО: чужий домен, жодного postMessage. Тому бій не може оцінюватися
   завданням, і шкала здоров'я існує лише щоб бій виглядав живим. Гра не
   нараховує монет і нікого не оцінює — це шар «Цінності», не «Уміння».

   ПАДІННЯ КОШТУЄ ЧАСУ, А НЕ ПРОГРЕСУ. Збита Міра не зникає й не з'являється
   наново — вона повзе до синьої зони, лікується там, бере лук, робить один
   постріл із-за межі ділянки ворога, відходить назад і аж тоді знову йде в
   шаблю. Шлях це не блокує ніяк: карати нема за що, гра нічого не оцінює.
   Змінюється не покарання, а тактика.

   ДВІ ГЕОМЕТРІЇ УДАРУ, БЕЗ ЩІЛИНИ МІЖ НИМИ. `canStrike` — той самий рядок,
   `canStrikeVertical` — сусідній, і нижньою межею другому служить верхня межа
   першого. Довкола кута панелі пара сходиться по діагоналі, і поки між тестами
   лишався зазор, обидва автомати цю пару не бачили: спрайти налазили один на
   одного, а бій не починався. Тому окремої нижньої константи тут немає й бути
   не має. */

(function () {
  'use strict';

  /* --- сталі ---------------------------------------------------------------

     Час у мілісекундах, швидкості — у КЛІТИНКАХ за секунду, відстані — у
     клітинках. Пікселів у логіці немає взагалі: вони з'являються лише в
     drawActor(), коли клітинку треба покласти на екран. */

  var STEP_MAX = 100;          /* стеля кроку симуляції: вкладка була схована */
  var WALK_SPEED = 2.0;
  var RETREAT_SPEED = 1.5;
  var CROUCH_SPEED = 1.3;      /* крадькома — повільніше за ходу */
  var LIMP_SPEED = 1.1;        /* заповз після падіння — найповільніше з усього */
  var ENEMY_SPEED = 1.2;

  var STRIKE_X = 1.25;         /* дістає на сусідню клітинку */
  var STRIKE_Y = 0.45;         /* але тільки в тому самому рядку */

  /* Бій на РІЗНИХ рядках. Довкола кута панелі Міра й ворог сходяться з двох
     площин і опиняються по діагоналі: по горизонталі вони вже поруч, а STRIKE_Y
     їх не бачить — обидва топчуться впритул, не дістаючи одне одного, і спрайти
     налазять один на одного. Це і є «колізія анімацій».

     Дальність по горизонталі та сама (STRIKE_X), відрізняється лише допуск по
     вертикалі, і нижньою межею йому служить сам STRIKE_Y. Так між двома тестами
     не лишається ЖОДНОЇ щілини: пара або в одному рядку (шабля навпростець),
     або в сусідньому (удар згори чи знизу). Окрема нижня константа тут була б
     помилкою — вона й лишала б мертву зону, заради якої все й затівалося. */
  var VSTRIKE_Y_MAX = 1.3;

  /* Постріл. Ближче SHOT_MIN — це вже шабля, далі SHOT_MAX стріла не летить. */
  var SHOT_MIN = 2;
  var SHOT_MAX = 5;

  /* Сагайдак на одну сортію. Потрібен не для «складності», а тому, що інакше
     серію пострілів нема чим завершити: ворог прив'язаний до посту й далі своєї
     ділянки не піде, тож умова «поки не підійде надто близько» сама по собі
     ніколи не спрацює, і Міра розстрілювала б його зі спокою. Стріли беруться
     на спавні — там само, де вона лікується. */
  var ARROWS = 3;
  var ARROW_SPEED = 9;         /* клітинок за секунду: 3 клітинки ~ 330 мс */
  var ARROW_LIFT = 66;         /* px над лінією ніг — висота грудей */

  /* Скільки поза випуску тримається ГАРАНТОВАНО. З близької відстані стріла
     долітає швидше, ніж дограє гіф, і без цього мінімуму кадр утримання не
     встигав з'явитися взагалі — стенд показував 6 кадрів на 9 пострілів. */
  var SHOT_HOLD = 240;

  var MIN_RING = 1;            /* мінімум вільних клітинок з кожного боку */

  /* Перемикати погляд лише за помітної різниці. Без порога знак `enemy.fx -
     hero.fx` стрибає щокадру, коли вони майже на одному x: файл міняється
     _r/_l і .gif стартує з нуля щокадру. Це і є частина «смикання». */
  var FACE_HYSTERESIS = 0.15;

  var FIGHT_TIMEOUT = 30000;   /* поки не мине — Міра не з'являється на новій сцені */
  var VOICE_HOLD = 2500;       /* скільки уривок думки висить, перш ніж його змінять */

  /* Скрадання. На скільки клітинок падає дистанція реакції ворога, поки Міра
     рухається крадькома, і нижче чого вона не опускається. */
  var STEALTH_NOTICE_CUT = 1;
  var MIN_NOTICE = 1;

  var HERO_HP = 100;
  var ENEMY_HP = 100;
  var HIT_LIGHT = 11;
  var HIT_HARD = 21;
  var HIT_DOWN = 17;           /* удар згори: важчий за звичайний, легший за hard */
  /* Три стріли дають 36 — лук пом'якшує, добиває шабля. Більше зробило б сортію
     сильнішою за весь ближній бій, і бій став би додатком до неї. */
  var HIT_ARROW = 12;
  /* 28 — число ПІДІБРАНЕ ВИМІРЮВАННЯМ, не з голови. При 100 HP це чотири
     влучання. Менші значення падінь не дають узагалі: 13, 16, 18 і 24 показали
     нуль падінь за дванадцять проходжень поспіль, тобто вся сцена з луком була
     недосяжним кодом. З 28 виходить 1,25 падіння на проходження, і падіння є в
     УСІХ дванадцяти прогонах. Міняючи це число, переміряйте — сусідні значення
     поводяться зовсім інакше. */
  var HIT_ENEMY = 28;

  /* Здоров'я під час заповзу. Не нуль: порожня смуга читається як труп, а вона
     повзе. Наповнюється до HERO_HP уже на спавні, і це видно на самій смузі. */
  var HP_FLOOR = 12;

  /* Паузи між діями. Раніше темп задавали ще й кулдауни — два механізми на
     одну поведінку означали два місця, де його правити. Лишилися паузи: вони
     видимі на екрані, тому налагоджувані. */
  var PAUSE_ENEMY_ATTACK = 1000;   /* між атаками ворога — рівно секунда */
  var PAUSE_HERO_ATTACK = 450;
  var PAUSE_AFTER_DAMAGE = 300;
  var PAUSE_AT_POINT = 350;
  var PAUSE_AFTER_WIN = 600;
  var PAUSE_BEFORE_READY = 250;

  /* Міра відступає після КОЖНОГО удару — так було з самого початку, і так
     лишається. Спроба зробити відступ імовірнісним падіння давала, але ціною
     поведінки: вона стояла й розмінювалася ударами, тобто «йшла просто на
     ворога». Характеристика повернена.

     Влучання ворог здобуває інакше — не тим, що жертва стоїть, а тим, що він її
     ЛОВИТЬ. `LEAP_CHASE` — як часто він стрибає вслід тому, хто задкує. Це його
     характеристика, не її, і саме вона тепер тримає падіння можливими. */
  var LEAP_CHASE = 0.5;
  var LEAP_COOLDOWN = 1100;    /* не частіше, ніж раз на стільки — інакше суцільний стрибок */

  /* Заповз із зупинками. Шанс перевіряється на кожній пройденій клітинці, тому
     зупинки нерівномірні — вона відпочиває там, де застало, а не за розкладом. */
  var PAUSE_LIMP_REST = 700;
  var LIMP_REST_CHANCE = 0.3;

  /* Між пострілами. Без паузи три постріли зливаються в один довгий і серії не
     видно — а видимість тут і є вся мета. */
  var PAUSE_SHOT = 500;

  /* Тривалості СТАНІВ зняті з самих .gif, а не вигадані. Стан, що показує
     дію, мусить жити ціле число циклів своєї анімації — інакше вона
     обривається на півкадрі й перезапускається з середини, і це видно як
     смикання. Виміряно в assets/:
       walk / attack / attack_hard / battle_ready / crouch / selebration
                              4 кадри x 160 мс = 640
       dead                   2 кадри x 160 мс = 320  (граємо два цикли)
       enemy_atack            6 кадрів x 100 мс = 600
       damage                 2 кадри x   0 мс = 0  (див. DAMAGE_PLAY) */
  var D = {
    takeoff: 160, jump: 640, ready: 640,
    attack: 640, attackHard: 640, attackDown: 640, damage: 640,
    dead: 640, celebration: 640,
    /* Лук. shootBow коротший за решту НЕ з міркувань темпу: у
       mira-attack-bow_*.gif лише 2 кадри по 160 мс. Тривалість завжди
       знімається з файла. */
    revive: 1200, armBow: 640, shootBow: 320,
    enemyAttack: 600, enemyDamage: 320, enemyJump: 520, enemyDead: 960
  };

  /* Шкода — окремий випадок. `mira-damage_r.gif` оголошує НУЛЬ мілісекунд на
     кадр, тож у петлі два кадри блимають із максимальною швидкістю. Браузери
     підтягують нуль приблизно до 100 мс, тобто цикл ~200 мс. Стільки й граємо,
     а далі тримаємо нерухомий damageHold до кінця стану. */
  var DAMAGE_PLAY = 200;

  /* --- стан модуля ---------------------------------------------------------- */

  var config = null;
  var data = null;
  var stage = null;
  var layerGrid = null;
  var layerActors = null;
  var layerFx = null;          /* летючі предмети: у них немає ні HP, ні стану */

  /* `blockedBase` — тільки клітинки під панеллю; `blocked` — вони ж плюс обриви
     біля платформ, які залежать від локації. Дві маски, бо `goToLocation()` НЕ
     перераховує сітку: якби обриви дописувалися просто в `blocked`, вони
     перетікали б із локації в локацію й з кожним переходом з'їдали б поле. */
  var grid = {
    cell: 152, cols: 0, rows: 0, offsetX: 0, offsetY: 0,
    blocked: [], blockedBase: [], box: null, cramped: false
  };

  var index = 0;
  var location = null;
  var points = [];             /* шлях, розв'язаний у клітинки */
  var corridor = {};           /* 'col:row' -> 'ground' | 'platform' */
  var cleared = [];

  var hero = null;
  var enemy = null;
  var corpses = [];
  var shots = [];              /* стріли в польоті */

  var raf = null;
  var lastFrame = 0;
  var clock = 0;               /* час сцени, мс — база для інтервалів між діями */
  var transiting = false;
  var heroSpawnAt = 0;         /* доки не настане — Міри на сцені немає */
  var lastWaitLeft = -1;
  var voiceShownAt = -1e9;     /* коли показали останній уривок думки */
  var voiceQueued = null;
  var reduced = false;
  var resizeTimer = null;

  /* --- службове -------------------------------------------------------------

     Тільки createElement + textContent. Жодного innerHTML: тексти локацій
     пишуть люди, і будь-який `<` став би дірою (export.md B4). */

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) { node.className = className; }
    if (text !== undefined && text !== null) { node.textContent = String(text); }
    return node;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
  }

  /* Супровідний текст — не диктор, а думка, що долинула уривком. Рядок
     береться навмання з `voices[key]`, тому та сама подія двічі не звучить
     однаково. `data-who` каже, чия думка, — стиль вирішує CSS, рушій про
     кольори не знає. */
  function say(key, override) {
    var voice = (data.voices || {})[key];
    if (!voice) { return; }
    var pool = (override && override.length) ? override : (voice.lines || []);
    if (!pool.length) { return; }

    var text = pool[Math.floor(Math.random() * pool.length)];
    var who = voice.who || 'mira';

    /* Уривок мусить устигнути дочитатися. Події на сцені йдуть щільно — Міра
       з'явилася й одразу побачила ворога — і без витримки вхідна думка локації
       гинула, не проживши й кадру. Черга на один рядок: важить остання думка,
       backlog не накопичується. */
    if (clock - voiceShownAt < VOICE_HOLD) {
      voiceQueued = { text: text, who: who };
      return;
    }
    showVoice(text, who);
  }

  function showVoice(text, who) {
    voiceShownAt = clock;
    voiceQueued = null;
    if (!config.narrateId) { return; }
    var box = document.getElementById(config.narrateId);
    if (!box) { return; }
    box.textContent = text;
    box.setAttribute('data-who', who);
  }

  function tickVoice() {
    if (voiceQueued && clock - voiceShownAt >= VOICE_HOLD) {
      showVoice(voiceQueued.text, voiceQueued.who);
    }
  }

  function chance(p) { return Math.random() < p; }

  /* --- сітка ----------------------------------------------------------------

     Клітинки рахуються від розміру вікна, а не від елемента: сцена займає весь
     екран. Залишок ділиться порівну, тому поле не притиснуте до лівого краю. */

  function inBounds(col, row) {
    return col >= 0 && row >= 0 && col < grid.cols && row < grid.rows;
  }

  function isFree(col, row) {
    return inBounds(col, row) && !grid.blocked[row * grid.cols + col];
  }

  function chebyshev(col, row, cell) {
    return Math.max(Math.abs(col - cell.col), Math.abs(row - cell.row));
  }

  function cellOf(actor) {
    return { col: Math.round(actor.fx), row: Math.round(actor.fy) };
  }

  function layoutGrid() {
    var cell = (data.grid && data.grid.cell) || 152;
    var vw = window.innerWidth;
    var vh = window.innerHeight;

    grid.cell = cell;
    grid.cols = Math.max(1, Math.floor(vw / cell));
    grid.rows = Math.max(1, Math.floor(vh / cell));
    grid.offsetX = Math.round((vw - grid.cols * cell) / 2);
    grid.offsetY = Math.round((vh - grid.rows * cell) / 2);

    var total = grid.cols * grid.rows;
    grid.blocked = [];
    grid.blockedBase = [];
    for (var i = 0; i < total; i++) {
      grid.blocked[i] = false;
      grid.blockedBase[i] = false;
    }

    /* Тісний екран: після зарезервованого блоку не лишається жодної вільної
       клітинки. Ходити нема де, тому сцена ховається, а гра лишається
       прохідною через панель і кнопку. Видима межа краща за Міру, що стоїть
       під панеллю й не рухається. */
    grid.cramped = grid.cols < 2 * MIN_RING + 1 || grid.rows < 2 * MIN_RING + 1;
    if (grid.cramped) {
      grid.box = null;
      return;
    }

    var share = config.reserve || { w: 0.7, h: 0.7, anchor: 'center' };
    var bw = Math.round(grid.cols * (share.w || 0.7));
    var bh = Math.round(grid.rows * (share.h || 0.7));
    var col0, row0;

    bw = Math.max(1, Math.min(grid.cols - 2 * MIN_RING, bw));
    col0 = Math.floor((grid.cols - bw) / 2);

    if (share.anchor === 'bottom') {
      /* Смуга внизу: кільце потрібне лише згори, з боків клітинки лишаються
         вільні самі собою. */
      bh = Math.max(1, Math.min(grid.rows - MIN_RING, bh));
      row0 = grid.rows - bh;
    } else {
      bh = Math.max(1, Math.min(grid.rows - 2 * MIN_RING, bh));
      row0 = Math.floor((grid.rows - bh) / 2);
    }

    grid.box = { col: col0, row: row0, w: bw, h: bh };
    for (var r = row0; r < row0 + bh; r++) {
      for (var c = col0; c < col0 + bw; c++) {
        if (inBounds(c, r)) {
          grid.blocked[r * grid.cols + c] = true;
          grid.blockedBase[r * grid.cols + c] = true;
        }
      }
    }
  }

  /* Панель отримує геометрію ВІД сітки, а не навпаки: інакше вона стояла б на
     півклітинки й Міра або впиралася б у порожнечу, або залазила б під неї. */
  function layoutPanel() {
    var panel = config.panelId && document.getElementById(config.panelId);
    if (!panel) { return; }
    if (!grid.box) {
      panel.style.left = '';
      panel.style.top = '';
      panel.style.width = '';
      panel.style.height = '';
      return;
    }
    panel.style.left = (grid.offsetX + grid.box.col * grid.cell) + 'px';
    panel.style.top = (grid.offsetY + grid.box.row * grid.cell) + 'px';
    panel.style.width = (grid.box.w * grid.cell) + 'px';
    panel.style.height = (grid.box.h * grid.cell) + 'px';
  }

  function pxLeft(fx) { return grid.offsetX + (fx + 0.5) * grid.cell; }

  function pxBottom(fy) {
    return window.innerHeight - (grid.offsetY + (fy + 1) * grid.cell);
  }

  /* Найближча вільна клітинка — пошуком у ширину назовні. Потрібна там, де
     частка з даних впала під панель: шлях тоді не ламається, а зсувається. */
  function nearestFree(col, row) {
    if (isFree(col, row)) { return { col: col, row: row }; }
    var seen = {};
    var queue = [{ col: col, row: row }];
    seen[col + ':' + row] = true;

    while (queue.length) {
      var cur = queue.shift();
      if (isFree(cur.col, cur.row)) { return cur; }
      var steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < steps.length; i++) {
        var nc = cur.col + steps[i][0];
        var nr = cur.row + steps[i][1];
        if (!inBounds(nc, nr)) { continue; }
        var key = nc + ':' + nr;
        if (seen[key]) { continue; }
        seen[key] = true;
        queue.push({ col: nc, row: nr });
      }
    }
    return { col: 0, row: 0 };
  }

  /* Шлях по вільних клітинках. allow — необов'язкове додаткове обмеження
     (ним ворог тримається своєї зони). null означає «дійти неможливо». */
  function findRoute(from, to, allow) {
    if (from.col === to.col && from.row === to.row) { return []; }

    var prev = {};
    var seen = {};
    seen[from.col + ':' + from.row] = true;
    var queue = [from];
    var found = null;

    while (queue.length) {
      var cur = queue.shift();
      if (cur.col === to.col && cur.row === to.row) { found = cur; break; }

      var steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (var i = 0; i < steps.length; i++) {
        var nc = cur.col + steps[i][0];
        var nr = cur.row + steps[i][1];
        if (!isFree(nc, nr)) { continue; }
        if (allow && !allow(nc, nr)) { continue; }
        var key = nc + ':' + nr;
        if (seen[key]) { continue; }
        seen[key] = true;
        prev[key] = cur;
        queue.push({ col: nc, row: nr });
      }
    }

    if (!found) { return null; }

    var route = [];
    var node = found;
    while (node && !(node.col === from.col && node.row === from.row)) {
      route.unshift(node);
      node = prev[node.col + ':' + node.row];
    }
    return route;
  }

  /* --- спрайти --------------------------------------------------------------

     Запис у маніфесті — {r, l}: файл для погляду вправо і для погляду вліво.
     Намальовано лише один бік — беремо його й кажемо CSS дзеркалити.
     Глобальної константи «базового напрямку» немає навмисно: одна константа
     на двох персонажів, намальованих у різні боки, і давала баг «вороги
     перейняли орієнтацію Міри». */

  function pickSide(entry, dir) {
    if (!entry) { return null; }
    var want = dir > 0 ? 'r' : 'l';
    var other = dir > 0 ? 'l' : 'r';
    if (entry[want]) { return { file: entry[want], flip: false }; }
    if (entry[other]) { return { file: entry[other], flip: true }; }
    return null;
  }

  function spriteOf(kind, state, dir) {
    return pickSide((data.sprites[kind] || {})[state], dir);
  }

  /* Логічний стан автомата не завжди збігається з назвою спрайта: пауза
     малюється спокійною позою, відступ і обхід — крадькома, стрибок — двома
     різними кадрами залежно від напрямку, а шкода після короткого програвання
     ЗАМИРАЄ на нерухомому кадрі. Без цієї мапи spriteOf() віддав би null і
     персонаж застигав би в попередньому кадрі. */
  function spriteState(actor) {
    if (actor.state === 'pause') { return actor.pauseSprite; }
    /* Крадькома — три різні наміри, одна поза. */
    if (actor.state === 'retreat' || actor.state === 'flank'
        || actor.state === 'limp') {
      return 'crouch';
    }
    /* Із луком у руках: підхід і відхід малюються тим самим присідом. */
    if (actor.state === 'stalk' || actor.state === 'fallback') {
      return 'crouchBow';
    }
    if (actor.state === 'arm') { return 'idleBow'; }
    /* Гіф пострілу — 2 кадри, 320 мс, і далі в петлю. Постріл у петлі читається
       як тремтіння, тому після одного програвання тримаємо нерухому позу
       випуску, поки стріла в повітрі. Той самий прийом, що й damage/damageHold. */
    if (actor.state === 'shoot') {
      return actor.time > D.shootBow ? 'attackBowHold' : 'attackBow';
    }
    if (actor.state === 'revive') { return 'idle'; }
    /* Присід перед стрибком і є присід. Окремий crouchJump прибрано: його файл
       був побайтовою копією важкого удару, тож перед кожним стрибком блимав
       замах шаблею. */
    if (actor.state === 'takeoff') { return 'crouch'; }
    /* jumpUp/jumpDown існують ЛИШЕ в Міри. Ворог має один кадр стрибка, і
       раніше spriteState віддавав йому неіснуючий ключ: spriteOf повертав
       null, drawActor мовчки лишав попередній кадр — enemy-jump_l.gif не грав
       жодного разу за всю історію гри. */
    if (actor.state === 'jump') {
      return actor.kind === 'mira' ? (actor.jumpDir || 'jumpUp') : 'jump';
    }
    if (actor.state === 'damage' && actor.time > DAMAGE_PLAY) {
      return 'damageHold';
    }
    return actor.state;
  }

  /* --- актор ---------------------------------------------------------------- */

  function makeActor(kind) {
    var node = el('div', 'stage__actor stage__actor--' + kind);

    var img = el('img', 'stage__sprite');
    img.alt = '';
    node.appendChild(img);

    /* Відсутній актив мусить бути ВИДИМИМ. Мовчазна порожнеча на місці
       персонажа читається як зламана сторінка — і правильно читається. */
    var missing = el('span', 'stage__missing');
    missing.hidden = true;
    node.appendChild(missing);

    img.addEventListener('error', function () {
      img.hidden = true;
      missing.hidden = false;
      missing.textContent = 'немає: ' + (img.getAttribute('data-file') || '?');
    });
    img.addEventListener('load', function () {
      img.hidden = false;
      missing.hidden = true;
    });

    layerActors.appendChild(node);

    return {
      kind: kind, node: node, img: img,
      fx: 0, fy: 0, dir: 1,
      state: 'idle', time: 0, hitDone: false,
      hp: 0, maxHp: 0, blows: 0, src: '', bar: null,
      route: null, goalKey: '', jump: null, jumpDir: 'jumpUp',
      pauseFor: 0, pauseNext: 'idle', pauseSprite: 'idle',
      post: null, zone: 2, nextAttackAt: 0, nextLeapAt: 0, alerted: false, leap: null,
      arrows: 0, shot: null,
      /* Одноразові наміри «наступного разу зроби інакше». Обидва знімаються
         НА ПОЧАТКУ дії, а не в кінці: інакше будь-яке переривання лишає
         прапорець живим і намір повторюється нескінченно. */
      flankNext: false, bowNext: false
    };
  }

  function setState(actor, state) {
    actor.state = state;
    actor.time = 0;
    actor.hitDone = false;
  }

  function pause(actor, ms, next, sprite) {
    actor.pauseFor = ms;
    actor.pauseNext = next;
    actor.pauseSprite = sprite || 'idle';
    setState(actor, 'pause');
  }

  function addBar(actor, kind) {
    var bar = el('div', 'stage__hp stage__hp--' + kind);
    var fill = el('i', 'stage__hp-fill');
    bar.appendChild(fill);
    actor.node.appendChild(bar);
    actor.bar = fill;
  }

  function drawActor(actor) {
    var sprite = spriteOf(actor.kind, spriteState(actor), actor.dir);
    if (sprite) {
      var src = config.basePath + sprite.file;
      /* Не чіпаємо src без потреби: присвоєння перезапускає .gif із нуля. */
      if (src !== actor.src) {
        actor.src = src;
        actor.img.setAttribute('data-file', sprite.file);
        actor.img.src = src;
      }
      actor.node.classList.toggle('is-flipped', !!sprite.flip);
    }
    actor.node.style.left = pxLeft(actor.fx) + 'px';
    actor.node.style.bottom = pxBottom(actor.fy) + 'px';

    if (actor.bar) {
      actor.bar.style.width = Math.max(0, actor.hp / actor.maxHp * 100) + '%';
      /* Смуга здоров'я має сенс лише в бою. Поза боєм вона перетворює
         прогулянку на інтерфейс шутера. */
      actor.bar.parentNode.hidden = !enemy;
    }
  }

  /* --- рух по клітинках ------------------------------------------------------ */

  function beginJump(actor, target) {
    actor.jump = {
      fromX: actor.fx, fromY: actor.fy,
      toX: target.col, toY: target.row
    };
    /* Менший рядок = вище на екрані. */
    actor.jumpDir = target.row < actor.fy ? 'jumpUp' : 'jumpDown';
    if (target.col !== actor.fx) { actor.dir = target.col > actor.fx ? 1 : -1; }
    /* Куди повернутися після приземлення. Без цього стрибок посеред обходу
       скидав Міру у 'walk', вона знову бачила flankNext і планувала обхід
       заново — і так по колу, ганяючи кільцем і не б'ючись. */
    actor.jumpReturn =
      (actor.state === 'flank' || actor.state === 'retreat'
       || actor.state === 'stalk' || actor.state === 'fallback')
        ? actor.state : 'walk';
    setState(actor, 'takeoff');
  }

  /* Крок по маршруту. Повертає true, коли маршрут вичерпано. */
  function stepAlongRoute(actor, speed, step) {
    if (!actor.route || !actor.route.length) { return true; }
    var target = actor.route[0];

    /* Перепад рядків для Міри — це стрибок, а не ковзання вгору. Саме тут
       нарешті грають mira-jump-*. Виняток один: заповз після падіння. Стрибок
       посеред заповзу — це вже не заповз, тож перепад вона переповзає. */
    if (actor.kind === 'mira' && actor.state !== 'limp'
        && target.row !== Math.round(actor.fy)) {
      beginJump(actor, target);
      return false;
    }

    var move = speed * step / 1000;
    var dx = target.col - actor.fx;
    var dy = target.row - actor.fy;

    if (Math.abs(dx) > 0.001) {
      actor.dir = dx > 0 ? 1 : -1;
      if (Math.abs(dx) > move) { actor.fx += dx > 0 ? move : -move; return false; }
      actor.fx = target.col;
    }
    if (Math.abs(dy) > 0.001) {
      if (Math.abs(dy) > move) { actor.fy += dy > 0 ? move : -move; return false; }
      actor.fy = target.row;
    }

    actor.route.shift();
    return actor.route.length === 0;
  }

  /* --- стріла ---------------------------------------------------------------

     Не актор: ні здоров'я, ні стану, ні автомата — лише ціль і швидкість. Тому
     живе на власному шарі й оновлюється окремо від акторів.

     ШКОДА НАРАХОВУЄТЬСЯ НА ВЛУЧАННІ, а не за таймером анімації. Це те саме
     правило, що й скрізь у цій грі: причину має бути ВИДНО. Раніше постріл
     віднімав здоров'я на середині замаху, і глядач бачив лише позу — тепер між
     причиною і наслідком летить предмет. */

  function launchArrow(target, damage) {
    var sprite = pickSide((data.projectiles || {}).arrow, hero.dir);
    if (!sprite) { return null; }

    var node = el('div', 'stage__arrow');
    var img = el('img', 'stage__arrow-img');
    img.alt = '';
    img.src = config.basePath + sprite.file;
    node.appendChild(img);
    node.classList.toggle('is-flipped', !!sprite.flip);
    layerFx.appendChild(node);

    var shot = {
      node: node, fx: hero.fx, fy: hero.fy,
      dir: hero.dir, target: target, damage: damage, done: false
    };
    shots.push(shot);
    drawArrow(shot);
    return shot;
  }

  function drawArrow(shot) {
    shot.node.style.left = pxLeft(shot.fx) + 'px';
    shot.node.style.bottom = (pxBottom(shot.fy) + ARROW_LIFT) + 'px';
  }

  function dropArrow(shot) {
    if (shot.node.parentNode) { shot.node.parentNode.removeChild(shot.node); }
    shot.done = true;
  }

  function clearArrows() {
    shots.forEach(function (shot) { dropArrow(shot); });
    shots = [];
  }

  function updateArrows(step) {
    if (!shots.length) { return; }
    var move = ARROW_SPEED * step / 1000;

    shots.forEach(function (shot) {
      if (shot.done) { return; }
      shot.fx += shot.dir * move;

      /* Ціль запам'ятана на випуску. Якщо вона встигла загинути, стріла долітає
         й зникає без наслідків — але долітає: зникнути в повітрі вона не може. */
      var hit = shot.target
        && Math.abs(shot.fx - shot.target.fx) <= 0.6
        && Math.abs(shot.fy - shot.target.fy) <= 1;

      if (hit) {
        if (enemy && enemy === shot.target && enemy.hp > 0) {
          enemy.alerted = true;
          hurtEnemy(shot.damage);
        }
        dropArrow(shot);
        return;
      }
      if (shot.fx < -1 || shot.fx > grid.cols) { dropArrow(shot); return; }
      drawArrow(shot);
    });

    shots = shots.filter(function (shot) { return !shot.done; });
  }

  function canStrike(a, b) {
    return !!b && Math.abs(a.fx - b.fx) <= STRIKE_X
                && Math.abs(a.fy - b.fy) <= STRIKE_Y;
  }

  /* Зближення з РІЗНИХ площин: майже той самий стовпець, сусідній рядок. Саме
     цей випадок і виникає довкола кута панелі Wordwall, і саме його раніше не
     бачив жоден із двох автоматів — тому обидва топталися впритул. */
  function canStrikeVertical(a, b) {
    if (!b) { return false; }
    var dy = Math.abs(a.fy - b.fy);
    return Math.abs(a.fx - b.fx) <= STRIKE_X
        && dy > STRIKE_Y && dy <= VSTRIKE_Y_MAX;
  }

  function canEngage(a, b) {
    return canStrike(a, b) || canStrikeVertical(a, b);
  }

  /* Постріл: той самий рядок, дистанція 2..5 клітинок і ВІЛЬНА ЛІНІЯ. Без
     останньої умови Міра стріляла б крізь панель Wordwall — а панель тут не
     декорація, а стіна, в яку вона фізично не заходить. */
  function shotClear(a, b) {
    var row = Math.round(a.fy);
    var from = Math.round(Math.min(a.fx, b.fx));
    var to = Math.round(Math.max(a.fx, b.fx));
    for (var col = from; col <= to; col++) {
      if (!isFree(col, row)) { return false; }
    }
    return true;
  }

  function canShoot(a, b) {
    if (!b) { return false; }
    var dx = Math.abs(a.fx - b.fx);
    return Math.abs(a.fy - b.fy) <= STRIKE_Y
        && dx >= SHOT_MIN && dx <= SHOT_MAX
        && shotClear(a, b);
  }

  /* --- побудова локації ------------------------------------------------------ */

  /* Дані містять частки сітки 0..1; тут вони стають клітинками. Оригінальний
     об'єкт даних НЕ мутується — він спільний глобал, і переписувати його на
     кожен resize означало б зіпсувати джерело. */
  function resolvePoints() {
    points = [];
    if (!location) { return; }
    location.path.forEach(function (point) {
      var col = Math.round((point.x || 0) * (grid.cols - 1));
      var row = Math.round((point.y || 0) * (grid.rows - 1));
      points.push({
        cell: nearestFree(col, row),
        fight: point.fight || null,
        zone: point.zone || 2,
        wait: !!point.wait
      });
    });
    resolveCorridor();
  }

  /* КАНОНІЧНИЙ КОРИДОР — клітинки, якими Міра справді піде, якщо її ніхто не
     зіб'є: той самий BFS, яким вона й ходитиме, прогнаний наперед між сусідніми
     точками. Потрібен лише для показу місцевості, у логіці руху не бере участі.

     Звідси й правило куратора «земля там, де ходять, платформа там, де
     стрибають»: стрибок у stepAlongRoute починається рівно на перепаді рядків,
     тож клітинка зі зміненим рядком — і є та, куди вона стрибне. Місцевість
     ВИВОДИТЬСЯ з поведінки й не може з нею розійтися.

     Вартість: 3–4 запуски BFS по сітці 12x7 на локацію, тобто ніщо. */
  function resolveCorridor() {
    corridor = {};
    /* Сітка повертається до «лише панель заблокована»: обриви минулої локації
       не мають брати участь у прокладанні цього коридору. */
    for (var i = 0; i < grid.blockedBase.length; i++) {
      grid.blocked[i] = grid.blockedBase[i];
    }
    if (points.length < 2) { return; }

    var at = points[0].cell;
    corridor[at.col + ':' + at.row] = 'ground';

    for (var i = 1; i < points.length; i++) {
      var leg = findRoute(at, points[i].cell);
      if (!leg) { at = points[i].cell; continue; }
      for (var k = 0; k < leg.length; k++) {
        var step = leg[k];
        corridor[step.col + ':' + step.row] =
          step.row !== at.row ? 'platform' : 'ground';
        at = step;
      }
      at = points[i].cell;
    }

    blockLedges();
  }

  /* Обриви. Платформа — це виступ, на який СТРИБАЮТЬ; отже поруч із нею ходити
     нема де, інакше вона й не виступ. Клітинки, суміжні з платформою, стають
     непрохідними й не малюються взагалі — так само, як клітинки під панеллю.

     Сам коридор і точки шляху ніколи не блокуються, тому прохід гарантований за
     побудовою: усе, що блокується, лежить ЗА межами маршруту. Саме тому цей
     крок і йде після resolveCorridor(), а не до нього. */
  function blockLedges() {
    var steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    var keep = {};
    Object.keys(corridor).forEach(function (key) { keep[key] = true; });
    points.forEach(function (point) {
      keep[point.cell.col + ':' + point.cell.row] = true;
    });

    Object.keys(corridor).forEach(function (key) {
      if (corridor[key] !== 'platform') { return; }
      var parts = key.split(':');
      var col = Number(parts[0]);
      var row = Number(parts[1]);
      steps.forEach(function (step) {
        var nc = col + step[0];
        var nr = row + step[1];
        if (!inBounds(nc, nr)) { return; }
        if (keep[nc + ':' + nr]) { return; }
        grid.blocked[nr * grid.cols + nc] = true;
      });
    });
  }

  function terrainOf(col, row) {
    return corridor[col + ':' + row] || null;
  }

  /* Варіант плитки вибирається ДЕТЕРМІНОВАНО з координат. Math.random() тут був
     би помилкою: buildGridView() перезапускається на кожному ресайзі, і мапа
     перетасовувалася б у користувача на очах. */
  function tileFor(kind, col, row) {
    var list = (data.terrain || {})[kind];
    if (!list || !list.length) { return null; }
    return list[(col * 7 + row * 13) % list.length];
  }

  /* Клас клітинки за її роллю на мапі. Порядок перевірок = пріоритет: кінець
     маршруту важливіший за зону бою, зона бою — за звичайний рух. */
  function zoneOf(col, row) {
    var i, point;
    for (i = 0; i < points.length; i++) {
      point = points[i];
      if (point.wait && point.cell.col === col && point.cell.row === row) {
        return 'end';
      }
    }
    for (i = 0; i < points.length; i++) {
      point = points[i];
      if (!point.fight) { continue; }
      var post = postCellFor(point, point.zone, i);
      if (chebyshev(col, row, post) <= point.zone) { return 'fight'; }
    }
    if (points.length && points[0].cell.col === col
        && points[0].cell.row === row) {
      return 'spawn';
    }
    return 'walk';
  }

  function decorNode(name, cell) {
    var file = (data.decor || {})[name];
    if (!file) { return null; }
    var node = el('div', 'stage__decor');
    var img = el('img', 'stage__decor-img');
    img.alt = '';
    img.src = config.basePath + file;
    node.appendChild(img);
    node.style.left = (grid.offsetX + (cell.col + 0.5) * grid.cell) + 'px';
    node.style.top = (grid.offsetY + (cell.row + 1) * grid.cell) + 'px';
    return node;
  }

  function buildGridView() {
    clear(layerGrid);
    if (grid.cramped || !location) { return; }

    if (data.grid && data.grid.show !== false) {
      for (var r = 0; r < grid.rows; r++) {
        for (var c = 0; c < grid.cols; c++) {
          if (!isFree(c, r)) { continue; }
          var terrain = terrainOf(c, r);
          var cellNode = el('div', 'stage__cell stage__cell--' + zoneOf(c, r)
            + (terrain ? ' stage__cell--' + terrain : ''));
          cellNode.style.left = (grid.offsetX + c * grid.cell) + 'px';
          cellNode.style.top = (grid.offsetY + r * grid.cell) + 'px';
          cellNode.style.width = grid.cell + 'px';
          cellNode.style.height = grid.cell + 'px';
          /* Плитка йде фоном, а колір зони — у ::after поверх неї: фоновий
             КОЛІР малюється під фоновим ЗОБРАЖЕННЯМ, тому старим способом
             зона перестала б бути видимою. */
          if (terrain) {
            var tile = tileFor(terrain, c, r);
            if (tile) {
              cellNode.style.backgroundImage =
                'url("' + config.basePath + tile + '")';
            }
          }
          layerGrid.appendChild(cellNode);
        }
      }
    }

    /* Декор. Механіки не несе — просто щоб місце бою читалося ще до появи
       ворога. Кінець маршруту нічого не отримує: біла клітинка говорить сама. */
    points.forEach(function (point) {
      if (!point.fight) { return; }
      var node = decorNode('rocks', point.cell);
      if (node) { layerGrid.appendChild(node); }
    });
  }

  function makeHero() {
    var actor = makeActor('mira');
    actor.maxHp = HERO_HP;
    actor.hp = HERO_HP;
    addBar(actor, 'hero');
    return actor;
  }

  /* Пост ворога — не сама точка бою, а клітинка за `zone` кроків далі по
     маршруту. Тоді Міра, дійшовши до точки, опиняється рівно на межі зони:
     ворог рушає до неї, а не чекає, поки вона стане йому на голову. */
  function postCellFor(point, zone, index) {
    var next = points[index + 1];
    var away = 1;
    if (next && next.cell.col !== point.cell.col) {
      away = next.cell.col > point.cell.col ? 1 : -1;
    }
    var d;
    for (d = zone; d >= 1; d--) {
      if (isFree(point.cell.col + away * d, point.cell.row)) {
        return { col: point.cell.col + away * d, row: point.cell.row };
      }
    }
    for (d = zone; d >= 1; d--) {
      if (isFree(point.cell.col - away * d, point.cell.row)) {
        return { col: point.cell.col - away * d, row: point.cell.row };
      }
    }
    return { col: point.cell.col, row: point.cell.row };
  }

  function makeEnemy(point, index) {
    var actor = makeActor('skeleton');
    actor.maxHp = ENEMY_HP;
    actor.hp = ENEMY_HP;
    actor.zone = point.zone;
    actor.post = postCellFor(point, point.zone, index);
    actor.fx = actor.post.col;
    actor.fy = actor.post.row;
    actor.dir = -1;
    setState(actor, 'idle');
    addBar(actor, 'enemy');
    return actor;
  }

  function goToLocation(next) {
    if (next >= data.locations.length) {
      finish();
      return;
    }

    index = next;
    location = data.locations[index];
    cleared = [];
    lastWaitLeft = -1;
    /* Думка, що не встигла прозвучати на старій локації, на новій уже не про
       те. Показана лишається — вона ще дочитується. */
    voiceQueued = null;

    clear(layerActors);
    clearArrows();
    corpses = [];
    enemy = null;
    hero = null;

    document.body.style.setProperty('--stage-tint',
      location.tint || 'var(--color-surface)');

    resolvePoints();
    buildGridView();

    /* Міра могла лишитися добивати ворога на попередній локації — тоді сцена
       якийсь час стоїть без неї. Це і є ціна кнопки: користувача ніщо не
       тримає, платить Міра. */
    if (clock >= heroSpawnAt) { spawnHero(false); }

    if (config.onArrive) { config.onArrive(location, index); }
  }

  function spawnHero(late) {
    hero = makeHero();
    hero.fx = points[0].cell.col;
    hero.fy = points[0].cell.row;
    hero.dir = 1;
    hero.wp = 1;
    setState(hero, 'walk');

    if (reduced || grid.cramped) {
      /* Без руху: Міра одразу стоїть у кінці доступного відрізка.
         Самі .gif зупинити неможливо — статичних PNG для них немає (є лише
         enemy-dead.png). Тому спрайт на місці анімується далі; це межа
         формату, а не недогляд. */
      var last = points[points.length - 1];
      hero.fx = last.cell.col;
      hero.fy = last.cell.row;
      hero.wp = points.length;
      setState(hero, 'awaiting');
    }

    drawActor(hero);
    /* Рядок role="status" — єдиний канал сцени для скрін-рідера, тому думка
       йде саме туди, а не в окремий абзац поруч. */
    say(late ? 'late' : 'enter', late ? null : location.enter);
  }

  function finish() {
    location = null;
    points = [];
    clear(layerActors);
    clear(layerGrid);
    clearArrows();
    corpses = [];
    enemy = null;

    hero = makeHero();
    hero.bar = null;
    hero.fx = grid.cols > 1 ? Math.floor(grid.cols / 2) : 0;
    hero.fy = grid.rows - 1;
    var spot = nearestFree(hero.fx, hero.fy);
    hero.fx = spot.col;
    hero.fy = spot.row;
    hero.dir = 1;
    setState(hero, 'goodbye');
    drawActor(hero);

    say('outro');
    if (config.onFinish) { config.onFinish(); }
  }

  /* --- ШІ Міри --------------------------------------------------------------

     Скінченний автомат. Правила читаються згори вниз: ворог поруч -> бій;
     ворога немає -> йди до наступної точки; дістала удар -> відступи й
     повернися. */

  function heroPoint() { return points[hero.wp] || null; }

  function ensureEnemy() {
    var point = heroPoint();
    if (!point || !point.fight || cleared[hero.wp] || enemy) { return; }
    enemy = makeEnemy(point, hero.wp);
    say('foe');
  }

  /* Гістерезис: коли ворог майже на одному x із Мірою, знак різниці стрибає
     щокадру. Без порога це перемикало б файл _r/_l і рестартувало .gif
     щокадру — те саме смикання, тільки в бою. */
  function faceEnemy() {
    if (!enemy) { return; }
    var delta = enemy.fx - hero.fx;
    if (Math.abs(delta) < FACE_HYSTERESIS) { return; }
    hero.dir = delta > 0 ? 1 : -1;
  }

  function hurtHero() {
    hero.hp -= HIT_ENEMY;
    hero.route = null;
    if (hero.hp <= 0) {
      hero.hp = 0;
      setState(hero, 'dead');
      say('fall');
      return;
    }
    setState(hero, 'damage');
  }

  function hurtEnemy(amount) {
    enemy.hp -= amount;
    enemy.route = null;
    if (enemy.hp <= 0) {
      enemy.hp = 0;
      setState(enemy, 'dead');
      return;
    }
    setState(enemy, 'damage');
  }

  /* --- сцена падіння --------------------------------------------------------

     Раніше падіння коштувало нуль: Міра миттєво з'являлася на попередній точці
     з половиною здоров'я. Тепер це найдовша сцена в грі й вона розігрується
     цілком на очах:

       dead -> limp -> revive -> arm -> stalk -> shoot -> fallback -> walk
       впала   заповз  лікується  бере   підкра-  постріл  відхід    шабля
                                  лук    дається

     Падіння й далі НЕ блокує шлях — гра нічого не оцінює, карати нема за що.
     Змінюється не покарання, а тактика: удруге лобом вона не піде. */

  function heroFall() {
    hero.route = null;
    hero.hp = HP_FLOOR;
    hero.bowNext = true;
    setState(hero, 'limp');
    say('limp');
  }

  /* Заповз ПРОЙДЕНИМ ШЛЯХОМ, а не навпростець. Той самий BFS, але дозволені
     лише клітинки коридору — тобто рівно ті, якими вона сюди й дійшла, і рівно
     ті, на яких лежить намальована земля. Навпростець вона різала кут через
     відкрите поле й опинялася збоку від ворога — виглядало так, ніби вона на
     нього йде, а не відповзає.

     Якщо коридор недосяжний (її відкинуло далеко вбік), лишається звичайний
     шлях: доповзти вона мусить у будь-якому разі. */
  function limpRoute() {
    var from = cellOf(hero);
    var goal = points[0].cell;
    var byPath = findRoute(from, goal, function (col, row) {
      return !!corridor[col + ':' + row];
    });
    if (byPath && byPath.length) { return byPath; }
    return findRoute(from, goal);
  }

  /* Ціль пострілу — клітинка ЗА межею прив'язі ворога (`zone + 1`). Тому
     постріл безкарний: heroInZone() лишається хибним, ворог із посту не рушає.
     У цьому й сенс лука — єдина дія в грі, яка не коштує здоров'я. */
  function shotSpot() {
    if (!enemy) { return null; }
    var post = enemy.post;
    /* Тільки з БОКУ МІРИ. Спокуса підставити протилежний бік, коли на її боці
       тісно, оманлива: перейти на той бік означає пройти впритул повз ворога,
       тобто під удар — а це вже обхідний маневр, а не стрільба. Немає місця —
       лук відкладається, і вона сама про це каже. */
    var side = Math.round(hero.fx) <= post.col ? -1 : 1;
    var want = [enemy.zone + 1, enemy.zone + 2, enemy.zone];
    for (var i = 0; i < want.length; i++) {
      var d = Math.min(want[i], SHOT_MAX);
      if (d < SHOT_MIN) { continue; }
      var spot = { col: post.col + side * d, row: post.row };
      if (isFree(spot.col, spot.row)) { return spot; }
    }
    return null;
  }

  /* Що після пострілу. Умов зупинки дві, і обидві потрібні:

     — «ворог підійшов надто близько» (вимога куратора). Сама по собі вона
       спрацьовує не завжди: ворог прив'язаний до посту, і якщо Міра стоїть за
       межею його ділянки, він упреться в прив'язь і не дійде НІКОЛИ;
     — сагайдак порожній. Саме ця умова й закриває серію в такому разі.

     Прив'язь при цьому не чіпаємо: правило «ворог не женеться за межі посту»
     робить чесним відступ, і міняти його заради лука було б дорого. */
  function afterShot() {
    if (!enemy) { drawBlade(true); return; }
    if (hero.arrows <= 0) { setState(hero, 'fallback'); return; }
    if (canEngage(hero, enemy)
        || Math.abs(hero.fx - enemy.fx) < SHOT_MIN) {
      setState(hero, 'fallback');
      return;
    }
    pause(hero, PAUSE_SHOT, 'stalk', 'crouchBow');
  }

  /* Лук відкладено: далі все як завжди. Викликається і після відходу, і коли
     ворог помер посеред сортії. */
  function drawBlade(quiet) {
    hero.bowNext = false;
    hero.route = null;
    /* hero.wp НЕ чіпаємо. Спокуса відкотити його на початок велика, але шкідлива:
       у локації з двома боями це відкинуло б Міру до першого, уже зачищеного.
       Вона стоїть на спавні — `walk` прокладе BFS просто до своєї точки бою. */
    hero.flankNext = true;   /* лобом вона й тепер не піде: підхід обхідний */
    if (!quiet) { say('blade'); }
    pause(hero, PAUSE_AT_POINT, 'walk', 'idle');
  }

  /* --- обхідний маневр ------------------------------------------------------

     Ціль — клітинка з протилежного від Міри боку ворога. Маршрут той самий
     BFS, але клітинки, суміжні з ворогом, заборонені: інакше «обхід» звівся б
     до проходу впритул повз нього, тобто під удар. Шляху немає (кільце
     вузьке) — маневр мовчки скасовується, і вона йде звичайно. */

  function flankTarget() {
    var e = cellOf(enemy);
    var h = cellOf(hero);
    var side = e.col >= h.col ? 1 : -1;      /* ворог праворуч -> заходимо справа */
    for (var d = 2; d <= 4; d++) {
      var spot = { col: e.col + side * d, row: e.row };
      if (isFree(spot.col, spot.row)) { return spot; }
    }
    return null;
  }

  function beginFlank() {
    var target = flankTarget();
    if (!target) { hero.flankNext = false; return false; }

    var e = cellOf(enemy);
    var route = findRoute(cellOf(hero), target, function (col, row) {
      return chebyshev(col, row, e) > 1;
    });
    if (!route || !route.length) { hero.flankNext = false; return false; }

    hero.route = route;
    /* Знімаємо прапорець ОДРАЗУ, а не після завершення маневру: інакше будь-яке
       переривання (стрибок, удар) поверне її у 'walk' із живим прапорцем, і
       обхід почнеться заново — нескінченно. */
    hero.flankNext = false;
    setState(hero, 'flank');
    say('flank');
    return true;
  }

  function retreatRoute() {
    if (!enemy) { return null; }
    var away = enemy.fx >= hero.fx ? -1 : 1;
    var from = cellOf(hero);
    for (var d = 2; d >= 1; d--) {
      var col = from.col + away * d;
      if (!isFree(col, from.row)) { continue; }
      var route = findRoute(from, { col: col, row: from.row });
      if (route && route.length) { return route; }
    }
    return null;
  }

  function reachWaypoint() {
    var point = heroPoint();
    if (!point) { standAtEnd(); return; }

    if (point.fight && !cleared[hero.wp]) {
      /* Стоїмо на місці бою: ворог сам вийде назустріч у межах своєї зони. */
      pause(hero, PAUSE_AT_POINT, 'walk', enemy ? 'ready' : 'idle');
      return;
    }
    if (point.wait) { standAtEnd(); return; }

    hero.wp += 1;
    pause(hero, PAUSE_AT_POINT, 'walk', 'idle');
  }

  function standAtEnd() {
    setState(hero, 'awaiting');
    say('arrive');
  }

  function updateHero(step) {
    hero.time += step;

    switch (hero.state) {

      case 'pause':
        if (hero.time >= hero.pauseFor) { setState(hero, hero.pauseNext); }
        return;

      case 'walk':
        ensureEnemy();
        if (canEngage(hero, enemy)) {
          faceEnemy();
          hero.route = null;
          setState(hero, 'ready');
          return;
        }
        /* Після падіння перший підхід — обхідний. Перевірка стоїть ПІСЛЯ
           canStrike: якщо вона вже впритул, обходити нема сенсу. */
        if (enemy && hero.flankNext && beginFlank()) { return; }
        var point = heroPoint();
        if (!point) { standAtEnd(); return; }

        if (!hero.route || !hero.route.length) {
          hero.route = findRoute(cellOf(hero), point.cell);
          if (!hero.route) {
            /* Дійти неможливо — клітинки між ними закрила панель. Стоїмо і
               кажемо про це, а не смикаємося в стіну щокадру. */
            pause(hero, 600, 'walk', 'idle');
            return;
          }
          if (!hero.route.length) { reachWaypoint(); return; }
        }
        if (stepAlongRoute(hero, WALK_SPEED, step)) {
          hero.route = null;
          reachWaypoint();
        }
        return;

      case 'takeoff':
        if (hero.time >= D.takeoff) { setState(hero, 'jump'); }
        return;

      /* Обхід крадькома. Ворог поруч — маневр завершено достроково: краще
         вдарити, ніж дійти до наміченої клітинки. */
      case 'flank':
        if (!enemy) { hero.route = null; setState(hero, 'walk'); return; }
        if (canEngage(hero, enemy)) {
          hero.route = null;
          faceEnemy();
          setState(hero, 'ready');
          return;
        }
        if (!hero.route || !hero.route.length) {
          hero.route = null;
          faceEnemy();
          setState(hero, 'walk');
          return;
        }
        stepAlongRoute(hero, CROUCH_SPEED, step);
        return;

      case 'jump':
        var jump = hero.jump;
        if (!jump) { setState(hero, 'walk'); return; }
        var progress = Math.min(hero.time / D.jump, 1);
        hero.fx = jump.fromX + (jump.toX - jump.fromX) * progress;
        hero.fy = jump.fromY + (jump.toY - jump.fromY) * progress;
        if (progress >= 1) {
          hero.jump = null;
          if (hero.route && hero.route.length) { hero.route.shift(); }
          var back = hero.jumpReturn || 'walk';
          hero.jumpReturn = null;
          if (back === 'walk' && hero.route && !hero.route.length) {
            hero.route = null;
            reachWaypoint();
            return;
          }
          setState(hero, back);
        }
        return;

      case 'ready':
        if (!enemy) { setState(hero, 'walk'); return; }
        faceEnemy();
        if (!canEngage(hero, enemy)) { setState(hero, 'walk'); return; }
        if (hero.time >= D.ready) {
          hero.blows += 1;
          /* Ворог на іншому рядку — б'ємо по вертикалі. Більший рядок = нижче
             на екрані, тож ворог унизу дістає удар згори, ворог угорі —
             важкий замах. Той самий attackHard, що й кожен четвертий удар:
             два різні приводи, один файл. */
          if (canStrikeVertical(hero, enemy) && !canStrike(hero, enemy)) {
            setState(hero, enemy.fy > hero.fy ? 'attackDown' : 'attackHard');
            return;
          }
          /* Важкий удар — кожен четвертий або добивання. */
          var hard = hero.blows % 4 === 0 || enemy.hp < ENEMY_HP * 0.35;
          setState(hero, hard ? 'attackHard' : 'attack');
        }
        return;

      case 'attack':
      case 'attackHard':
      case 'attackDown':
        var span = D[hero.state] || D.attack;
        if (!hero.hitDone && hero.time >= span / 2) {
          hero.hitDone = true;
          /* Влучання приймає ОБИДВІ геометрії: замах міг початися по вертикалі,
             а поки він тривав, ворог зсунувся в той самий рядок. */
          if (enemy && enemy.hp > 0 && canEngage(hero, enemy)) {
            hurtEnemy(hero.state === 'attack' ? HIT_LIGHT
                    : hero.state === 'attackDown' ? HIT_DOWN : HIT_HARD);
          }
        }
        if (hero.time >= span) {
          pause(hero, PAUSE_HERO_ATTACK, enemy ? 'ready' : 'walk',
                enemy ? 'ready' : 'idle');
        }
        return;

      case 'damage':
        if (hero.time >= D.damage) {
          pause(hero, PAUSE_AFTER_DAMAGE, 'retreat', enemy ? 'ready' : 'idle');
        }
        return;

      case 'retreat':
        if (!enemy) { setState(hero, 'walk'); return; }
        if (!hero.route || !hero.route.length) {
          hero.route = retreatRoute();
          if (!hero.route || !hero.route.length) {
            pause(hero, PAUSE_BEFORE_READY, 'ready', 'ready');
            return;
          }
        }
        /* Дивиться туди, КУДИ біжить, а не на ворога: faceEnemy() тут і робив
           «мунвок» — ноги йшли вперед, тіло їхало назад. Напрямок ставить сам
           stepAlongRoute(), а спрайт — crouch (див. spriteState). */
        stepAlongRoute(hero, RETREAT_SPEED, step);
        if (!hero.route.length) {
          hero.route = null;
          faceEnemy();
          pause(hero, PAUSE_BEFORE_READY, 'ready', 'ready');
        }
        return;

      case 'dead':
        if (hero.time >= D.dead) { heroFall(); }
        return;

      /* Заповз до синьої зони. Повзе повільно, із зупинками, і найчастіше повз
         того, хто її щойно збив, — саме тому його удар у цьому стані відхилено
         (див. updateEnemy). Стрибків тут немає навмисно: перепад рядків вона
         просто переповзає, бо стрибок посеред заповзу — це вже не заповз. */
      case 'limp':
        if (!hero.route || !hero.route.length) {
          hero.route = limpRoute();
          if (!hero.route || !hero.route.length) {
            hero.route = null;
            setState(hero, 'revive');
            return;
          }
        }
        var wasLeft = hero.route.length;
        if (stepAlongRoute(hero, LIMP_SPEED, step)) {
          hero.route = null;
          setState(hero, 'revive');
          return;
        }
        /* Зупинка перевіряється на ПРОЙДЕНІЙ клітинці, а не за розкладом: вона
           відпочиває там, де застало, і два заповзи не схожі один на одного. */
        if (hero.route.length < wasLeft && chance(LIMP_REST_CHANCE)) {
          pause(hero, PAUSE_LIMP_REST, 'limp', 'idle');
        }
        return;

      /* Лікування на спавні. Смуга наповнюється на очах — інакше це був би
         той самий миттєвий респавн, лише з довшою дорогою до нього. */
      case 'revive':
        hero.hp = Math.min(HERO_HP,
          HP_FLOOR + (HERO_HP - HP_FLOOR) * (hero.time / D.revive));
        if (hero.time < D.revive) { return; }
        hero.hp = HERO_HP;
        /* Спавн — не тільки лікарня, а й місце, де беруть стріли. Сагайдак
           наповнюється саме тут, і тому сортія завжди має чим закінчитися. */
        hero.arrows = ARROWS;
        say('rise');
        if (hero.bowNext && enemy) { setState(hero, 'arm'); }
        else { drawBlade(true); }
        return;

      /* Бере лук. Один повний цикл анімації — не менше й не більше. */
      case 'arm':
        if (hero.time < D.armBow) { return; }
        if (!enemy) { drawBlade(true); return; }
        say('bow');
        setState(hero, 'stalk');
        return;

      /* Підкрадається на дистанцію пострілу — за межу прив'язі ворога. */
      case 'stalk':
        if (!enemy) { drawBlade(true); return; }
        if (hero.arrows <= 0) { setState(hero, 'fallback'); return; }
        if (canShoot(hero, enemy)) {
          hero.route = null;
          faceEnemy();
          setState(hero, 'shoot');
          return;
        }
        /* Опинилася впритул — стріляти нема куди, лук відкладено. */
        if (canEngage(hero, enemy)) {
          hero.route = null;
          faceEnemy();
          drawBlade(false);
          return;
        }
        if (!hero.route || !hero.route.length) {
          var spot = shotSpot();
          hero.route = spot ? findRoute(cellOf(hero), spot) : null;
          if (!hero.route || !hero.route.length) {
            hero.route = null;
            drawBlade(false);
            return;
          }
        }
        stepAlongRoute(hero, CROUCH_SPEED, step);
        return;

      /* Постріл триває, ПОКИ ЛЕТИТЬ СТРІЛА, а не фіксовані 320 мс: вона стоїть
         у позі випуску рівно стільки, скільки предмет у повітрі. */
      case 'shoot':
        if (!hero.hitDone && hero.time >= D.shootBow / 2) {
          hero.hitDone = true;
          hero.arrows -= 1;
          hero.shot = (enemy && enemy.hp > 0)
            ? launchArrow(enemy, HIT_ARROW) : null;
        }
        if (hero.time < D.shootBow + SHOT_HOLD) { return; }
        if (hero.shot && !hero.shot.done) { return; }
        hero.shot = null;
        afterShot();
        return;

      /* Відхід на спавн із луком у руках. Одна стріла — один відхід: гра не
         перетворюється на перестрілку, лук лишається епізодом. */
      case 'fallback':
        if (!hero.route || !hero.route.length) {
          hero.route = findRoute(cellOf(hero), points[0].cell);
          if (!hero.route || !hero.route.length) {
            hero.route = null;
            drawBlade(false);
            return;
          }
        }
        if (stepAlongRoute(hero, RETREAT_SPEED, step)) {
          hero.route = null;
          drawBlade(false);
        }
        return;

      case 'celebration':
        /* Перехід після перемоги запускає tickFight(), а не цей стан: коли
           кнопку вже натиснуто, чекати треба саме на кінець святкування. */
        if (hero.time >= D.celebration) {
          pause(hero, PAUSE_AFTER_WIN, 'walk', 'idle');
        }
        return;

      case 'awaiting':
      case 'goodbye':
      case 'idle':
        return;
    }
  }

  /* --- ШІ ворога ------------------------------------------------------------

     Головна відмінність від Міри: ворог прив'язаний до посту. Він ходить лише
     по клітинках у межах `zone` і НЕ переслідує до краю екрана. Це і робить
     відступ чесним — відступивши за межу зони, Міра справді в безпеці. */

  /* Мінімальний інтервал між атаками ворога — саме секунда паузи після того,
     як замах закінчився.

     Чому не самою паузою pause(): удар Міри перериває замах і кидає ворога в
     `damage`, тобто повз паузу. Стенд це й показав — інтервал сідав до 868 мс.
     Робити довшою паузу після шкоди теж не можна: тоді ворог, якого б'ють,
     не встигає атакувати взагалі. Тому інтервал відлічується від годинника
     сцени й не залежить від того, яким шляхом ворог вийшов зі стану. */
  function armNextAttack() {
    enemy.nextAttackAt = clock + D.enemyAttack + PAUSE_ENEMY_ATTACK;
  }

  /* Крадькома — це стани, які малюються спрайтом crouch: обхід із-за спини й
     відступ. Правило навмисно прив'язане до того, що ВИДНО на екрані: якщо
     Міра пригнулася, ворог помічає її ближче. */
  function sneaking() {
    return hero.state === 'flank' || hero.state === 'retreat'
        || hero.state === 'limp' || hero.state === 'stalk'
        || hero.state === 'fallback';
  }

  /* Дистанція реакції — не те саме, що прив'язь. Прив'язь (`insideZone`) каже,
     КУДИ ворогові дозволено ступати, і від скрадання не залежить: інакше він
     посеред погоні втрачав би половину своєї ділянки. Реакція каже, ЧИ він
     узагалі рушить. Скорочувати треба саме її. Менше за MIN_NOTICE не
     опускаємо: ворог, який не бачить того, хто стоїть упритул, — не стелс, а
     поламаний ШІ. */
  function noticeRange() {
    if (!sneaking()) { return enemy.zone; }
    return Math.max(MIN_NOTICE, enemy.zone - STEALTH_NOTICE_CUT);
  }

  /* Стріла будить. Той, у кого влучили, вже не вартовий: він іде до Міри — але
     ТІЛЬКИ в межах своєї ділянки. Прив'язь лишається чинною, тож здалеку він
     упреться в її межу й далі не піде; саме тому серію пострілів завершує
     порожній сагайдак, а не його наближення. */
  function heroInZone() {
    if (enemy.alerted) { return true; }
    var cell = cellOf(hero);
    return chebyshev(cell.col, cell.row, enemy.post) <= noticeRange();
  }

  function insideZone(col, row) {
    return chebyshev(col, row, enemy.post) <= enemy.zone;
  }

  /* Куди приземлиться випад. Найдальша вільна клітинка в бік Міри — але не далі
     двох і не за межі ділянки: стрибок ловить того, хто задкує, а не скасовує
     прив'язь. Немає куди — стрибок лишається на місці, як і був. */
  function leapTarget() {
    var from = cellOf(enemy);
    var stepX = hero.fx > enemy.fx ? 1 : (hero.fx < enemy.fx ? -1 : 0);
    var stepY = Math.round(hero.fy) > from.row
      ? 1 : (Math.round(hero.fy) < from.row ? -1 : 0);
    var best = null;

    for (var d = 2; d >= 1; d--) {
      var col = from.col + stepX * d;
      var row = from.row + stepY * d;
      if (!isFree(col, row) || !insideZone(col, row)) { continue; }
      /* Не приземлятися Мірі на голову: клітинка, яку вона займає, зайнята. */
      if (col === Math.round(hero.fx) && row === Math.round(hero.fy)) { continue; }
      best = { col: col, row: row };
      break;
    }
    if (!best) { return null; }
    return {
      fromX: enemy.fx, fromY: enemy.fy, toX: best.col, toY: best.row
    };
  }

  function updateEnemy(step) {
    if (!enemy) { return; }
    enemy.time += step;

    /* Той самий гістерезис, що й у Міри, і з тієї самої причини: без порога знак
       різниці стрибає щокадру, коли вони майже на одному x, а в ворога `idle`
       намальовано з ОБОХ боків — тобто мінявся б не клас дзеркалення, а сам
       файл, і .gif рестартував би з нуля. Для Міри це полагоджено в третьому
       підході, ворога тоді пропустили — тут лише симетрія. */
    if (enemy.state !== 'dead' && hero.state !== 'dead') {
      var facing = hero.fx - enemy.fx;
      if (Math.abs(facing) >= FACE_HYSTERESIS) {
        enemy.dir = facing > 0 ? 1 : -1;
      }
    }

    switch (enemy.state) {

      case 'pause':
        if (enemy.time >= enemy.pauseFor) { setState(enemy, enemy.pauseNext); }
        return;

      case 'idle':
        /* Через паузу, а не одразу: якщо дійти до Міри неможливо, «walk»
           поверне сюди ж, і без паузи ці два стани миготіли б щокадру,
           перезапускаючи .gif. */
        if (heroInZone()) { pause(enemy, 300, 'walk', 'idle'); }
        return;

      case 'walk':
        if (canEngage(enemy, hero)) {
          enemy.route = null;
          pause(enemy, PAUSE_BEFORE_READY, 'ready', 'ready');
          return;
        }
        /* Випад услід тому, хто задкує. Рішення живе САМЕ ТУТ, а не в `ready`:
           щойно Міра відступила на клітинку, `ready` бачить, що дістати її вже
           не можна, і перекидає ворога у `walk` — тобто до перевірки на стрибок
           справа не доходила ніколи. Вікно рішення обмежене годинником
           (`nextLeapAt`), інакше `chance()` перевірявся б щокадру й випадковість
           перетворилася б на постійність. */
        if (hero.state === 'retreat' && clock >= enemy.nextLeapAt) {
          enemy.nextLeapAt = clock + LEAP_COOLDOWN;
          if (chance(LEAP_CHASE)) {
            var pounce = leapTarget();
            if (pounce) {
              enemy.leap = pounce;
              enemy.route = null;
              setState(enemy, 'jump');
              return;
            }
          }
        }
        var chasing = heroInZone();
        var goal = chasing ? cellOf(hero) : enemy.post;
        var key = goal.col + ':' + goal.row;
        if (key !== enemy.goalKey || !enemy.route || !enemy.route.length) {
          enemy.goalKey = key;
          enemy.route = findRoute(cellOf(enemy), goal, insideZone);
          /* Дійти неможливо (клітинки закрила панель) або вже на місці —
             в обох випадках стояти й чекати, а не смикатися щокадру. */
          if (!enemy.route || !enemy.route.length) {
            enemy.route = null;
            setState(enemy, 'idle');
            return;
          }
        }
        if (stepAlongRoute(enemy, ENEMY_SPEED, step)) {
          enemy.route = null;
          setState(enemy, 'idle');
        }
        return;

      case 'ready':
        if (!canEngage(enemy, hero)) { setState(enemy, 'walk'); return; }
        if (enemy.time >= D.ready && clock >= enemy.nextAttackAt) {
          /* Через стрибок — коли треба подолати перепад рядків (бій довкола
             кута панелі) або навздогін тому, хто відступає. Друге — головний
             спосіб ворога взагалі влучити: Міра задкує після кожного удару, і
             без переслідування його замах бив би самий лише простір. */
          var leap = (canStrikeVertical(enemy, hero) && !canStrike(enemy, hero))
                  || (hero.state === 'retreat' && chance(LEAP_CHASE));
          if (leap) { enemy.leap = leapTarget(); }
          setState(enemy, leap ? 'jump' : 'attack');
          if (enemy.state === 'attack') { armNextAttack(); }
        }
        return;

      /* Стрибок ворога ПЕРЕМІЩУЄ його. Раніше він програвав анімацію на місці,
         тобто «випад услід тому, хто відступає» був малюнком без наслідку: Міра
         задкувала, він махав повітрю, і влучити не міг у принципі. Саме тому
         вона й не падала жодного разу за десять проходжень. */
      case 'jump':
        if (enemy.leap) {
          var t = Math.min(enemy.time / D.enemyJump, 1);
          enemy.fx = enemy.leap.fromX + (enemy.leap.toX - enemy.leap.fromX) * t;
          enemy.fy = enemy.leap.fromY + (enemy.leap.toY - enemy.leap.fromY) * t;
        }
        if (enemy.time >= D.enemyJump) {
          enemy.leap = null;
          enemy.route = null;
          enemy.goalKey = '';
          setState(enemy, 'attack');
          armNextAttack();
        }
        return;

      case 'attack':
        if (!enemy.hitDone && enemy.time >= D.enemyAttack / 2) {
          enemy.hitDone = true;
          /* Того, хто лежить або повзе, не добивають. Це не милосердя ШІ, а
             відмова перетворювати падіння на фарм: сцена заповзу мусить
             дограти. */
          if (hero.state !== 'dead' && hero.state !== 'limp'
              && canEngage(enemy, hero)) {
            hurtHero();
          }
        }
        if (enemy.time >= D.enemyAttack) {
          /* Рівно секунда між атаками — вимога куратора. */
          pause(enemy, PAUSE_ENEMY_ATTACK, 'ready', 'ready');
        }
        return;

      case 'damage':
        if (enemy.time >= D.enemyDamage) {
          pause(enemy, PAUSE_BEFORE_READY, 'ready', 'ready');
        }
        return;

      case 'dead':
        if (enemy.time >= D.enemyDead) { buryEnemy(); }
        return;
    }
  }

  function buryEnemy() {
    /* Останній кадр — .png: .gif лишився б у петлі, і труп «дихав» би. */
    var still = spriteOf('skeleton', 'deadStill', enemy.dir);
    if (still) {
      enemy.src = config.basePath + still.file;
      enemy.img.setAttribute('data-file', still.file);
      enemy.img.src = enemy.src;
      enemy.node.classList.toggle('is-flipped', !!still.flip);
    }
    if (enemy.bar) { enemy.bar.parentNode.hidden = true; }
    enemy.bar = null;
    corpses.push(enemy);
    enemy = null;

    cleared[hero.wp] = true;
    hero.route = null;
    hero.hp = Math.min(HERO_HP, hero.hp + 15);
    /* Ворог міг загинути посеред сортії — від стріли або від чужого удару.
       Намір «наступного разу з лука» тоді нікуди не веде й знімається тут,
       інакше він дочекався б наступного бою й спрацював без причини. */
    hero.bowNext = false;
    setState(hero, 'celebration');
    say('win');
  }

  /* --- перехід між локаціями ------------------------------------------------- */

  function startTransit() {
    transiting = true;
    stage.classList.add('is-transit');
    var delay = reduced ? 0 : 320;
    window.setTimeout(function () {
      goToLocation(index + 1);
      stage.classList.remove('is-transit');
      transiting = false;
    }, delay);
  }

  /* Кнопка НЕ тримає користувача. Вона завжди переводить далі негайно —
     платить за це Міра: якщо вона лишила ворога недобитим, на новій локації
     її не буде FIGHT_TIMEOUT. Сцена стоїть порожня, панель завдання працює,
     і історія рухається без неї. Це навмисна асиметрія з наративної
     конституції (§22): користувач — спостерігач, і затримувати його не можна;
     Міра автономна, і наслідки її. */
  function advance() {
    if (transiting || !location) { return false; }

    if (enemy && enemy.hp > 0 && !reduced && !grid.cramped) {
      heroSpawnAt = Math.max(heroSpawnAt, clock + FIGHT_TIMEOUT);
    }
    startTransit();
    return true;
  }

  /* Кличеться щокадру, поки Міри на сцені немає. */
  function tickSpawn() {
    if (hero || !points.length) { return; }

    if (clock < heroSpawnAt) {
      var left = Math.ceil((heroSpawnAt - clock) / 1000);
      if (left !== lastWaitLeft) {
        lastWaitLeft = left;
        if (config.onWait) { config.onWait(left); }
      }
      return;
    }

    lastWaitLeft = -1;
    if (config.onWait) { config.onWait(0); }
    spawnHero(true);
  }

  /* --- перерахунок при зміні розміру вікна ----------------------------------- */

  /* Тісний екран — це не збій, а окремий режим: сцени немає, сторінка
     повертається до звичайного гортання, панель завдання стає звичайним
     блоком. Гра лишається прохідною, просто без Міри. */
  function applyCramped() {
    stage.hidden = grid.cramped;
    document.body.classList.toggle('is-cramped', grid.cramped);
  }

  function relayout() {
    layoutGrid();
    layoutPanel();
    applyCramped();
    if (!location) { return; }

    resolvePoints();
    buildGridView();

    /* Актори могли опинитися під панеллю — переставляємо у вільні клітинки й
       забуваємо маршрути: вони рахувалися для старої сітки. */
    [hero, enemy].concat(corpses).forEach(function (actor) {
      if (!actor) { return; }
      var spot = nearestFree(Math.round(actor.fx), Math.round(actor.fy));
      actor.fx = spot.col;
      actor.fy = spot.row;
      actor.route = null;
      actor.goalKey = '';
      actor.jump = null;
      drawActor(actor);
    });

    /* Пост ворога перераховується з КЛІТИНКИ точки бою, а не з його пікселів.
       Інакше зона повзе за ним на кожному ресайзі, і бій ламається: саме так
       Міра одного разу опинилася в нього за спиною й перемогла миттєво. */
    if (enemy) {
      var point = points[hero.wp];
      enemy.post = point && point.fight
        ? postCellFor(point, enemy.zone, hero.wp)
        : nearestFree(enemy.post.col, enemy.post.row);
    }
  }

  function onResize() {
    if (resizeTimer) { clearTimeout(resizeTimer); }
    resizeTimer = window.setTimeout(function () {
      resizeTimer = null;
      relayout();
    }, 200);
  }

  /* --- цикл ------------------------------------------------------------------ */

  function frame(now) {
    var step = Math.min(now - lastFrame, STEP_MAX);
    lastFrame = now;
    clock += step;

    if (location && !transiting && !grid.cramped) {
      /* Спершу спавн: поки Міри немає, оновлювати нікого, але годинник її
         появи має цокати. */
      tickSpawn();
      tickVoice();
      if (hero) {
        updateEnemy(step);
        updateHero(step);
        /* Стріла рухається ПІСЛЯ акторів: вона цілиться в позицію цього кадру,
           а не минулого, тож влучання збігається з тим, що видно. */
        updateArrows(step);
        drawActor(hero);
        if (enemy) { drawActor(enemy); }
      }
    }
    raf = window.requestAnimationFrame(frame);
  }

  /* --- ініціалізація --------------------------------------------------------- */

  function init(userConfig) {
    config = {
      containerId: userConfig.containerId,
      panelId: userConfig.panelId || null,
      reserve: userConfig.reserve || { w: 0.7, h: 0.7, anchor: 'center' },
      data: userConfig.data,
      basePath: userConfig.basePath || '',
      narrateId: userConfig.narrateId || null,
      onArrive: userConfig.onArrive || null,
      onFinish: userConfig.onFinish || null,
      /* onWait(secondsLeft) — скільки лишилося Мірі на бій; 0 = чекати годі. */
      onWait: userConfig.onWait || null
    };
    data = config.data;

    var container = document.getElementById(config.containerId);
    if (!container) {
      throw new Error('NarrativeStage.init: немає елемента #' + config.containerId);
    }
    clear(container);

    reduced = document.documentElement.classList.contains('reduce-motion');

    stage = el('div', 'stage');
    /* Сцена — оздоблення. Для скрін-рідера говорить рядок role="status",
       який тримає сторінка: анімацію він не прочитає ніяк. */
    stage.setAttribute('aria-hidden', 'true');

    layerGrid = el('div', 'stage__layer stage__layer--grid');
    layerActors = el('div', 'stage__layer stage__layer--actors');
    /* Летючі предмети — над акторами: стріла має бути видима на тлі того, в
       кого летить, інакше половина польоту губиться за спрайтом. */
    layerFx = el('div', 'stage__layer stage__layer--fx');
    stage.appendChild(layerGrid);
    stage.appendChild(layerActors);
    stage.appendChild(layerFx);
    container.appendChild(stage);

    layoutGrid();
    layoutPanel();
    applyCramped();

    preload();
    goToLocation(0);

    window.addEventListener('resize', onResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', onResize);
    }

    if (!reduced && !grid.cramped) {
      lastFrame = window.performance ? performance.now() : Date.now();
      raf = window.requestAnimationFrame(frame);
    }
  }

  /* Прекеш: без нього перший показ кожного стану блимає порожнечею.

     Раніше тут бралися `entry.base` (такого ключа в маніфесті немає взагалі)
     і `entry.r` — а `entry.l` пропускався. Тобто кожен ЛІВИЙ кадр першого разу
     показувався порожнечею, і найпомітніше це було на ворогові, у якого майже
     всі файли ліві. */
  function preload() {
    var seen = {};
    function take(entry) {
      if (!entry) { return; }
      if (Object.prototype.toString.call(entry) === '[object Array]') {
        entry.forEach(take);
        return;
      }
      if (typeof entry === 'string') {
        if (!seen[entry]) {
          seen[entry] = new Image();
          seen[entry].src = config.basePath + entry;
        }
        return;
      }
      take(entry.r);
      take(entry.l);
    }
    Object.keys(data.sprites).forEach(function (kind) {
      var states = data.sprites[kind];
      Object.keys(states).forEach(function (state) { take(states[state]); });
    });
    /* Плитки місцевості й декор — теж активи, і теж мусять бути в кеші до
       першого buildGridView(), інакше мапа домальовується на очах. */
    Object.keys(data.terrain || {}).forEach(function (key) {
      take(data.terrain[key]);
    });
    Object.keys(data.decor || {}).forEach(function (key) {
      take(data.decor[key]);
    });
    Object.keys(data.projectiles || {}).forEach(function (key) {
      take(data.projectiles[key]);
    });
  }

  function destroy() {
    if (raf) { window.cancelAnimationFrame(raf); raf = null; }
    window.removeEventListener('resize', onResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', onResize);
    }
    location = null;
    hero = null;
    enemy = null;
    clearArrows();
  }

  window.NarrativeStage = {
    init: init,
    advance: advance,
    locationIndex: function () { return index; },
    relayout: relayout,
    destroy: destroy
  };
})();
