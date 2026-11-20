// ЗГЕНЕРОВАНО tools/facts-build.py — не редагувати руками.
// Джерело: data/topics/demo-ukr-revolution/facts.md

(function () {
  'use strict';
  window.FACTS = window.FACTS || {};
  window.FACTS['demo-ukr-revolution'] = {
    slug: 'demo-ukr-revolution',
    title: 'Українська революція 1917–1921',
    period: 6,
    password: 'Соборність',
    accent: '#b8860b',
    facts: [
      {
        id: 'F001', type: 'PERSON',
        concept: 'Українська Центральна Рада',
        predicate: 'очолював',
        object: 'Михайло Грушевський',
        fact: 'Українську Центральну Раду очолював Михайло Грушевський.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: ['Грушевський', 'М. Грушевський'],
        requires: ['T001']
      },
      {
        id: 'F002', type: 'DATE',
        concept: 'Берестейський мир',
        predicate: 'дата',
        object: '1918',
        fact: 'Берестейський мир укладено у 1918 році.',
        date: 1918, difficulty: 'easy',
        detail: 'Перший міжнародний договір, підписаний Українською Народною Республікою.',
        quote: '«Мир між Українською Народною Республікою з одної сторони і Німеччиною, Австро-Угорщиною, Болгарією й Туреччиною з другої… Договірні сторони заявляють, що між ними немає стану війни.»',
        aliases: ['1918 р.', '1918 рік'],
        requires: ['T002']
      },
      {
        id: 'F003', type: 'DOCUMENT',
        concept: 'IV Універсал',
        predicate: 'зміст',
        object: 'незалежність УНР',
        fact: 'IV Універсал проголосив незалежність УНР.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: '«Однині Українська Народна Республіка стає самостійною, ні від кого незалежною, вільною, суверенною державою українського народу.»',
        aliases: [],
        requires: ['T003']
      },
      {
        id: 'F004', type: 'DOCUMENT',
        concept: 'I Універсал',
        predicate: 'зміст',
        object: 'автономія України',
        fact: 'I Універсал проголосив автономію України.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: '«Хай буде Україна вільною. Не одділяючись від усієї Росії… хай народ український на своїй землі має право сам порядкувати своїм життям.»',
        aliases: [],
        requires: ['T004']
      },
      {
        id: 'F005', type: 'PLACE',
        concept: 'ЗУНР',
        predicate: 'столиця',
        object: 'Львів',
        fact: 'Столицею ЗУНР став Львів.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: ['м. Львів'],
        requires: ['T005']
      },
      {
        id: 'F006', type: 'PERSON',
        concept: 'Українська Держава',
        predicate: 'очолював',
        object: 'Павло Скоропадський',
        fact: 'Українську Державу очолював гетьман Павло Скоропадський.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: '«Цією грамотою я оголошую себе Гетьманом всієї України… Центральна і Мала Рада з нинішнього дня розпускаються.»',
        aliases: ['Скоропадський', 'П. Скоропадський'],
        requires: ['T006']
      },
      {
        id: 'F007', type: 'DATE',
        concept: 'Проголошення ЗУНР',
        predicate: 'дата',
        object: '1918',
        fact: 'Проголошення ЗУНР відбулося у 1918 році.',
        date: 1918, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: ['1918 р.', '1918 рік'],
        requires: ['T007']
      },
      {
        id: 'F008', type: 'PERSON',
        concept: 'Директорія УНР',
        predicate: 'очолював',
        object: 'Володимир Винниченко',
        fact: 'Директорію УНР очолював Володимир Винниченко.',
        date: null, difficulty: 'medium',
        detail: 'Перший голова Директорії; згодом її очолив Симон Петлюра.',
        quote: null,
        aliases: ['Винниченко', 'В. Винниченко'],
        requires: ['T008']
      },
      {
        id: 'F009', type: 'DOCUMENT',
        concept: 'III Універсал',
        predicate: 'зміст',
        object: 'створення УНР',
        fact: 'III Універсал проголосив створення УНР.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: '«Однині Україна стає Українською Народною Республікою. Не відділяючись від Республіки Російської і зберігаючи єдність її, ми твердо станемо на нашій землі…»',
        aliases: [],
        requires: ['T009']
      },
      {
        id: 'F010', type: 'DATE',
        concept: 'Акт Злуки',
        predicate: 'дата',
        object: '1919',
        fact: 'Акт Злуки проголошено у 1919 році.',
        date: 1919, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: ['1919 р.', '1919 рік'],
        requires: ['T010']
      },
      {
        id: 'F011', type: 'PLACE',
        concept: 'Акт Злуки',
        predicate: 'місце',
        object: 'Софійська площа в Києві',
        fact: 'Акт Злуки проголошено на Софійській площі в Києві.',
        date: null, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['Софійська площа', 'Київ'],
        requires: ['T011']
      },
      {
        id: 'F012', type: 'RELATION',
        concept: 'Берестейський мир',
        predicate: 'сторона',
        object: 'УНР',
        fact: 'Однією зі сторін Берестейського миру була УНР.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T012']
      },
      {
        id: 'F013', type: 'RELATION',
        concept: 'Берестейський мир',
        predicate: 'сторона',
        object: 'Центральні держави',
        fact: 'Однією зі сторін Берестейського миру були Центральні держави.',
        date: null, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T012']
      },
      {
        id: 'F014', type: 'DATE',
        concept: 'Ризький мирний договір',
        predicate: 'дата',
        object: '1921',
        fact: 'Ризький мирний договір підписано у 1921 році.',
        date: 1921, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['1921 р.', '1921 рік'],
        requires: ['T013']
      },
      {
        id: 'F015', type: 'PERSON',
        concept: 'ЗУНР',
        predicate: 'очолював',
        object: 'Євген Петрушевич',
        fact: 'ЗУНР очолював президент Євген Петрушевич.',
        date: null, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['Петрушевич', 'Є. Петрушевич'],
        requires: ['T014']
      },
      {
        id: 'F016', type: 'RELATION',
        concept: 'Акт Злуки',
        predicate: 'сторона',
        object: 'УНР',
        fact: 'Однією зі сторін Акта Злуки була УНР.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T015']
      },
      {
        id: 'F017', type: 'RELATION',
        concept: 'Акт Злуки',
        predicate: 'сторона',
        object: 'ЗУНР',
        fact: 'Однією зі сторін Акта Злуки була ЗУНР.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T015']
      },
      {
        id: 'F018', type: 'PLACE',
        concept: 'Бій під Крутами',
        predicate: 'місце',
        object: 'станція Крути',
        fact: 'Бій під Крутами відбувся на станції Крути.',
        date: null, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T016']
      },
      {
        id: 'F019', type: 'DATE',
        concept: 'Варшавська угода',
        predicate: 'дата',
        object: '1920',
        fact: 'Варшавську угоду укладено у 1920 році.',
        date: 1920, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['1920 р.', '1920 рік'],
        requires: ['T017']
      },
      {
        id: 'F020', type: 'DOCUMENT',
        concept: 'Варшавська угода',
        predicate: 'зміст',
        object: 'визнання незалежності УНР Польщею',
        fact: 'Варшавська угода передбачала визнання незалежності УНР Польщею.',
        date: null, difficulty: 'hard',
        detail: null,
        quote: null,
        aliases: [],
        requires: ['T018']
      },
      {
        id: 'F021', type: 'PLACE',
        concept: 'Берестейський мир',
        predicate: 'місце',
        object: 'Берестя',
        fact: 'Берестейський мир укладено в місті Берестя.',
        date: null, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['Брест', 'Брест-Литовськ'],
        requires: ['T019']
      },
      {
        id: 'F022', type: 'DATE',
        concept: 'Гетьманський переворот',
        predicate: 'дата',
        object: '1918',
        fact: 'Гетьманський переворот стався у 1918 році.',
        date: 1918, difficulty: 'easy',
        detail: null,
        quote: null,
        aliases: ['1918 р.', '1918 рік'],
        requires: ['T020']
      },
      {
        id: 'F023', type: 'PLACE',
        concept: 'Ризький мирний договір',
        predicate: 'місце',
        object: 'Рига',
        fact: 'Ризький мирний договір підписано в місті Рига.',
        date: null, difficulty: 'medium',
        detail: null,
        quote: null,
        aliases: ['м. Рига'],
        requires: ['T021']
      }
    ]
  };
})();
