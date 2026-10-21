# 0052. Brown sugar is groceries (Day 23, PR Q)

Status: Accepted · 2026-10-21 · Changes the drugs rule of ADR-0029.

## Decisions

1. **"brown sugar" is no longer on the drugs deny list.** In India the phrase also names heroin, but on a kirana marketplace a customer who types it almost always wants the sweetener, and a hard block turned away honest requests.
2. **It is seeded as a grocery item** (`brown-sugar`, synonyms "brown cheeni", "demerara sugar", "muscovado sugar", "ब्राउन शुगर"), so it resolves straight to the catalog item and goes to grocery shops, who answer with the sweetener. "Khandsari" is a different sugar and is deliberately not a synonym. Seed version 8; the price is an estimate.
3. **Everything else stays blocked:** heroin, smack, cocaine, charas, ganja, afeem, opium, MDMA, LSD, meth and the other unambiguous terms still hit the deny list (`denyList.test.ts` asserts each).
4. **The classifier still checks new items** (ADR-0029 layer 2), so a request that clearly seeks the drug is judged on its whole text, not on this word.

## Consequences

- A person who really means the drug gets grocery shops. Shops answer for what they sell, nothing changes hands in the app, and unambiguous terms are still refused.
- After deploy the seed and embedding steps pick up the new item.
