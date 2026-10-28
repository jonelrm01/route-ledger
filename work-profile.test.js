'use strict';
// Onboarding asks "Do you drive for your business?" and, if yes, what kind of
// work. The answers are saved as a work profile that (a) hides mileage/vehicle
// controls for people who don't drive for work and (b) picks the Driving
// stream's categories. Existing users never answered, so they MUST keep the
// original delivery behavior.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, categoriesSandbox } = require('./helpers');

const html = loadHtml();
const join = function(arr){ return Array.from(arr).join('|'); };

test('no saved profile (existing users) = delivery with mileage on, original categories unchanged', function(){
  const sb = categoriesSandbox(html);
  const p = sb.loadWorkProfile();
  assert.strictEqual(p.usesVehicle, true);
  assert.strictEqual(p.workType, 'delivery');
  assert.strictEqual(p.onboardedVersion, 0);
  assert.strictEqual(join(sb.categoriesForStream('Driving')), 'Uber|DoorDash|Gas|Restaurant|Other');
});

test('each work type gets its own Driving categories; other streams are never affected', function(){
  const expectIn = { contractor: ['Job payment', 'Materials', 'Subcontractors'], towing: ['Tow call', 'Tires', 'Dispatch fees'], other: ['Income', 'Supplies'] };
  Object.keys(expectIn).forEach(function(type){
    const sb = categoriesSandbox(html, { usesVehicle: true, workType: type, onboardedVersion: 2 });
    const cats = Array.from(sb.categoriesForStream('Driving'));
    expectIn[type].forEach(function(c){ assert.ok(cats.indexOf(c) !== -1, type + ' should offer ' + c); });
    assert.strictEqual(cats.indexOf('Uber'), -1, type + ' should not get the delivery-only Uber category');
    const personal = Array.from(sb.categoriesForStream('Personal'));
    assert.ok(personal.indexOf('Groceries') !== -1 && personal.indexOf('Tow call') === -1, 'Personal stream stays the general set for ' + type);
  });
});

test('every work type list is deduplicated, includes Gas, and ends with Other', function(){
  const lists = extractObjectLiteral(html, 'WORK_TYPE_CATEGORIES');
  assert.strictEqual(Object.keys(lists).sort().join('|'), 'contractor|delivery|other|towing');
  Object.keys(lists).forEach(function(type){
    const cats = lists[type];
    assert.strictEqual(new Set(cats).size, cats.length, type + ' has duplicate categories');
    assert.ok(cats.indexOf('Gas') !== -1, type + ' must keep Gas');
    assert.strictEqual(cats[cats.length - 1], 'Other', type + ' must end with Other so old entries stay valid');
  });
});

test('loadWorkProfile survives corrupt or partial storage instead of throwing', function(){
  assert.strictEqual(categoriesSandbox(html, '{not json').loadWorkProfile().workType, 'delivery');
  assert.strictEqual(categoriesSandbox(html, 'null').loadWorkProfile().usesVehicle, true);
  assert.strictEqual(categoriesSandbox(html, { workType: 'spaceship' }).loadWorkProfile().workType, 'delivery', 'unknown work type falls back to delivery');
  assert.strictEqual(categoriesSandbox(html, { usesVehicle: false, workType: 'other' }).loadWorkProfile().usesVehicle, false, 'an explicit "no" is preserved');
});

test('saveWorkProfile round-trips through loadWorkProfile', function(){
  const sb = categoriesSandbox(html);
  sb.saveWorkProfile({ usesVehicle: true, workType: 'towing', onboardedVersion: 2 });
  const p = sb.loadWorkProfile();
  assert.strictEqual(p.workType, 'towing');
  assert.strictEqual(p.onboardedVersion, 2);
  assert.strictEqual(join(sb.categoriesForStream('Driving')).indexOf('Tow call') !== -1, true);
});

test('wiring: welcome + settings controls exist, mileage controls are marked vehicle-only, CSS hides them', function(){
  ['wDriveOptions', 'wTypeOptions', 'wTypeWrap', 'welcomePlatformWrap', 'sDriveOptions', 'sTypeOptions', 'sTypeWrap', 'workProfileSection'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing element #' + id);
  });
  assert.ok(/body\.no-vehicle \.vehicle-only\s*\{\s*display:none !important/.test(html), 'CSS rule that hides vehicle controls is missing');
  assert.ok(/class="nav-btn vehicle-only" data-panel="vehicle"/.test(html), 'Vehicle tab must be hideable');
  assert.ok(/class="vehicle-card vehicle-only" id="gpsTripCard"/.test(html), 'GPS trip card must be hideable');
  assert.ok(/class="vehicle-card vehicle-only" id="odoWeeklyBanner"/.test(html), 'weekly odometer banner must be hideable');
  assert.ok(/id="mileageSourceSection"/.test(html) && /vehicle-only" id="mileageSourceSection"/.test(html), 'mileage source setting must be hideable');
  assert.ok(/data-type="mileage" class="vehicle-only"/.test(html), 'Mileage entry type must be hideable');
});

test('wiring: finishing onboarding saves the profile, and only delivery work keeps the platform checklist', function(){
  const body = html.slice(html.indexOf("welcomeBtn.addEventListener('click'"), html.indexOf("maybePromptStorageChoice();\n    });"));
  assert.ok(body.indexOf('saveWorkProfile(chosenProfile)') !== -1, 'continue handler must save the work profile');
  assert.ok(body.indexOf('onboardedVersion: 2') !== -1);
  assert.ok(/savePlatforms\(\(chosenProfile\.usesVehicle && chosenProfile\.workType==='delivery'\) \? checked : \[\]\)/.test(body), 'platforms are kept only for delivery/rideshare work');
  assert.ok(body.indexOf("welcomeWork.usesVehicle ? welcomeWork.workType : 'other'") !== -1, 'answering "no" must not carry over a stale work type');
  assert.ok(body.indexOf('applyWorkProfile()') !== -1);
});

test('applyWorkProfile hides vehicle UI via a body class and leaves the Vehicle tab if it is open', function(){
  const fn = extractFn(html, 'applyWorkProfile');
  assert.ok(fn.indexOf("classList.toggle('no-vehicle', !p.usesVehicle)") !== -1);
  assert.ok(fn.indexOf("showPanel('log')") !== -1, 'must not strand someone on the hidden Vehicle tab');
  assert.ok(fn.indexOf('rebuildCategorySelect()') !== -1, 'category list must refresh after the profile changes');
  assert.ok(fn.indexOf("getElementById('manualCategory')") !== -1 && fn.indexOf("innerHTML = ''") !== -1 && fn.indexOf("innerHTML = ''") < fn.indexOf('rebuildCategorySelect()'), 'the old selection must be cleared before rebuilding, or a stale category (Uber) leaks into the new list');
});

test('work profile strings exist in all 5 languages', function(){
  const i18n = extractObjectLiteral(html, 'I18N');
  const keys = ['workDriveLbl', 'workDriveHint', 'workDriveYes', 'workDriveNo', 'workTypeLbl', 'workTypeDelivery', 'workTypeContractor', 'workTypeTowing', 'workTypeOther', 'workProfileLbl'];
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    keys.forEach(function(k){ assert.ok(i18n[lang][k] && i18n[lang][k].length > 0, lang + ' missing ' + k); });
  });
});
