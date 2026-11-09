# DM Manager: Instagram DM inbox for high-volume business accounts

**Problem.** Small businesses that get 500+ Instagram DMs a day can't keep up by hand. Some customers never get a reply, some get one late, and follow-ups get forgotten.

**Phase 1 goal.** Make sure *no conversation can be forgotten*. Every chat has a lifecycle status and a reply timer, and the inbox always shows the customer who has waited longest first.

> Capstone, Phase 1 of 4. Message classification (Phase 2), reply assistance (Phase 3) and the live Instagram connection (Phase 4) build on this foundation.

---

## Run it

Needs Node.js 20+ (built on 24). No database install: it uses **PGlite**, which is real PostgreSQL compiled to WebAssembly and runs inside Node.

```bash
npm install                      # installs server + client (npm workspaces)
cp server/.env.example server/.env
npm run dev:server               # API on http://localhost:4000
npm run dev:client               # dashboard on http://localhost:5173  (second terminal)
npm run simulate                 # replay synthetic DMs (third terminal)
npm test                         # 15 automated tests
```

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
| 2 | Intent classification (price / size / COD / order status / complaint / collab / spam…): keyword baseline vs. TF-IDF + logistic regression vs. small transformer, with error analysis |
| 3 | FAQ templates, suggested replies, priority ranking, overdue notifications |
| 4 | Real Instagram integration (Meta developer app, webhooks, Send API, App Review), pilot with one business, before/after measurement |
