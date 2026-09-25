# GigHelper regression tests

These check the app's most fragile pieces automatically instead of relying on
re-typed one-off tests each chat session (which is how the same
stream-tagging bug ended up getting reintroduced more than once).

## Running them

You need Node.js installed (no other setup, no `npm install` — everything
here uses only Node's built-ins). From the project folder:

```
node tests/run.js
```

You'll get a pass/fail line per test, and a summary at the end like:

```
25 passed, 0 failed  (6 files, 25 tests)
```

If anything fails, it prints the test name and the specific reason. A
failure here means a real behavior changed in `index.html` — either an
intentional change (update the test to match) or an accidental regression
(fix the app code).

## What's covered

- **static-checks** — the inline script's JS still parses, and no two
  elements share an `id` (a duplicate silently breaks `getElementById`
  lookups for one of them).
- **i18n-completeness** — every one of the 5 supported languages (English,
  Spanish, Italian, French, Chinese) has exactly the same set of UI strings
  and the same 10 Help-guide sections, with nothing left empty. This is the
  check that would have caught a string added to English but forgotten in
  the other four.
- **streams** — per-stream category lists (Driving vs. everything else),
  counting a stream's entries before allowing deletion, and the
  delete-confirmation text substitution.
- **weekly-odometer** — Monday-based week boundaries, and that logging twice
  in the same week overwrites instead of creating a duplicate row.
- **manual-entry-date** — backdating a manual entry lands it on the chosen
  day (not today), at noon local time to dodge timezone/DST edge cases.
- **share-backup** — the iOS/unsupported-browser Web Share backup path:
  feature detection across a few mocked browsers, and the success/cancel/
  failure/guard behavior of the actual share function.

## How this works, if you're curious

`index.html` is one big file with no build step, so these tests don't
"import" the app the normal way. `helpers.js` pulls specific functions and
objects (like `categoriesForStream` or the `I18N` dictionary) directly out
of the real `index.html` text at test-run time, and runs them in a small
sandboxed environment with just the fake browser bits each test needs (a
fake `localStorage`, a fake button, etc). That means a test is always
checking today's actual shipped code — if a function's behavior changes,
the test picks up the new version automatically; there's no separate copy
of the logic to remember to keep in sync.

## Adding a new test

When you (or a future session) fix a bug or add a feature that's easy to
break by accident later, add a case here rather than only testing it once
in chat. Copy the pattern in an existing `*.test.js` file — extract the
real function with `extractFn`, feed it whatever mocks it needs, assert on
the result. Keep tests in whichever file matches the feature area, or start
a new `something.test.js` file if it's a new area — `run.js` picks up any
file ending in `.test.js` automatically.
