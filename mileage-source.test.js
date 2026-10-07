'use strict';
// Mileage source tagging: every mileage entry is 'manual' or 'gps', and only
// the chosen PRIMARY source counts toward totals, the tax deduction and the
// estimated odometer, so the same drive is never counted twice.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function makeLocalStorageMock(){
  const store = {};
  return {
    store: store,
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function(k, v){ store[k] = String(v); },
    removeItem: function(k){ delete store[k]; }
  };
}

function sourceHelpers(){
  return [
    "var storageWorks = true;",
    "var MILEAGE_SOURCE_KEY = 'routeLedger.mileageSource.v1';",
    extractFn(html, 'loadMileageSource'),
    extractFn(html, 'saveMileageSource'),
    extractFn(html, 'mileageSourceOf'),
    extractFn(html, 'countsTowardMileage')
  ];
}

test('mileageSourceOf: entries without a source tag (saved before this feature) count as manual', function(){
  const sb = runInSandbox(sourceHelpers(), { localStorage: makeLocalStorageMock(), window: {} });
  assert.strictEqual(sb.mileageSourceOf({ type: 'mileage', miles: 5 }), 'manual');
  assert.strictEqual(sb.mileageSourceOf({ type: 'mileage', miles: 5, source: 'manual' }), 'manual');
  assert.strictEqual(sb.mileageSourceOf({ type: 'mileage', miles: 5, source: 'gps' }), 'gps');
  assert.strictEqual(sb.mileageSourceOf({ type: 'mileage', miles: 5, source: 'junk' }), 'manual');
});

test('loadMileageSource: defaults to manual, round-trips gps, and ignores garbage', function(){
  const ls = makeLocalStorageMock();
  const sb = runInSandbox(sourceHelpers(), { localStorage: ls, window: {} });
  assert.strictEqual(sb.loadMileageSource(), 'manual');
  sb.saveMileageSource('gps');
  assert.strictEqual(sb.loadMileageSource(), 'gps');
  sb.saveMileageSource('nonsense');
  assert.strictEqual(sb.loadMileageSource(), 'manual', 'an invalid value must fall back to manual');
  ls.store['routeLedger.mileageSource.v1'] = 'whatever';
  assert.strictEqual(sb.loadMileageSource(), 'manual');
});

test('loadMileageSource: falls back to in-memory storage when localStorage is unavailable', function(){
  const sources = sourceHelpers().slice();
  sources[0] = "var storageWorks = false;";
  const sb = runInSandbox(sources, { localStorage: makeLocalStorageMock(), window: {} });
  assert.strictEqual(sb.loadMileageSource(), 'manual');
  sb.saveMileageSource('gps');
  assert.strictEqual(sb.loadMileageSource(), 'gps');
});

test('countsTowardMileage: non-mileage entries always count; mileage counts only from the primary source', function(){
  const ls = makeLocalStorageMock();
  const sb = runInSandbox(sourceHelpers(), { localStorage: ls, window: {} });
  const manual = { type: 'mileage', miles: 10, source: 'manual' };
  const gps = { type: 'mileage', miles: 12, source: 'gps' };
  const legacy = { type: 'mileage', miles: 8 };
  const income = { type: 'income', amount: 50 };
  assert.strictEqual(sb.countsTowardMileage(income), true);
  assert.strictEqual(sb.countsTowardMileage(manual), true);
  assert.strictEqual(sb.countsTowardMileage(legacy), true);
  assert.strictEqual(sb.countsTowardMileage(gps), false);
  sb.saveMileageSource('gps');
  assert.strictEqual(sb.countsTowardMileage(manual), false);
  assert.strictEqual(sb.countsTowardMileage(legacy), false);
  assert.strictEqual(sb.countsTowardMileage(gps), true);
  assert.strictEqual(sb.countsTowardMileage(income), true, 'income/expense are unaffected by the mileage source');
});

test('summarize: miles come only from the primary source, and switching the source swaps them', function(){
  const sb = runInSandbox(sourceHelpers().concat([extractFn(html, 'summarize')]), { localStorage: makeLocalStorageMock(), window: {} });
  const list = [
    { type: 'mileage', miles: 10, source: 'manual' },
    { type: 'mileage', miles: 4 },
    { type: 'mileage', miles: 12, source: 'gps' },
    { type: 'income', amount: 100 },
    { type: 'expense', amount: 30 }
  ];
  let s = sb.summarize(list);
  assert.strictEqual(s.miles, 14, 'manual primary: 10 + 4 legacy, GPS ignored');
  assert.strictEqual(s.income, 100);
  assert.strictEqual(s.expense, 30);
  sb.saveMileageSource('gps');
  s = sb.summarize(list);
  assert.strictEqual(s.miles, 12, 'gps primary: only the GPS entry');
  assert.strictEqual(s.net, 70, 'money totals do not change with the mileage source');
});

test('mileageDeduction: only the primary source earns the IRS deduction (no double counting)', function(){
  const sources = sourceHelpers().concat([
    "var MILEAGE_RATE_TABLE = [{ from: new Date(2025,0,1), rate: 0.70 }];",
    extractFn(html, 'getMileageRate'),
    extractFn(html, 'mileageDeduction')
  ]);
  const sb = runInSandbox(sources, { localStorage: makeLocalStorageMock(), window: {} });
  const ts = new Date(2025, 5, 1, 12).toISOString();
  const list = [
    { type: 'mileage', miles: 100, source: 'manual', ts: ts },
    { type: 'mileage', miles: 110, source: 'gps', ts: ts }
  ];
  assert.ok(Math.abs(sb.mileageDeduction(list) - 70) < 1e-9, 'manual primary: 100 mi x 0.70');
  sb.saveMileageSource('gps');
  assert.ok(Math.abs(sb.mileageDeduction(list) - 77) < 1e-9, 'gps primary: 110 mi x 0.70');
});

test('computeCurrentMileage: estimated odometer adds only primary-source trips since the baseline', function(){
  const sources = sourceHelpers().concat([
    "var vehicle = { odoBaseline: 1000, baselineSetAt: new Date(2026, 0, 1).toISOString() };",
    "var entries = [" +
      "{ type:'mileage', miles:20, source:'manual', ts:new Date(2026,1,1).toISOString() }," +
      "{ type:'mileage', miles:25, source:'gps', ts:new Date(2026,1,1).toISOString() }," +
      "{ type:'mileage', miles:99, source:'manual', ts:new Date(2025,1,1).toISOString() }" +
    "];",
    extractFn(html, 'computeCurrentMileage')
  ]);
  const sb = runInSandbox(sources, { localStorage: makeLocalStorageMock(), window: {} });
  assert.strictEqual(sb.computeCurrentMileage(), 1020, 'manual primary; pre-baseline trip ignored');
  sb.saveMileageSource('gps');
  assert.strictEqual(sb.computeCurrentMileage(), 1025);
});

test('addEntry: mileage entries are tagged manual by default and gps when asked; other types get no source', function(){
  const sources = [
    "var entries = []; var activeStream = 'Driving'; var streams = ['Driving']; var DEFAULT_STREAMS = ['Driving'];",
    "function saveEntries(){} function renderAll(){} function maybeAutoBackup(){}",
    extractFn(html, 'addEntry')
  ];
  const sb = runInSandbox(sources, {});
  const m = sb.addEntry('mileage', 0, 'Other', 5);
  const g = sb.addEntry('mileage', 0, 'Other', 6, 'Driving', undefined, 'gps');
  const bad = sb.addEntry('mileage', 0, 'Other', 7, 'Driving', undefined, 'bogus');
  const inc = sb.addEntry('income', 20, 'Uber', 0);
  assert.strictEqual(m.source, 'manual');
  assert.strictEqual(g.source, 'gps');
  assert.strictEqual(bad.source, 'manual', 'an unknown source value is treated as manual');
  assert.ok(!('source' in inc), 'income entries carry no mileage source');
});

test('both GPS entry points (Start/End trip and auto-detect) tag their mileage as gps', function(){
  const matches = html.match(/addEntry\('mileage', 0, 'Other', miles, 'Driving', undefined, 'gps'\);/g) || [];
  assert.strictEqual(matches.length, 2, 'expected exactly 2 GPS call sites tagged gps, found ' + matches.length);
  // And no GPS-style call is left untagged.
  const untagged = html.match(/addEntry\('mileage', 0, 'Other', miles, 'Driving'\);/g) || [];
  assert.strictEqual(untagged.length, 0, 'found an untagged GPS addEntry call');
});

test('csvContent: adds a Source column that is filled for mileage rows only', function(){
  const sources = sourceHelpers().concat([
    "var currentCurrency = 'USD'; var DEFAULT_STREAMS = ['Driving'];",
    "function distUnitLabel(){ return 'mi'; } function milesToDisplay(m){ return m; }",
    "var archivedEntries = []; var entries = [" +
      "{ type:'mileage', miles:5, amount:0, category:'Other', stream:'Driving', ts:new Date(2026,1,1,12).toISOString(), source:'gps' }," +
      "{ type:'mileage', miles:4, amount:0, category:'Other', stream:'Driving', ts:new Date(2026,1,2,12).toISOString() }," +
      "{ type:'income', miles:0, amount:20, category:'Uber', stream:'Driving', ts:new Date(2026,1,3,12).toISOString() }" +
    "];",
    "function allEntries(){ return archivedEntries.concat(entries); }",
    extractFn(html, 'csvContent')
  ]);
  const sb = runInSandbox(sources, { localStorage: makeLocalStorageMock(), window: {} });
  const rows = sb.csvContent().replace('\uFEFF', '').split('\n').map(function(r){ return r.split('","').map(function(c){ return c.replace(/^"|"$/g, ''); }); });
  assert.strictEqual(rows[0][rows[0].length - 1], 'Source');
  assert.strictEqual(rows[1][rows[1].length - 1], 'gps');
  assert.strictEqual(rows[2][rows[2].length - 1], 'manual', 'legacy untagged mileage exports as manual');
  assert.strictEqual(rows[3][rows[3].length - 1], '', 'income rows have no source');
});
