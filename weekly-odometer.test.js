'use strict';
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

test('startOfWeek returns the Monday of the given date\'s week (app uses Monday, not Sunday, as week start)', function(){
  const fn = extractFn(html, 'startOfWeek');
  const sandbox = runInSandbox(fn);
  const sunday = new Date(2026, 8, 20, 15, 0, 0); // Sep 20 2026 is a Sunday
  const wk = sandbox.startOfWeek(sunday);
  assert.strictEqual(wk.getDay(), 1, 'expected a Monday');
  assert.strictEqual(wk.getDate(), 14);
  assert.strictEqual(wk.getMonth(), 8);
});

test('dateKeyLocal formats using local calendar fields, not a UTC-shifted ISO string', function(){
  const fn = extractFn(html, 'dateKeyLocal');
  const sandbox = runInSandbox(fn);
  assert.strictEqual(sandbox.dateKeyLocal(new Date(2026, 0, 5)), '2026-01-05');
  assert.strictEqual(sandbox.dateKeyLocal(new Date(2026, 11, 31)), '2026-12-31');
});

test('upsertWeeklyOdoEntry overwrites the same week instead of duplicating, and starts a new row for a new week', function(){
  const sources = [
    "var storageWorks = true;",
    "var WEEKLY_ODO_KEY = 'routeLedger.weeklyOdoLog.v1';",
    extractFn(html, 'startOfWeek'),
    extractFn(html, 'dateKeyLocal'),
    extractFn(html, 'loadWeeklyOdoLog'),
    extractFn(html, 'saveWeeklyOdoLog'),
    extractFn(html, 'upsertWeeklyOdoEntry')
  ];
  const sandbox = runInSandbox(sources, { localStorage: makeLocalStorageMock() });

  sandbox.upsertWeeklyOdoEntry(50000, new Date(2026, 8, 15)); // Tuesday
  sandbox.upsertWeeklyOdoEntry(50120, new Date(2026, 8, 17)); // Thursday, same week -> should overwrite
  let log = sandbox.loadWeeklyOdoLog();
  assert.strictEqual(log.length, 1, 'two same-week upserts should not create two rows');
  assert.strictEqual(log[0].mileage, 50120, 'the later same-week upsert should win');
  assert.strictEqual(log[0].weekStart, '2026-09-14');

  sandbox.upsertWeeklyOdoEntry(50450, new Date(2026, 8, 22)); // next Tuesday -> new week
  log = sandbox.loadWeeklyOdoLog();
  assert.strictEqual(log.length, 2, 'a genuinely new week should add a new row');

  log.sort(function(a, b){ return b.weekStart.localeCompare(a.weekStart); });
  assert.strictEqual(log[0].mileage - log[1].mileage, 330, 'week-over-week delta should be computable from the stored rows');
});
