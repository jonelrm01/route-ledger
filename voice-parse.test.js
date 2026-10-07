'use strict';
// Voice entry: speech engines return several candidate transcripts and often
// split brand names ("door dash") or hyphenate numbers ("twenty-five"). These
// check the normalization, the pick-first-alternative-that-parses logic, and
// the phrases that used to need repeating.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, runInSandbox } = require('./helpers');

const html = loadHtml();

function makeParser(opts){
  opts = opts || {};
  const added = [];
  const sources = [
    "var EN_ONES = " + JSON.stringify(extractObjectLiteral(html, 'EN_ONES')) + ";",
    "var EN_TENS = " + JSON.stringify(extractObjectLiteral(html, 'EN_TENS')) + ";",
    "var currentLang = 'en-US'; var streams = ['Driving']; var KM_TO_MI = 0.621371;",
    "var activeStream = " + JSON.stringify(opts.stream || 'Driving') + "; var DEFAULT_STREAMS = ['Driving'];",
    "var NAV_WORDS_BY_LANG = { 'en-US': {} }; var NAV_LABELS = { 'en-US': {} };",
    "function loadPlatforms(){ return []; } function fmtDist(m){ return m + ' mi'; } function currencySymbol(){ return '$'; }",
    extractFn(html, 'wordsToDigitsEN'),
    extractFn(html, 'wordsToDigitsBasic'),
    "var NUMBER_WORDS_BASIC = {};",
    extractFn(html, 'normalizeSpeechText'),
    extractFn(html, 'matchCategory'),
    "var INCOME_PLATFORM_CATEGORIES = " + JSON.stringify(['DoorDash','Uber Eats','Amazon Flex','Uber','Lyft','Grubhub','Instacart']) + ";",
    extractFn(html, 'parseVoiceCommand')
  ];
  const mocks = {
    CATEGORY_WORDS_BY_LANG: extractObjectLiteral(html, 'CATEGORY_WORDS_BY_LANG'),
    COMMAND_WORDS_BY_LANG: extractObjectLiteral(html, 'COMMAND_WORDS_BY_LANG'),
    addEntry: function(type, amount, category, miles){ added.push({ type: type, amount: amount, category: category, miles: miles }); }
  };
  const sb = runInSandbox(sources, mocks);
  return { parse: sb.parseVoiceCommand, added: added, sb: sb };
}

test('normalizeSpeechText: joins split brand names and hyphenated number words', function(){
  const sb = runInSandbox([extractFn(html, 'normalizeSpeechText')]);
  assert.strictEqual(sb.normalizeSpeechText('Twenty-five dollars Door Dash'), 'twenty five dollars doordash');
  assert.strictEqual(sb.normalizeSpeechText('8 dollars Grub Hub'), '8 dollars grubhub');
  assert.strictEqual(sb.normalizeSpeechText('10 dollars Insta Cart'), '10 dollars instacart');
  assert.strictEqual(sb.normalizeSpeechText('15 dollars UberEats'), '15 dollars uber eats');
});

test('normalizeSpeechText: leaves other hyphens alone (app names like Assist-Dummy survive the rename command)', function(){
  const sb = runInSandbox([extractFn(html, 'normalizeSpeechText')]);
  assert.strictEqual(sb.normalizeSpeechText('call this app Assist-Dummy'), 'call this app assist-dummy');
});

test('collectAlternatives: returns distinct non-empty transcripts in order', function(){
  const sb = runInSandbox([extractFn(html, 'collectAlternatives')]);
  const fake = [{ transcript: 'a b' }, { transcript: 'a c' }, { transcript: 'a b' }, { transcript: '' }, null];
  assert.deepStrictEqual(Array.from(sb.collectAlternatives(fake)), ['a b', 'a c']);
});

test('pickParsedAlternative: uses the first alternative that parses, not just the top guess', function(){
  const sb = runInSandbox([extractFn(html, 'pickParsedAlternative')]);
  const picked = sb.pickParsedAlternative(['garbled one', 'good one', 'also good'], function(t){ return t === 'good one' || t === 'also good' ? 'ok:' + t : null; });
  assert.strictEqual(picked.transcript, 'good one');
  assert.strictEqual(picked.result, 'ok:good one');
  assert.strictEqual(sb.pickParsedAlternative(['x', 'y'], function(){ return null; }), null);
  assert.strictEqual(sb.pickParsedAlternative([], function(){ return 'never'; }), null);
});

test('parseVoiceCommand: "twenty-five dollars income door dash" logs 25 income as DoorDash', function(){
  const p = makeParser();
  const res = p.parse('Twenty-five dollars income door dash');
  assert.ok(res, 'should parse');
  assert.strictEqual(p.added.length, 1);
  assert.strictEqual(p.added[0].type, 'income');
  assert.strictEqual(p.added[0].amount, 25);
  assert.strictEqual(p.added[0].category, 'DoorDash');
});

test('parseVoiceCommand: amount + platform with no keyword ("20 dollars doordash") logs income in the Driving stream', function(){
  const p = makeParser();
  assert.ok(p.parse('20 dollars doordash'));
  assert.strictEqual(p.added[0].type, 'income');
  assert.strictEqual(p.added[0].category, 'DoorDash');
});

test('parseVoiceCommand: that platform-only inference does not apply outside the Driving stream', function(){
  const p = makeParser({ stream: 'Personal' });
  assert.strictEqual(p.parse('20 dollars amazon'), null);
  assert.strictEqual(p.added.length, 0);
});

test('parseVoiceCommand: explicit expense words still win over the platform inference', function(){
  const p = makeParser();
  assert.ok(p.parse('8 dollars expense gas'));
  assert.strictEqual(p.added[0].type, 'expense');
  assert.strictEqual(p.added[0].category, 'Gas');
});

test('parseVoiceCommand: unrelated speech is still rejected without logging anything', function(){
  const p = makeParser();
  assert.strictEqual(p.parse('what a nice day'), null);
  assert.strictEqual(p.added.length, 0);
});

test('parseVoiceCommand: mileage commands still work', function(){
  const p = makeParser();
  assert.ok(p.parse('log twelve miles'));
  assert.strictEqual(p.added[0].type, 'mileage');
  assert.strictEqual(p.added[0].miles, 12);
});

test('the recognizer asks for multiple alternatives', function(){
  assert.ok(/recognition\.maxAlternatives = 5;/.test(html), 'maxAlternatives should be 5');
});
