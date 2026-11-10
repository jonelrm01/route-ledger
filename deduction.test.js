'use strict';
// The tax summary must not deduct the same cost twice. The IRS standard
// mileage rate already covers gas, repairs and tires, so under the standard
// method those are NOT also expenses. Under "actual expenses" vehicle costs
// are deducted times the business-use share and the per-mile rate is unused.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function grab(re, label){
  const m = html.match(re);
  if(!m) throw new Error('not found in index.html: ' + label);
  return m[0];
}

function sandbox(stored){
  const store = {};
  if(stored !== undefined) store['routeLedger.deduction.v1'] = (typeof stored === 'string') ? stored : JSON.stringify(stored);
  const localStorage = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v){ store[k] = String(v); }
  };
  return runInSandbox([
    'var storageWorks = true;',
    "var DEDUCTION_KEY = 'routeLedger.deduction.v1';",
    grab(/var STANDARD_RATE_COVERED = \[[^\]]*\];/, 'STANDARD_RATE_COVERED'),
    grab(/var VEHICLE_COST_CATEGORIES = \[[^\]]*\];/, 'VEHICLE_COST_CATEGORIES'),
    'var MILEAGE_RATE_TABLE = [{ from: new Date(2000,0,1), rate: 0.70 }];',
    'function countsTowardMileage(e){ return true; }',
    extractFn(html, 'getMileageRate'), extractFn(html, 'mileageDeduction'),
    extractFn(html, 'loadDeduction'), extractFn(html, 'saveDeduction'),
    extractFn(html, 'taxFigures'), extractFn(html, 'suggestBusinessUsePct')
  ], { localStorage: localStorage, store: store });
}

const ts = '2026-03-10T12:00:00.000Z';
const list = [
  { type: 'income',  category: 'Tow call', amount: 5000, ts: ts },
  { type: 'expense', category: 'Gas', amount: 800, ts: ts },
  { type: 'expense', category: 'Tires', amount: 200, ts: ts },
  { type: 'expense', category: 'Insurance', amount: 600, ts: ts },
  { type: 'expense', category: 'Tolls', amount: 50, ts: ts },
  { type: 'expense', category: 'Dispatch fees', amount: 100, ts: ts },
  { type: 'mileage', miles: 1000, amount: 0, category: 'Mileage', ts: ts }
];

test('default (no saved setting) is the standard method at 100% business use', function(){
  const d = sandbox().loadDeduction();
  assert.strictEqual(d.method, 'standard');
  assert.strictEqual(d.businessUsePct, 100);
});

test('standard method: gas and tires are NOT deducted on top of the mileage rate, and are reported as excluded', function(){
  const tf = sandbox({ method: 'standard' }).taxFigures(list);
  assert.strictEqual(tf.mileageDeduction, 700);
  assert.strictEqual(tf.excludedTotal, 1000, 'gas + tires are covered by the standard rate');
  assert.strictEqual(tf.excludedByCat.Gas, 800);
  assert.strictEqual(tf.otherExpenses, 750, 'insurance, tolls and dispatch fees stay as ordinary expenses');
  assert.strictEqual(tf.net, 5000 - 750 - 700);
  assert.strictEqual(tf.vehicleDeductible, 0);
});

test('actual method: vehicle costs x business use, no per-mile deduction, tolls stay 100%', function(){
  const tf = sandbox({ method: 'actual', businessUsePct: 80 }).taxFigures(list);
  assert.strictEqual(tf.mileageDeduction, 0, 'the standard rate must not be used with actual expenses');
  assert.strictEqual(tf.vehicleCostTotal, 800 + 200 + 600);
  assert.strictEqual(tf.vehicleDeductible, 1600 * 0.8);
  assert.strictEqual(tf.otherExpenses, 150, 'tolls and dispatch fees are not vehicle costs');
  assert.strictEqual(tf.net, 5000 - 150 - 1280);
});

test('the same list can never deduct more under one method than its own rules allow (no double counting)', function(){
  const std = sandbox({ method: 'standard' }).taxFigures(list);
  const gasInExpenses = std.expenseByCat.Gas || 0;
  assert.strictEqual(gasInExpenses, 0, 'Gas must not appear as an expense next to the mileage deduction');
});

test('loadDeduction clamps and repairs bad stored values', function(){
  assert.strictEqual(sandbox({ method: 'actual', businessUsePct: 250 }).loadDeduction().businessUsePct, 100);
  assert.strictEqual(sandbox({ method: 'actual', businessUsePct: 0 }).loadDeduction().businessUsePct, 1);
  assert.strictEqual(sandbox({ method: 'bogus' }).loadDeduction().method, 'standard');
  assert.strictEqual(sandbox('{not json').loadDeduction().method, 'standard');
  assert.strictEqual(sandbox({ method: 'actual', businessUsePct: 'abc' }).loadDeduction().businessUsePct, 100);
});

test('suggestBusinessUsePct: needs 2+ weeks of odometer data, uses the primary source, caps at 100', function(){
  const sb = sandbox();
  const rows = [
    { odoDelta: 400, gps: 300, manual: 280 },
    { odoDelta: 500, gps: 350, manual: 320 },
    { odoDelta: null, gps: 999, manual: 999 }
  ];
  assert.strictEqual(sb.suggestBusinessUsePct(rows, 'manual'), Math.round(600 / 900 * 100));
  assert.strictEqual(sb.suggestBusinessUsePct(rows, 'gps'), Math.round(650 / 900 * 100));
  assert.strictEqual(sb.suggestBusinessUsePct(rows.slice(0, 1), 'manual'), null, 'one week is not enough');
  assert.strictEqual(sb.suggestBusinessUsePct([{ odoDelta: 100, gps: 0, manual: 500 }, { odoDelta: 100, gps: 0, manual: 500 }], 'manual'), 100, 'logged above odometer is capped');
  assert.strictEqual(sb.suggestBusinessUsePct([{ odoDelta: 100, gps: 0, manual: 0 }, { odoDelta: 100, gps: 0, manual: 0 }], 'manual'), null, 'no logged miles gives no suggestion');
});

test('wiring: the report and the quarterly banner both use taxFigures (one source of truth)', function(){
  const report = extractFn(html, 'buildTaxSummary');
  assert.ok(report.indexOf('taxFigures(list)') !== -1);
  assert.ok(report.indexOf('NOT DEDUCTED SEPARATELY') !== -1, 'excluded costs must be disclosed, not silently dropped');
  assert.ok(report.indexOf('VEHICLE DEDUCTION METHOD') !== -1);
  assert.ok(/taxFigures\(periodList\)\.net/.test(html), 'quarterly estimate must use the same net figure');
  assert.strictEqual(/s\.net - mileageDed/.test(html), false, 'old double-counting formula must be gone');
});

test('wiring: settings controls exist and strings exist in all 5 languages', function(){
  ['deductionSection', 'deductionOptions', 'bizUseWrap', 'bizUseInput', 'bizUseSuggest', 'bizUseApplyBtn'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  const { extractObjectLiteral } = require('./helpers');
  const i18n = extractObjectLiteral(html, 'I18N');
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    ['deductionLbl', 'deductionHint', 'deductionStandard', 'deductionActual', 'bizUseLbl', 'bizUseSuggest', 'bizUseApply'].forEach(function(k){
      assert.ok(i18n[lang][k], lang + ' missing ' + k);
    });
    assert.ok(i18n[lang].bizUseSuggest.indexOf('{{PCT}}') !== -1, lang + ' suggestion must keep the {{PCT}} placeholder');
  });
});
