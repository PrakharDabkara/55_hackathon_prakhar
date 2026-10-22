# Security

## Reporting a problem

Please do not open a public issue for a security problem. Email **prakhar.dabkara@fiftyfivetech.io**. Say what you found, how to repeat it, and what it lets someone do. Do not test against other people's accounts; the live site is a demo, so use your own.

If you find a secret (a key or token) in the repository or its history, say so in the report; do not use it.

## What we keep

| Data                                                    | Why                                                                                                       | How long                                                                |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Your phone number                                       | Login. Shops never see it. The app shows it partly hidden.                                                | Until you delete your account (ADR-0054), which erases it.              |
| One-time codes                                          | Login. Stored as a hash; a readable code exists only for demo numbers.                                    | 5 minutes, then ignored.                                                |
| Login sessions                                          | Stay logged in. Stored as a hash of the token.                                                            | 30 days, or until you log out (one device, or all devices in Account).  |
| What you searched for, your rough location, the replies | Show shops with the item. A shop sees the item and a rough distance, not you.                             | A request is open 15 minutes.                                           |
| Photos you add                                          | Shown to the shops asked. Re-encoded on our server; location data is removed.                             | 7 days after the request ends.                                          |
| An order's address and first name                       | Delivery. A shop sees them only after it accepts the order.                                               | Cleared 30 days after the order ends.                                   |
| An address you chose to remember                        | Next time. Off unless you tick it.                                                                        | Until you remove it or delete your account.                             |
| Reply alerts (a browser's push address)                 | Tell you when a shop answers.                                                                             | Until you turn them off, log out of that device, or log out everywhere. |
| Model calls: purpose, tokens, time, outcome             | Cost and reliability. Never the text sent.                                                                | Kept.                                                                   |
| Server logs                                             | Debugging. Request id, path, status, ids. No phone, token, code, address, note or search text (ADR-0060). | Set by the host.                                                        |

The text of a search or an errand is sent to a language model (Google Gemini, free tier, which Google may review). Before every request a guard blocks any text with a phone number, an email, coordinates or a contact or address field; shop names are cleaned and quoted as data (ADR-0060).

## Demo mode: what it is and is not

The live site is a demo, not a production service.

- **There is no SMS.** Login codes are simulated: only the numbers in `DEMO_PHONES` can read their code (`/dev/otp-inbox`). Any other number gets a normal-looking answer but no readable code, so a stranger cannot log in as someone else. Do not enter a real number you care about.
- **Admin** is a secret token (`ADMIN_TOKEN`), not a phone login, and is switched off unless configured.
- **Shops can be simulated** (`is_simulated`): fake shops that answer pings so the demo has activity. Their answers are not real stock.
- Limits per user and per network address apply to every route (ADR-0058, ADR-0059). They protect the model quota and are part of what the demo promises.
- Hosting is a small free-tier setup: no uptime promise.

Before real customers: real SMS, an agreement with the model vendor that forbids using prompts for training, and a paid tier with the data controls that come with it.
