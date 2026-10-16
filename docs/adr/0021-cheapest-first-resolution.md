# 0021. Cheapest-first resolution: cache → synonyms → trigram → embeddings → LLM

Status: Accepted · 2026-10-15 (extends ADR-0014). Day 10 (ADR-0022) added the `default` step after trigram, a nonsense guard, and cache expiry with a catalog version; the 'Known misses' below are fixed there.

## Context

ADR-0014 resolved text to a catalog item with synonyms and trigram similarity and left the rest unresolved. Searches such as "pen", "clip", "doodh wala packet" or a typo in a short word need meaning, not spelling. Every AI step must start with the cheapest path (brief), so the LLM is the last resort and its answers are remembered.

## Decision

`resolveItem` runs these steps in order and records the one that answered in `search_queries.matched_by` (`cache`, `synonym`, `trigram`, `embedding`, `llm`; NULL when unresolved):

1. **Cache** (`query_cache`, keyed by the normalised text): an earlier answer of step 4 or 5. It can hold an item, "nothing fits", or a question with its options.
2. **Exact synonym** (unchanged).
3. **Trigram** with the ambiguity rules of ADR-0014 (unchanged). The weaker candidates are kept for the shortlist.
4. **Embedding.** Embed the query (`RETRIEVAL_QUERY`), take the 5 nearest items by cosine (`items.embedding`, HNSW). Resolve when the best similarity is at least `EMBED_THRESHOLD` **and** ahead of the second by at least `EMBED_MARGIN`. Items are embedded from name, Hindi name and synonyms by `npm run ai:embed-catalog` (a source hash makes a second run free; the deploy job runs it after seeding).
5. **LLM.** Shown the query and a shortlist of at most 10 items (id, English and Hindi name, category) from steps 3 and 4. It answers JSON `{itemId | null, needsClarification, question?, optionIds?}`, validated with zod. **Every id must be in the shortlist or the answer is rejected** (`invalid_output`, nothing cached). The prompt says: variants of one thing (pen: ball or gel) → pick the most common; ask only when the candidates are genuinely different things (clip: paper, clothes, hair). "Nothing fits" is a valid answer.
6. **Unresolved.**

Around it:

- **Cache writes.** A successful embedding or LLM answer is cached, so the same query never costs a call again; the LLM's "nothing fits" and questions are cached too. A failure is never cached.
- **Suggested synonyms.** Every query the LLM resolved to an item is inserted into `suggested_synonyms` for a person to review. Nothing is added to the catalog automatically.
- **Safety.** The query is data, not instructions: capped at 100 characters, control characters stripped (one line), the delimiter marks removed, wrapped in `<<<QUERY ... QUERY>>>`, and the system prompt says to ignore instructions inside it. The shortlist check is the hard guard: whatever the text says, the answer can only be one of at most 10 items we chose, or null.
- **Per-user limit.** At most 30 LLM resolutions per user per hour (a Redis counter keyed by a hash of the user id; fails open). Over the limit, step 5 is skipped.
- **Degrade, never fail.** Any AI error, timeout, open breaker or invalid answer leaves the query unresolved; the cheaper steps are unaffected.
- **API.** An ambiguous query answers `422 {error: {code: "item_ambiguous", question, options: [{itemId, nameEn, nameHi}]}}` from `POST /requests` and `GET /search`; both accept `itemId` to skip resolution. The seeker app shows the question with the options as big buttons and resubmits with the chosen `itemId`. `GET /admin/ai/stats` reports steps, fallback and cache-hit rates, tokens, latency, errors and breaker skips.

## Tuning (first version of the eval)

`evals/resolve.dev.jsonl` has 81 labelled queries (Hinglish, Devanagari, typos, variants, ambiguous, nonsense, multi-word, quantity phrases, 5 prompt injections). Gemini embeddings are compressed: correct matches scored 0.70 to 0.77 with a gap of 0.04 to 0.13 to the runner-up, while wrong and ambiguous ones scored 0.55 to 0.71 with a gap under 0.02. `EMBED_THRESHOLD=0.70` and `EMBED_MARGIN=0.04` resolve the clear cases and made no wrong resolution on this set; the unsure ones go on to the LLM. The first run with threshold 0.8 sent everything to the LLM. Three queries ("dal", "oil", "battery") were first labelled as variants and relabelled "ambiguous" after reading the answers (different pulses, different oils, AA versus AAA are choices worth a tap); that is tuning on the eval set and is noted here on purpose. The last run, with `gemini-3.1-flash-lite`: 77 of 81 right (95.1%), 23 LLM calls (about 850 tokens each), p95 3.0 s. Known misses: "pen" and "bottle" are sometimes asked about instead of picked (the model is inconsistent on variants), "paper" once failed on an LLM error, and "xyzzy plugh" resolved to plug top because of letter overlap. Day 10 turns this into a CI gate.

## Injection defence (Day 10 addendum)

Two cheap layers sit in front of the shortlist check. (1) The query is cut to its **first line** (the app's box is one line, so a line break means the text is not from the app) and to 100 characters. (2) A pattern check (`looksLikeInstruction`, English, Hinglish and Devanagari: "ignore previous instructions", "system:", "you are now", "answer X", "pichle nirdesh bhool jao" and similar) makes the query skip the embedding and LLM steps; the free steps still answer, and the skip is logged as `llm_skipped_suspicious`. The patterns are a first line of defence, not a guarantee: the shortlist check stays the hard guard.

**Worst case of a successful injection today is a wrong catalog item** from a list of at most 10 we chose: this step has no tools and no data access. That does not carry over to the Day 12 errand agent, which will call tools; it needs its own, stronger guardrails (tool allow-lists, argument validation, no secrets in context, confirmation for side effects).

## Alternatives rejected

- **Embeddings or the LLM first:** tokens and latency on every search, when a dictionary answers more than half (44 of 81 here).
- **Letting the LLM return free text and matching it back:** the id-in-shortlist rule is simple to verify and defeats made-up answers.
- **Adding LLM answers to the synonym table automatically:** one wrong guess would become permanent. A person reviews `suggested_synonyms`.
- **Caching only successes with an item:** "nothing fits" and questions are the expensive repeats (nonsense gets typed again).

## Consequences

- The cache can hold a stale "nothing fits" after the catalog grows; clear it with `TRUNCATE query_cache` after a large catalog change (or delete single rows).
- The shortlist is capped at 10, so an item the first steps do not surface can never be chosen by the LLM; that is by design and the unresolved log shows what to add to the catalog.
- Free-tier LLM latency (2 to 5 s) is added to a search only when the first four steps fail; the seeker sees the question or the unresolved message after it.
