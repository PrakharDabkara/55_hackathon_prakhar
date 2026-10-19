# 0037. Clean-up before the UI overhaul (Day 17, PR I)

Status: Accepted · 2026-10-19 · no new dependency, no migration. Touches resolve and the errand agent: `evals` and `agent-evals` labels needed.

## Decisions

1. **An identical tool call is answered from the first result.** In the errand executor, `resolve_item`, `find_item_nearby`, `ask_shops`, `get_request_status` and `plan_route` called again with the same arguments return the earlier result, are not run, and count against no cap. `find_item_nearby` and `get_request_status` repeat only within one stretch of the conversation (a resume, when shops answered, starts a new one). The step is still logged (the model needs a result for every call) with `replayed: true`; progress lines ignore it and the agent eval no longer counts it as `repeated_call` (it reports `replays`). The memory is rebuilt from the step log, so it survives a restart.
2. **d18 (school project).** The Evals run 39212188514 report names only the failure kind (`missing_item`), not the item, so the cause is inferred, and the report now says which (`missing`, `planSlugs`). The two likely causes are fixed generally: "colours" had no meaning of its own and went to the model (now the default for colour pencils, like "pen"), and the usual extras were left unticked (the checklist rule is now general, ADR-0038: preselect what was named and what the goal cannot do without). The next run's report shows whether that was it.
3. **Resolve dev misses** (PR #38 run, dev only). `plumber`, `dentist`, `electric car` reached the model and got a question: texts that are no product by code (`checkProductName`: services, vehicles, places, sentences) now stop before the embedding and model steps. A model question is only for 3 words or fewer ("ice cream scoop holder" is a missing product, not a question). The resolve prompt says a brand is not the generic item of its kind (`mentos` was chewing gum). `phone cover` is a catalog item, so the dev case was relabelled.
4. **e2e on any database.** Offer, photos and errand-open-catalog use a corner, shop name and new-item name of their own per run (`e2e/unique.ts`, `newCorner`); the scripted model takes the new item's name from the task (`{{kit}}`). The suite passed four times in a row on one database, including the one earlier runs had polluted.
5. **The flaky errandPatience test** was a race in the test: the errand turns to PLANNING first and the job is queued a moment later, and the test read the queue at once. It now waits for the job.
6. **"Dukaan ne jawab diya" during an errand.** The push was suppressed while the customer had any running errand. It is now suppressed only for requests the errand opened (the existing `errand_requests` link, so no new column).

## Alternatives rejected

- **Caching every tool call forever:** after shops answer, `find_item_nearby` and `get_request_status` must be able to see it.
- **A new `errand_id` column on requests:** `errand_requests` already links them.
