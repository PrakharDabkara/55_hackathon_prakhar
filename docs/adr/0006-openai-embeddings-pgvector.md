# 0006. OpenAI embeddings stored in pgvector

Status: Accepted · 2026-10-12

## Context

Query understanding matches free text to known items by embedding similarity before falling back to the LLM. Anthropic has no embeddings API.

## Decision

Use OpenAI `text-embedding-3-small` and store vectors in Postgres with pgvector.

## Consequences

- No extra database; vectors live next to shops and stock and can be joined in SQL.
- A second AI provider and API key to manage (`OPENAI_API_KEY`).
- Changing the embedding model means re-embedding the catalog.
