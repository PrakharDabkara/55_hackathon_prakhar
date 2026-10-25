# ADR-0067: App round 2: AI failure is not "unclear", three active searches, ask now

Status: accepted. Amends ADR-0045 (a doubtful classifier no longer ends "exactly what I typed" in "couldn't understand") and ADR-0029 (a classifier outage is `ai_busy`, still fail closed).

## Context

Prakhar's functional test of Find and the shop replies. "Walnuts, 500g" and "Mobile phone" (after about 40 s) both said "We couldn't understand that item". A search with a photo failed with "Something went wrong" and no ref, and every later search failed. A request showed "No shops asked" and "All shops have replied." together, and "no shops" for 20 to 30 s while the shop already had the ping.

## Decision

1. **An AI failure is told apart from an unclear item.** `Resolution.aiFailed` is set when nothing was found and an AI step failed, timed out or hit the per-user limit; `POST /requests` then answers `503 ai_busy` ("Our assistant is busy right now. Please try again in a minute."). `item_unavailable` is replaced by `ai_busy`. A truly unclear text is still `422 item_unresolved`.
2. **One 15 s budget per Find** (`withDeadline`, `AiContext.resolveBudgetMs`). Embedding, resolve and classify share it, so retries and fallbacks never add up to 40 s, and no proxy cuts the request first.
3. **Name hygiene allows everyday punctuation** (`, . - ' ( ) & /` count as a space), so "Walnuts, 500g" reaches the classifier. URLs, emails, long digit runs and other characters are still refused.
4. **"Exactly what I typed" never fails on a merely unsure classifier.** `unsure` files the words under the catch-all (`general_store`, uncategorised, ADR-0046). `nonsense`, `blocked`, the deny list and every sanity check still refuse. This amends ADR-0045; "Something else" stays an exact search.
5. **A retry reuses its key.** The web keeps one `Idempotency-Key` per identical search, so a request the server finished whose answer was lost (the photo case) comes back instead of failing with `photo_taken`. A photo that still cannot be attached is dropped with a clear message.
6. **The server says when the shops are settled.** `requests.fanned_out_at` is set at the end of every fan-out (also with zero shops) and a `request.updated` hint is sent. `asking` in the request view is true until then; the screen shows "Asking shops nearby…", never "no shops" or "all replied". Zero shops asked says "No shops were asked." in both places.
7. **Ask shops now.** `POST /requests/:id/ask` turns an answered-from-memory request with no pings into PINGING (event `ASK_SHOPS`), sets `ask_all` (the shops that remembered it are asked too) and restarts the deadline. 409 `already_asked` once pings exist.
8. **A picked item is the request.** `requests.picked`: the parchi shows the chosen item, with "you typed: …" small.
9. **Three active searches (Prakhar's decision).** Single Finds and sent lists each count as one, errands do not. The server refuses a 4th with `409 search_limit` before any AI call or ping (`ACTIVE_SEARCH_LIMIT` in shared, `activeSearches` injected into the requests and lists contexts). `GET /searches/active` feeds a card per live search on Find ("<item> · n replies · View") that opens `/app/request/:id` or `/app/list/:id`. The back arrow goes home and stops nothing. A 4th search asks which of the three to stop. A wider search stops the empty one first. Every live search has a card, so no shop holds a request the customer cannot see or stop.
10. **"1 shop doesn't have it" is removed**, not filled in: the server does not expose who said no, listing shops that cannot help adds noise, and the count moves into the status line ("All shops have replied. 2 said they don't have it.").
11. **Shop Not available waits 5 s with an Undo bar** (no modal); leaving the screen makes it final.
12. **Demo shop accounts start setup on the demo place** (banner "Demo area · Change"). The simulator spreads within 1.5 km, so seeded and simulated demo shops are within 2 km.

## Alternatives rejected

- **Throw `AiUnavailableError` out of resolve.** Lists, errands and the free steps rely on soft failure.
- **List the shops that said no.** Needs a new field and shows nothing useful.
- **Make "Something else" a normal search.** ADR-0045 decided otherwise; not changed without asking.

## Consequences

- Migration 031 adds `fanned_out_at`, `ask_all`, `picked` to `requests` (old rows are settled).
- A customer with GPS denied no longer re-picks the place for each search (kept in the tab).
- The change touches the resolve pipeline (`resolve.ts`, `openCatalog.ts`, name hygiene): it needs the `evals` label and the final eval run. The errand agent is untouched.
- A search lost to the 3-search limit is a prompt, not an error; users with 3 stale searches wait up to 15 minutes or stop one.
