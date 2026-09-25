'use strict';
const assert = require('assert');
const { loadHtml, extractFn, runInSandbox } = require('./helpers');

const html = loadHtml();

function FakeFile(parts, name, opts){ this.parts = parts; this.name = name; this.type = opts && opts.type; }

function detectWebShare(navigatorMock, FileCtor){
  try{
    if(!(navigatorMock.share && navigatorMock.canShare)) return false;
    const testFile = new FileCtor(['test'], 'test.csv', { type: 'text/csv' });
    return navigatorMock.canShare({ files: [testFile] });
  }catch(e){ return false; }
}

test('web share feature detection: iOS-Safari-like environment is detected as supported', function(){
  const nav = { share: function(){}, canShare: function(o){ return !!(o && o.files); } };
  assert.strictEqual(detectWebShare(nav, FakeFile), true);
});

test('web share feature detection: an environment with no navigator.share at all is NOT supported', function(){
  assert.strictEqual(detectWebShare({}, FakeFile), false);
});

test('web share feature detection: canShare returning false for files (common on desktop Chrome) is NOT supported', function(){
  const nav = { share: function(){}, canShare: function(){ return false; } };
  assert.strictEqual(detectWebShare(nav, FakeFile), false);
});

test('web share feature detection: a throwing File constructor fails closed instead of crashing', function(){
  const nav = { share: function(){}, canShare: function(){ return true; } };
  function ThrowyFile(){ throw new Error('no File support'); }
  assert.strictEqual(detectWebShare(nav, ThrowyFile), false);
});

function makeSandboxForShare(navigatorMock){
  const store = {};
  const toasts = [];
  const bannerEl = { style: { display: 'flex' } };
  let statusCalls = 0;
  const fn = extractFn(html, 'shareBackupNow');
  const sandbox = runInSandbox(fn, {
    File: function(parts, name, opts){ this.parts = parts; this.name = name; this.type = opts && opts.type; },
    localStorage: {
      getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem: function(k, v){ store[k] = String(v); }
    },
    showToast: function(msg){ toasts.push(msg); },
    document: { getElementById: function(id){ return id === 'backupBanner' ? bannerEl : null; } },
    appName: 'GigHelper',
    csvContent: function(){ return 'fake,csv'; },
    updateAutoBackupStatusUi: function(){ statusCalls++; },
    navigator: navigatorMock
  });
  sandbox.__store = store;
  sandbox.__toasts = toasts;
  sandbox.__banner = bannerEl;
  sandbox.__statusCalls = function(){ return statusCalls; };
  return sandbox;
}

test('shareBackupNow: on success, shares one correctly-named/typed CSV file and records the backup', function(done){
  let sharedOpts = null;
  const sandbox = makeSandboxForShare({
    canShare: function(o){ return !!(o && o.files && o.files.length === 1); },
    share: function(opts){ sharedOpts = opts; return Promise.resolve(); }
  });
  sandbox.shareBackupNow();
  setTimeout(function(){
    try{
      assert.ok(sharedOpts, 'navigator.share should have been called');
      assert.strictEqual(sharedOpts.files.length, 1);
      assert.ok(sharedOpts.files[0].name.indexOf('GigHelper_backup_') === 0, 'unexpected filename: ' + sharedOpts.files[0].name);
      assert.strictEqual(sharedOpts.files[0].type, 'text/csv');
      assert.ok(sandbox.__store['gh_last_export'], 'gh_last_export should be recorded on success');
      assert.strictEqual(sandbox.__banner.style.display, 'none', 'backup banner should be hidden on success');
      assert.strictEqual(sandbox.__statusCalls(), 1);
      assert.ok(sandbox.__toasts.indexOf('Backup shared') !== -1);
      done();
    }catch(err){ done(err); }
  }, 10);
});

test('shareBackupNow: a user cancelling the share sheet (AbortError) fails silently — no false "backed up" state, no error toast', function(done){
  const sandbox = makeSandboxForShare({
    canShare: function(){ return true; },
    share: function(){ const e = new Error('cancelled'); e.name = 'AbortError'; return Promise.reject(e); }
  });
  sandbox.shareBackupNow();
  setTimeout(function(){
    try{
      assert.strictEqual(sandbox.__store['gh_last_export'], undefined);
      assert.strictEqual(sandbox.__banner.style.display, 'flex');
      assert.strictEqual(sandbox.__toasts.length, 0, 'a user-initiated cancel should not show an error toast');
      done();
    }catch(err){ done(err); }
  }, 10);
});

test('shareBackupNow: a genuine share failure shows an error toast and does not mark as backed up', function(done){
  const sandbox = makeSandboxForShare({
    canShare: function(){ return true; },
    share: function(){ return Promise.reject(new Error('boom')); }
  });
  sandbox.shareBackupNow();
  setTimeout(function(){
    try{
      assert.strictEqual(sandbox.__store['gh_last_export'], undefined);
      assert.ok(sandbox.__toasts.indexOf('Could not share backup') !== -1);
      done();
    }catch(err){ done(err); }
  }, 10);
});

test('shareBackupNow: never calls navigator.share when canShare says it can\'t work', function(){
  let shareCalled = false;
  const sandbox = makeSandboxForShare({
    canShare: function(){ return false; },
    share: function(){ shareCalled = true; return Promise.resolve(); }
  });
  sandbox.shareBackupNow();
  assert.strictEqual(shareCalled, false, 'share() must never be called if canShare said no');
  assert.strictEqual(sandbox.__toasts.length, 1);
});
