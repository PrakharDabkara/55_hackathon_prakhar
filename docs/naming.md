# Naming: KahanMilega → AskBuy

## Why we changed

"KahanMilega" ("where will I find it?") sounded narrow and informal: it reads as a question about finding one thing, and it is hard to say for anyone who does not speak Hindi. The product does more: you **ask** the shops nearby, then you **buy**. And the shops "lift the shutter online" without building a catalogue. **AskBuy** says both halves in two plain English words.

Names we looked at:

| Name      | Why not                                       |
| --------- | --------------------------------------------- |
| Counter   | Nice for shops, says nothing about asking     |
| Askaround | Close, but long and reads as a chat app       |
| Enquire   | Formal, and it sounds like a form             |
| Scout     | Short, but says nothing about shops or buying |
| Askby     | Looks like a typo of AskBuy and means nothing |

## When

- **PR P** (ADR-0050): the visible brand, `BRAND_NAME`, icons, manifest, taglines.
- **PR Q** (ADR-0051): code, packages, MCP server, CI, compose and docs.

## What changed, and what was kept

| Thing                                                                                     | Now                                                      | Why                                                                                           |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Workspace packages                                                                        | `@askbuy/*`                                              | Internal only                                                                                 |
| MCP server name, bin, env names, login file                                               | `askbuy`, `askbuy-mcp`, `ASKBUY_*`, `.askbuy-login.json` | Old env names and login file still work (migrated on first run)                               |
| Errand prompt, messages, comments, tests                                                  | AskBuy                                                   | Text only                                                                                     |
| CI compose project, local compose project and images                                      | `askbuy-ci`, `askbuy`, `askbuy-postgres`                 | Local volumes keep their old names so data survives                                           |
| Docs (README, runbook, BRIEF, CLAUDE.md)                                                  | AskBuy                                                   | Current docs                                                                                  |
| GitHub repo, Render service and URL (`kahanmilega-api.onrender.com`), `kahanmilega-redis` | **kept**                                                 | Renaming changes the URL, breaks deploys and logs every user out                              |
| Database, role and env var names/values (Render, GitHub environments, `.env.example`)     | **kept**                                                 | They live in running databases and dashboards                                                 |
| Browser storage keys `km-*`, push/VAPID setup                                             | **kept**                                                 | Renaming logs users out and drops push subscriptions                                          |
| Redis channel `kahanmilega:events`                                                        | **kept**                                                 | During a deploy old and new instances would listen on different channels and drop live events |
| Runner cache `$HOME/.cache/kahanmilega-evals`                                             | **kept**                                                 | A new name starts empty and forces a full re-embed against the Gemini quota                   |
| Local Docker volumes `kahanmilega_pgdata`, `kahanmilega_redisdata`                        | **kept**                                                 | They hold the local data                                                                      |
| Old ADRs, journey entries, released CHANGELOG entries, git history                        | **kept**                                                 | They are the record                                                                           |
| Local folder path (and the folder tree in BRIEF.md)                                       | **kept**                                                 | It is the real path on the author's machine                                                   |

`evals/naming.test.ts` fails if the old name shows up anywhere else.
