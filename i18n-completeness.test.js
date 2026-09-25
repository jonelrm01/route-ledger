'use strict';
// This is the check that would have caught it every single time a new
// string got added to one language's I18N/HELP_CONTENT block but not the
// other four — the exact class of slip that's easy to make by hand across
// 5 near-identical copy/paste edits.
const assert = require('assert');
const { loadHtml, extractObjectLiteral } = require('./helpers');

const html = loadHtml();
const EXPECTED_LANGS = ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'];

test('I18N defines exactly the 5 supported languages', function(){
  const I18N = extractObjectLiteral(html, 'I18N');
  assert.deepStrictEqual(Object.keys(I18N).sort(), EXPECTED_LANGS.slice().sort());
});

test('every I18N language has exactly the same set of keys as en-US', function(){
  const I18N = extractObjectLiteral(html, 'I18N');
  const baseKeys = Object.keys(I18N['en-US']).sort();
  EXPECTED_LANGS.forEach(function(lang){
    const keys = Object.keys(I18N[lang]).sort();
    const missing = baseKeys.filter(function(k){ return keys.indexOf(k) === -1; });
    const extra = keys.filter(function(k){ return baseKeys.indexOf(k) === -1; });
    if(missing.length) throw new Error(lang + ' is missing I18N keys: ' + missing.join(', '));
    if(extra.length) throw new Error(lang + ' has I18N keys not present in en-US: ' + extra.join(', '));
  });
});

test('no I18N string value is empty (recurses into nested objects like maintenance "items")', function(){
  const I18N = extractObjectLiteral(html, 'I18N');
  function checkLeaves(obj, lang, pathPrefix){
    Object.keys(obj).forEach(function(key){
      const val = obj[key];
      const fullPath = pathPrefix + '.' + key;
      if(val && typeof val === 'object'){
        checkLeaves(val, lang, fullPath);
      } else if(typeof val !== 'string' || val.trim() === ''){
        throw new Error(lang + fullPath + ' is empty or not a string');
      }
    });
  }
  EXPECTED_LANGS.forEach(function(lang){
    checkLeaves(I18N[lang], lang, '');
  });
});

test('HELP_CONTENT defines exactly the 5 supported languages, 10 sections each', function(){
  const HELP = extractObjectLiteral(html, 'HELP_CONTENT');
  assert.deepStrictEqual(Object.keys(HELP).sort(), EXPECTED_LANGS.slice().sort());
  EXPECTED_LANGS.forEach(function(lang){
    assert.ok(Array.isArray(HELP[lang].sections), lang + ' HELP_CONTENT.sections should be an array');
    assert.strictEqual(HELP[lang].sections.length, 10, lang + ' should have 10 Help sections, got ' + HELP[lang].sections.length);
  });
});

test('every HELP_CONTENT section has a non-empty icon, title, and body in every language', function(){
  const HELP = extractObjectLiteral(html, 'HELP_CONTENT');
  EXPECTED_LANGS.forEach(function(lang){
    HELP[lang].sections.forEach(function(section, i){
      ['icon', 'title', 'body'].forEach(function(field){
        if(typeof section[field] !== 'string' || section[field].trim() === ''){
          throw new Error(lang + ' section #' + i + ' has an empty "' + field + '"');
        }
      });
    });
  });
});

test('CATEGORY_LABELS defines exactly the 5 supported languages, with identical category keys and no empty values', function(){
  const CATEGORY_LABELS = extractObjectLiteral(html, 'CATEGORY_LABELS');
  assert.deepStrictEqual(Object.keys(CATEGORY_LABELS).sort(), EXPECTED_LANGS.slice().sort());
  const baseKeys = Object.keys(CATEGORY_LABELS['en-US']).sort();
  EXPECTED_LANGS.forEach(function(lang){
    const keys = Object.keys(CATEGORY_LABELS[lang]).sort();
    const missing = baseKeys.filter(function(k){ return keys.indexOf(k) === -1; });
    const extra = keys.filter(function(k){ return baseKeys.indexOf(k) === -1; });
    if(missing.length) throw new Error(lang + ' CATEGORY_LABELS is missing: ' + missing.join(', '));
    if(extra.length) throw new Error(lang + ' CATEGORY_LABELS has extra keys not in en-US: ' + extra.join(', '));
    keys.forEach(function(k){
      const val = CATEGORY_LABELS[lang][k];
      if(typeof val !== 'string' || val.trim() === ''){
        throw new Error(lang + '.' + k + ' category label is empty');
      }
    });
  });
});

test('categoryLabel() translates a known category and falls back to the stored name for brand names / unknown categories', function(){
  const { extractFn, runInSandbox } = require('./helpers');
  const fn = extractFn(html, 'categoryLabel');
  const categoryLabelsObj = extractObjectLiteral(html, 'CATEGORY_LABELS');
  const sandbox = runInSandbox([
    'var CATEGORY_LABELS = ' + JSON.stringify(categoryLabelsObj) + ';',
    'var currentLang = "es-ES";',
    fn
  ]);
  assert.strictEqual(sandbox.categoryLabel('Services'), categoryLabelsObj['es-ES'].Services);
  assert.strictEqual(sandbox.categoryLabel('Uber'), 'Uber', 'brand names should pass through untranslated');
  assert.strictEqual(sandbox.categoryLabel('Some Future Custom Category'), 'Some Future Custom Category', 'unmapped categories should fall back to their stored name, never render blank');
});

