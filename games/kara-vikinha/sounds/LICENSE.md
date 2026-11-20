# Звуки «Кари вікінга»

Усі файли тут — CC0 (суспільне надбання): дозволено використовувати, змінювати й поширювати без згадки автора.
Згадку все одно лишаємо — щоб знати, звідки що.

| Файл | Подія | Автор | Джерело |
|---|---|---|---|
| `handleCoins2.ogg` | своє яблуко в кошику | Kenney (kenney.nl), набір «RPG Audio» (50 RPG sound effects) | https://opengameart.org/content/50-rpg-sound-effects |
| `metalPot2.ogg` | чуже яблуко | те саме | те саме |
| `dropLeather.ogg` | своє яблуко впало на землю | те саме | те саме |
| `handleCoins.ogg` | кінець гри | те саме | те саме |
| `horn-theircoming3.ogg` (оригінал — `theircoming3_0.ogg`) | нова категорія; гра обрізає до 2,2 с | StumpyStrust | https://opengameart.org/content/their-coming-generic-horn-sound |

Завантажено 2026-11-20.
Гра ці файли напряму не читає: `python tools/sounds-build.py kara-vikinha` пакує їх у `games/kara-vikinha/sounds.js` (base64), бо через `file://` браузер не дає прочитати локальний файл у Web Audio.
Яка подія грає який файл — таблиця `GAMES` у `tools/sounds-build.py`.
Формат OGG Vorbis: Chrome, Edge і Firefox його розкодовують; старий Safari може не розкодувати — тоді гра просто мовчить.
