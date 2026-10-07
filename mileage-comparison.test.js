'use strict';
// Weekly mileage comparison (Monday through Sunday, same weeks as the
// odometer log): GPS miles and manual miles for each week that has an
// odometer reading, next to the odometer change from the previous week.
// Reference calendar (2026): Mondays are Sep 28, Oct 5, Oct 12; Sundays are
// Oct 4 and Oct 11.
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function sources(){
  return [
    "var MILEAGE_GAP_WARN_PCT = 10;",
    extractFn(html, 'mileageSourceOf'),
    extractFn(html, 'dateKeyLocal'),
    extractFn(html, 'odoLogStamp'),
    extractFn(html, 'computeMileageComparison')
  ];
}
function sandbox(){ return runInSandbox(sources()); }
function at(month, day, hour, min){ return new Date(2026, month - 1, day, hour === undefined ? 12 : hour, min || 0).toISOString(); }
function reading(weekStart, mileage, month, day, hour){ return { weekStart: weekStart, mileage: mileage, loggedAt: at(month, day, hour) }; }
function trip(month, day, miles, source, hour, min){ return { type: 'mileage', miles: miles, source: source, ts: at(month, day, hour, min) }; }

// Exact setup: Sunday readings a week apart (Oct 4 then Oct 11).
function sundayLog(m1, m2){ return [reading('2026-09-28', m1, 10, 4, 20), reading('2026-10-05', m2, 10, 11, 20)]; }

test('no odometer readings means no rows', function(){
  assert.strictEqual(sandbox().computeMileageComparison([], [trip(10, 6, 5, 'manual')]).length, 0);
});

test('a first reading still gets a row: GPS and manual for its Monday-Sunday week, odometer unknown', function(){
  const sb = sandbox();
  const rows = sb.computeMileageComparison([reading('2026-10-05', 50000, 10, 11, 20)], [trip(10, 6, 40, 'manual'), trip(10, 7, 45, 'gps')]);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].odoDelta, null);
  assert.strictEqual(rows[0].manual, 40);
  assert.strictEqual(rows[0].gps, 45);
});

test('a week is Monday 00:00 through Sunday 23:59: boundaries land in the right week', function(){
  const sb = sandbox();
  const list = [
    trip(10, 4, 1, 'manual', 23, 59),   // Sunday of the previous week
    trip(10, 5, 10, 'manual', 0, 0),    // Monday 00:00 -> in week
    trip(10, 8, 20, 'manual', 12, 0),   // midweek -> in week
    trip(10, 11, 30, 'manual', 23, 59), // Sunday 23:59 -> in week
    trip(10, 12, 100, 'manual', 0, 0)   // next Monday 00:00 -> not in week
  ];
  const rows = sb.computeMileageComparison([reading('2026-10-05', 1000, 10, 11, 20)], list);
  assert.strictEqual(rows[0].manual, 10 + 20 + 30);
});

test('splits GPS from manual, counts untagged older entries as manual, ignores income/expense', function(){
  const sb = sandbox();
  const list = [
    trip(10, 6, 100, 'manual'), trip(10, 7, 120, 'gps'),
    { type: 'mileage', miles: 7, ts: at(10, 8) },
    { type: 'income', amount: 50, ts: at(10, 9) }
  ];
  const rows = sb.computeMileageComparison(sundayLog(0, 400), list);
  const wk = rows[0];
  assert.strictEqual(wk.weekStart, '2026-10-05');
  assert.strictEqual(wk.manual, 107);
  assert.strictEqual(wk.gps, 120);
});

test('odometer change comes from the previous week\'s reading and is exact only when both readings were on a Sunday', function(){
  const sb = sandbox();
  let rows = sb.computeMileageComparison(sundayLog(50000, 50400), []);
  assert.strictEqual(rows[0].odoDelta, 400);
  assert.strictEqual(rows[0].aligned, true);
  // Same weeks, but one reading was taken on a Wednesday: still computed, marked approximate.
  rows = sb.computeMileageComparison([reading('2026-09-28', 50000, 10, 4, 20), reading('2026-10-05', 50400, 10, 8, 9)], []);
  assert.strictEqual(rows[0].odoDelta, 400);
  assert.strictEqual(rows[0].aligned, false);
});

test('a skipped week breaks the odometer comparison instead of comparing two weeks to one', function(){
  const sb = sandbox();
  const rows = sb.computeMileageComparison([reading('2026-09-28', 1000, 10, 4, 20), reading('2026-10-12', 1900, 10, 18, 20)], [trip(10, 14, 50, 'manual')]);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].weekStart, '2026-10-12');
  assert.strictEqual(rows[0].odoDelta, null, 'no reading for the week in between');
  assert.strictEqual(rows[0].manual, 50, 'GPS/manual for the week are still reported');
});

test('flags GPS vs manual more than 10% apart, and not when they are close', function(){
  const sb = sandbox();
  let rows = sb.computeMileageComparison(sundayLog(0, 1000), [trip(10, 6, 100, 'manual'), trip(10, 7, 130, 'gps')]);
  assert.ok(rows[0].gapWarn, '100 vs 130 should be flagged');
  assert.ok(Math.abs(rows[0].gapPct - (30 / 130 * 100)) < 1e-9);
  rows = sb.computeMileageComparison(sundayLog(0, 1000), [trip(10, 6, 100, 'manual'), trip(10, 7, 105, 'gps')]);
  assert.strictEqual(rows[0].gapWarn, false, '100 vs 105 is within 10%');
});

test('no gap is computed when only one source has miles that week', function(){
  const sb = sandbox();
  const rows = sb.computeMileageComparison(sundayLog(0, 500), [trip(10, 6, 80, 'manual')]);
  assert.strictEqual(rows[0].gapPct, null);
  assert.strictEqual(rows[0].gapWarn, false);
});

test('flags logged miles above the odometer change only when the odometer figure is exact, with rounding tolerance', function(){
  const sb = sandbox();
  let rows = sb.computeMileageComparison(sundayLog(1000, 1100), [trip(10, 6, 150, 'gps')]);
  assert.strictEqual(rows[0].overOdo, true);
  rows = sb.computeMileageComparison(sundayLog(1000, 1100), [trip(10, 6, 100.4, 'manual')]);
  assert.strictEqual(rows[0].overOdo, false, 'a tiny overshoot is within tolerance');
  rows = sb.computeMileageComparison(sundayLog(1000, 1100), [trip(10, 6, 60, 'manual')]);
  assert.strictEqual(rows[0].overOdo, false, 'personal driving makes the odometer higher, which is fine');
  // Same overshoot, but readings were not on Sundays: windows differ, so no alarm.
  rows = sb.computeMileageComparison([reading('2026-09-28', 1000, 10, 1, 9), reading('2026-10-05', 1100, 10, 8, 9)], [trip(10, 6, 150, 'gps')]);
  assert.strictEqual(rows[0].overOdo, false);
});

test('returns newest week first across several readings', function(){
  const sb = sandbox();
  const log = [reading('2026-10-05', 1400, 10, 11, 20), reading('2026-09-28', 1000, 10, 4, 20), reading('2026-10-12', 1900, 10, 18, 20)];
  const rows = sb.computeMileageComparison(log, []);
  assert.deepStrictEqual(Array.from(rows.map(function(r){ return r.weekStart; })), ['2026-10-12', '2026-10-05', '2026-09-28']);
  assert.deepStrictEqual(Array.from(rows.map(function(r){ return r.odoDelta; })), [500, 400, null]);
});

test('the card exists in the Vehicle tab and is re-rendered whenever the odometer log renders', function(){
  assert.ok(html.indexOf('id="mileageCompareCard"') !== -1);
  assert.ok(html.indexOf('id="mileageCompareList"') !== -1);
  assert.ok(extractFn(html, 'renderWeeklyOdoLog').indexOf('renderMileageComparison()') !== -1);
});

test('renderMileageComparison: three columns, bold primary source, ≈ on approximate odometer, — when unknown, hidden with no readings', function(){
  const els = {};
  ['mileageCompareCard', 'mileageCompareList', 'mileageCompareTitle', 'mileageCompareHint'].forEach(function(id){
    els[id] = { style: {}, textContent: '', innerHTML: '' };
  });
  let storedLog = [reading('2026-09-28', 1000, 10, 4, 20), reading('2026-10-05', 1500, 10, 11, 20)];
  const entries = [trip(10, 6, 100, 'manual'), trip(10, 7, 140, 'gps')];
  const sb = runInSandbox([
    "var MILEAGE_GAP_WARN_PCT = 10; var currentLang = 'en-US';",
    extractFn(html, 'mileageSourceOf'),
    extractFn(html, 'dateKeyLocal'),
    extractFn(html, 'odoLogStamp'),
    extractFn(html, 'computeMileageComparison'),
    extractFn(html, 'renderMileageComparison')
  ], {
    document: { getElementById: function(id){ return els[id] || null; } },
    t: function(k){ return k; },
    fmtDist: function(m, d){ return m.toFixed(d) + ' mi'; },
    isNativeApp: function(){ return true; },
    allEntries: function(){ return entries; },
    loadWeeklyOdoLog: function(){ return storedLog; },
    loadMileageSource: function(){ return 'manual'; }
  });
  sb.renderMileageComparison();
  assert.strictEqual(els.mileageCompareCard.style.display, '');
  let out = els.mileageCompareList.innerHTML;
  assert.ok(out.indexOf('cmpOdometer') !== -1 && out.indexOf('srcGps') !== -1 && out.indexOf('srcManual') !== -1);
  assert.ok(out.indexOf('500 mi') !== -1 && out.indexOf('140.0 mi') !== -1 && out.indexOf('100.0 mi') !== -1);
  assert.ok(out.indexOf('\u2248') === -1, 'Sunday readings are exact, so no approximate marker');
  assert.ok(out.indexOf('cmpGapWarn') !== -1);
  assert.ok(out.indexOf('\u2014') !== -1, 'the oldest week has no previous reading, shown as a dash');
  assert.ok(/srcManual<\/div><div class="num" style="color:var\(--text-primary\); font-weight:700;/.test(out), 'primary source (manual) is bold');
  storedLog = [reading('2026-09-28', 1000, 10, 4, 20), reading('2026-10-05', 1500, 10, 8, 9)];
  sb.renderMileageComparison();
  out = els.mileageCompareList.innerHTML;
  assert.ok(out.indexOf('\u2248 500 mi') !== -1, 'a non-Sunday reading is marked approximate');
  storedLog = [];
  sb.renderMileageComparison();
  assert.strictEqual(els.mileageCompareCard.style.display, 'none');
  assert.strictEqual(els.mileageCompareList.innerHTML, '');
});
