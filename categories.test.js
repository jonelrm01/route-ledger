'use strict';
// "Restaurant" is a built-in expense category in every stream, translated,
// and understood by voice entry in all five languages.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, runInSandbox } = require('./helpers');

const html = loadHtml();

test('Restaurant is offered in Driving, Dojo, Personal and custom streams, just before Other', function(){
  const sb = runInSandbox(["var DEFAULT_STREAMS = ['Driving'];", extractFn(html, 'categoriesForStream')]);
  ['Driving', 'Dojo', 'Personal', 'My Side Gig'].forEach(function(stream){
    const cats = Array.from(sb.categoriesForStream(stream));
    assert.strictEqual(cats.filter(function(c){ return c === 'Restaurant'; }).length, 1, stream + ' has Restaurant exactly once');
    assert.strictEqual(cats[cats.length - 1], 'Other', stream + ' still ends with Other');
    assert.ok(cats.indexOf('Restaurant') < cats.indexOf('Other'));
  });
});

test('Restaurant has a display name in all 5 languages', function(){
  const labels = extractObjectLiteral(html, 'CATEGORY_LABELS');
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    assert.ok(labels[lang] && labels[lang].Restaurant, lang + ' is missing a Restaurant label');
  });
  assert.strictEqual(labels['es-ES'].Restaurant, 'Restaurante');
  assert.strictEqual(labels['it-IT'].Restaurant, 'Ristorante');
});

function parser(lang){
  const added = [];
  const sb = runInSandbox([
    "var EN_ONES = " + JSON.stringify(extractObjectLiteral(html, 'EN_ONES')) + "; var EN_TENS = " + JSON.stringify(extractObjectLiteral(html, 'EN_TENS')) + ";",
    "var currentLang = " + JSON.stringify(lang) + "; var streams = ['Driving']; var KM_TO_MI = 0.621371;",
    "var activeStream = 'Driving'; var DEFAULT_STREAMS = ['Driving'];",
    "var NAV_WORDS_BY_LANG = {}; NAV_WORDS_BY_LANG[currentLang] = {}; var NAV_LABELS = {}; NAV_LABELS[currentLang] = {};",
    "function loadPlatforms(){ return []; } function fmtDist(m){ return m + ' mi'; } function currencySymbol(){ return '$'; }",
    extractFn(html, 'wordsToDigitsEN'), extractFn(html, 'wordsToDigitsBasic'), "var NUMBER_WORDS_BASIC = {};",
    extractFn(html, 'normalizeSpeechText'), extractFn(html, 'matchCategory'),
    "var INCOME_PLATFORM_CATEGORIES = ['DoorDash','Uber Eats','Amazon Flex','Uber','Lyft','Grubhub','Instacart'];",
    extractFn(html, 'parseVoiceCommand')
  ], {
    CATEGORY_WORDS_BY_LANG: extractObjectLiteral(html, 'CATEGORY_WORDS_BY_LANG'),
    COMMAND_WORDS_BY_LANG: extractObjectLiteral(html, 'COMMAND_WORDS_BY_LANG'),
    addEntry: function(type, amount, category, miles){ added.push({ type: type, amount: amount, category: category }); }
  });
  return { parse: sb.parseVoiceCommand, added: added };
}

test('voice (English): "20 dollars restaurant", lunch, dinner, takeout are logged as Restaurant expenses', function(){
  ['20 dollars restaurant', '15 dollars lunch', 'spent 40 on dinner', '12 dollars takeout', '9 dollars breakfast'].forEach(function(phrase){
    const p = parser('en-US');
    assert.ok(p.parse(phrase), 'should be understood: ' + phrase);
    assert.strictEqual(p.added[0].type, 'expense', phrase);
    assert.strictEqual(p.added[0].category, 'Restaurant', phrase);
  });
});

test('voice: existing categories are unaffected', function(){
  const gas = parser('en-US'); gas.parse('8 dollars expense gas');
  assert.deepStrictEqual([gas.added[0].type, gas.added[0].category], ['expense', 'Gas']);
  const dd = parser('en-US'); dd.parse('20 dollars income doordash');
  assert.deepStrictEqual([dd.added[0].type, dd.added[0].category], ['income', 'DoorDash']);
});

test('voice (es/it/fr/zh): a restaurant word is both the category and an expense signal', function(){
  const cases = { 'es-ES': '15 dólares restaurante', 'it-IT': '15 dollari ristorante', 'fr-FR': '15 dollars restaurant', 'zh-CN': '15美元餐厅' };
  Object.keys(cases).forEach(function(lang){
    const p = parser(lang);
    assert.ok(p.parse(cases[lang]), lang + ' should parse: ' + cases[lang]);
    assert.strictEqual(p.added[0].category, 'Restaurant', lang);
    assert.strictEqual(p.added[0].type, 'expense', lang);
  });
});
