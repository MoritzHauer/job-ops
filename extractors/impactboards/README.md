# Impact boards extractor

One discoverable manifest provides `eightyhours` (80,000 Hours) and `aisafety`
(AISafety.com). Both are independently selectable pipeline sources.

- 80,000 Hours: read the public Nuxt search configuration on the board homepage,
  then query its frontend's Algolia index with the published search-only key.
  No key is stored in the repository or logs. Paginate using `page`/`nbPages`,
  100 hits per request; surface the 1,000-hit search-window limit.
- AISafety.com: parse public rendered `a.card[id][href]` cards with Cheerio.
  All 568 cards were server-rendered at the 2026-10-28 probe; no pagination was
  present. Do not use the private `/api/` routes (disallowed by robots.txt).
  Search title, employer, and summary locally. An explicit next-page link or
  missing cards fails visibly so an upstream format change needs review.

Fixture tests retain two public cards (images omitted) and a minimal two-hit
Algolia response recorded on 2026-10-28. They cover field mapping, canonical ATS
URLs, pagination, duplicates, error sanitization, cancellation, source selection,
and independence of concurrent runs. All mutable data is local to a run; this
extractor uses no tenant data, files, cookies, or shared caches.

No stable API contract is promised by either site. Summaries can be shorter than
employer descriptions. Location preferences are enforced by the existing pipeline
after discovery. Requests have a 20-second timeout and respect access failures.

See `docs-site/docs/extractors/impact-job-boards.md` for user instructions.
