---
id: impact-job-boards
title: Impact Job Boards
description: Discover roles from 80,000 Hours and AISafety.com in automatic pipeline runs.
sidebar_position: 11
---

## What it is

Two independent source choices for [80,000 Hours](https://jobs.80000hours.org/) and [AISafety.com](https://aisafety.com/jobs). No account or credentials are required.

80,000 Hours uses its frontend's public Algolia search interface. AISafety.com uses the public rendered job cards. These are public website interfaces, not documented stable APIs.

## Why it exists

These curated boards cover high-impact careers and AI safety roles. Enabling both expands discovery while the pipeline removes overlapping employer posting URLs.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **80,000 Hours**, **AISafety.com**, or both under **Sources**.
3. Enter search terms such as `research` or `software` and choose your location preferences.
4. Start the run and review the discovered jobs.

Defaults and constraints:

- The shared pipeline budget controls results per term; the extractor fallback is 50 per term.
- 80,000 Hours sends search terms to its public search service, requesting pages of 100 hits until the result limit or final page. A run that needs to scan more than 1,000 hits per term fails with an instruction to narrow the terms. The service may impose a smaller accessible search window.
- AISafety.com currently publishes all cards in one page, with no pagination. It fetches that page once per run and performs case-insensitive substring searches over title, employer, and summary locally.
- Country, city, and workplace preferences use the pipeline's shared location matching after discovery; they are not sent to these boards. Strict preferences can reduce the imported count below the discovery limit.
- Descriptions contain the board's summary when a full description is unavailable. Employer URLs lead to the application posting; JobOps does not fetch each employer page.
- Source record IDs remain stable. Tracking parameters (`utm_*`) are removed from posting URLs; job identity parameters such as `gh_jid` are preserved for duplicate detection, including overlap between these boards.
- External requests contain only search terms (80,000 Hours), pagination, and the site's public search configuration. Profile, resume, tenant, and saved job data are not sent. No persistent cookies or shared result cache are used.

## Common problems

### A source is missing

Use a build containing the `impactboards` extractor workspace and shared source catalog entries. Both choices appear through the existing source picker.

### No matching jobs appear

Broaden search terms or location preferences. AISafety.com matches a literal phrase rather than Algolia's search ranking. Remote work can still have geographic restrictions; review the original posting.

### Discovery fails

Access errors, rate limits, missing search configuration, or changed HTML can fail discovery. Retry later; do not bypass access controls. The current interfaces have no guaranteed stability. A changed page needs an adapter update.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
