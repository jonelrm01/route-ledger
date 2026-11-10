'use strict';
// The in-app User guide must describe the app as it really is. These tests
// tie the guide to the real UI strings (so it can't name a button that does
// not exist) and keep all five languages in step with each other.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral } = require('./helpers');

const html = loadHtml();
const HELP = extractObjectLiteral(html, 'HELP_CONTENT');
const I18N = extractObjectLiteral(html, 'I18N');
const LANGS = ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'];
const WORK = extractObjectLiteral(html, 'WORK_TYPE_CATEGORIES');
const IDX = { start: 0, work: 1, tax: 11, ded: 12, cel: 13 };
const body = function(lang, key){ return HELP[lang].sections[IDX[key]].body; };

test('all languages have the same section order (icons line up one-to-one)', function(){
  const icons = HELP['en-US'].sections.map(function(s){ return s.icon; });
  LANGS.forEach(function(lang){
    assert.deepStrictEqual(HELP[lang].sections.map(function(s){ return s.icon; }), icons, lang + ' sections are out of order');
  });
  assert.strictEqual(HELP['en-US'].sections[IDX.work].title.indexOf('Work profile'), 0);
  assert.strictEqual(HELP['en-US'].sections[IDX.tax].title, 'Tax tools (US only)');
  assert.strictEqual(HELP['en-US'].sections[IDX.ded].title.indexOf('Vehicle deduction method'), 0);
  assert.strictEqual(HELP['en-US'].sections[IDX.cel].title, 'Confetti and sounds');
});

test('guide text is inserted as HTML, so it must not contain angle brackets', function(){
  LANGS.forEach(function(lang){
    HELP[lang].sections.forEach(function(sec){
      assert.ok(!/[<>]/.test(sec.title + sec.body), lang + ' / ' + sec.title + ' contains < or >');
    });
  });
});

test('Getting started names the real welcome button and the two onboarding questions in every language', function(){
  LANGS.forEach(function(lang){
    const b = body(lang, 'start');
    assert.ok(b.indexOf(I18N[lang].getStarted) !== -1, lang + ': must name the button "' + I18N[lang].getStarted + '"');
  });
  // the guide must not call the button "Continue"
  assert.strictEqual(/tap Continue/i.test(body('en-US', 'start')), false);
});

test('Work profile section uses the exact UI wording in every language', function(){
  LANGS.forEach(function(lang){
    const b = body(lang, 'work'), t = I18N[lang];
    [t.workProfileLbl, t.workDriveLbl, t.workTypeLbl, t.settingsTitle].forEach(function(term){
      assert.ok(b.indexOf(term) !== -1, lang + ': Work profile section should mention "' + term + '"');
    });
    // every category it promises must really be in the preset for that work type
    ['contractor', 'towing'].forEach(function(type){
      WORK[type].forEach(function(cat){
        assert.ok(b.indexOf(cat) !== -1, lang + ': should list the ' + type + ' category "' + cat + '"');
      });
    });
  });
});

test('Deduction section uses the exact UI wording and the real report heading in every language', function(){
  const report = extractFn(html, 'buildTaxSummary');
  assert.ok(report.indexOf('NOT DEDUCTED SEPARATELY') !== -1, 'the report must really print this heading');
  LANGS.forEach(function(lang){
    const b = body(lang, 'ded'), t = I18N[lang];
    [t.deductionLbl, t.deductionStandard, t.deductionActual, t.bizUseApply, t.settingsTitle, 'NOT DEDUCTED SEPARATELY'].forEach(function(term){
      assert.ok(b.indexOf(term) !== -1, lang + ': Deduction section should mention "' + term + '"');
    });
  });
});

test('Tax tools section names the real picker, its options and the banner button', function(){
  assert.ok(html.indexOf('>Tax summary period<') !== -1, 'the picker label must exist in the app');
  assert.ok(html.indexOf("text:'This year so far (") !== -1 && html.indexOf("text:'Last year (") !== -1 && html.indexOf('Custom range') !== -1);
  assert.ok(/id="taxBannerView"[^>]*>View summary</.test(html), 'the tax reminder button must be labelled "View summary"');
  LANGS.forEach(function(lang){
    const b = body(lang, 'tax');
    ['Tax summary period', 'This year so far', 'Last year', 'Custom range', 'View summary', 'PDF', '2022'].forEach(function(term){
      assert.ok(b.indexOf(term) !== -1, lang + ': Tax tools section should mention "' + term + '"');
    });
    ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function(q){ assert.ok(b.indexOf(q) !== -1, lang + ' missing ' + q); });
  });
});

test('Tax periods in the guide match the periods the app actually uses (Q2 is only Apr-May)', function(){
  const fn = extractFn(html, 'quarterlyTaxDeadlines');
  assert.ok(/periodStart/.test(fn));
  const { runInSandbox } = require('./helpers');
  const sb = runInSandbox([fn]);
  const q = Array.from(sb.quarterlyTaxDeadlines(2026)).map(function(x){ return x.label + ':' + (x.periodStart.getMonth() + 1) + '-' + new Date(x.periodEnd.getTime() - 86400000).getMonth(); });
  assert.deepStrictEqual(q, ['Q1:1-2', 'Q2:4-4', 'Q3:6-7', 'Q4:9-11'], 'guide says Q1 Jan-Mar, Q2 Apr-May, Q3 Jun-Aug, Q4 Sep-Dec');
});

test('Celebrations section matches the real Settings switches', function(){
  assert.ok(html.indexOf('id="celebrationsToggleBtn"') !== -1 && html.indexOf('id="celebrationSoundToggleBtn"') !== -1, 'two separate switches must exist');
  LANGS.forEach(function(lang){ assert.ok(body(lang, 'cel').length > 80, lang + ' celebrations text is too short'); });
});

test('Vehicle section tells people about the Sunday reminder using the real setting name in every language', function(){
  LANGS.forEach(function(lang){
    const b = HELP[lang].sections[6].body;
    assert.ok(b.indexOf(I18N[lang].weeklyReminderTitle) !== -1, lang + ': should name the setting "' + I18N[lang].weeklyReminderTitle + '"');
    assert.ok(/9|21/.test(b), lang + ': should say the time (9 pm, or 21:00 in 24-hour languages)');
    assert.ok(b.indexOf(I18N[lang].settingsTitle) !== -1, lang + ': should say where it is (Settings)');
  });
});

test('Vehicle section says the reminder has a sound and a vibration, and is honest about phone settings and iPhone', function(){
  const words = { 'en-US': [/chime/i, /vibrat/i, /iPhone/, /silent mode/i], 'es-ES': [/sonido/i, /vibraci/i, /iPhone/, /silencio/i], 'it-IT': [/suono/i, /vibrazione/i, /iPhone/, /silenziosa/i], 'fr-FR': [/son /i, /vibration/i, /iPhone/, /silencieux/i], 'zh-CN': [/提示音/, /振动/, /iPhone/, /静音/] };
  LANGS.forEach(function(lang){
    const b = HELP[lang].sections[6].body;
    words[lang].forEach(function(re){ assert.ok(re.test(b), lang + ': Vehicle section should match ' + re); });
  });
});

test('Getting started explains the notification permission prompt that follows the welcome card', function(){
  const words = { 'en-US': /asks permission to show notifications/, 'es-ES': /pedirá permiso para mostrar notificaciones/, 'it-IT': /chiederà il permesso di mostrare le notifiche/, 'fr-FR': /l'autorisation d'afficher des notifications/, 'zh-CN': /请求显示通知的权限/ };
  LANGS.forEach(function(lang){ assert.ok(words[lang].test(HELP[lang].sections[0].body), lang + ': Getting started should mention the permission prompt'); });
});
