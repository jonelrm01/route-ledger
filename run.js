#!/usr/bin/env node
'use strict';
// Regression test runner for GigHelper (index.html).
//
//   Run with: node tests/run.js
//
// No npm install needed — everything here uses only Node's built-ins, so
// this works on a bare Node install with nothing else set up.
//
// Each *.test.js file in this folder calls the global `test(name, fn)`
// once per case:
//   - a plain sync fn (no args) that returns normally = pass, throws = fail
//   - a sync fn that returns a Promise = pass/fail follows the promise
//   - an async-style fn(done) that calls done() = pass, done(err) = fail
//     (wrap assertions in try/catch and call done(err) in the catch —
//     an uncaught throw inside a setTimeout/promise callback won't be
//     attributed to the right test otherwise)
//
// Exits with code 1 if anything failed, so this can be wired into a CI
// step later without any changes.
const fs = require('fs');
const path = require('path');

const testsDir = __dirname;
const files = fs.readdirSync(testsDir).filter(function(f){ return f.endsWith('.test.js'); }).sort();

const tests = []; // { file, name, fn }
let currentFile = '';

global.test = function(name, fn){
  tests.push({ file: currentFile, name: name, fn: fn });
};

files.forEach(function(file){
  currentFile = file;
  require(path.join(testsDir, file));
});

function runOne(t){
  return new Promise(function(resolve){
    let settled = false;
    const timer = setTimeout(function(){
      if(settled) return;
      settled = true;
      resolve({ ok: false, err: new Error('timed out after 2000ms — did an async test forget to call done()?') });
    }, 2000);
    function finish(err){
      if(settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(err ? { ok: false, err: err } : { ok: true });
    }
    try{
      if(t.fn.length >= 1){
        t.fn(finish); // done-callback style
      } else {
        const result = t.fn();
        if(result && typeof result.then === 'function'){
          result.then(function(){ finish(); }, finish);
        } else {
          finish();
        }
      }
    }catch(err){
      finish(err);
    }
  });
}

(async function(){
  let pass = 0, fail = 0;
  let lastFile = '';
  for(const t of tests){
    if(t.file !== lastFile){ console.log('\n' + t.file); lastFile = t.file; }
    const result = await runOne(t);
    if(result.ok){
      pass++;
      console.log('  ok   - ' + t.name);
    } else {
      fail++;
      console.log('  FAIL - ' + t.name);
      console.log('         ' + (result.err && result.err.message ? result.err.message : result.err));
    }
  }
  console.log('\n' + '-'.repeat(50));
  console.log(pass + ' passed, ' + fail + ' failed  (' + files.length + ' files, ' + tests.length + ' tests)');
  process.exitCode = fail > 0 ? 1 : 0;
})();
