# GigHelper support agent

An assistant that reads the emails sent to your GigHelper support Gmail account
and answers the ones the **user guide** clearly covers, in the customer's
language (English, Spanish, Italian, French or Chinese). Everything else goes
to you.

It runs for free inside Google (Apps Script). You only pay Anthropic for the
AI calls, usually a small fraction of a cent to a few cents per email depending
on the model (see Anthropic's pricing page).

## What it will and will not do

**It answers** how-to and troubleshooting questions that the guide covers.

**It never answers, it hands to you** (label `AI/needs-human`, starred, left
unread, optional alert email): refunds and billing, privacy or data-deletion
requests, bug reports and lost data, tax advice, feature requests, angry
customers, questions about prices or iPhone availability, anything not in the
guide, anything that depends on an attachment, and any language other than the
five above.

**Safety built in** (all of it is checked by automated tests):
- Starts in **DRAFT mode**: it writes the reply as a Gmail draft and you press
  Send. Switch to SEND mode only after you trust the drafts.
- Only replies with category `how_to` or `troubleshooting`, with confidence 0.7
  or higher. A reply that contains a link, another email address, or is too
  long is thrown away and sent to you instead.
- Customer emails are treated as untrusted text. A message that says "ignore
  your rules" is escalated, and even a fooled model can only produce text that
  has to pass the checks above.
- Never replies to no-reply addresses, mailing lists, auto-responders, or
  itself. At most 2 of its own replies per conversation and 4 per sender every
  6 hours, then a person takes over.
- A daily cap on AI calls (default 150) so a flood of mail cannot run up a bill.
- Every automatic reply says it was written by the AI assistant and invites
  the customer to reply for a person.

## Setup (about 30 minutes, once)

### 1. Get an API key
1. Create an account at console.anthropic.com and add billing.
2. In the console, create an **API key** and copy it. Set a monthly spend limit
   there too, as a second safety net.

### 2. Create the script **while signed in as the support Gmail account**
1. Go to script.google.com, click **New project**, name it `GigHelper support`.
2. Replace the contents of `Code.gs` with the file `Code.gs` from this folder.
3. Add two more script files (the **+** next to Files, choose Script) named
   `Knowledge` and `Eval`, and paste in `Knowledge.gs` and `Eval.gs`.
4. **Project Settings** (gear icon) → tick **Show "appsscript.json" manifest
   file in editor**, open it, and paste the contents of `appsscript.json`.
   Change `timeZone` to yours if you like.
5. Still in Project Settings → **Script properties** → add:
   | Property | Value |
   |---|---|
   | `ANTHROPIC_API_KEY` | your key |
   | `MODE` | `draft` |
   | `OWNER_EMAIL` | your personal email, for "needs you" alerts (optional) |

   Optional: `MODEL` (default `claude-haiku-5-5`; try `claude-sonnet-5-5` if
   answers are not good enough), `ESCALATION_ACK` = `on` (in SEND mode, sends
   a short "a person will reply" note), `DAILY_CALL_CAP`.

### 3. Switch it on
1. Open `Code.gs`, choose the function **setup** in the dropdown, press **Run**.
   Google asks you to authorize. Because this is your own unpublished script it
   shows an "unverified app" warning: click **Advanced → Go to GigHelper
   support (unsafe)** and allow. This is normal for your own script.
2. Run **testApiKey**. The log should say the key works.
3. Run **runEval** (opens the practice exam in `Eval.gs`, about 27 made-up
   emails). Read the log (**Execution log**). Fix anything marked `FAIL`
   before going further. Nothing in your inbox is touched by this.

### 4. Run in DRAFT mode for at least two weeks
- Ask a friend (or yourself from another address) to email the support
  address with real questions in different languages.
- Every 10 minutes the agent checks the inbox. Answers appear as **drafts** in
  the conversation and the label `AI/drafted`. Read each one, edit if needed,
  and send it yourself.
- Anything it won't answer gets `AI/needs-human`.
- Keep a note of every draft you had to fix. If you fix many, tell me and we
  improve the prompt or the guide.

### 5. Go live (only when drafts are consistently right)
- Change the script property `MODE` to `send`. That's it. Check the
  `AI/answered` label daily for the first week.
- To pause at any time: set `MODE` back to `draft`, or delete the trigger
  (Triggers → clock icon on the left).

## Keeping it up to date
The agent's knowledge is the in-app User guide. Whenever you change the guide
in `index.html`:
1. Run `node tools/build-knowledge.js` (writes a new `Knowledge.gs`).
2. Paste the new `Knowledge.gs` into the script.
3. The project's automated tests fail if `Knowledge.gs` is out of date, so you
   will be reminded.

## Before you launch
- Update your **privacy policy**: say that emails sent to support are
  processed by an AI provider (Anthropic) to draft replies, and tell customers
  not to email passwords, card numbers or similar. Read Anthropic's current
  terms and privacy information to describe their data handling accurately.
- A free Gmail account has daily limits on emails sent from a script. Check
  Google's current "Apps Script quotas" page; it is plenty for a small app but
  matters if you grow.

## Limits to know about
- It cannot see attachments or screenshots. Those go to you.
- It only looks at the last 3 messages of a conversation.
- It answers from the guide, so it is only as good as the guide. When it
  escalates something that people ask often, that is a sign the guide needs a
  new section.
- It is not a lawyer, accountant or tax advisor, and it won't pretend to be.
