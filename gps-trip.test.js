'use strict';
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

test('haversineMiles: distance between two identical points is zero', function(){
  const fn = extractFn(html, 'haversineMiles');
  const sandbox = runInSandbox(fn);
  assert.strictEqual(sandbox.haversineMiles(40.7128, -74.0060, 40.7128, -74.0060), 0);
});

test('haversineMiles: one degree of latitude is approximately 69 miles', function(){
  const fn = extractFn(html, 'haversineMiles');
  const sandbox = runInSandbox(fn);
  const d = sandbox.haversineMiles(0, 0, 1, 0);
  assert.ok(Math.abs(d - 69.09) < 0.5, 'expected ~69.09 mi for one degree of latitude, got ' + d);
});

test('haversineMiles: known city-to-city distance (NYC to Philadelphia) is roughly correct', function(){
  const fn = extractFn(html, 'haversineMiles');
  const sandbox = runInSandbox(fn);
  // NYC (40.7128,-74.0060) to Philadelphia (39.9526,-75.1652) is ~80-83 miles as the crow flies
  const d = sandbox.haversineMiles(40.7128, -74.0060, 39.9526, -75.1652);
  assert.ok(d > 75 && d < 90, 'expected ~80 mi NYC-Philadelphia straight-line, got ' + d);
});

test('computeTripMiles: fewer than 2 points returns 0', function(){
  const sources = [extractFn(html, 'haversineMiles'), "var GPS_JITTER_FLOOR_MILES = 0.02;", extractFn(html, 'computeTripMiles')];
  const sandbox = runInSandbox(sources);
  assert.strictEqual(sandbox.computeTripMiles([]), 0);
  assert.strictEqual(sandbox.computeTripMiles([{ lat: 1, lng: 1 }]), 0);
});

test('computeTripMiles: sums distance across a multi-point path', function(){
  const sources = [extractFn(html, 'haversineMiles'), "var GPS_JITTER_FLOOR_MILES = 0.02;", extractFn(html, 'computeTripMiles')];
  const sandbox = runInSandbox(sources);
  const points = [
    { lat: 40.0, lng: -75.0 },
    { lat: 40.05, lng: -75.0 },
    { lat: 40.1, lng: -75.0 }
  ];
  const total = sandbox.computeTripMiles(points);
  const leg1 = sandbox.haversineMiles(40.0, -75.0, 40.05, -75.0);
  const leg2 = sandbox.haversineMiles(40.05, -75.0, 40.1, -75.0);
  assert.ok(Math.abs(total - (leg1 + leg2)) < 0.0001, 'expected sum of both legs');
});

test('computeTripMiles: drops jitter segments under the ~0.02 mi floor (standing still adds no fake mileage)', function(){
  const sources = [extractFn(html, 'haversineMiles'), "var GPS_JITTER_FLOOR_MILES = 0.02;", extractFn(html, 'computeTripMiles')];
  const sandbox = runInSandbox(sources);
  // Tiny jitter around the same spot -- well under the jitter floor.
  const points = [
    { lat: 40.00000, lng: -75.00000 },
    { lat: 40.00001, lng: -75.00001 },
    { lat: 40.00000, lng: -75.00002 },
    { lat: 40.00001, lng: -75.00000 }
  ];
  const total = sandbox.computeTripMiles(points);
  assert.strictEqual(total, 0, 'jitter-only movement should not accrue any mileage');
});

test('computeTripMiles: a real segment still counts even when jitter segments are mixed in', function(){
  const sources = [extractFn(html, 'haversineMiles'), "var GPS_JITTER_FLOOR_MILES = 0.02;", extractFn(html, 'computeTripMiles')];
  const sandbox = runInSandbox(sources);
  const points = [
    { lat: 40.00000, lng: -75.00000 },
    { lat: 40.00001, lng: -75.00001 }, // jitter, dropped
    { lat: 40.10000, lng: -75.00000 }  // real ~6.9mi move, counted
  ];
  const total = sandbox.computeTripMiles(points);
  const realLeg = sandbox.haversineMiles(40.00001, -75.00001, 40.10000, -75.00000);
  assert.ok(total > 0, 'the real segment should still be counted');
  assert.ok(Math.abs(total - realLeg) < 0.01, 'total should be dominated by the one real leg, jitter leg excluded');
});

test('isNativeApp: returns true when window.Capacitor reports a native platform', function(){
  const fn = extractFn(html, 'isNativeApp');
  const sandbox = runInSandbox(fn, { window: { Capacitor: { isNativePlatform: function(){ return true; } } } });
  assert.strictEqual(sandbox.isNativeApp(), true);
});

test('isNativeApp: returns false on plain web (no Capacitor global at all)', function(){
  const fn = extractFn(html, 'isNativeApp');
  const sandbox = runInSandbox(fn, { window: {} });
  assert.strictEqual(sandbox.isNativeApp(), false);
});

test('isNativeApp: returns false in Capacitor "web mode" (plugin present but isNativePlatform reports false)', function(){
  const fn = extractFn(html, 'isNativeApp');
  const sandbox = runInSandbox(fn, { window: { Capacitor: { isNativePlatform: function(){ return false; } } } });
  assert.strictEqual(sandbox.isNativeApp(), false);
});

function autoDetectorSandbox(){
  return runInSandbox([
    extractFn(html, 'haversineMiles'),
    "var GPS_JITTER_FLOOR_MILES = 0.02;",
    extractFn(html, 'computeTripMiles'),
    "var AUTO_TRIP_START_MPH = 10; var AUTO_TRIP_STOP_MPH = 3; var AUTO_TRIP_START_CONFIRM_COUNT = 3; var AUTO_TRIP_STOP_CONFIRM_MS = 3 * 60 * 1000;",
    extractFn(html, 'speedMph'),
    extractFn(html, 'createTripAutoDetector')
  ]);
}
// Builds a straight-line path of points moving at a constant mph, one point per minute.
function drivingPath(startLat, startLng, mph, count, startTs){
  const points = [];
  const milesPerMinute = mph / 60;
  const milesPerDegreeLat = 69.0; // approx, fine for test-scale distances
  for(let i = 0; i < count; i++){
    points.push({ lat: startLat + (i * milesPerMinute / milesPerDegreeLat), lng: startLng, ts: startTs + i * 60000 });
  }
  return points;
}

test('speedMph: computes a sane mph from two points a known distance/time apart', function(){
  const sandbox = autoDetectorSandbox();
  const path = drivingPath(40, -75, 30, 2, 0); // 30 mph for one 1-minute step
  const mph = sandbox.speedMph(path[0], path[1]);
  assert.ok(Math.abs(mph - 30) < 1, 'expected ~30 mph, got ' + mph);
});

test('createTripAutoDetector: does not start a trip from a single momentary fast reading (needs a sustained streak)', function(){
  const sandbox = autoDetectorSandbox();
  let ended = false;
  const detector = sandbox.createTripAutoDetector(function(){ ended = true; });
  const path = drivingPath(40, -75, 25, 2, 0); // just one fast leg
  path.forEach(function(p){ detector.feed(p); });
  assert.strictEqual(detector.getState(), 'idle', 'a single fast reading should not be enough to start a trip');
  assert.strictEqual(ended, false);
});

test('createTripAutoDetector: starts a trip after a sustained fast streak (driving speed, not walking)', function(){
  const sandbox = autoDetectorSandbox();
  const detector = sandbox.createTripAutoDetector(function(){});
  const path = drivingPath(40, -75, 30, 5, 0); // several consecutive 30mph legs
  path.forEach(function(p){ detector.feed(p); });
  assert.strictEqual(detector.getState(), 'tripping');
});

test('createTripAutoDetector: does NOT start a trip at walking speed', function(){
  const sandbox = autoDetectorSandbox();
  const detector = sandbox.createTripAutoDetector(function(){});
  const path = drivingPath(40, -75, 3, 6, 0); // walking pace the whole time
  path.forEach(function(p){ detector.feed(p); });
  assert.strictEqual(detector.getState(), 'idle', 'walking speed should never be classified as a driving trip');
});

test('createTripAutoDetector: ends the trip and reports mileage once slow enough for long enough', function(){
  const sandbox = autoDetectorSandbox();
  let reportedMiles = null;
  const detector = sandbox.createTripAutoDetector(function(miles){ reportedMiles = miles; });
  const driving = drivingPath(40, -75, 30, 5, 0); // start driving
  driving.forEach(function(p){ detector.feed(p); });
  assert.strictEqual(detector.getState(), 'tripping');

  // Now stop moving (same point repeated) for longer than the stop-confirm window.
  const lastTs = driving[driving.length - 1].ts;
  const lastPoint = driving[driving.length - 1];
  for(let i = 1; i <= 4; i++){
    detector.feed({ lat: lastPoint.lat, lng: lastPoint.lng, ts: lastTs + i * 60000 }); // +1min each, same spot
  }
  assert.strictEqual(detector.getState(), 'idle', 'trip should have ended after being stopped past the confirm window');
  assert.ok(reportedMiles !== null && reportedMiles > 0, 'should have reported nonzero mileage for the completed trip');
});

test('createTripAutoDetector: a brief stop (e.g. a red light) under the confirm window does not end the trip', function(){
  const sandbox = autoDetectorSandbox();
  let ended = false;
  const detector = sandbox.createTripAutoDetector(function(){ ended = true; });
  const driving = drivingPath(40, -75, 30, 5, 0);
  driving.forEach(function(p){ detector.feed(p); });
  const lastPoint = driving[driving.length - 1];
  // Stopped for only 1 minute (under the 3-minute confirm window), then resumes driving.
  detector.feed({ lat: lastPoint.lat, lng: lastPoint.lng, ts: lastPoint.ts + 60000 });
  assert.strictEqual(detector.getState(), 'tripping', 'a brief stop under the confirm window should not end the trip');
  assert.strictEqual(ended, false);
});
