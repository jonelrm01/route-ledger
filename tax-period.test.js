'use strict';
// The tax summary can cover: this year so far, an estimated-tax quarter (the
// IRS payment periods Jan-Mar, Apr-May, Jun-Aug, Sep-Dec), last year, or a
// custom range. The default must behave exactly as the old year-to-date report.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();
function grab(re, label){ const m = html.match(re); if(!m) throw new Error('not found: ' + label); return m[0]; }
const sb = runInSandbox([
  grab(/var TAX_MONTHS = \[[^\]]*\];/, 'TAX_MONTHS'),
  grab(/var MILEAGE_RATE_TABLE = \[[\s\S]*?\n  \];/, 'MILEAGE_RATE_TABLE'),
  extractFn(html, 'getMileageRate'), extractFn(html, 'quarterlyTaxDeadlines'),
  extractFn(html, 'taxPeriodOptions'), extractFn(html, 'parseIsoDate'), extractFn(html, 'resolveTaxPeriod')
]);
const d = function(y, m, day){ return new Date(y, m - 1, day); };
const ymd = function(x){ return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); };

test('default (this year) matches the old year-to-date behavior exactly', function(){
  const now = d(2026, 10, 29);
  const r = sb.resolveTaxPeriod('ytd', now);
  assert.strictEqual(ymd(r.start), '2026-1-1');
  assert.strictEqual(ymd(r.end), '2027-1-1');
  assert.strictEqual(r.rangeText, d(2026, 1, 1).toLocaleDateString() + ' to ' + now.toLocaleDateString());
  assert.strictEqual(r.short, '2026');
  assert.strictEqual(r.fileKey, '2026');
  assert.strictEqual(r.warn, undefined);
  assert.strictEqual(sb.resolveTaxPeriod('anything-unknown', now).short, '2026', 'unknown values fall back to this year');
});

test('last year covers the full previous calendar year', function(){
  const r = sb.resolveTaxPeriod('last', d(2026, 10, 29));
  assert.strictEqual(ymd(r.start), '2025-1-1');
  assert.strictEqual(ymd(r.end), '2026-1-1');
  assert.strictEqual(r.rangeText, d(2025, 1, 1).toLocaleDateString() + ' to ' + d(2025, 12, 31).toLocaleDateString());
  assert.strictEqual(r.short, '2025');
});

test('estimated-tax quarters use the IRS payment periods, not calendar quarters', function(){
  const now = d(2026, 10, 29);
  const q2 = sb.resolveTaxPeriod('q:2026:Q2', now);
  assert.strictEqual(ymd(q2.start), '2026-4-1');
  assert.strictEqual(ymd(q2.end), '2026-6-1', 'Q2 is only April and May');
  assert.strictEqual(q2.rangeText, d(2026, 4, 1).toLocaleDateString() + ' to ' + d(2026, 5, 31).toLocaleDateString());
  assert.strictEqual(q2.short, 'Q2 2026');
  assert.strictEqual(q2.fileKey, 'Q2_2026');
  const q3 = sb.resolveTaxPeriod('q:2026:Q3', now);
  assert.strictEqual(ymd(q3.start) + ' ' + ymd(q3.end), '2026-6-1 2026-9-1');
});

test('a quarter still in progress is shown up to today, not to its last day', function(){
  const now = d(2026, 10, 29);
  const q4 = sb.resolveTaxPeriod('q:2026:Q4', now);
  assert.strictEqual(q4.rangeText, d(2026, 9, 1).toLocaleDateString() + ' to ' + now.toLocaleDateString());
});

test('options list: only started periods, last year\'s Q4 early in the year, ends with last year and custom', function(){
  const oct = Array.from(sb.taxPeriodOptions(d(2026, 10, 29))).map(function(o){ return o.value; });
  assert.deepStrictEqual(oct, ['ytd', 'q:2026:Q4', 'q:2026:Q3', 'q:2026:Q2', 'q:2026:Q1', 'q:2025:Q4', 'last', 'custom']);
  const jan = Array.from(sb.taxPeriodOptions(d(2027, 1, 10))).map(function(o){ return o.value; });
  assert.deepStrictEqual(jan, ['ytd', 'q:2027:Q1', 'q:2026:Q4', 'last', 'custom'], 'future quarters must not be offered');
  const text = Array.from(sb.taxPeriodOptions(d(2026, 10, 29))).filter(function(o){ return o.value === 'q:2026:Q2'; })[0].text;
  assert.strictEqual(text, 'Q2 2026 \u00B7 Apr\u2013May');
});

test('custom range: inclusive of the end date, validated, never silently wrong', function(){
  const r = sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2026-03-15', '2026-03-31');
  assert.strictEqual(ymd(r.start), '2026-3-15');
  assert.strictEqual(ymd(r.end), '2026-4-1', 'end is exclusive, so March 31 is included');
  assert.strictEqual(r.fileKey, '2026-03-15_to_2026-03-31');
  assert.ok(sb.resolveTaxPeriod('custom', d(2026, 10, 29), '', '2026-03-31').error, 'missing start');
  assert.ok(sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2026-03-15', 'garbage').error, 'bad end');
  assert.ok(sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2026-04-01', '2026-03-01').error, 'reversed dates');
  const same = sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2026-03-15', '2026-03-15');
  assert.ok(!same.error && ymd(same.end) === '2026-3-16', 'a single day is a valid range');
});

test('ranges starting before 2022 carry a warning about missing IRS rates', function(){
  const r = sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2021-06-01', '2021-12-31');
  assert.ok(r.warn && /before 2022/.test(r.warn));
  assert.strictEqual(sb.resolveTaxPeriod('custom', d(2026, 10, 29), '2022-01-01', '2022-12-31').warn, undefined);
});

test('IRS mileage rates are present for 2022 through 2025 so prior-year reports use the right rate', function(){
  assert.strictEqual(sb.getMileageRate(d(2022, 3, 1)), 0.585);
  assert.strictEqual(sb.getMileageRate(d(2022, 8, 1)), 0.625, 'mid-2022 adjustment');
  assert.strictEqual(sb.getMileageRate(d(2023, 6, 1)), 0.655);
  assert.strictEqual(sb.getMileageRate(d(2024, 6, 1)), 0.67);
  assert.strictEqual(sb.getMileageRate(d(2025, 6, 1)), 0.70);
  const froms = Array.from(sb.MILEAGE_RATE_TABLE).map(function(r){ return r.from.getTime(); });
  assert.deepStrictEqual(froms.slice().sort(function(a, b){ return a - b; }), froms, 'table must stay in date order');
});

test('wiring: report uses the picker, banner "View" exports its own quarter, picker is US-only', function(){
  const build = extractFn(html, 'buildTaxSummary');
  assert.ok(build.indexOf('resolveTaxPeriod(currentTaxPeriodValue()') !== -1);
  assert.ok(build.indexOf('showToast(period.error)') !== -1, 'invalid custom dates must tell the person, not export');
  assert.strictEqual(/yearStart/.test(build), false, 'the old hard-coded year start must be gone');
  assert.ok(/'q:' \+ q\.periodStart\.getFullYear\(\) \+ ':' \+ q\.label/.test(html), 'banner View must select its own quarter');
  assert.ok(/periodWrap\.style\.display = \(currentCountry === 'US'\)/.test(html));
  ['taxPeriodWrap', 'taxPeriodSelect', 'taxPeriodCustom', 'taxFrom', 'taxTo'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
});
