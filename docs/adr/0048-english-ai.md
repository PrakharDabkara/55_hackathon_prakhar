# 0048. The AI speaks English (Day 22, PR P)

Status: Accepted · 2026-10-20 · supersedes the "strings fed to a model are not touched" part of ADR-0042. Migration 025 clears cached questions.

## Decisions

1. **Customers may type in any language; everything we ask or show is English.** The resolve prompt asks its clarifying question "in plain English"; the seed catalog's three ambiguous questions are English; the errand prompt and tool schemas ask the checklist question and write notes in plain English.
2. **Already English, unchanged:** `liveLabel`, `freshnessLabel`, `statusForModel`, `NO_ANSWER_NOTE`, `buildAnswerNote` and the tool descriptions had no Hinglish. The input examples ("chai banane ka saaman") stay: they are the customer's side.
3. **The cache is cleared** of rows that carry a question (migration 025), so no Hinglish question is served for 30 days.
4. **The client shows the server's question again** in the Did-you-mean sheet and as the errand list heading (falling back to the app's own text when empty). It is plain text, never acted on.
5. **The classifier may answer `other`** for a product no kind of shop fits (ADR-0046).
6. **The refusal messages of the open catalog** are English too.
7. **Left for the next PR:** the brand name inside the errand prompt.

## Consequences

- No Hinglish reaches an English screen from the AI. The `hi` tables stay in parity for the language switch.
- The resolve and errand evals must be re-run (see the PR).
