# DM Manager: Instagram DM inbox for high-volume business accounts

**Problem.** Small businesses that get 500+ Instagram DMs a day can't keep up by hand. Some customers never get a reply, some get one late, and follow-ups get forgotten.

**Phase 1 goal.** Make sure *no conversation can be forgotten*. Every chat has a lifecycle status and a reply timer, and the inbox always shows the customer who has waited longest first.

**Phase 2 goal.** Sort every DM by type (price, size, COD, order status, complaint, spam…), so complaints and customers chasing a reply rise to the top, and agents can filter the inbox.

**Phase 3 goal.** Answer the same questions faster: saved replies suggested by message type, and alerts when chats go overdue.

**Phase 4 goal. Connect to real Instagram: send replies through Meta's API, count replies typed in the Instagram app, show real usernames, and require agents to sign in.

> Testing and evaluation results (coverage, load test, security checks, what's not yet evaluated): [docs/EVALUATION.md](docs/EVALUATION.md).
>
> Capstone: Phases 1–3 and the Phase 4 code are done. Going live still needs a Meta developer app and a test account: see [docs/INSTAGRAM_SETUP.md](docs/INSTAGRAM_SETUP.md). For presenting, see [docs/DEMO.md](docs/DEMO.md).

---

## Run it

Needs Node.js 20+ (built on 24). No database install: it uses **PGlite**, which is real PostgreSQL compiled to WebAssembly and runs inside Node.

```bash
npm install                      # installs server + client (npm workspaces)
cp server/.env.example server/.env
npm run dev:server               # API on http://localhost:4000
npm run dev:client               # front page http://localhost:5173, dashboard /app  (second terminal)
npm run simulate                 # replay synthetic DMs (third terminal)
npm test                         # 76 automated server tests
npm run loadtest                 # 5,000+ DMs: nothing lost or duplicated, timings
npm run demo:reset               # fresh, realistic demo inbox (server stopped)
```

**Login.** `server/.env.example` has `AUTH=on`: create an account first (stop the API server while you do, see below) with

```bash
npm run agent -- add Asha        # prints a generated password once
```

For a local demo with simulated data only, `AUTH=off` skips login and shows a "pick who you are" menu instead. The server refuses to start with `AUTH=off` when `SENDER=instagram`.

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

## Deploy a permanent demo link (Render, free)

`render.yaml` sets everything up: one web service that runs the API and serves the built
dashboard, plus a free PostgreSQL database (the embedded one needs more than the free plan's
512 MB of memory). The synthetic demo inbox is loaded at startup, and reloaded when it is
older than 6 hours, so chats never sit past Meta's 24-hour reply window.

1. Sign in at https://render.com with GitHub.
2. **New → Blueprint**, pick this repository, click **Apply**.
3. When the build finishes, the link is `https://<service-name>.onrender.com` (front page) and `/app` (dashboard).

Free instances sleep after ~15 minutes without visitors; the first visit after that takes
about a minute to wake up. Render's free databases have had a time limit (30 days), so check
their current policy and recreate or upgrade the database when it expires. For real customers use
`AUTH=on`, a hosted PostgreSQL (`DATABASE_URL`) and the Instagram setup guide.

To run the production build locally: `npm run build`, then
`SERVE_CLIENT=true DEMO_SEED=true npm start` and open http://localhost:4000.

## Architecture

```
Instagram ──webhook──▶ Express API ──▶ PostgreSQL (PGlite in dev)
(or the simulator)        │                 ▲
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
  src/senders/              how replies are delivered (simulated, or Instagram)
  src/instagram/client.js   Meta API calls: send a DM, look up a username
  src/services/profiles.js  fills in usernames for new customers
  src/auth.js               agent accounts (scrypt), sessions, login throttling
  scripts/agent.js          npm run agent -- add|reset|disable|enable|list
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

7. **The 24-hour messaging window is enforced.** The API refuses normal replies more than 24h after the customer's last message, and the dashboard shows the time left. (Re-check Meta's current policy before going live.)

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

## Phase 3: saved replies and alerts

- **Saved replies.** Up to 3 are suggested above the reply box, matched to the conversation's message type (complaint → apology, COD → delivery info) and ranked by use. Insert one by clicking or pressing **1–3**. `{name}` becomes the customer's @handle, and the first `[placeholder]` is selected so the agent types over it. Manage them from the ⚡ button. A starter set is added on first start: edit it to match the shop.
- **Rule-based on purpose, not generated.** Nothing can invent a price or a policy, the agent always sees and edits the text, and each sent message records which saved reply it came from and whether it was edited.
- **Measured.** `GET /api/stats` → `templates` gives the share of replies started from a saved reply, how often they were edited, and the median reply time with and without one. Compare these in a pilot. Don't treat the generated demo data as a result.
- **Overdue alerts.** The bell turns on alerts when more chats become overdue or urgent: a desktop notification if the tab is in the background (and allowed), otherwise a message in the tab. It never alerts for chats that were already overdue when the page opened.

## Team workspace

Features a team needs once several people share one inbox:

| Feature | Where | Why |
|---|---|---|
| **Follow-up reminders** | Details panel: in 1 h / 4 h / tomorrow 10:00 / 3 days / any time | The original problem: follow-ups get forgotten. When a reminder is due the chat shows in **Follow-ups due** (banner + alert). It clears itself when the customer writes, when someone replies, or when the chat is resolved. |
| **Team notes** | Details panel, or press **n** | Context for teammates ("replacement approved"). Never sent to the customer. With login on, only the author can delete a note. |
| **Customer details** | Details panel | First seen, messages and replies, current wait, and **order numbers** found in the customer's messages (click to copy). |
| **Activity timeline** | Details panel | Who opened, replied, resolved, set reminders, and when, from the audit log (`status_events`). |
| **"Also viewing" warning** | Chat header, eye icon in the list | Two agents replying to the same customer at once looks unprofessional. Shown when another agent opened the chat in the last 15 s (kept in memory: fine for one server process). |
| **Assigned to me** | More → Assigned to me, press **a** to take a chat | Each agent finds their own work. |
| **Bulk actions** | Hover a row → checkbox, or press **x** | Resolve, assign, or mark many chats as spam at once. Spam labels go in as corrections, so they become training data. One failure doesn't stop the rest. |
| **Draft marker** | List | Shows which chats have an unsent reply in progress. |
| **Report CSV** | Overview → Report (`GET /api/report.csv`) | One row per conversation: first reply time, replies, median reply time, saved replies used. No message text. For the evaluation chapter. |

## Phase 4: connecting to real Instagram

What the code does now (setup steps are in [docs/INSTAGRAM_SETUP.md](docs/INSTAGRAM_SETUP.md)):

| Piece | How it works | Why |
|---|---|---|
| **Sending** | `SENDER=instagram` posts each reply to Meta's messages endpoint. Token in an `Authorization` header (never in the URL or logs), 10 s timeout. | Errors keep Meta's message and say if a retry makes sense (429/5xx) or not (bad token, window closed). A failed send stays visible with "Try again", and the chat keeps its reply timer. |
| **Replies typed in the Instagram app** | Meta sends every outgoing message back as an *echo* webhook. Echoes count as replies, shown as "Instagram app". | Without this, a teammate answering from their phone would leave the chat "waiting" forever, and the metrics would be wrong. |
| **No double counting** | Our own replies echo back with the same message id, which is `UNIQUE`. If the echo arrives *before* our send call returns, the send step merges it. | Tested both orders. |
| **Out-of-order webhooks** | A reply only answers customer messages sent *before* it. Later ones keep their timer. | Webhooks aren't guaranteed to arrive in order. |
| **Usernames** | Looked up once per new customer after the webhook is answered. A failed lookup waits an hour before retrying. | Webhooks only carry a numeric id, and Meta wants a fast 200. |
| **Login** | Accounts with scrypt-hashed passwords. Session = random token in an `HttpOnly`, `SameSite=Lax` cookie, and only its SHA-256 is stored. 5 failed attempts per name per address in 15 min → locked out. Changes must be JSON. | The server decides who acted (from the session), not the browser, so "sent by" and assignment can't be faked. |
| **Safe startup** | `SENDER=instagram` refuses to start without `IG_APP_SECRET`, `IG_ACCESS_TOKEN` and `AUTH=on`. A port already in use stops startup with an error. | Fails loudly instead of running half-configured. |

## Known limitations
- **Polling, not push.** Refreshing every 3 seconds is fine for a small team. Server-Sent Events or WebSockets would come later.
- **Inline webhook processing.** At high volume, put a queue between the webhook and the database (respond 200 at once, process in a worker).
- **Text only.** Attachments are stored as `[attachment]`.
- **Synthetic data.** It's good for building and demos, **but don't report model accuracy on it** in Phase 2. Collect a small real, anonymised, consented set for evaluation.
- **Automatic replies count as replies.** If the account uses Instagram's own automated messages (e.g. instant replies), their echoes clear the reply timer too. Turn those off, or filter them out once you've seen what their echo looks like with your account.
- **Token refresh is manual.** Long-lived Instagram tokens expire (about 60 days at the time of writing) and must be refreshed. See the setup guide.
- **Login throttling is in memory.** It resets when the server restarts and isn't shared between several server processes. That's fine for one server; use Redis or the database when scaling out.
- **Agent accounts are managed from the command line.** There's no admin screen yet.

## Roadmap
| Phase | Scope |
|---|---|
| 1 ✅ | Inbox, lifecycle, overdue detection, simulator, metrics |
| 2 ✅ | Intent classification: keyword baseline vs. TF-IDF + logistic regression (template-grouped CV, error analysis), priority and "chasing" rules, agent corrections → real training data |
| 2b | Retrain and evaluate on real anonymised messages; try multilingual sentence embeddings (small transformer) |
| 3 ✅ | Saved replies suggested by message type (usage and edits tracked), overdue/urgent alerts, demo reset |
| 4 ✅ code | Instagram send API, echo handling, username lookup, agent login. Tested with fakes, not yet against Meta |
| 4b | Meta developer app + test account (live demo), App Review, pilot with one business, before/after measurement |
