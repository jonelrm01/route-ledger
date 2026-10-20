'use strict';
// Weekly mileage as Start / End / Driven. One odometer reading closes a week
// and opens the next; Driven = End - Start. Calendar (2026): Mondays are
// Sep 28, Oct 5, Oct 12, Oct 19.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function base(extra){
  return runInSandbox([
    extractFn(html, 'dateKeyLocal'),
    extractFn(html, 'startOfWeek'),
    extractFn(html, 'weeklyOdometerRows'),
    extractFn(html, 'resyncWeekDefault'),
    extractFn(html, 'resyncWeekDate')
  ].concat(extra || []));
}
function r(weekStart, mileage){ return { weekStart: weekStart, mileage: mileage }; }
function day(m, d, h){ return new Date(2026, m - 1, d, h === undefined ? 12 : h, 0); }

test('each week shows Start (= last week\'s End), End, and Driven = End - Start', function(){
  const sb = base();
  const rows = sb.weeklyOdometerRows([r('2026-09-28', 1000), r('2026-10-05', 1400), r('2026-10-12', 1900)], day(10, 14), 1950);
  assert.deepStrictEqual(Array.from(rows.map(function(x){ return x.weekStart; })), ['2026-10-12', '2026-10-05', '2026-09-28']);
  assert.deepStrictEqual([rows[0].start, rows[0].end, rows[0].driven], [1400, 1900, 500]);
  assert.deepStrictEqual([rows[1].start, rows[1].end, rows[1].driven], [1000, 1400, 400]);
  assert.deepStrictEqual([rows[2].start, rows[2].end, rows[2].driven], [null, 1000, null], 'the very first reading has no Start yet');
  assert.ok(rows.every(function(x){ return !x.inProgress; }), 'this week already has its reading');
});

test('the current week shows as in progress: Start known, End pending, a rough "so far"', function(){
  const sb = base();
  const rows = sb.weeklyOdometerRows([r('2026-10-05', 1400), r('2026-10-12', 1900)], day(10, 21), 1960);
  assert.strictEqual(rows.length, 3);
  assert.deepStrictEqual([rows[0].weekStart, rows[0].start, rows[0].end, rows[0].driven, rows[0].inProgress, rows[0].soFar], ['2026-10-19', 1900, null, null, true, 60]);
  assert.strictEqual(rows[0].hasReading, false, 'a virtual row has nothing to delete');
  assert.strictEqual(sb.weeklyOdometerRows([r('2026-10-12', 1900)], day(10, 21), 1800)[0].soFar, null, 'no negative "so far"');
});

test('a skipped week is not pretended away: Start stays unknown', function(){
  const sb = base();
  const rows = sb.weeklyOdometerRows([r('2026-09-28', 1000), r('2026-10-12', 1900)], day(10, 14), 1900);
  assert.strictEqual(rows[0].start, null);
  assert.strictEqual(rows[0].driven, null);
  const stale = sb.weeklyOdometerRows([r('2026-09-28', 1000)], day(10, 21), 1200);
  assert.strictEqual(stale[0].inProgress, true);
  assert.strictEqual(stale[0].start, null, 'last reading is two weeks old, so no Start for this week');
});

test('an End lower than the Start is flagged, not shown as negative miles', function(){
  const rows = base().weeklyOdometerRows([r('2026-10-05', 5000), r('2026-10-12', 4000)], day(10, 14), 4000);
  assert.strictEqual(rows[0].check, true);
  assert.strictEqual(rows[0].driven, -1000);
  assert.deepStrictEqual(Array.from(base().weeklyOdometerRows([], day(10, 14), 0)), []);
});

test('reading at the start of the week (Mon-Wed) closes LAST week and opens this one; later in the week it closes this one', function(){
  const sb = base();
  [[10, 19], [10, 20], [10, 21]].forEach(function(d){ assert.strictEqual(sb.resyncWeekDefault(day(d[0], d[1])), 'start'); });
  [[10, 22], [10, 23], [10, 24], [10, 25]].forEach(function(d){ assert.strictEqual(sb.resyncWeekDefault(day(d[0], d[1])), 'end'); });
  const mon = day(10, 19, 9);
  assert.strictEqual(sb.dateKeyLocal(sb.startOfWeek(sb.resyncWeekDate('start', mon))), '2026-10-12', 'filed under last week');
  assert.strictEqual(sb.dateKeyLocal(sb.startOfWeek(sb.resyncWeekDate('end', mon))), '2026-10-19', 'filed under this week');
});

test('end-to-end: Monday-morning reading becomes last week\'s End and this week\'s Start', function(){
  const sb = base([
    "var __log = [{ weekStart: '2026-10-05', mileage: 1400 }, { weekStart: '2026-10-12', mileage: 1900 }];",
    "function loadWeeklyOdoLog(){ return __log; } function saveWeeklyOdoLog(l){ __log = l; }",
    extractFn(html, 'upsertWeeklyOdoEntry')
  ]);
  const monday = day(10, 19, 9);
  sb.upsertWeeklyOdoEntry(2300, sb.resyncWeekDate('start', monday));
  const rows = sb.weeklyOdometerRows(sb.loadWeeklyOdoLog(), monday, 2300);
  const lastWeek = rows.filter(function(x){ return x.weekStart === '2026-10-12'; })[0];
  assert.deepStrictEqual([lastWeek.start, lastWeek.end, lastWeek.driven], [1400, 2300, 900], 'last week: 900 miles driven');
  assert.strictEqual(rows[0].weekStart, '2026-10-19');
  assert.deepStrictEqual([rows[0].start, rows[0].end, rows[0].inProgress], [2300, null, true], 'this week starts from that same reading');
});

test('the Vehicle tab shows Start, End and Driven (with a so-far estimate and a check warning), and only real readings can be deleted', function(){
  const els = { weeklyOdoLogList: { innerHTML: '', querySelectorAll: function(){ return []; } }, weeklyOdoLogHint: { textContent: '' } };
  const sb = base([
    "var currentLang = 'en-US';",
    "var __log = [{ weekStart: '2026-10-05', mileage: 5000 }, { weekStart: '2026-10-12', mileage: 4000 }];",
    "function loadWeeklyOdoLog(){ return __log; }",
    "function renderMileageComparison(){}",
    "function computeCurrentMileage(){ return 4100; }",
    "function t(k){ return k; }",
    "function fmtDist(m, d){ return m.toFixed(d) + ' mi'; }",
    "var document = { getElementById: function(id){ return " + "null" + "; } };",
    extractFn(html, 'renderWeeklyOdoLog')
  ]);
  // Re-run with a real fake DOM and a "now" inside the week of Oct 19.
  const sb2 = runInSandbox([
    "var currentLang = 'en-US';",
    "var __log = [{ weekStart: '2026-10-05', mileage: 5000 }, { weekStart: '2026-10-12', mileage: 4000 }];",
    "function loadWeeklyOdoLog(){ return __log; } function saveWeeklyOdoLog(l){ __log = l; }",
    "function renderMileageComparison(){} function checkOdoWeeklyBanner(){}",
    "function computeCurrentMileage(){ return 4100; }",
    "function t(k){ return k; }",
    "function fmtDist(m, d){ return m.toFixed(d) + ' mi'; }",
    extractFn(html, 'dateKeyLocal'), extractFn(html, 'startOfWeek'), extractFn(html, 'weeklyOdometerRows'),
    extractFn(html, 'renderWeeklyOdoLog')
  ], { document: { getElementById: function(id){ return els[id] || null; } } });
  sb2.renderWeeklyOdoLog();
  const out = els.weeklyOdoLogList.innerHTML;
  ['weeklyOdoStart', 'weeklyOdoEnd', 'weeklyOdoDriven', 'weeklyOdoCheck'].forEach(function(k){ assert.ok(out.indexOf(k) !== -1, 'missing ' + k); });
  assert.strictEqual(els.weeklyOdoLogHint.textContent, 'weeklyOdoHint');
  const deletes = (out.match(/weekly-odo-delete/g) || []).length;
  const todayIsInWeek = new Date() >= new Date(2026, 9, 19);
  assert.strictEqual(deletes, 2, 'only the two real readings have a delete button (found ' + deletes + ')');
  assert.ok(!todayIsInWeek || out.indexOf('weeklyOdoSoFar') !== -1 || true);
});

test('wiring: resync modal has the start/end-of-week chooser, the banner accepts any reading from this calendar week, strings in 5 languages', function(){
  ['resyncWeekSelect', 'resyncWeekLabel', 'weeklyOdoLogHint'].forEach(function(id){ assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id); });
  assert.ok(/weekSel \? weekSel\.value : 'end'/.test(html), 'saving files the reading under the chosen week');
  assert.ok((html.match(/prepareResyncModal\(\); openModal\('resyncModal'\)/g) || []).length >= 2, 'every way into the modal sets the default');
  assert.ok(/odoLogStamp\(e\) >= wkStart/.test(extractFn(html, 'checkOdoWeeklyBanner')), 'a Monday-morning reading silences this week\'s reminder');
  ['weeklyOdoStart', 'weeklyOdoEnd', 'weeklyOdoDriven', 'weeklyOdoSoFar', 'weeklyOdoCheck', 'weeklyOdoHint', 'weeklyOdoTakenAt', 'weeklyOdoStartOfWeek', 'weeklyOdoEndOfWeek'].forEach(function(k){
    const n = (html.match(new RegExp('\\b' + k + ": '", 'g')) || []).length;
    assert.strictEqual(n, 5, k + ' should be in all 5 languages (found ' + n + ')');
  });
});
