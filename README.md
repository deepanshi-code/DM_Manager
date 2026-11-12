# DM Manager: Instagram DM inbox for high-volume business accounts

**Problem.** Small businesses that get 500+ Instagram DMs a day can't keep up by hand. Some customers never get a reply, some get one late, and follow-ups get forgotten.

**Phase 1 goal.** Make sure *no conversation can be forgotten*. Every chat has a lifecycle status and a reply timer, and the inbox always shows the customer who has waited longest first.

**Phase 2 goal.** Sort every DM by type (price, size, COD, order status, complaint, spam…), so complaints and customers chasing a reply rise to the top, and agents can filter the inbox.

> Capstone, Phases 1–2 of 4 done. Reply assistance (Phase 3) and the live Instagram connection (Phase 4) come next.

---

## Run it

Needs Node.js 20+ (built on 24). No database install: it uses **PGlite**, which is real PostgreSQL compiled to WebAssembly and runs inside Node.

```bash
npm install                      # installs server + client (npm workspaces)
cp server/.env.example server/.env
npm run dev:server               # API on http://localhost:4000
npm run dev:client               # dashboard on http://localhost:5173  (second terminal)
npm run simulate                 # replay synthetic DMs (third terminal)
npm test                         # 29 automated tests
```

The classifier model is already included (`server/src/classifier/model.json`). To retrain it you need Python 3.11+: see [ml/README.md](ml/README.md).

> If the server fails with `PGlite failed to initialize properly`, the local demo database in `server/.data/` is damaged (this happens if it's copied while the server is running). Stop the server, move or delete `server/.data/`, and start again; a fresh one is created.

Useful simulator options:

| Command | What it shows |
|---|---|
| `npm run simulate -- --count 20 --interval 300` | a few DMs, quickly |
| `npm run simulate -- --burst` | a spike of DMs arriving at once |
| `npm run simulate -- --dup-rate 0.3` | Meta re-delivering webhooks; the server stores each message once |

With `SLA_SECONDS=120` in `.env`, unanswered chats turn **Overdue** after 2 minutes. That's good for a demo. Use 3600 (1 hour) or whatever target the business sets in real use.

To use a real PostgreSQL server instead, set `DATABASE_URL` in `server/.env`. The SQL is the same.

---

## Architecture

```
Instagram ──webhook──▶ Express API ──▶ PostgreSQL (PGlite in dev)
(simulator for now)       │                 ▲
                          │                 │
                    SLA scheduler ──────────┘  flags overdue chats every N seconds
                          │
                 React dashboard (polls every 3s): inbox, filters, reply, assign, resolve
```

```
server/
  src/schema.sql            tables: contacts, conversations, messages, status_events
  src/stateMachine.js       lifecycle rules (pure functions, unit-tested)
  src/services/conversations.js   ingest, reply, status, assign, inbox queries, stats
  src/routes/webhook.js     Instagram webhook: verification, signature check, parsing
  src/routes/api.js         REST API used by the dashboard
  src/scheduler.js          overdue detection
  src/senders/              how replies are delivered (simulated now, Instagram in Phase 4)
  simulator/generate.js     builds SYNTHETIC DMs (seeded, labelled by intent)
  simulator/simulate.js     replays them as Instagram-shaped webhook events
  test/                     node:test suites (run against real Postgres via PGlite)
client/src/                 React dashboard
```

---

## Key design decisions (useful for your report and viva)

1. **"Overdue" is a timer, not a status.** The statuses are `NEW → OPEN → WAITING_ON_CUSTOMER → RESOLVED`. Both a NEW and an OPEN chat can be overdue, so overdue is a separate flag computed from `needs_reply_since`. Making it a status would lose the information about which stage the chat was in.

2. **`needs_reply_since` is the core of the system.** It holds the time of the oldest unanswered customer message. A reply clears it, and a new customer message sets it again if it's empty. The "Needs reply" view, the overdue check, response-time metrics and inbox ordering all come from this one column.

3. **Inbox order: overdue first, then longest-waiting.** Instagram sorts newest first, which pushes old unanswered chats out of sight. Reversing that order is the main product idea.

4. **Idempotent webhooks.** Meta retries webhook deliveries. `messages.platform_message_id` is `UNIQUE`, and inserts use `ON CONFLICT DO NOTHING`, so a retry never creates a duplicate. *Tested: 30 messages + 5 re-deliveries → 30 stored.*

5. **No race when a new customer sends two messages at once.** `conversations.contact_id` is `UNIQUE`, and creation uses `INSERT … ON CONFLICT` followed by `SELECT … FOR UPDATE`.

6. **Replies are tracked in three steps: PENDING → send → SENT/FAILED.** The database lock is never held during the network call. A failed send is recorded and visible, and the chat stays in "Needs reply" so it can't be lost.

7. **The 24-hour messaging window is enforced.** The API refuses normal replies more than 24h after the customer's last message, and the dashboard shows the time left. (Verify Meta's current policy before Phase 4.)

8. **Webhook security.** The `GET` verification handshake and the `X-Hub-Signature-256` HMAC check are implemented, with a constant-time comparison. The signature check is disabled only when `IG_APP_SECRET` is empty, and the server warns about this at startup.

9. **Every status change is logged** in `status_events`, which supports auditing and later analysis.

## Phase 2: message types and priority

```
DM ─▶ classify(text) ─────────────▶ messages.intent (+ confidence, source)
        │  model if confident            │
        │  else keyword rule             ▼
        │  else model guess, flagged   conversation topic + "customer is chasing" ─▶ priority
        ▼                                                                             URGENT / NORMAL / LOW
   trained in Python (ml/), runs in Node from model.json
```

10. **The model is trained in Python and runs in Node.** scikit-learn trains it. The result is just numbers (vocabulary, idf, coefficients), and `server/src/classifier/index.js` does the same arithmetic. A **parity test** fails if the JS and Python probabilities differ by more than 0.0001, so the two can't silently drift apart.
11. **Context rules handle what text can't.** "hi" and "hello??" mean different things when the customer has already waited 2 hours. A greeting or follow-up arriving while an earlier message is unanswered marks the customer as **chasing**, which makes the chat URGENT. A follow-up never replaces the conversation topic ("??" after "price?" is still a price chat). An unanswered complaint stays the topic.
12. **Priority orders the inbox without hiding anything.** The order is overdue first, then URGENT > NORMAL > LOW, then longest-waiting. A NORMAL chat that waits too long becomes overdue and jumps above everything non-overdue. Likely-spam chats are still flagged overdue and counted, but they don't jump the queue. A real customer the model mistook for spam can still be found in the Overdue view.
13. **Human corrections are stored next to the prediction, never over it.** Agents can fix any label from the message bubble. The correction wins immediately, model errors stay measurable (`/api/stats` → `labels`), and corrected rows export as real training data (`/api/labels.csv?corrected=1`).
14. **Older messages are labelled at startup.** Messages stored before the classifier existed are classified once, so a Phase 1 database upgrades in place (the schema uses `ADD COLUMN IF NOT EXISTS`).

**Evaluation (synthetic data, details and caveats in [ml/reports/phase2_evaluation.md](ml/reports/phase2_evaluation.md)):** the server's decision policy reaches 76% accuracy and 74% macro-F1 on held-out phrasings. However, complaint recall is only 22%, and the keyword rules it uses are leaked. Real, anonymised data is needed for a trustworthy number. See [ml/README.md](ml/README.md).

## Dashboard UX for high-volume inboxes

- **Work through the queue, not around it.** After you send a reply or resolve a chat, the next conversation opens automatically. You can turn this off under the reply box; the setting is remembered.
- **Keyboard:** `j`/`k` next/previous, `r` reply, `Ctrl+Enter` send, `e` resolve, `/` search, `Esc` back, `?` show all shortcuts.
- **Undo** after resolving. Reopening restores the reply timer, the overdue flag and the "chasing" flag, so an accidental resolve can't make a customer disappear (this is covered by a test).
- **Why is this chat on top?** Each row shows one waiting time (red when overdue) plus Overdue / Chasing / message-type tags. The status tag is hidden in action views, where every row needs a reply anyway.
- **Unsent drafts are kept per conversation** while switching chats. A failed delivery has a "Try again" link that puts the text back in the reply box.
- **Honest states:** a loading skeleton instead of a false "Inbox zero", and empty states that say what an empty view means.
- **Phone layout:** the inbox list and the conversation show one at a time, with a back link, and the page never scrolls sideways. On tablets the less important stats are hidden.
- **Dark mode** follows the system setting. The tab title shows how many customers are waiting, e.g. "(38) DM Manager".

## Metrics the dashboard already measures
- Conversations needing a reply, overdue conversations, and how long the oldest one has waited
- Median reply time (per customer message turn)
- Share of replies sent within the SLA
- Median first-response time (`/api/stats`)

These are your **evaluation metrics**. Measure them for a business before and after using the tool.

---

## Known limitations (Phase 1, by design)
- **No login yet.** "Signed in as" is a dropdown. Add real authentication before any real customer data touches this.
- **Polling, not push.** Refreshing every 3 seconds is fine for a small team. Server-Sent Events or WebSockets would come later.
- **Inline webhook processing.** At high volume, put a queue between the webhook and the database (respond 200 at once, process in a worker).
- **Text only.** Attachments are stored as `[attachment]`.
- **Synthetic data.** It's good for building and demos, **but don't report model accuracy on it** in Phase 2. Collect a small real, anonymised, consented set for evaluation.
- **Simulator-only `username`.** Real webhooks contain only the user ID, so Phase 4 must look up profile names through the API.

## Roadmap
| Phase | Scope |
|---|---|
| 1 ✅ | Inbox, lifecycle, overdue detection, simulator, metrics |
| 2 ✅ | Intent classification: keyword baseline vs. TF-IDF + logistic regression (template-grouped CV, error analysis), priority and "chasing" rules, agent corrections → real training data |
| 2b | Retrain and evaluate on real anonymised messages; try multilingual sentence embeddings (small transformer) |
| 3 | FAQ templates, suggested replies, priority ranking, overdue notifications |
| 4 | Real Instagram integration (Meta developer app, webhooks, Send API, App Review), pilot with one business, before/after measurement |
