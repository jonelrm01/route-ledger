'use strict';
// This is the feature area that's broken the most times in this project
// (the Personal/Driving mixup, the silent-orphan deletion bug), so it gets
// the most direct coverage.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

test('categoriesForStream: Driving keeps its curated platform categories', function(){
  const fn = extractFn(html, 'categoriesForStream');
  const sandbox = runInSandbox(["var DEFAULT_STREAMS = ['Driving'];", fn]);
  // Arrays built inside a vm sandbox are a different realm than this file's
  // Array, so assert.deepStrictEqual's prototype check fails even when the
  // contents match — compare via a plain value join instead.
  assert.strictEqual(sandbox.categoriesForStream('Driving').join('|'), ['Uber', 'DoorDash', 'Gas', 'Other'].join('|'));
});

test('categoriesForStream: every non-Driving stream gets the expanded set, and never the Driving-only ones', function(){
  const fn = extractFn(html, 'categoriesForStream');
  const sandbox = runInSandbox(["var DEFAULT_STREAMS = ['Driving'];", fn]);
  ['Personal', 'Dojo', 'App Sales', 'Some Future Custom Stream'].forEach(function(streamName){
    const cats = sandbox.categoriesForStream(streamName);
    assert.ok(cats.indexOf('Other') !== -1, streamName + ' must keep "Other" so old entries stay valid');
    assert.ok(cats.indexOf('Services') !== -1, streamName + ' should include the expanded personal/business categories');
    assert.ok(cats.indexOf('Credit Card Payment') !== -1, streamName + ' should include Credit Card Payment');
    assert.ok(cats.indexOf('Uber') === -1, streamName + ' should not get Driving-only categories');
  });
});

test('countEntriesForStream: counts only entries tagged with the given stream', function(){
  const fn = extractFn(html, 'countEntriesForStream');
  const sandbox = runInSandbox([
    "var entries = [{stream:'Driving'},{stream:'Personal'},{stream:'Personal'},{stream:'Dojo'}];",
    fn
  ]);
  assert.strictEqual(sandbox.countEntriesForStream('Personal'), 2);
  assert.strictEqual(sandbox.countEntriesForStream('Driving'), 1);
  assert.strictEqual(sandbox.countEntriesForStream('A Stream Nobody Used'), 0, 'an empty stream should count as 0, so its removal skips the confirm modal');
});

test('fillStreamDeleteText: substitutes {{STREAM}} and {{COUNT}} everywhere they appear, in any language template', function(){
  const fn = extractFn(html, 'fillStreamDeleteText');
  const sandbox = runInSandbox(fn);
  const out = sandbox.fillStreamDeleteText('Remove "{{STREAM}}"? {{COUNT}} entries. Remove {{STREAM}} anyway?', 'Dojo', 7);
  assert.strictEqual(out, 'Remove "Dojo"? 7 entries. Remove Dojo anyway?');
});

test('populateCategorySelect: option VALUE stays canonical English even when the visible label is translated', function(){
  // A minimal fake <select>/<option> — just enough surface for this
  // function (createElement, appendChild, innerHTML reset, .options,
  // .value getter/setter). This is the exact bug class being guarded here:
  // if the select's value ever became the translated label instead of the
  // canonical category, every category would silently re-tag itself the
  // moment someone switched languages.
  function makeFakeSelect(){
    const options = [];
    return {
      _value: '',
      options: options,
      set innerHTML(v){ options.length = 0; },
      appendChild: function(o){ options.push(o); },
      get value(){ return this._value; },
      set value(v){ this._value = v; }
    };
  }
  const { extractObjectLiteral } = require('./helpers');
  const categoryLabelsFn = extractFn(html, 'categoryLabel');
  const categoriesForStreamFn = extractFn(html, 'categoriesForStream');
  const populateFn = extractFn(html, 'populateCategorySelect');
  const categoryLabelsObj = extractObjectLiteral(html, 'CATEGORY_LABELS');

  const sandbox = runInSandbox([
    "var DEFAULT_STREAMS = ['Driving'];",
    'var CATEGORY_LABELS = ' + JSON.stringify(categoryLabelsObj) + ';',
    'var currentLang = "es-ES";',
    'function document_createElement(){ return { value:"", textContent:"" }; }',
    categoriesForStreamFn,
    categoryLabelsFn,
    populateFn
  ], {
    document: { createElement: function(){ return { value: '', textContent: '' }; } }
  });

  const sel = makeFakeSelect();
  sandbox.populateCategorySelect(sel, 'Personal', 'Services');

  const servicesOption = sel.options.filter(function(o){ return o.value === 'Services'; })[0];
  assert.ok(servicesOption, 'a "Services" option should exist with that exact canonical value');
  assert.strictEqual(servicesOption.textContent, categoryLabelsObj['es-ES'].Services, 'the visible label should be the Spanish translation');
  assert.strictEqual(sel.value, 'Services', 'selecting by ensureValue should match on canonical value, not the translated label');
});
