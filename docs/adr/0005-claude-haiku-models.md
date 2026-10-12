# 0005. Claude Haiku 5.5 for parsing and digests

Status: Accepted · 2026-10-12

## Context

LLM calls handle query understanding, reply parsing and the weekly demand digest. Token cost per search is a product metric we want to drive down.

## Decision

Use Claude Haiku 5.5 for all three. Move a task to Sonnet 5.5 only if its eval set shows Haiku falls short. The LLM is always the last path, after cache, rules and embeddings.

## Consequences

- Lowest cost per call; the model choice is backed by eval results, not guesswork.
- Requires labeled Hinglish eval sets and accuracy gates in CI before any model change.
- Shop and user text is passed as data, never as instructions.
