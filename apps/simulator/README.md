# simulator — fake shops for the live demo and load tests

Node built-ins only (no dependencies). It uses the server's `ADMIN_TOKEN` (from the environment, never a flag), creates simulated shops on the server (or reuses them from a local state file), listens on ONE admin event stream, and answers each ping as that shop through the real `POST /pings/:id/answer`.

```sh
ADMIN_TOKEN=<the server's token> npm run simulate -- --target https://kahanmilega-api.onrender.com --count 200 --speed 10
```

Each shop has a seeded character: it replies to 30-90 % of pings, after 5-90 s (divided by `--speed`), quotes the item's reference price plus or minus 30 %, sometimes adds "a few" or "plenty", and about 5 % of shops always say no. The same `--seed` gives the same shops and behaviour. Ctrl+C stops it cleanly and prints a summary.

Run `npm run simulate -- --help` for every option. The state file (`apps/simulator/.sim-state.json`, git-ignored) holds the fake shops' login tokens, so keep it private. See the runbook: "Run the simulator against the live site".
