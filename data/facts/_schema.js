// ЗГЕНЕРОВАНО tools/facts-build.py — не редагувати руками.
// Джерело: tools/facts_schema.py

(function () {
  'use strict';
  window.FACTS_SCHEMA = {
    version: 1,
    minChoiceOptions: 4,
    minQuoteOptions: 4,
    difficulties: ['easy', 'medium', 'hard'],
    renderable: ['DATE', 'PERSON', 'EVENT', 'DOCUMENT', 'TERM', 'PLACE', 'CAUSE', 'CONSEQUENCE', 'ORGANIZATION', 'ATTRIBUTE'],
    types: {
      'DATE': { renderable: true, mechanics: ['quiz-text', 'quiz-choice', 'falling', 'timeline', 'cards'] },
      'PERSON': { renderable: true, mechanics: ['quiz-choice', 'falling', 'cards'] },
      'EVENT': { renderable: true, mechanics: ['quiz-choice', 'falling', 'cards'] },
      'DOCUMENT': { renderable: true, mechanics: ['quiz-choice', 'falling', 'cards'] },
      'TERM': { renderable: true, mechanics: ['quiz-text', 'quiz-choice', 'cards'] },
      'PLACE': { renderable: true, mechanics: ['quiz-choice', 'falling', 'cards'] },
      'CAUSE': { renderable: true, mechanics: ['quiz-choice', 'cards'] },
      'CONSEQUENCE': { renderable: true, mechanics: ['quiz-choice', 'cards'] },
      'ORGANIZATION': { renderable: true, mechanics: ['quiz-choice', 'falling', 'cards'] },
      'ATTRIBUTE': { renderable: true, mechanics: ['quiz-text', 'cards'] },
      'RELATION': { renderable: false, mechanics: ['cards'] }
    }
  };
})();
