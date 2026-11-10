'use strict';
// A real Sunday 9:00 pm notification for people who drive for work, on the
// Android app only. These tests run the app's real scheduling code against a
// pretend notification plugin and check exactly what it asks the phone to do.
const assert = require('assert');
const { loadHtml, extractFn, extractObjectLiteral, runInSandbox } = require('./helpers');

const html = loadHtml();
function grab(re, label){ const m = html.match(re); if(!m) throw new Error('not found: ' + label); return m[0]; }

// opts: native (default true), permission ('granted'|'prompt'|'denied'), requestResult, wanted (default true), usesVehicle (default true), failSchedule
function setup(opts){
  opts = opts || {};
  const calls = [];
  const state = { display: opts.permission || 'granted' };
  const plugin = {
    checkPermissions: function(){ calls.push(['checkPermissions']); return Promise.resolve({ display: state.display }); },
    requestPermissions: function(){ calls.push(['requestPermissions']); state.display = opts.requestResult || 'granted'; return Promise.resolve({ display: state.display }); },
    createChannel: function(c){ calls.push(['createChannel', c]); return Promise.resolve(); },
    schedule: function(o){ calls.push(['schedule', o]); return opts.failSchedule ? Promise.reject(new Error('boom')) : Promise.resolve({ notifications: [] }); },
    cancel: function(o){ calls.push(['cancel', o]); return Promise.resolve(); }
  };
  const store = {};
  if(opts.wanted === false) store['routeLedger.weeklyReminder.v1'] = 'off';
  const win = opts.native === false ? {} : { Capacitor: { isNativePlatform: function(){ return true; }, Plugins: { LocalNotifications: plugin } } };
  const sb = runInSandbox([
    "var WEEKLY_REMINDER_KEY = 'routeLedger.weeklyReminder.v1'; var WEEKLY_REMINDER_ID = 41001; var WEEKLY_REMINDER_CHANNEL = 'weekly-mileage'; var WEEKLY_REMINDER_SOUND = 'reminder.wav';",
    'function isNativeApp(){ return !!(window.Capacitor && window.Capacitor.isNativePlatform()); }',
    'function t(k){ return "T:" + k; }',
    'function loadWorkProfile(){ return { usesVehicle: ' + (opts.usesVehicle === false ? 'false' : 'true') + ' }; }',
    extractFn(html, 'weeklyReminderWanted'), extractFn(html, 'setWeeklyReminderWanted'), extractFn(html, 'localNotificationsPlugin'),
    extractFn(html, 'buildWeeklyReminderNotification'), extractFn(html, 'syncWeeklyReminder')
  ], {
    window: win,
    localStorage: { getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; }, setItem: function(k, v){ store[k] = String(v); } }
  });
  return { sb: sb, calls: calls, names: function(){ return calls.map(function(c){ return c[0]; }); } };
}

test('in a plain browser nothing is scheduled (browsers cannot do scheduled notifications)', async function(){
  const x = setup({ native: false });
  assert.strictEqual(await x.sb.syncWeeklyReminder(true), 'unsupported');
  assert.deepStrictEqual(x.calls, []);
});

test('Android app, permission granted: schedules a repeating Sunday 9:00 pm notification', async function(){
  const x = setup({ permission: 'granted' });
  assert.strictEqual(await x.sb.syncWeeklyReminder(false), 'scheduled');
  const sched = x.calls.filter(function(c){ return c[0] === 'schedule'; });
  assert.strictEqual(sched.length, 1);
  const n = sched[0][1].notifications[0];
  assert.strictEqual(n.id, 41001);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(n.schedule.on)), { weekday: 1, hour: 21, minute: 0 }, 'weekday 1 is Sunday in the plugin');
  assert.strictEqual(n.isExactNotification, false, 'must not send people to the exact-alarm settings screen');
  assert.strictEqual(n.title, 'T:reminderNotifTitle');
  assert.strictEqual(n.body, 'T:reminderNotifBody');
  assert.strictEqual(n.channelId, 'weekly-mileage');
  assert.ok(x.names().indexOf('createChannel') < x.names().indexOf('schedule'), 'the channel must exist before scheduling');
  assert.strictEqual(x.calls.filter(function(c){ return c[0] === 'requestPermissions'; }).length, 0, 'no prompt when already granted');
});

test('the reminder beeps AND vibrates: channel has a sound file and vibration on; iPhone/Android 7 get the sound name too', async function(){
  const x = setup();
  await x.sb.syncWeeklyReminder(false);
  const ch = x.calls.filter(function(c){ return c[0] === 'createChannel'; })[0][1];
  assert.strictEqual(ch.sound, 'reminder.wav', 'Android 8+ plays no sound at all unless the channel names a sound file');
  assert.strictEqual(ch.vibration, true, 'vibration is off on a channel unless asked for');
  assert.ok(ch.importance >= 3, 'importance 3 or higher is needed for the sound to play');
  const n = x.calls.filter(function(c){ return c[0] === 'schedule'; })[0][1].notifications[0];
  assert.strictEqual(n.sound, 'reminder.wav', 'iOS is silent unless the notification names a sound; a name that is not in the app gives the standard system sound');
});

test('scheduling twice reuses the same id, so the reminder is replaced and never duplicated', async function(){
  const x = setup();
  await x.sb.syncWeeklyReminder(false); await x.sb.syncWeeklyReminder(false);
  const ids = x.calls.filter(function(c){ return c[0] === 'schedule'; }).map(function(c){ return c[1].notifications[0].id; });
  assert.deepStrictEqual(ids, [41001, 41001]);
});

test('startup-style sync never prompts: without permission it does nothing', async function(){
  const x = setup({ permission: 'prompt' });
  assert.strictEqual(await x.sb.syncWeeklyReminder(false), 'needs-permission');
  assert.deepStrictEqual(x.names(), ['checkPermissions']);
});

test('asking for permission: granted schedules it, denied leaves it off', async function(){
  const ok = setup({ permission: 'prompt', requestResult: 'granted' });
  assert.strictEqual(await ok.sb.syncWeeklyReminder(true), 'scheduled');
  assert.ok(ok.names().indexOf('requestPermissions') !== -1 && ok.names().indexOf('schedule') !== -1);
  const no = setup({ permission: 'prompt', requestResult: 'denied' });
  assert.strictEqual(await no.sb.syncWeeklyReminder(true), 'blocked');
  assert.strictEqual(no.names().indexOf('schedule'), -1, 'nothing scheduled after a "no"');
});

test('turned off in Settings, or not driving for work: the reminder is cancelled, never scheduled', async function(){
  const off = setup({ wanted: false });
  assert.strictEqual(await off.sb.syncWeeklyReminder(true), 'cancelled');
  assert.strictEqual(JSON.stringify(off.calls), JSON.stringify([['cancel', { notifications: [{ id: 41001 }] }]]), 'no permission prompt, no scheduling');
  const noVeh = setup({ usesVehicle: false });
  assert.strictEqual(await noVeh.sb.syncWeeklyReminder(true), 'cancelled');
  assert.strictEqual(noVeh.names().indexOf('schedule'), -1);
});

test('a plugin failure never throws into the app', async function(){
  const x = setup({ failSchedule: true });
  assert.strictEqual(await x.sb.syncWeeklyReminder(false), 'blocked');
});

test('preference defaults to on and round-trips', function(){
  const x = setup({ native: false });
  assert.strictEqual(x.sb.weeklyReminderWanted(), true);
  x.sb.setWeeklyReminderWanted(false); assert.strictEqual(x.sb.weeklyReminderWanted(), false);
  x.sb.setWeeklyReminderWanted(true); assert.strictEqual(x.sb.weeklyReminderWanted(), true);
});

test('wiring: Settings toggle, vehicle-only, tap opens the mileage window, no exact-alarm permission', function(){
  ['weeklyReminderSection', 'weeklyReminderToggleBtn', 'weeklyReminderStatus', 'welcomeDoneReminder'].forEach(function(id){
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'missing #' + id);
  });
  assert.ok(/class="settings-section vehicle-only" id="weeklyReminderSection"/.test(html), 'hidden for people who do not drive for work');
  assert.ok(/localNotificationActionPerformed[\s\S]{0,400}odoWeeklyBannerBtn[\s\S]{0,200}bannerBtn\.click\(\)/.test(html), 'tapping the notification opens the same update-mileage window as the in-app banner');
  assert.strictEqual(html.indexOf('SCHEDULE_EXACT_ALARM'), -1, 'the app must not request exact alarms');
  assert.ok(/queueReminderSync\(\);\s*\/\/ the Sunday reminder only exists/.test(html), 'changing the work profile must update the schedule');
  assert.ok(extractFn(html, 'applyLanguage').indexOf('queueReminderSync()') !== -1, 'a language change must re-schedule so the text is translated');
});

test('Settings shows the true on/off state every time it opens (permission can change outside the app)', function(){
  assert.ok(/id === 'settingsModal' && typeof paintWeeklyReminder === 'function'\) paintWeeklyReminder\(\)/.test(html));
  assert.ok(/syncWeeklyReminder\(true\)\.then\(function\(\)\{ paintWeeklyReminder\(\); maybePromptStorageChoice\(\); \}\)/.test(html), 'after the permission answer the toggle must be repainted');
});

test('welcome card mentions the reminder only where it can really work', function(){
  const fn = extractFn(html, 'paintWelcomeDoneTexts');
  assert.ok(/usesVehicle && localNotificationsPlugin\(\)/.test(fn));
});

test('reminder strings exist in all 5 languages and are safe', function(){
  const i18n = extractObjectLiteral(html, 'I18N');
  const keys = ['weeklyReminderTitle', 'weeklyReminderHint', 'weeklyReminderBlocked', 'weeklyReminderWebOnly', 'reminderNotifTitle', 'reminderNotifBody', 'welcomeDoneReminder'];
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    keys.forEach(function(k){ assert.ok(i18n[lang][k] && !/[<>]/.test(i18n[lang][k]), lang + ' missing or unsafe ' + k); });
    assert.ok(/9|21/.test(i18n[lang].weeklyReminderHint) && /9|21/.test(i18n[lang].welcomeDoneReminder), lang + ': the time must be stated (9 pm, or 21:00 in 24-hour languages)');
  });
});

test('wording is platform-neutral now that the reminder is for Android and iPhone', function(){
  const i18n = extractObjectLiteral(html, 'I18N');
  ['en-US', 'es-ES', 'it-IT', 'fr-FR', 'zh-CN'].forEach(function(lang){
    assert.ok(!/android|安卓/i.test(i18n[lang].weeklyReminderWebOnly), lang + ': the web-only note must not say Android');
  });
});
