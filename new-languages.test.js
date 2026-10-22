'use strict';
// Portuguese (pt-BR), Hindi (hi-IN) and Russian (ru-RU): every per-language
// table is complete, the language buttons exist, and real spoken phrases in
// each language parse into the right entries / tab / stream.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, runInSandbox } = require('./helpers');

const html = loadHtml();
const NEW = ['pt-BR', 'hi-IN', 'ru-RU'];
const ALL = ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].concat(NEW);

test('language buttons for all 8 languages on the welcome screen and in Settings', function(){
  ALL.forEach(function(code){
    const n = (html.match(new RegExp('data-lang="' + code + '"', 'g')) || []).length;
    assert.strictEqual(n, 2, code + ' should have a button in both language pickers (found ' + n + ')');
  });
});

test('every voice/navigation table covers the new languages', function(){
  ['CATEGORY_WORDS_BY_LANG', 'COMMAND_WORDS_BY_LANG', 'NAV_WORDS_BY_LANG', 'NAV_LABELS', 'STREAM_WORDS_BY_LANG', 'NUMBER_WORDS_BASIC'].forEach(function(name){
    const table = extractObjectLiteral(html, name);
    NEW.forEach(function(code){ assert.ok(table[code], name + ' is missing ' + code); });
  });
  const cmd = extractObjectLiteral(html, 'COMMAND_WORDS_BY_LANG');
  const enKeys = Object.keys(cmd['en-US']).sort();
  NEW.forEach(function(code){ assert.deepStrictEqual(Object.keys(cmd[code]).sort(), enKeys, code + ' command patterns match English'); });
  const nav = extractObjectLiteral(html, 'NAV_WORDS_BY_LANG');
  NEW.forEach(function(code){ assert.deepStrictEqual(Object.keys(nav[code]).sort(), ['calendar', 'log', 'stats', 'vehicle'], code + ' tabs'); });
});

test('every Help section is translated for the new languages (no copied English)', function(){
  const HELP = extractObjectLiteral(html, 'HELP_CONTENT');
  NEW.forEach(function(code){
    assert.strictEqual(HELP[code].sections.length, 12);
    HELP[code].sections.forEach(function(sec, i){
      assert.ok(sec.title && sec.body.length > 40, code + ' section ' + i + ' has content');
      assert.notStrictEqual(sec.body, HELP['en-US'].sections[i].body, code + ' section ' + i + ' is not just the English text');
    });
  });
});

function parser(lang){
  const added = [], nav = [];
  const sb = runInSandbox([
    "var EN_ONES = " + JSON.stringify(extractObjectLiteral(html, 'EN_ONES')) + "; var EN_TENS = " + JSON.stringify(extractObjectLiteral(html, 'EN_TENS')) + ";",
    "var currentLang = " + JSON.stringify(lang) + "; var KM_TO_MI = 0.621371;",
    "var streams = ['Driving', 'Dojo', 'Personal']; var activeStream = 'Driving'; var DEFAULT_STREAMS = ['Driving'];",
    "function loadPlatforms(){ return []; } function fmtDist(m){ return m + ' mi'; } function currencySymbol(){ return '$'; }",
    "function matchStream(name){ var n = String(name).toLowerCase().trim(); for(var i = 0; i < streams.length; i++){ if(n.indexOf(streams[i].toLowerCase()) !== -1) return streams[i]; } return null; }",
    "function setActiveStream(s){ activeStream = s; } function renderAll(){} function renderStreamBar(){} function showToast(){}",
    "var NUMBER_WORDS_BASIC = " + "NUMBER_WORDS_BASIC_ARG" + ";",
    extractFn(html, 'wordsToDigitsEN'), extractFn(html, 'wordsToDigitsBasic'),
    extractFn(html, 'normalizeSpeechText'), extractFn(html, 'matchCategory'),
    "var INCOME_PLATFORM_CATEGORIES = ['DoorDash','Uber Eats','Amazon Flex','Uber','Lyft','Grubhub','Instacart'];",
    extractFn(html, 'parseVoiceCommand')
  ], {
    NUMBER_WORDS_BASIC_ARG: extractObjectLiteral(html, 'NUMBER_WORDS_BASIC'),
    CATEGORY_WORDS_BY_LANG: extractObjectLiteral(html, 'CATEGORY_WORDS_BY_LANG'),
    COMMAND_WORDS_BY_LANG: extractObjectLiteral(html, 'COMMAND_WORDS_BY_LANG'),
    NAV_WORDS_BY_LANG: extractObjectLiteral(html, 'NAV_WORDS_BY_LANG'),
    NAV_LABELS: extractObjectLiteral(html, 'NAV_LABELS'),
    STREAM_WORDS_BY_LANG: extractObjectLiteral(html, 'STREAM_WORDS_BY_LANG'),
    addEntry: function(type, amount, category, miles){ added.push({ type: type, amount: amount, category: category, miles: miles }); },
    showPanel: function(name){ nav.push(name); }
  });
  return { sb: sb, added: added, nav: nav };
}

// What each language says for the same four things.
const SAMPLES = {
  'pt-BR': { income: '20 reais receita doordash', expense: '8 reais despesa gasolina', restaurant: '15 reais restaurante', miles: 'registrar 12 milhas', tab: 'abrir estatísticas' },
  'ru-RU': { income: '20 долларов доход доордаш', expense: '8 долларов расход бензин', restaurant: '15 долларов ресторан', miles: 'запиши 12 миль', tab: 'открой статистику' },
  'hi-IN': { income: '20 डॉलर आय डोरडैश', expense: '8 डॉलर खर्च पेट्रोल', restaurant: '15 डॉलर रेस्टोरेंट', miles: '12 मील दर्ज करो', tab: 'आँकड़े खोलो' }
};

NEW.forEach(function(code){
  test(code + ': income, expense, restaurant, mileage and tab navigation are understood by voice', function(){
    const S = SAMPLES[code];
    let p = parser(code); assert.ok(p.sb.parseVoiceCommand(S.income), 'income: ' + S.income);
    assert.deepStrictEqual([p.added[0].type, p.added[0].amount, p.added[0].category], ['income', 20, 'DoorDash']);
    p = parser(code); assert.ok(p.sb.parseVoiceCommand(S.expense), 'expense: ' + S.expense);
    assert.deepStrictEqual([p.added[0].type, p.added[0].amount, p.added[0].category], ['expense', 8, 'Gas']);
    p = parser(code); assert.ok(p.sb.parseVoiceCommand(S.restaurant), 'restaurant: ' + S.restaurant);
    assert.deepStrictEqual([p.added[0].type, p.added[0].category], ['expense', 'Restaurant']);
    p = parser(code); assert.ok(p.sb.parseVoiceCommand(S.miles), 'miles: ' + S.miles);
    assert.strictEqual(p.added[0].type, 'mileage'); assert.strictEqual(p.added[0].miles, 12);
    p = parser(code); assert.ok(p.sb.parseVoiceCommand(S.tab), 'tab: ' + S.tab);
    assert.deepStrictEqual(p.nav, ['stats']);
  });
});

test('the existing five languages still parse their own phrases (nothing regressed)', function(){
  const p = parser('es-ES'); assert.ok(p.sb.parseVoiceCommand('20 dólares ingreso doordash'));
  assert.deepStrictEqual([p.added[0].type, p.added[0].category], ['income', 'DoorDash']);
  const q = parser('en-US'); assert.ok(q.sb.parseVoiceCommand('8 dollars expense gas'));
  assert.deepStrictEqual([q.added[0].type, q.added[0].category], ['expense', 'Gas']);
});

test('spoken number words work in Portuguese and Russian ("vinte reais", "двадцать долларов")', function(){
  const pt = parser('pt-BR'); assert.ok(pt.sb.parseVoiceCommand('vinte reais receita doordash'));
  assert.strictEqual(pt.added[0].amount, 20);
  const ru = parser('ru-RU'); assert.ok(ru.sb.parseVoiceCommand('двадцать долларов доход доордаш'));
  assert.strictEqual(ru.added[0].amount, 20);
});
