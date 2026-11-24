# Connecting DM Manager to a real Instagram account

This guide takes you from the simulator to real DMs on a **test account you own**. That's
enough for development and a live capstone demo. Serving another business's account needs Meta's
App Review (step 9).

> **Check against Meta's docs.** Meta renames menus, permissions and API versions fairly often.
> The names below are what this project was written against, from the "Instagram API with
> Instagram Login" docs. Where a step says *(verify)*, confirm it on developers.facebook.com before
> relying on it, and fix this file if it has changed.

---

## What you need

| Item | Notes |
|---|---|
| An Instagram **professional** account (Business or Creator) | Personal accounts can't use the messaging API. Use a new test account, not the business's real one. |
| A second, ordinary Instagram account | To act as "the customer" and send DMs during testing. |
| A Meta developer account | developers.facebook.com, free. |
| A public **HTTPS** address for the API server | Meta must be able to reach `/webhook/instagram`. For testing, a tunnel such as `cloudflared` or `ngrok` works. |

---

## 1. Make the test account professional
In the Instagram app: Settings → *Account type and tools* → switch to a professional account *(verify the menu name)*.

## 2. Allow tools to read the account's messages
In the Instagram app: Settings → *Messages and story replies* → *Message controls* → *Connected tools* → turn on **Allow access to messages** *(verify)*. Without this, webhooks for DMs don't arrive.

## 3. Create the Meta app
1. developers.facebook.com → *My Apps* → *Create app*. Pick the use case for managing messaging on Instagram *(verify)*.
2. Add the **Instagram** product and choose **API setup with Instagram login**.
3. Under *Roles*, add your test professional account (and the "customer" account) as **Instagram testers**, then accept the invites in the Instagram app or on instagram.com *(verify where invites appear)*.
4. Permissions used by this project: `instagram_business_basic` and `instagram_business_manage_messages`.

While the app is in **development mode**, expect it to work only with accounts that have a role on the app. That's why the "customer" account is added as a tester too. For a live demo, add the examiner's account as a tester beforehand, or use your own second account.

## 4. Get the access token and account id
1. In the app's Instagram API setup page, **generate a token** for the test account (a long-lived token).
2. Find the account's id:
   ```bash
   curl -H "Authorization: Bearer $IG_ACCESS_TOKEN" "https://graph.instagram.com/v23.0/me?fields=user_id,username"
   ```
   Use the returned `user_id` as `IG_USER_ID`, or leave `IG_USER_ID=me`.
3. Copy the **App secret** from *App settings → Basic*.

The token and app secret are passwords. Put them only in `server/.env`, which git ignores. Never paste them into chats, screenshots or your report. If one leaks, reset it in the Meta dashboard.

## 5. Make the API reachable over HTTPS
For testing, run a tunnel in a separate terminal:
```bash
cloudflared tunnel --url http://localhost:4000
```
It prints an `https://…trycloudflare.com` address. The address changes each time it starts, so update the webhook URL in step 7 after a restart.

Only the **API server** (port 4000) needs to be public. The dashboard can stay on `localhost:5173/app`. The public API is protected by login, which is why `SENDER=instagram` won't start with `AUTH=off`.

## 6. Configure `server/.env`
```ini
SENDER=instagram
AUTH=on
TRUST_PROXY=1                  # behind the tunnel: correct client IPs and Secure cookies
IG_ACCESS_TOKEN=...            # from step 4
IG_USER_ID=me                  # or the user_id from step 4
IG_APP_SECRET=...              # from step 4: webhook signatures are checked with it
IG_VERIFY_TOKEN=pick-a-long-random-string
IG_API_VERSION=v23.0           # set to the version shown in your app dashboard (verify)
SLA_SECONDS=3600
```
Create at least one agent account with the API server stopped, then start it:
```bash
npm run agent -- add Asha
```
```bash
npm run dev:server
```
The startup log should end with `sender: instagram` and `login: on`. If a setting is missing, the server says which one and doesn't start.

## 7. Register the webhook
In the Meta app's Instagram webhook settings:
- **Callback URL:** `https://<your-tunnel-address>/webhook/instagram`
- **Verify token:** the same value as `IG_VERIFY_TOKEN`
- **Subscribe** to the `messages` field.

Meta calls the URL once to verify it. The server answers the handshake automatically.

Replies typed in the Instagram app reach us as **echo** events (`is_echo: true`). If your app version lists a separate `message_echoes` field, subscribe to it too *(verify)*. Then use the test in step 8 to confirm that echoes arrive.

## 8. Test it end to end
| Do this | Expect |
|---|---|
| From the "customer" account, DM the test account | It appears in the dashboard within ~3 s, first with the numeric id and then the username |
| Reply from the dashboard | It arrives on the customer's phone, and the chat moves to *Waiting on customer* |
| From the **Instagram app**, answer another chat | That chat leaves *To reply*, and the reply shows as "Instagram app" |
| Send a DM, wait more than `SLA_SECONDS` | The chat turns *Overdue* |
| Stop the tunnel, reply from the dashboard | The reply shows *Not delivered* with the reason and *Try again*, and the chat keeps its timer |

If DMs don't arrive: check step 2 (message access), that both accounts are testers (step 3), that the webhook URL matches the current tunnel address, and the server log. A `401` on `/webhook/instagram` means `IG_APP_SECRET` is wrong.

## 9. Before serving a real business (not needed for the demo)
- **App Review:** request advanced access for the messaging permission. Meta asks for a screencast of the app in use and a **privacy policy** URL, and may require business verification *(verify current requirements)*.
- **Consent and data:** the business owns its customers' messages. Agree in writing on what is stored, for how long, and who can see it. Don't export customer text without anonymising it (`ml/anonymize.py`).
- **Hosting:** run the API on a real server with a managed PostgreSQL (`DATABASE_URL`), HTTPS, and backups, not on a laptop tunnel.
- **Token refresh:** long-lived Instagram tokens expire (about 60 days when this was written) and can be refreshed before then *(verify)*:
  ```bash
  curl "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=$IG_ACCESS_TOKEN"
  ```
  This endpoint takes the token in the URL. Run it from your own terminal and don't share the output. Put the new token in `.env` and restart.
- **24-hour window:** normal replies are only allowed within 24 h of the customer's last message, and the app blocks later ones. Meta has a separate "human agent" option for later replies that needs its own approval *(verify)*.
- **Automated messages:** if the account uses Instagram's own automatic replies, their echoes also count as replies. Turn them off, or filter them out.
