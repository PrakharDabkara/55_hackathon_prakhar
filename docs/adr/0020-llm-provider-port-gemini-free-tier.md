# 0020. LLM provider port; Gemini free tier first

Status: Accepted · 2026-10-15 (updates the Models and Embeddings rows of the brief; supersedes ADR-0005 and ADR-0006 for now)

## Context

Query understanding needs a language model and an embedding model for the searches a dictionary cannot answer (ADR-0021). The brief named Claude Haiku and OpenAI embeddings. Both are paid, and this build has no budget for a paid API.

## Decision

- **Money: no paid API.** Google's Gemini free tier serves both generation and embeddings. Claude (or any other vendor) is a future adapter behind the same port, not a rewrite.
- **A provider port**, `LlmProvider`, in `modules/ai`: `generateJson({system, user, schema, maxOutputTokens, purpose})` returns `{data, usage, model, latencyMs}` and `embed(texts, purpose)` returns `{vectors, usage, model, latencyMs}`. The answer is validated with a zod schema. Two adapters: `gemini` (Google's official `@google/genai`, JSON output with a response schema, temperature 0) and `fake` (deterministic, scripted per test; the default outside production).
- **Configuration.** `LLM_PROVIDER` is `gemini` or `fake`; it defaults to `fake` in development and test, and **must be set explicitly in production** (fail closed). `GEMINI_API_KEY` is required when the provider is `gemini`. `GEMINI_MODEL`, `GEMINI_EMBED_MODEL`, `EMBED_DIM` (768), `EMBED_THRESHOLD` and `EMBED_MARGIN` are env vars. Model names are not typed from memory: `npm run ai:models` lists what the key can use.
- **Chosen on 2026-10-15** from that list, by trying them with the key: `gemini-3.1-flash-lite` for generation (a stable name, 1.6 s for a small JSON call, no hidden thinking tokens; `gemini-3.8-flash` took 15 s because it thinks first, `gemini-3.7-flash` and `gemini-3.5-flash` answered 503 under load, and `gemini-2.5-flash` is no longer open to new use) and `gemini-embedding-001` for embeddings (stable, 768 dimensions through `outputDimensionality`, one vector per input; `gemini-embedding-2` folded a batch of two texts into one vector). Changing a model is one env var.
- **Privacy rule for the free tier: prompts may be reviewed by Google, so send only the query text and catalog item names.** Never phone numbers, user ids, locations, prices or shop data. The query is capped at 100 characters. A test records everything a fake provider receives and asserts none of that is present; the audit table has no column for prompt text.
- **Resilience, in one wrapper (`createAiClient`).** An 8 second timeout; one retry with a pause on 429 and 5xx (never on other 4xx); a circuit breaker per kind of call (generate, embed): after 5 failures in a row AI is skipped for 60 seconds, then one trial call decides. **AI failure never fails a search**: every caller degrades to "unresolved". An answer in the wrong shape is `invalid_output`, is not retried and does not open the breaker.
- **`ai_calls` (migration 008).** One row per provider call: purpose, provider, model, tokens, latency, outcome (`ok`, `invalid_output`, `error`, `skipped_breaker`) and the HTTP request id. Cost per search becomes a number we can chart (`GET /admin/ai/stats`).

## Alternatives rejected

- **Claude Haiku and OpenAI embeddings now:** the better-known path, but paid. The port keeps that door open.
- **A local model (Ollama, sentence-transformers):** free and private, but needs a machine with memory and CPU the free hosting does not have.
- **Calling the SDK directly from the resolver:** quicker, but every test would need the network or a mock of Google's types, and switching vendor would touch the resolver.
- **One breaker for everything:** a success of embeddings would keep resetting the count of a failing generate endpoint, so it would never open.

## Consequences

- The free tier has rate limits (a 429 on a burst of embeddings showed this): the catalog script sends small batches with pauses, and live search retries once then degrades.
- Free-tier terms can change; the port, the fake provider and the audit table make a move cheap.
- `EMBED_DIM` is baked into the column type (`vector(768)`); another size needs a migration and a re-embed.
- Each new LLM feature must send only what the privacy rule allows, and gets its own `purpose` in `ai_calls`.
