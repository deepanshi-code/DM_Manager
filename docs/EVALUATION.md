# Testing and evaluation

What was tested, how, the results, and what is **not** yet evaluated. Every number below
can be reproduced with the commands shown. Measured on 24 Nov 2026 on a Windows 11 laptop,
Node.js 24, embedded PostgreSQL (PGlite).

## 1. Summary

| Area | Method | Result |
|---|---|---|
| Server logic and API | 76 automated tests (`npm test`) | **76 / 76 pass** |
| Code coverage | Node's built-in coverage | **95.6 % of lines**, 85.9 % of branches, 91.0 % of functions |
| ML tools | 9 Python tests (`npm run test:ml`) | **9 / 9 pass** |
| Correctness under load | 5,498 webhook events, 1,500 customers (`npm run loadtest`) | **All 6 checks pass**: nothing lost, nothing duplicated |
| Speed under load | Same run | ~100 webhook events/s; inbox loads in ~28 ms with ~2,000 chats |
| Security | Signature, login, cross-site, injection, header and dependency checks | **No issues open**; 2 fixed during this pass (§5) |
| Classifier | Retrained from scratch (`python ml/train.py`) | **Reproducible**: identical model, same scores |
| User interface | End-to-end walkthrough in a browser, light/dark, phone width | All flows work; 1 bug fixed (§6) |

## 2. Automated tests

```bash
npm test          # 76 server tests (node:test, real PostgreSQL via PGlite)
npm run test:ml   # 9 Python tests for the anonymiser and agreement tools
```

| Suite | Tests | What it covers |
|---|---|---|
| `stateMachine.test.js` | lifecycle rules | allowed status changes, overdue and 24-hour window maths |
| `flow.test.js` | Phase 1–2 behaviour | idempotent webhooks, reply timer, ordering, intent and priority, Undo |
| `classifier.test.js` | model in Node | JS output matches Python probabilities (< 1e-4), rule fallbacks |
| `phase3.test.js` | saved replies | suggestions by type, usage and edit tracking, validation, team stats |
| `phase4.test.js` | Instagram + login | Send API request shape and errors, echoes (both arrival orders), username lookup, login, sessions, throttling |
| `workspace.test.js` | team features | notes, reminders (rules and auto-clear), order numbers, presence, Mine, bulk actions, report |
| `http.test.js` | real HTTP | webhook handshake and signatures, full agent flow, security checks, bad input, security headers |

**Coverage** (`node --test --experimental-test-coverage "test/**/*.test.js"` in `server/`):

| File | Lines |
|---|---|
| services/conversations.js | 99.4 % |
| services/workspace.js | 99.1 % |
| routes/api.js | 99.0 % |
| routes/webhook.js | 97.0 % |
| auth.js | 90.1 % (uncovered: password change and account enable/disable, used by the CLI) |
| **all files** | **95.6 %** |

## 3. Load test: correct at high volume?

The problem statement is 500+ DMs a day. The test sends about 10 days of that volume, faster
than real life, including Meta's re-deliveries and replies typed on a phone.

```bash
npm run loadtest
```

| Correctness check | Result |
|---|---|
| Every unique DM stored exactly once | PASS (4,672 / 4,672) |
| Every phone reply (echo) stored once | PASS (828 / 828) |
| No message stored twice (≈10 % re-deliveries ignored) | PASS (0 duplicates) |
| One conversation per customer | PASS (1,951 / 1,951) |
| No unanswered chat hidden from "To reply" | PASS (0 hidden) |
| No webhook answered with an error | PASS (0) |

| Speed | Result |
|---|---|
| Steady load, 20 deliveries at a time | 5,498 events in 53 s ≈ **103 events/s**; latency p50 190 ms, p95 227 ms, p99 260 ms |
| Burst: 500 new DMs, 50 connections at a time | all stored in 4.6 s; p95 605 ms |
| Extreme burst: 500 connections at the same instant | Windows refused 234 connections; after re-delivery (what Meta does) **all stored once** |
| Dashboard reads with ~2,000 chats / 5,500 messages | inbox 28 ms, search 19 ms, stats 35 ms, open a chat 11 ms |

**Reading these numbers:** 500 DMs a day averages one every ~3 minutes, so ~100 events per
second is far above the need, even for peaks. The extreme-burst result is a limit of one
laptop and one process, not of the design: nothing was lost, because unanswered webhooks are
re-delivered. For a much larger shop, the next steps are a hosted PostgreSQL and a queue
between the webhook and the database (see README → Known limitations).

## 4. Classifier: reproducible?

`python ml/generate_dataset.py` then `python ml/train.py` rebuilt the dataset and retrained the
model from scratch. The new `model.json` is **identical** to the committed one apart from its
timestamp, and every score in `ml/reports/phase2_evaluation.md` is unchanged:

| Approach (synthetic test set, 380 rows) | Accuracy | Macro-F1 | Complaint recall |
|---|---|---|---|
| Keyword rules (leaked: written after seeing all templates) | 76.6 % | 79.0 % | 54.1 % |
| Server policy (model if confident → rules → model) | 76.1 % | 73.9 % | 21.6 % |

These are **synthetic-data results**, useful for comparing approaches, not real-world
accuracy. Complaint recall is weak, and the rule baseline is optimistic because it is leaked.
The report explains both. Real-data evaluation is listed in §8.

## 5. Security checks

| Check | How | Result |
|---|---|---|
| Fake webhooks | unsigned, wrong-signature and tampered bodies | rejected (401), nothing stored |
| Webhook verify token | wrong token | rejected (403) |
| Login required (AUTH=on) | API without a session | 401 everywhere except login |
| Acting as someone else | send `agent: "Rohan"` while signed in as Asha | ignored: the session decides |
| Password storage | inspect hash | salted scrypt, never plain text |
| Guessing passwords | 5 wrong attempts | 6th blocked for 15 minutes (429) |
| Cross-site form posts | non-JSON write | refused (415); cookie is `SameSite=Lax`, `HttpOnly` |
| Script in a message | `<script>` / `onerror` payload via webhook | stored as text, shown as text (React escapes it) |
| SQL injection via search | `' OR 1=1 --`, `; DROP TABLE` | treated as text, tables intact |
| Oversized requests | 200 KB body | refused (413) |
| Report privacy | report CSV | contains no message text or notes |
| Dependencies | `npm audit` | 0 known vulnerabilities |

**Fixed during this pass:**
1. **Security headers added** (`nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
   and `Cache-Control: no-store` on API responses, so customer messages aren't cached on shared
   computers). Now tested.
2. **Search treated `%` and `_` as wildcards**, so searching "%" matched every chat. They're now
   literal characters. Now tested.

## 6. End-to-end walkthrough (browser)

Done by hand in the real dashboard, in demo mode. Login on/off is also covered by the
automated tests and was checked in the browser earlier.

| Flow | Result |
|---|---|
| Front page → Open dashboard → `/app`; logo back to `/` | works |
| Overview numbers; click "Overdue" card → overdue list | works |
| `j` opens next chat → `1` inserts saved reply with `[price]` selected → type → Ctrl+Enter | sent, recorded as saved reply, next chat opens |
| `e` resolves → Undo | chat returns to "To reply" with its timer |
| Correct a message type | header and priority update; correction stored |
| Search, type filter | correct rows |
| New DMs from the simulator | appear within one refresh (≤ 3 s) |
| Details panel: reminder, note, order numbers, activity | works (also at phone width) |
| Second agent opens same chat | "Rohan is also here" warning |
| Bulk assign 2 chats | both assigned, confirmation shown |
| Light / dark / phone width | no horizontal scroll, nothing cut off |

**Bug found and fixed:** when a customer's 24-hour reply window had closed, pressing `1` still
put a saved reply into the locked reply box. The key now does nothing in that case.

**Observed, not a bug:** a few `502` responses in the browser console. They most likely came
from the API restarting on its own after a code change; the dashboard recovered at the next
refresh. They aren't reproducible now, so the exact timing isn't proven.

## 7. How to repeat everything

```bash
npm test
npm run test:ml
npm run loadtest
python ml/generate_dataset.py
python ml/train.py
npm audit
```

## 8. Not yet evaluated (be honest about these in the report)

| Gap | Why it matters | How to close it |
|---|---|---|
| **No real Instagram test yet** | The Meta API is tested against fakes that follow its documented format, not against Meta itself | Follow `docs/INSTAGRAM_SETUP.md` with a test account; record the result |
| **No real-message accuracy** | Synthetic data is cleaner than real DMs | Collect consented, anonymised messages (`ml/anonymize.py`), label them with two people (`ml/agreement.py`), run `train.py --real` |
| **No pilot with a shop** | The real question is whether customers get answered faster | One week before / one week after with one seller: median reply time, % on time, customers never answered, saved-reply use (all in the report CSV) |
| **No usability study** | Speed for real agents isn't measured | 3–5 people do fixed tasks; time them and use the SUS questionnaire |
| **No formal accessibility audit** | Keyboard use and labels were checked by hand, not against WCAG | Run an automated checker and a screen-reader pass |
| **No automated UI tests** | The interface was tested by hand | Add Playwright tests for the main flows |
| **One server process** | Login throttling and "also viewing" live in memory | Move them to the database or Redis before running several servers |
