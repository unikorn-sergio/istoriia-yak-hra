/*
 * BoardGame — рушій настільної гри: дошка, хід, PIN, гроші, оренда, події,
 * таймер, автозбереження.
 *
 * Спільна дошка на одному екрані; хід починається лише після PIN активної
 * команди. PIN — захист «від чужої руки за проєктором», а не криптографія:
 * у сховищі лежить простий хеш.
 *
 * Приклад:
 *   BoardGame.init({ setupId: 'screenSetup', gameId: 'screenGame', finalId: 'screenFinal' });
 *
 * Залежить від BoardData (js/data.js) і BoardTasks (js/tasks.js) — порядок
 * <script> в index.html і є графом залежностей.
 */
(function () {
  'use strict';

  var STORE_STATE = 'nastilna_state';
  var STORE_DATA = 'nastilna_data';
  var COLORS = ['#c1554a', '#1d7a8c', '#b8860b', '#6b4fa0'];
  var TOKENS = ['●', '▲', '■', '◆'];

  var D = null;      // дані гри (BoardData.current())
  var S = null;      // стан партії
  var ui = {};
  var timerId = null;
  var storageOk = true;

  /* ---------- допоміжне ---------- */

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function btn(text, onClick, cls) {
    var b = el('button', 'btn' + (cls ? ' ' + cls : ''), text);
    b.type = 'button';
    b.addEventListener('click', function (e) {
      // Кнопка дії спрацьовує один раз: інакше повторний клік «Купити»
      // списав би гроші двічі. Гаснуть усі кнопки цієї групи.
      var group = b.parentNode;
      if (group && group.classList && group.classList.contains('actions')) {
        Array.prototype.forEach.call(group.querySelectorAll('button'), function (x) { x.disabled = true; });
      }
      onClick(e);
    });
    return b;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function hash(s) {
    var h = 5381;
    s = 'nastilna:' + s;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return 'h' + (h >>> 0).toString(36);
  }
  function rnd(n) { return Math.floor(Math.random() * n); }
  function money(n) { return n + ' ₴'; }

  function store(key, val) {
    try {
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) { storageOk = false; return false; }
  }
  function load(key) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { storageOk = false; return null; }
  }

  /* ---------- дошка ---------- */

  function group(id) {
    for (var i = 0; i < D.groups.length; i++) if (D.groups[i].id === id) return D.groups[i];
    return null;
  }
  function jailIndex() {
    for (var i = 0; i < D.cells.length; i++) if (D.cells[i].type === 'jail') return i;
    return 0;
  }
  function cellName(c) {
    var names = { start: 'Старт', chronicle: 'Хроніка', archive: 'Архів', tax: 'Мито', jail: 'Поруб', gotojail: 'Застава', slow: 'Бездоріжжя' };
    return c.name || names[c.type] || c.type;
  }
  // Назву в'язниці бере з дошки: у кожного набору своя («Поруб», «Вигнання»…).
  function jailName() { return cellName(D.cells[jailIndex()]); }
  var ICON = { start: '▶', chronicle: '📜', archive: '🗄', tax: '⚖', jail: '⛓', gotojail: '🚧', slow: '🌫', trade: '⚒' };

  function upgradeCost(c) { return c.upgrade || Math.round(c.price / 2); }
  function ownsGroup(teamIdx, gid) {
    var lands = D.cells.map(function (c, i) { return { c: c, i: i }; })
      .filter(function (x) { return x.c.type === 'land' && x.c.group === gid; });
    return lands.length > 0 && lands.every(function (x) { return S.owners[x.i] && S.owners[x.i].team === teamIdx; });
  }
  function activeMods(gid) {
    return S.mods.filter(function (m) { return m.group === gid && S.round <= m.until; });
  }
  function rentOf(i) {
    var c = D.cells[i], o = S.owners[i];
    if (!o) return 0;
    if (c.type === 'trade') {
      var n = 0;
      D.cells.forEach(function (x, k) { if (x.type === 'trade' && S.owners[k] && S.owners[k].team === o.team) n++; });
      var tr = c.rent || D.settings.tradeRent;
      return tr[Math.min(n, tr.length) - 1];
    }
    var r = c.rent[Math.min(o.level, c.rent.length - 1)];
    if (o.level === 0 && ownsGroup(o.team, c.group)) r *= 2;
    activeMods(c.group).forEach(function (m) { r *= m.mult; });
    return Math.round(r);
  }
  function capital(ti) {
    var t = S.teams[ti], sum = t.money;
    Object.keys(S.owners).forEach(function (k) {
      var o = S.owners[k];
      if (o.team === ti) sum += D.cells[k].price + o.level * (D.cells[k].type === 'land' ? upgradeCost(D.cells[k]) : 0);
    });
    return sum;
  }

  function ringPos(i, n) {
    var k = n / 4 + 1; // клітинок на бік, разом із кутами
    if (i < k) return { r: 1, c: i + 1 };
    if (i < 2 * k - 1) return { r: i - k + 2, c: k };
    if (i < 3 * k - 2) return { r: k, c: k - (i - (2 * k - 2)) };
    return { r: k - (i - (3 * k - 3)), c: 1 };
  }

  function renderBoard() {
    var b = ui.board;
    clear(b);
    var n = D.cells.length;
    var layout = (D.board && D.board.layout) || 'ring';
    b.className = 'board board-' + layout;
    b.style.backgroundImage = '';
    b.style.gridTemplateColumns = '';
    b.style.gridTemplateRows = '';
    if (layout === 'ring') {
      var k = n / 4 + 1;
      b.style.gridTemplateColumns = 'repeat(' + k + ', 1fr)';
      b.style.gridTemplateRows = 'repeat(' + k + ', 1fr)';
      var center = el('div', 'board-center');
      center.style.gridArea = '2 / 2 / ' + k + ' / ' + k;
      center.appendChild(el('p', 'board-title', D.title));
      ui.dice = el('p', 'board-dice', S && S.lastRoll ? S.lastRoll.join(' + ') : '');
      center.appendChild(ui.dice);
      var mods = S ? S.mods.filter(function (m) { return S.round <= m.until; }) : [];
      mods.forEach(function (m) {
        var g = group(m.group);
        center.appendChild(el('p', 'board-mod', (g ? g.name : m.group) + ': оренда ×' + m.mult + ' до кінця раунду ' + m.until));
      });
      b.appendChild(center);
    } else {
      var map = String(D.board.map).replace(/["\\\n\r]/g, '');
      b.style.backgroundImage = 'url("' + map + '")';
      if (D.board.aspect) b.style.aspectRatio = String(D.board.aspect);
      b.appendChild(routeSvg());
      ui.dice = el('p', 'board-dice board-dice-map', S && S.lastRoll ? diceText(S.lastRoll) : '');
      if (S && S.lastRoll) b.appendChild(ui.dice);
      var mods2 = S ? S.mods.filter(function (m) { return S.round <= m.until; }) : [];
      if (mods2.length) {
        var mb = el('div', 'board-mods-map');
        mods2.forEach(function (m) {
          var g2 = group(m.group);
          mb.appendChild(el('p', 'board-mod', (g2 ? g2.name : m.group) + ': оренда ×' + m.mult + ' до кінця раунду ' + m.until));
        });
        b.appendChild(mb);
      }
    }

    if (layout === 'map') { D.cells.forEach(function (c, i) { b.appendChild(mapCell(c, i)); }); return; }

    D.cells.forEach(function (c, i) {
      var cell = el('div', 'cell cell-' + c.type + (i % (n / 4) === 0 && layout === 'ring' ? ' cell-corner' : ''));
      if (layout === 'ring') {
        var p = ringPos(i, n);
        cell.style.gridRow = String(p.r);
        cell.style.gridColumn = String(p.c);
      } else {
        cell.style.left = c.x + '%';
        cell.style.top = c.y + '%';
      }
      var g = c.type === 'land' ? group(c.group) : null;
      if (g) {
        var bar = el('span', 'cell-bar');
        bar.style.background = g.color || '#ddd';
        cell.appendChild(bar);
        cell.title = cellName(c) + ' — ' + g.name;
      } else {
        cell.title = cellName(c);
      }
      cell.appendChild(el('span', 'cell-name', (ICON[c.type] ? ICON[c.type] + ' ' : '') + cellName(c)));
      var o = S && S.owners[i];
      if (o) {
        var tm = S.teams[o.team];
        cell.style.boxShadow = 'inset 0 0 0 4px ' + tm.color;
        cell.appendChild(el('span', 'cell-owner', TOKENS[o.team] + (o.level ? ' ' + '★'.repeat(o.level) : '')));
      } else if (c.price) {
        cell.appendChild(el('span', 'cell-price', money(c.price)));
      }
      if (S) {
        var here = el('span', 'cell-tokens');
        S.teams.forEach(function (t, ti) {
          if (!t.bankrupt && t.pos === i) {
            var tok = el('span', 'token' + (ti === S.turn ? ' token-active' : ''), TOKENS[ti]);
            tok.style.background = t.color;
            tok.title = t.name;
            here.appendChild(tok);
          }
        });
        cell.appendChild(here);
      }
      b.appendChild(cell);
    });
  }

  /* ---------- карта-маршрут: прийоми зі зразка «Пиратской монополии» ----------
     Дошка — ілюстрована карта, клітинки — медальйони на пунктирному шляху,
     куплена земля позначена прапорцем команди. Графіка власна: карта —
     data/karta.svg, решта — CSS і символи. */

  var SVGNS = 'http://www.w3.org/2000/svg';

  function routeSvg() {
    var aspect = D.board.aspect || 4 / 3;
    var h = 100 / aspect;
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('class', 'route');
    svg.setAttribute('viewBox', '0 0 100 ' + h.toFixed(2));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('aria-hidden', 'true');
    var P = D.cells.map(function (c) { return [c.x, c.y / 100 * h]; });
    // замкнений згладжений шлях (Catmull-Rom → Безьє)
    var d = 'M' + P[0][0] + ',' + P[0][1];
    for (var i = 0; i < P.length; i++) {
      var p0 = P[(i - 1 + P.length) % P.length], p1 = P[i], p2 = P[(i + 1) % P.length], p3 = P[(i + 2) % P.length];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ' C' + c1x.toFixed(2) + ',' + c1y.toFixed(2) + ' ' + c2x.toFixed(2) + ',' + c2y.toFixed(2) + ' ' + p2[0] + ',' + p2[1];
    }
    ['route-shadow', 'route-line'].forEach(function (cls) {
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', d);
      path.setAttribute('class', cls);
      path.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(path);
    });
    return svg;
  }

  function mapCell(c, i) {
    var cell = el('div', 'mcell mcell-' + c.type + ' mcell-lp-' + (c.lp || 'b'));
    cell.style.left = c.x + '%';
    cell.style.top = c.y + '%';
    var g = c.type === 'land' ? group(c.group) : null;
    var o = S && S.owners[i];
    var dot = el('span', 'mcell-dot', g ? '' : (ICON[c.type] || '•'));
    if (g) dot.style.background = g.color || '#ddd';
    cell.appendChild(dot);
    cell.title = cellName(c) + (g ? ' — ' + g.name : '') + (c.price && !o ? ', ' + money(c.price) : '');
    if (c.type === 'land' || c.type === 'trade') {
      var label = el('span', 'mcell-label', cellName(c));
      if (c.price && !o) label.appendChild(el('span', 'mcell-price', ' · ' + money(c.price)));
      cell.appendChild(label);
    }
    if (o) {
      var tm = S.teams[o.team];
      var flag = el('span', 'mflag');
      flag.style.setProperty('--team', tm.color);
      flag.appendChild(el('span', 'mflag-cloth', o.level ? '★'.repeat(o.level) : ''));
      cell.appendChild(flag);
    }
    if (S) {
      var here = el('span', 'mcell-tokens');
      S.teams.forEach(function (t, ti) {
        if (!t.bankrupt && t.pos === i) {
          var tok = el('span', 'token' + (ti === S.turn ? ' token-active' : ''), TOKENS[ti]);
          tok.style.background = t.color;
          tok.title = t.name;
          here.appendChild(tok);
        }
      });
      cell.appendChild(here);
    }
    return cell;
  }

  /* ---------- ілюстровані картки й рух ---------- */

  var PIC = {
    turn: ['🔔', 'Ваш хід'], start: ['🌅', 'Старт'], land: ['📜', 'Грамота'], rent: ['💰', 'Оренда'],
    trade: ['⚒', 'Промисел'], chronicle: ['📖', 'Хроніка'], archive: ['🗄', 'Архів'], tax: ['⚖', 'Мито'],
    jail: ['⛓', 'Поруб'], gotojail: ['🚧', 'Застава'], slow: ['🌫', 'Бездоріжжя'], own: ['🏰', 'Ваша земля']
  };
  function picture(kind, tint, label) {
    var p = PIC[kind] || PIC.chronicle;
    if (label) p = [p[0], label];
    var box = el('div', 'pic pic-' + kind);
    if (tint) box.style.setProperty('--tint', tint);
    box.appendChild(el('span', 'pic-glyph', p[0]));
    box.appendChild(el('span', 'pic-band', p[1]));
    box.setAttribute('aria-hidden', 'true');
    return box;
  }

  var FACES = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  function diceText(r) { return r.map(function (v) { return FACES[v - 1]; }).join(' '); }
  function calm() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; }
  }

  // Фішка йде клітинка за клітинкою, як у зразку; бонус за «Старт» — у момент проходу.
  function walk(steps, done) {
    if (calm() || !steps) { move(steps); return done(); }
    var dir = steps > 0 ? 1 : -1, left = Math.abs(steps);
    (function next() {
      if (!left) { renderAll(); return done(); }
      left--;
      var t = team(), n = D.cells.length;
      t.pos = ((t.pos + dir) % n + n) % n;
      if (dir > 0 && t.pos === 0) {
        gain(S.turn, D.settings.passBonus);
        log(t.name + ' проходить «Старт»: +' + money(D.settings.passBonus) + '.');
        renderTeams();
      }
      renderBoard();
      setTimeout(next, 230);
    })();
  }

  // Плаваюче «+200 ₴» біля рядка команди.
  var floats = [];
  function floatMoney(ti, delta) { if (delta) floats.push({ ti: ti, delta: delta }); }

  /* ---------- панель ---------- */

  function renderTeams() {
    clear(ui.teams);
    S.teams.forEach(function (t, i) {
      var row = el('div', 'team' + (i === S.turn ? ' team-active' : '') + (t.bankrupt ? ' team-out' : ''));
      var tok = el('span', 'token', TOKENS[i]);
      tok.style.background = t.color;
      row.appendChild(tok);
      row.appendChild(el('span', 'team-name', t.name));
      row.appendChild(el('span', 'team-money', t.bankrupt ? 'банкрут' : money(t.money)));
      var extra = [];
      var lands = Object.keys(S.owners).filter(function (k) { return S.owners[k].team === i; }).length;
      if (lands) extra.push('земель: ' + lands);
      if (t.jail) extra.push('⛓ ' + jailName());
      if (t.jailKeys) extra.push('грамот: ' + t.jailKeys);
      if (t.skip) extra.push('пропускає хід');
      row.appendChild(el('span', 'team-extra', extra.join(' · ')));
      floats.filter(function (f) { return f.ti === i; }).forEach(function (f, k) {
        var fl = el('span', 'money-float ' + (f.delta > 0 ? 'money-up' : 'money-down'), (f.delta > 0 ? '+' : '−') + money(Math.abs(f.delta)));
        fl.style.animationDelay = (k * 0.25) + 's';
        row.appendChild(fl);
      });
      ui.teams.appendChild(row);
    });
    floats = [];
  }

  function renderLog() {
    clear(ui.log);
    S.log.slice(-6).reverse().forEach(function (l) {
      var li = el('li', null, l.text);
      if (l.team !== null && S.teams[l.team]) li.style.borderLeftColor = S.teams[l.team].color;
      ui.log.appendChild(li);
    });
  }

  function renderAll() {
    renderBoard();
    renderTeams();
    renderLog();
    ui.round.textContent = 'Раунд ' + S.round;
  }

  function log(text, team) {
    S.log.push({ text: text, team: team === undefined ? S.turn : team, round: S.round });
    renderLog();
  }

  function stage() { clear(ui.stage); return ui.stage; }
  function say(text, cls) { var p = el('p', 'msg' + (cls ? ' ' + cls : ''), text); ui.stage.appendChild(p); return p; }
  function actions() { var a = el('div', 'actions'); ui.stage.appendChild(a); return a; }
  function team() { return S.teams[S.turn]; }

  /* ---------- гроші ---------- */

  // Списати з команди; якщо не вистачає — банкрутство, землі звільняються.
  function pay(ti, amount, toTeam) {
    var t = S.teams[ti];
    if (amount <= 0) return true;
    if (t.money >= amount) {
      t.money -= amount;
      floatMoney(ti, -amount);
      if (toTeam !== undefined && toTeam !== null) { S.teams[toTeam].money += amount; floatMoney(toTeam, amount); }
      return true;
    }
    if (toTeam !== undefined && toTeam !== null) S.teams[toTeam].money += t.money;
    t.money = 0;
    t.bankrupt = true;
    Object.keys(S.owners).forEach(function (k) { if (S.owners[k].team === ti) delete S.owners[k]; });
    log(t.name + ' — банкрутство. Землі повертаються в казну.', ti);
    return false;
  }
  function gain(ti, amount) { S.teams[ti].money += amount; floatMoney(ti, amount); }

  /* ---------- завдання ---------- */

  function pickTask(gid, kind) {
    var all = D.tasks.map(function (t, i) { return i; }).filter(function (i) { return !kind || D.tasks[i].kind === kind; });
    if (!all.length) return null;
    var free = all.filter(function (i) { return S.used.indexOf(i) < 0; });
    if (!free.length) {
      S.used = S.used.filter(function (i) { return all.indexOf(i) < 0; });
      free = all;
    }
    var own = gid ? free.filter(function (i) { return D.tasks[i].group === gid; }) : [];
    var from = own.length ? own : free;
    var pick = from[rnd(from.length)];
    S.used.push(pick);
    return D.tasks[pick];
  }

  function runTask(task, after) {
    var mount = el('div', 'task-mount');
    ui.stage.appendChild(mount);
    BoardTasks.run(task, mount, function (ok) {
      var t = team();
      if (ok) t.ok++; else t.fail++;
      renderTeams();
      after(ok);
    });
  }

  /* ---------- хід ---------- */

  function startTurn() {
    if (S.ended) return finish();
    var t = team();
    S.phase = 'pin';
    var snap = clone(S);
    delete snap.snapshot;
    S.snapshot = snap;
    save();
    renderAll();
    var st = stage();
    st.appendChild(el('h2', 'turn-title', 'Хід: ' + t.name));
    if (t.skip > 0) {
      t.skip--;
      say('Команда пропускає цей хід.');
      log(t.name + ' пропускає хід.');
      actions().appendChild(btn('Далі', nextTurn, 'btn-main'));
      return;
    }
    st.appendChild(picture('turn', t.color));
    // Без PIN (ведучий сам клацає за всіх) — хід починається однією кнопкою.
    if (!t.pin) {
      var go = btn('Почати хід', function () { if (t.jail > 0) jailMenu(); else rollMenu(); }, 'btn-main');
      actions().appendChild(go);
      go.focus();
      return;
    }
    say('Введіть PIN команди, щоб почати хід.');
    var form = el('form', 'pin-form');
    var inp = el('input', 'pin-input');
    inp.type = 'password';
    inp.autocomplete = 'off';
    inp.setAttribute('aria-label', 'PIN команди ' + t.name);
    var msg = el('p', 'msg msg-bad');
    msg.setAttribute('role', 'status');
    form.appendChild(inp);
    form.appendChild(btn('Почати хід', function () {}, 'btn-main'));
    form.lastChild.type = 'submit';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (hash(inp.value) !== t.pin) { msg.textContent = 'PIN не підходить. Хід може почати лише ця команда.'; inp.value = ''; inp.focus(); return; }
      if (t.jail > 0) jailMenu(); else rollMenu();
    });
    st.appendChild(form);
    st.appendChild(msg);
    inp.focus();
  }

  function rollMenu() {
    S.phase = 'roll';
    var st = stage();
    st.appendChild(el('h2', 'turn-title', 'Хід: ' + team().name));
    var b = btn('Кинути ' + (D.settings.dice === 2 ? 'кубики' : 'кубик'), function () {
      var r = [1 + rnd(6)];
      if (D.settings.dice === 2) r.push(1 + rnd(6));
      S.lastRoll = r;
      var steps = r.reduce(function (a, x) { return a + x; }, 0);
      // Кубики «крутяться» ~0,7 с, потім фішка йде клітинка за клітинкою.
      var cup = el('p', 'dice-roll', diceText(r));
      ui.stage.appendChild(cup);
      var spins = calm() ? 0 : 10;
      (function spin() {
        if (spins-- > 0) {
          cup.textContent = r.map(function () { return FACES[rnd(6)]; }).join(' ');
          return setTimeout(spin, 70);
        }
        cup.textContent = diceText(r) + '  =  ' + steps;
        cup.classList.add('dice-done');
        log(team().name + ' кидає: ' + r.join(' + ') + ' = ' + steps + '.');
        walk(steps, function () { setTimeout(resolveCell, calm() ? 0 : 250); });
      })();
    }, 'btn-main btn-big');
    actions().appendChild(b);
    b.focus();
  }

  function move(steps) {
    var t = team(), n = D.cells.length;
    if (steps >= 0) {
      for (var i = 0; i < steps; i++) {
        t.pos = (t.pos + 1) % n;
        if (t.pos === 0) { gain(S.turn, D.settings.passBonus); log(t.name + ' проходить «Старт»: +' + money(D.settings.passBonus) + '.'); }
      }
    } else {
      t.pos = ((t.pos + steps) % n + n) % n;
    }
    renderAll();
  }

  function sendToJail() {
    var t = team();
    t.pos = jailIndex();
    t.jail = 2;
    log(t.name + ' потрапляє на клітинку «' + jailName() + '».');
    renderAll();
  }

  function resolveCell() {
    var t = team(), i = t.pos, c = D.cells[i];
    var st = stage();
    st.appendChild(el('h2', 'turn-title', t.name + ': ' + cellName(c)));
    var own = S.owners[i];
    var kind = c.type === 'land' || c.type === 'trade'
      ? (!own ? c.type : own.team === S.turn ? 'own' : 'rent') : c.type;
    var gg = c.type === 'land' ? group(c.group) : null;
    st.appendChild(picture(kind, gg ? gg.color : null, c.type === 'land' || c.type === 'trade' ? null : cellName(c)));
    if (c.type === 'land' || c.type === 'trade') {
      var o = S.owners[i];
      if (!o) return c.type === 'land' ? offerLand(i) : offerTrade(i);
      if (o.team === S.turn) { say('Це ваша земля.'); return endMenu(); }
      return rentMenu(i);
    }
    if (c.type === 'chronicle') return drawEvent();
    if (c.type === 'archive') {
      say(cellName(c) + ': виконайте завдання. Успіх — +' + money(D.settings.archiveBonus) + '.');
      var task = pickTask(null);
      if (!task) { say('Завдань немає.'); return endMenu(); }
      return runTask(task, function (ok) {
        if (ok) { gain(S.turn, D.settings.archiveBonus); log(t.name + ' — успіх («' + cellName(c) + '»): +' + money(D.settings.archiveBonus) + '.'); }
        else log(t.name + ' — невдача («' + cellName(c) + '»).');
        endMenu();
      });
    }
    if (c.type === 'tax') {
      say(cellName(c) + ': сплатіть ' + money(c.amount) + '.');
      pay(S.turn, c.amount);
      log(t.name + ' сплачує ' + money(c.amount) + ' («' + cellName(c) + '»).');
      return endMenu();
    }
    if (c.type === 'jail') { say('Ви тут лише проїздом — це не покарання.'); return endMenu(); }
    if (c.type === 'gotojail') { say(cellName(c) + ': вас відправлено на клітинку «' + jailName() + '».'); sendToJail(); return endMenu(); }
    if (c.type === 'slow') {
      t.skip = 1;
      say(cellName(c) + ': наступний хід команда пропускає.');
      log(t.name + ' пропускає наступний хід («' + cellName(c) + '»).');
      return endMenu();
    }
    say('Старт.');
    endMenu();
  }

  function offerLand(i) {
    var t = team(), c = D.cells[i], g = group(c.group);
    say('Вільна земля, доба: ' + (g ? g.name : c.group) + '. Ціна грамоти — ' + money(c.price) + '.');
    if (t.money < c.price) { say('Грошей на грамоту не вистачає.'); return endMenu(); }
    say('Щоб отримати право купити, виконайте завдання цієї доби.', 'msg-soft');
    var a = actions();
    a.appendChild(btn('Виконати завдання', function () {
      clear(a);
      var task = pickTask(c.group);
      if (!task) { say('Завдань немає.'); return endMenu(); }
      runTask(task, function (ok) {
        if (!ok) { log(t.name + ' — невдача на «' + c.name + '», грамоти немає.'); return endMenu(); }
        var b = actions();
        b.appendChild(btn('Купити за ' + money(c.price), function () {
          pay(S.turn, c.price);
          S.owners[i] = { team: S.turn, level: 0 };
          log(t.name + ' отримує грамоту на «' + c.name + '».');
          renderAll();
          endMenu();
        }, 'btn-main'));
        b.appendChild(btn('Не купувати', function () { log(t.name + ' відмовляється від «' + c.name + '».'); endMenu(); }));
      });
    }, 'btn-main'));
    a.appendChild(btn('Пройти далі', endMenu));
  }

  function offerTrade(i) {
    var t = team(), c = D.cells[i];
    say('Промисел купується без завдання. Ціна — ' + money(c.price) + '. Оренда залежить від того, скільки промислів має власник.');
    var a = actions();
    if (t.money >= c.price) {
      a.appendChild(btn('Купити за ' + money(c.price), function () {
        pay(S.turn, c.price);
        S.owners[i] = { team: S.turn, level: 0 };
        log(t.name + ' купує промисел «' + c.name + '».');
        renderAll();
        endMenu();
      }, 'btn-main'));
    } else say('Грошей не вистачає.');
    a.appendChild(btn('Пройти далі', endMenu));
  }

  function rentMenu(i) {
    var t = team(), c = D.cells[i], o = S.owners[i], owner = S.teams[o.team];
    var rent = rentOf(i);
    say('Земля належить команді «' + owner.name + '». Оренда — ' + money(rent) + '.');
    if (c.type === 'land' && rent > 0) {
      var notes = [];
      if (o.level === 0 && ownsGroup(o.team, c.group)) notes.push('уся доба в одних руках — оренда подвійна');
      activeMods(c.group).forEach(function (m) { notes.push('діє новина: оренда ×' + m.mult); });
      if (notes.length) say('(' + notes.join('; ') + ')', 'msg-soft');
    }
    var a = actions();
    a.appendChild(btn('Сплатити ' + money(rent), function () {
      pay(S.turn, rent, o.team);
      log(t.name + ' сплачує оренду ' + money(rent) + ' команді «' + owner.name + '».');
      renderAll();
      endMenu();
    }, 'btn-main'));
    if (c.type === 'land' && rent > 1) {
      var half = Math.ceil(rent / 2);
      a.appendChild(btn('Оскаржити: завдання, успіх — ' + money(half), function () {
        clear(a);
        var task = pickTask(c.group);
        if (!task) { say('Завдань немає.'); return endMenu(); }
        runTask(task, function (ok) {
          var sum = ok ? half : rent;
          pay(S.turn, sum, o.team);
          log(t.name + (ok ? ' оскаржує оренду й сплачує ' : ' не оскаржує оренди й сплачує ') + money(sum) + '.');
          renderAll();
          endMenu();
        });
      }));
    }
  }

  function jailMenu() {
    var t = team();
    S.phase = 'jail';
    var st = stage();
    st.appendChild(el('h2', 'turn-title', t.name + ': «' + jailName() + '»'));
    say('Вийти можна: грамотою, викупом, завданням-послідовністю або дочекавшись (лишилося чекати: ' + t.jail + ').');
    var a = actions();
    function out(text) { t.jail = 0; log(text); renderAll(); rollMenu(); }
    if (t.jailKeys > 0) a.appendChild(btn('Використати грамоту', function () { t.jailKeys--; out(t.name + ' виходить на волю за грамотою.'); }, 'btn-main'));
    if (t.money >= D.settings.jailFine) {
      a.appendChild(btn('Викуп ' + money(D.settings.jailFine), function () { pay(S.turn, D.settings.jailFine); out(t.name + ' викуповується на волю.'); }));
    }
    var task = null;
    a.appendChild(btn('Завдання-послідовність', function () {
      clear(a);
      task = pickTask(null, 'sequence') || pickTask(null);
      if (!task) return wait();
      runTask(task, function (ok) {
        if (ok) { var b = actions(); b.appendChild(btn('Вийти й кинути кубик', function () { out(t.name + ' виходить на волю завдяки знанню.'); }, 'btn-main')); }
        else { log(t.name + ' лишається на клітинці «' + jailName() + '».'); t.jail = Math.max(0, t.jail - 1); endMenu(); }
      });
    }));
    function wait() {
      t.jail = Math.max(0, t.jail - 1);
      if (t.jail === 0) { out(t.name + ': термін минув, вихід на волю.'); return; }
      log(t.name + ' чекає («' + jailName() + '»).');
      endMenu();
    }
    a.appendChild(btn('Чекати', wait));
  }

  /* ---------- Хроніка ---------- */

  function drawEvent() {
    var t = team();
    if (!D.events.length) { say('Хроніка мовчить: подій немає.'); return endMenu(); }
    var k;
    if (D.settings.eventsInOrder) {
      // Хроніка в порядку файлу: хто знає історію, той передбачає наступну подію.
      k = (S.evNext || 0) % D.events.length;
      S.evNext = k + 1;
    } else {
      var all = D.events.map(function (e, i) { return i; });
      var free = all.filter(function (i) { return S.evUsed.indexOf(i) < 0; });
      if (!free.length) { S.evUsed = []; free = all; }
      k = free[rnd(free.length)];
      S.evUsed.push(k);
    }
    var ev = D.events[k];
    var card = el('div', 'chron');
    card.appendChild(el('p', 'task-kind', 'Хроніка'));
    ui.stage.appendChild(card);

    if (ev.kind === 'card') {
      card.appendChild(el('p', 'chron-story', ev.story));
      card.appendChild(el('p', 'chron-effect', ev.effect));
      log(t.name + ' — Хроніка: ' + ev.effect);
      var a = actions();
      a.appendChild(btn('Далі', function () { applyEffects(ev); }, 'btn-main'));
      return;
    }
    if (ev.kind === 'news') {
      card.appendChild(el('p', 'chron-story', ev.text));
      if (ev.why) card.appendChild(el('p', 'chron-effect', ev.why));
      var laps = ev.laps || 1;
      // Діє до кінця раунду, у якому випала, і ще laps повних раундів (раунд — кожна команда походила раз).
      S.mods.push({ group: ev.group, mult: ev.mult, until: S.round + laps });
      log('Новина: ' + ev.text);
      renderAll();
      return endMenu();
    }
    // decision
    card.appendChild(el('p', 'chron-story', ev.text));
    card.appendChild(el('p', 'msg-soft', 'Правильного варіанта немає: кожен має свою ціну.'));
    var opts = actions();
    ev.options.forEach(function (o) {
      opts.appendChild(btn(o.label, function () {
        clear(opts);
        card.appendChild(el('p', 'chron-effect', o.outcome || ''));
        log(t.name + ' обирає: ' + o.label + '.');
        var b = actions();
        b.appendChild(btn('Далі', function () { applyEffects(o); }, 'btn-main'));
      }, 'opt'));
    });
  }

  function applyEffects(e) {
    var ti = S.turn, t = team();
    if (e.money) {
      if (e.money > 0) gain(ti, e.money); else pay(ti, -e.money);
    }
    if (e.perUpgrade) {
      var lv = 0;
      Object.keys(S.owners).forEach(function (k) { if (S.owners[k].team === ti) lv += S.owners[k].level; });
      var sum = e.perUpgrade * lv;
      if (sum > 0) gain(ti, sum); else pay(ti, -sum);
      if (lv) log(t.name + ': за укріплення ' + (sum >= 0 ? '+' : '') + money(sum) + '.');
    }
    if (e.jailKey) { t.jailKeys++; }
    renderAll();
    if (t.bankrupt) return endMenu();
    if (e.goto === 'jail') { sendToJail(); return endMenu(); }
    if (typeof e.goto === 'number') { var n = D.cells.length; return walk((e.goto - t.pos + n) % n, resolveCell); }
    if (e.move) return walk(e.move, resolveCell);
    endMenu();
  }

  /* ---------- кінець ходу ---------- */

  function endMenu() {
    S.phase = 'end';
    renderAll();
    var t = team();
    var a = actions();
    if (!t.bankrupt) {
      D.cells.forEach(function (c, i) {
        var o = S.owners[i];
        if (!o || o.team !== S.turn || c.type !== 'land') return;
        if (!ownsGroup(S.turn, c.group) || o.level >= c.rent.length - 1) return;
        var cost = upgradeCost(c);
        if (t.money < cost) return;
        a.appendChild(btn('Укріпити «' + c.name + '» за ' + money(cost), function () {
          pay(S.turn, cost);
          o.level++;
          log(t.name + ' укріплює «' + c.name + '» (рівень ' + o.level + ').');
          clear(ui.stage);
          ui.stage.appendChild(el('h2', 'turn-title', t.name + ': укріплення'));
          endMenu();
        }));
      });
    }
    var done = btn('Завершити хід', nextTurn, 'btn-main');
    a.appendChild(done);
    done.focus();
  }

  function alive() { return S.teams.filter(function (t) { return !t.bankrupt; }).length; }
  function firstAlive() { for (var i = 0; i < S.teams.length; i++) if (!S.teams[i].bankrupt) return i; return 0; }
  function timeUp() { return Date.now() >= S.deadline; }

  function nextTurn() {
    if (alive() <= 1) return finish();
    var i = S.turn;
    do {
      i = (i + 1) % S.teams.length;
      if (i === 0) S.round++;
    } while (S.teams[i].bankrupt);
    S.turn = i;
    if (timeUp() && i === firstAlive()) return finish();
    startTurn();
  }

  /* ---------- таймер і ведучий ---------- */

  function tick() {
    if (!S || S.ended) return;
    var left = Math.max(0, S.deadline - Date.now());
    var m = Math.floor(left / 60000), s = Math.floor(left / 1000) % 60;
    ui.timer.textContent = left > 0 ? 'Лишилося ' + m + ':' + (s < 10 ? '0' : '') + s : 'Час вийшов: доходимо раунд до кінця';
    ui.timer.classList.toggle('timer-up', left === 0);
  }

  function hostPanel() {
    var box = ui.host;
    if (!box.hidden) { box.hidden = true; return; }
    clear(box);
    box.hidden = false;
    function open() {
      clear(box);
      box.appendChild(el('p', 'host-title', 'Ведучий'));
      box.appendChild(btn('Пропустити хід цієї команди', function () { box.hidden = true; log('Ведучий пропускає хід.'); nextTurn(); }));
      box.appendChild(btn('Повернути початок цього ходу', function () {
        box.hidden = true;
        if (!S.snapshot) return;
        var snap = S.snapshot;
        S = clone(snap);
        S.log.push({ text: 'Ведучий повертає початок ходу.', team: null, round: S.round });
        startTurn();
      }));
      box.appendChild(btn('Додати 5 хвилин', function () { S.deadline = Math.max(S.deadline, Date.now()) + 5 * 60000; save(); tick(); }));
      box.appendChild(btn('Завершити партію зараз', function () { box.hidden = true; finish(); }, 'btn-danger'));
      box.appendChild(btn('Закрити', function () { box.hidden = true; }));
    }
    if (!S.host) return open();
    var form = el('form', 'pin-form');
    var inp = el('input', 'pin-input');
    inp.type = 'password';
    inp.setAttribute('aria-label', 'PIN ведучого');
    form.appendChild(inp);
    var ok = btn('Відкрити', function () {});
    ok.type = 'submit';
    form.appendChild(ok);
    var msg = el('p', 'msg msg-bad');
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (hash(inp.value) === S.host) open(); else { msg.textContent = 'PIN ведучого не підходить.'; inp.value = ''; }
    });
    box.appendChild(el('p', 'host-title', 'PIN ведучого'));
    box.appendChild(form);
    box.appendChild(msg);
    inp.focus();
  }

  /* ---------- збереження ---------- */

  function save() {
    if (!S) return;
    store(STORE_STATE, S);
    ui.storeNote.hidden = storageOk;
  }

  /* ---------- фінал ---------- */

  function finish() {
    S.ended = true;
    save();
    if (timerId) { clearInterval(timerId); timerId = null; }
    ui.game.hidden = true;
    ui.final.hidden = false;
    var f = ui.final;
    clear(f);
    var box = el('div', 'final');
    box.appendChild(el('h1', 'final-title', 'Кінець партії'));
    var rank = S.teams.map(function (t, i) { return { t: t, i: i, cap: capital(i) }; })
      .sort(function (a, b) { return b.cap - a.cap; });
    box.appendChild(el('p', 'final-win', 'Перемагає: ' + rank[0].t.name));
    var tbl = el('table', 'final-table');
    var head = el('tr');
    ['Команда', 'Капітал', 'Гроші', 'Земель', 'Завдань виконано', 'Не вдалося'].forEach(function (h) { head.appendChild(el('th', null, h)); });
    tbl.appendChild(head);
    rank.forEach(function (r) {
      var tr = el('tr');
      var lands = Object.keys(S.owners).filter(function (k) { return S.owners[k].team === r.i; }).length;
      [r.t.name + (r.t.bankrupt ? ' (банкрут)' : ''), money(r.cap), money(r.t.money), lands, r.t.ok, r.t.fail]
        .forEach(function (v) { tr.appendChild(el('td', null, v)); });
      tbl.appendChild(tr);
    });
    box.appendChild(tbl);
    box.appendChild(el('p', 'msg-soft', 'Капітал — гроші плюс ціна грамот і укріплень.'));

    box.appendChild(el('h2', null, 'Що сталося'));
    var ol = el('ol', 'final-log');
    S.log.forEach(function (l) {
      var li = el('li', null, 'Раунд ' + l.round + '. ' + l.text);
      if (l.team !== null && S.teams[l.team]) li.style.borderLeftColor = S.teams[l.team].color;
      ol.appendChild(li);
    });
    box.appendChild(ol);

    if (D.sources && D.sources.length) {
      box.appendChild(el('h2', null, 'Джерела'));
      var ul = el('ul', 'final-src');
      D.sources.forEach(function (s) { ul.appendChild(el('li', null, s)); });
      box.appendChild(ul);
    }
    box.appendChild(btn('Нова партія', function () { store(STORE_STATE, null); S = null; location.reload(); }, 'btn-main'));
    f.appendChild(box);
  }

  /* ---------- налаштування ---------- */

  function setupScreen() {
    var root = ui.setup;
    var info = root.querySelector('#dataInfo');
    var errs = root.querySelector('#dataErrors');
    var file = root.querySelector('#dataFile');

    function showInfo() {
      clear(info);
      info.appendChild(el('p', 'data-title', D.title));
      if (D.subtitle) info.appendChild(el('p', 'msg-soft', D.subtitle));
      var kinds = {};
      D.tasks.forEach(function (t) { kinds[t.kind] = (kinds[t.kind] || 0) + 1; });
      var parts = Object.keys(kinds).map(function (k) { return BoardTasks.LABEL[k].toLowerCase() + ' — ' + kinds[k]; });
      info.appendChild(el('p', null, 'Завдань: ' + D.tasks.length + ' (' + parts.join(', ') + '). Подій: ' + D.events.length + '. Клітинок: ' + D.cells.length + '.'));
      if (D.conditional) info.appendChild(el('p', 'warn', '⚠ ' + D.conditional));
      root.querySelector('#optTime').value = D.settings.timeLimitMin;
      root.querySelector('#optDice').value = String(D.settings.dice);
    }
    function showErrs(list, cls, head) {
      clear(errs);
      if (!list.length) return;
      errs.appendChild(el('p', cls, head));
      var ul = el('ul', 'err-list');
      list.slice(0, 30).forEach(function (x) { ul.appendChild(el('li', null, x)); });
      if (list.length > 30) ul.appendChild(el('li', null, '… і ще ' + (list.length - 30)));
      errs.appendChild(ul);
    }

    file.addEventListener('change', function () {
      var f = file.files[0];
      if (!f) return;
      BoardData.loadFile(f, BoardData.defaults(), function (res, name) {
        file.value = '';
        if (res.errors.length) { showErrs(res.errors, 'msg msg-bad', 'Файл «' + name + '» не завантажено. Гра лишила попередній набір. Що виправити:'); return; }
        BoardData.setCurrent(res.data);
        D = res.data;
        if (!store(STORE_DATA, D)) res.warnings.push('Браузер не зберіг набір: після перезавантаження сторінки його треба буде завантажити знову.');
        showInfo();
        renderPreview();
        if (res.warnings.length) showErrs(res.warnings, 'msg msg-ok', 'Файл «' + name + '» завантажено. Зауваги:');
        else showErrs(['Усе гаразд.'], 'msg msg-ok', 'Файл «' + name + '» завантажено.');
      });
    });
    root.querySelector('#dataSample').addEventListener('click', function () { BoardData.download(D, 'zrazok-gry.json'); });
    root.querySelector('#dataReset').addEventListener('click', function () {
      D = BoardData.defaults();
      BoardData.setCurrent(D);
      store(STORE_DATA, null);
      showInfo();
      renderPreview();
      showErrs(['Повернуто зразковий набір.'], 'msg msg-ok', 'Готово.');
    });

    var countSel = root.querySelector('#teamCount');
    var teamsBox = root.querySelector('#teamsBox');
    function renderTeamInputs() {
      var n = +countSel.value;
      var old = Array.prototype.map.call(teamsBox.querySelectorAll('.team-setup'), function (r) {
        return { name: r.querySelector('.ts-name').value, pin: r.querySelector('.ts-pin').value };
      });
      clear(teamsBox);
      for (var i = 0; i < n; i++) {
        var row = el('div', 'team-setup');
        var tok = el('span', 'token', TOKENS[i]);
        tok.style.background = COLORS[i];
        row.appendChild(tok);
        var name = el('input', 'ts-name');
        name.value = old[i] ? old[i].name : 'Команда ' + (i + 1);
        name.setAttribute('aria-label', 'Назва команди ' + (i + 1));
        var pin = el('input', 'ts-pin');
        pin.type = 'password';
        pin.autocomplete = 'new-password';
        pin.placeholder = 'PIN (необов\'язково)';
        pin.setAttribute('aria-label', 'PIN команди ' + (i + 1));
        if (old[i]) pin.value = old[i].pin;
        row.appendChild(name);
        row.appendChild(pin);
        teamsBox.appendChild(row);
      }
    }
    countSel.addEventListener('change', renderTeamInputs);
    renderTeamInputs();

    var startErr = root.querySelector('#startErr');
    root.querySelector('#startBtn').addEventListener('click', function () {
      var rows = teamsBox.querySelectorAll('.team-setup');
      var teams = [], problems = [];
      Array.prototype.forEach.call(rows, function (r, i) {
        var name = r.querySelector('.ts-name').value.trim() || 'Команда ' + (i + 1);
        var pin = r.querySelector('.ts-pin').value;
        if (pin && pin.length < 3) problems.push(name + ': PIN має бути від 3 знаків або порожній.');
        teams.forEach(function (t) { if (t.pinRaw === pin && pin) problems.push(name + ': такий самий PIN, як у «' + t.name + '».'); });
        teams.push({ name: name, pinRaw: pin });
      });
      var host = root.querySelector('#hostPin').value;
      clear(startErr);
      if (problems.length) { problems.forEach(function (p) { startErr.appendChild(el('li', null, p)); }); return; }
      var mins = Math.max(1, +root.querySelector('#optTime').value || D.settings.timeLimitMin);
      D.settings.dice = +root.querySelector('#optDice').value === 1 ? 1 : 2;
      store(STORE_DATA, D);
      S = {
        v: 1,
        teams: teams.map(function (t, i) {
          return { name: t.name, color: COLORS[i], pin: t.pinRaw ? hash(t.pinRaw) : '', pos: 0, money: D.settings.startMoney, jail: 0, jailKeys: 0, skip: 0, bankrupt: false, ok: 0, fail: 0 };
        }),
        host: host ? hash(host) : null,
        owners: {}, turn: 0, round: 1, mods: [], used: [], evUsed: [], log: [],
        deadline: Date.now() + mins * 60000, ended: false, lastRoll: null
      };
      log('Партію розпочато: ' + teams.length + ' команди, ' + mins + ' хв.', null);
      startGame();
    });

    var saved = load(STORE_STATE);
    var resume = root.querySelector('#resumeBox');
    if (saved && !saved.ended && saved.teams) {
      resume.hidden = false;
      clear(resume);
      resume.appendChild(el('p', null, 'Є незавершена партія: ' + saved.teams.map(function (t) { return t.name; }).join(', ') + ', раунд ' + saved.round + '.'));
      resume.appendChild(btn('Продовжити партію', function () {
        S = saved.snapshot ? clone(saved.snapshot) : saved;
        S.snapshot = saved.snapshot || null;
        startGame();
      }, 'btn-main'));
      resume.appendChild(btn('Почати з нуля', function () { store(STORE_STATE, null); resume.hidden = true; }));
    }

    function renderPreview() {
      var prevS = S;
      S = null;
      ui.board = root.querySelector('#preview');
      renderBoard();
      S = prevS;
    }
    showInfo();
    renderPreview();
    ui.storeNote.hidden = storageOk;
  }

  function startGame() {
    ui.setup.hidden = true;
    ui.final.hidden = true;
    ui.game.hidden = false;
    ui.game.classList.toggle('game-map', ((D.board && D.board.layout) || 'ring') === 'map');
    ui.board = ui.game.querySelector('#board');
    if (timerId) clearInterval(timerId);
    timerId = setInterval(tick, 1000);
    tick();
    startTurn();
  }

  function init(cfg) {
    ui.setup = document.getElementById(cfg.setupId);
    ui.game = document.getElementById(cfg.gameId);
    ui.final = document.getElementById(cfg.finalId);
    ui.stage = ui.game.querySelector('#stage');
    ui.teams = ui.game.querySelector('#teams');
    ui.log = ui.game.querySelector('#log');
    ui.timer = ui.game.querySelector('#timer');
    ui.round = ui.game.querySelector('#round');
    ui.host = ui.game.querySelector('#hostBox');
    ui.storeNote = document.getElementById('storeNote');
    ui.game.querySelector('#hostBtn').addEventListener('click', hostPanel);

    D = BoardData.defaults();
    var savedData = load(STORE_DATA);
    if (savedData) {
      var res = BoardData.validate(savedData, D);
      if (!res.errors.length) D = res.data;
    }
    BoardData.setCurrent(D);
    setupScreen();
  }

  window.BoardGame = { init: init };
})();
