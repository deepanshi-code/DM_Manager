# Demo script (about 8 minutes)

Two layers, so the demo survives a bad network:

- **Layer A (main, offline):** the simulator and the demo inbox.
- **Layer B (2 min, optional):** a real DM from a phone, once the Instagram setup in [INSTAGRAM_SETUP.md](INSTAGRAM_SETUP.md) works.

Record a screen video of both layers the day before, as a backup.

## Before you present (10 minutes earlier)

`server/.env` should contain `SLA_SECONDS=120` (chats go overdue after 2 minutes) and `AUTH=off`, unless you want to show login.

```bash
npm run demo:reset
```
```bash
npm run dev:server
```
```bash
npm run dev:client
```
Open http://localhost:5173 (the front page, good for the opening "problem" minute), click **Open the dashboard** (or go straight to http://localhost:5173/app), then:
- Turn on the bell (overdue alerts).
- Zoom the browser so the back row can read it (Ctrl + plus, about 125%).
- Keep a third terminal ready for `npm run simulate`.
- Optional: copy the link of a chat you want to jump to (the address bar shows `/app?c=<id>` while it is open), so you can reopen it in one step.
- Open the hosted demo (https://dm-manager-pfwi.onrender.com/app) in a second tab as a fallback. The free instance sleeps when idle, so open it early to wake it up.

Start the server about 2 minutes before you begin, so the new chats turn red while you talk.

## Run of show

| Time | Show | Say (in your own words) |
|---|---|---|
| 0:00 | Title / problem slide | "Shops get 500+ Instagram DMs a day. The Instagram inbox shows newest first, so the customer who waited longest is buried. Some never get a reply, and nobody knows." |
| 0:45 | **Overview** | "This is today's picture: how many are waiting, how many are overdue, the longest wait, and how often we reply within the target." |
| 1:30 | **Inbox order** | "Overdue chats come first, then urgent ones (complaints, customers chasing us), then whoever has waited longest. Newest-first is exactly what makes chats get forgotten." |
| 2:00 | Run `npm run simulate -- --count 15 --interval 1500` | New DMs arrive live. Point at the type labels (price, size, complaint…) assigned automatically. |
| 2:45 | Open a chat. Press **1** to insert a saved reply, type the price over `[price]`, then **Ctrl+Enter** | "Common questions take one key. The agent still sees and edits everything. Nothing is sent automatically." The next chat opens by itself. |
| 3:45 | Press **e** to resolve, then **Undo** in the message at the bottom | "Mistakes are cheap: Undo brings the chat back with its reply timer." |
| 4:00 | Open the details panel on a complaint: point at the order number, add a team note (**n**), set a reminder "In 1 hour" | "This is the follow-up problem from the start: the chat comes back by itself if the customer goes quiet, and the team sees the context." |
| 4:15 | A chat turns red, and the alert appears | "If nobody answers within the target time, the chat turns overdue and the team is alerted." |
| 4:45 | Fix a wrong message type in a chat | "When the classifier is wrong, the agent corrects it. Corrections are stored next to the prediction, so they become real training data." |
| 5:30 | **Evaluation slide** (numbers from `ml/reports/phase2_evaluation.md` and `docs/EVALUATION.md`) | The server's labelling policy (complaint keyword, then the model if it is confident, then keyword rules, then the model's guess) reaches 79.2% accuracy, 78.1% macro-F1 and 54.1% complaint recall on the synthetic test set; before the code-review fix complaint recall was 21.6%. The honest limits: the data is synthetic, the keyword rules were written after seeing all templates (so these numbers are optimistic), and about half of complaints are still missed. Then the testing in one line: 90 server tests and 11 Python tests pass, a load test passes all 6 correctness checks, and an independent review found 26 defects, all fixed. Real data is the next step. |
| 6:30 | **Layer B (optional):** a phone DM → dashboard → reply → phone | "This is the real Instagram API. A reply typed in the Instagram app also counts, so the dashboard never shows a chat as waiting when it was answered on a phone." |
| 7:30 | Wrap up | What's done, what you'd measure in a pilot (below), and what's next. |

## Numbers: say where they come from

- The overview numbers after `demo:reset` (and on the hosted demo, which reloads its synthetic inbox when it was loaded more than 6 hours ago) come from **generated demo data**. They show what the dashboard measures, not results. Say so if asked.
- The model scores come from the **synthetic test set**, which is split by template so the model is never tested on the sentences it learned from. They are not real-world accuracy, and the keyword-rule and server-policy scores are optimistic because the rules were written after seeing all templates.
- Load-test speed varies between laptop runs (latest 180 events/s, p95 139 ms; an earlier run 103 events/s, p95 227 ms). Lead with the 6 correctness checks, which all pass, and quote speed as a range rather than one figure.
- What a real pilot would measure, for one shop, one week before and one week after: median reply time, % of replies within target, customers never answered, and % of replies sent from saved replies (the dashboard already records this).

## Likely questions

| Question | Short answer |
|---|---|
| Why not just use the Instagram / Meta Business Suite inbox? | It's ordered by newest message, has no reply timers or overdue list, and doesn't track follow-ups or measure reply times per agent. |
| Why not have an LLM write the replies? | Saved replies can't invent prices or policies, the agent always approves the text, and usage is measurable. An LLM draft could be added later behind the same "agent approves" step. |
| How do you know the classifier works? | Template-grouped split, a keyword baseline for comparison (76.6% accuracy, 54.1% complaint recall), error analysis, and corrections collected from agents. The server combines keyword rules and the model, so a complaint keyword always wins; this raised complaint recall from 21.6% to 54.1%. The limits (synthetic data, leaked rules, half of complaints still missed) are reported, not hidden. Real data is the next step. |
| How was it tested? | 90 server tests and 11 Python tests, all passing (94.2% line coverage); a load test with about ten days of traffic, duplicates included, passing all 6 correctness checks; a browser walkthrough; and an independent pre-submission review in which each reported defect was checked by three skeptics. It confirmed 26 defects, all fixed (`docs/EVALUATION.md`, section 6a). |
| What if Meta delivers a webhook twice, or out of order? | Every message id is unique in the database, so repeats are ignored. A reply only answers messages sent before it. Both cases are tested. |
| Is customer data safe? | Webhook signatures are checked, agents sign in (hashed passwords, HttpOnly session cookie), the token stays in `.env`, and the anonymiser runs before anything leaves the shop. |
| What doesn't it do yet? | Real-data evaluation, Meta App Review for other shops' accounts, push updates instead of polling, and an admin screen for accounts. |

## If something breaks

| Problem | Fix |
|---|---|
| Dashboard says "Is the server running?" | Start `npm run dev:server`. If it says the port is in use, an old server is still running: close that terminal. |
| `PGlite failed to initialize` | Stop the server, run `npm run demo:reset` (it keeps the old data in `.data/pglite-previous`), start again. |
| Wi-Fi down, so no live Instagram | Skip Layer B and play the recorded video. |
| Local setup fails completely | Use the hosted demo (https://dm-manager-pfwi.onrender.com/app). It runs on synthetic data with login off; it may take a while to wake if it was idle. |
| Everything is red before you start | You started the server too early. That's fine: run `npm run demo:reset` again with the server stopped. |
