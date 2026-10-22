# ADR-0057: The service worker keeps the app shell

Status: accepted. Replaces the "caches nothing" lines of ADR-0017, ADR-0034 and ADR-0041.

## Context

A shop on a weak connection opened `/app/shop` and saw the browser's offline page, not the app with its "You're offline" banner. Fonts were bundled (ADR-0041) but only reachable online.

## Decision

1. **Keep the shell, not the data.** `public/sw.js` stores the page, its script and styles, the icons, the manifest and the Latin Mukta and Kalam fonts when it installs. It reads the file names from the page and its stylesheet, so the hashed names of each release need no list. The Devanagari fonts are stored the first time a page uses them.
2. **Pages: network first, kept page as the fallback.** Every address under `/app/` is the same `index.html`, so one kept copy opens `/app/`, `/app/shop` and the rest, and the app draws its own offline banner. Each successful page load refreshes the kept copy.
3. **Hashed files: kept copy first.** A name that contains its content hash never changes, so the kept copy is right. Other files under `/app/` go to the network first.
4. **Never the API.** Only GET requests under `/app/` are handled (not `sw.js`, which the browser checks itself). Requests, orders and prices always come from the server.
5. **Versioned.** The cache is named `askbuy-shell-N`; changing the rules means a new N, and the new worker deletes the old caches.
6. **Fonts stay self-hosted** (Fontsource woff2, Latin and Devanagari): the CSP allows no outside host (ADR-0017).

## Consequences

- A phone that has opened the app once can open it offline; what it shows still needs the network.
- A new release reaches a phone on its next online visit (the page is network first, new hashed files are kept as they load).
- The install downloads about 250 KB more once. If it fails, the worker still installs: push matters more.
