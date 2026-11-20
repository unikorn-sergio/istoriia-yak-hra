/* games/kara-vikinha/sound.js — window.KaraVikinhaSound.

   Звуки приходять як base64 у window.KARA_VIKINHA_SOUNDS (sounds.js,
   ЗГЕНЕРОВАНИЙ tools/sounds-build.py): file:// не дає fetch(), а Web Audio
   бере лише байти. Рушій гри про звук не знає — сторінка кличе play(назва)
   зі своїх обробників подій.

   Будова та сама, що в games/sky-highway/sound.js, без петлі двигуна, зате
   з обрізанням: ріг категорії триває 5 с, а категорія міняється кожні 15, —
   play('category', {seconds: 2.2}) гасить його плавно.

   Браузер не дає грати звук до першого жесту, тому unlock() кличеться з
   кліку «Почати гру». Без Web Audio усе мовчить — гра без звуку лишається
   грою.

     KaraVikinhaSound.unlock();                      // у click-обробнику
     KaraVikinhaSound.play('right');
     KaraVikinhaSound.play('category', { seconds: 2.2 });
     KaraVikinhaSound.setMuted(true);
     KaraVikinhaSound.suspend(); KaraVikinhaSound.resume();   // пауза
*/
(function () {
  'use strict';

  var VOLUME = { right: 0.8, wrong: 0.55, miss: 0.5, category: 0.45, finish: 0.85 };
  var FADE = 0.4;

  var data = window.KARA_VIKINHA_SOUNDS || {};
  var ctx = null, master = null, buffers = {}, muted = false;
  /* Перший ріг лунає в тому ж кліку, що й unlock(), а розкодування
     асинхронне: запит, що випередив буфер, чекає його до PENDING_MAX с. */
  var pending = {};
  var PENDING_MAX = 0.6;

  function decode(name) {
    var item = data[name];
    if (!item) { return; }
    var bin = atob(item.data), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { bytes[i] = bin.charCodeAt(i); }
    /* Колбеки, а не проміс: старий Safari знає лише цю форму. */
    try {
      ctx.decodeAudioData(bytes.buffer, function (buf) {
        buffers[name] = buf;
        var req = pending[name];
        delete pending[name];
        if (req && ctx.currentTime - req.at <= PENDING_MAX) { play(name, req.options); }
      },
        function () { if (window.console) { console.warn('звук не розкодувався: ' + item.file); } });
    } catch (e) { /* пошкоджений файл — мовчимо, гра йде далі */ }
  }

  function unlock() {
    if (!ctx) {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) { return; }
      try { ctx = new Ctx(); } catch (e) { return; }
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(ctx.destination);
      Object.keys(data).forEach(decode);
    }
    if (ctx.state === 'suspended') { ctx.resume(); }
  }

  function play(name, options) {
    if (!ctx || muted) { return; }
    var buf = buffers[name];
    if (!buf) {
      if (data[name]) { pending[name] = { at: ctx.currentTime, options: options }; }
      return;
    }
    if (ctx.state !== 'running') { return; }
    var src = ctx.createBufferSource(), g = ctx.createGain();
    var vol = VOLUME[name] !== undefined ? VOLUME[name] : 0.6;
    src.buffer = buf;
    g.gain.value = vol;
    src.connect(g);
    g.connect(master);
    src.start();
    var seconds = options && options.seconds;
    if (seconds && seconds < buf.duration) {
      var t = ctx.currentTime;
      g.gain.setValueAtTime(vol, t + Math.max(0, seconds - FADE));
      g.gain.linearRampToValueAtTime(0, t + seconds);
      src.stop(t + seconds + 0.05);
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (master) { master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.03); }
  }

  window.KaraVikinhaSound = {
    unlock: unlock,
    play: play,
    setMuted: setMuted,
    isMuted: function () { return muted; },
    suspend: function () { if (ctx && ctx.state === 'running') { ctx.suspend(); } },
    resume: function () { if (ctx && ctx.state === 'suspended') { ctx.resume(); } },
    available: function () { return !!(window.AudioContext || window.webkitAudioContext); },
    /* стенд: які звуки вже розкодовано */
    loaded: function () { return Object.keys(buffers).sort(); }
  };
})();
