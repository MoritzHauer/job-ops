import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtractorRuntimeContext } from "@shared/types/extractors";
import { describe, expect, it, vi } from "vitest";
import {
  canonicalJobUrl,
  mapEightyHoursJob,
  parseAiSafetyJobs,
  runImpactBoard,
} from "../src/run";

const cards = readFileSync(
  resolve(process.cwd(), "../extractors/impactboards/tests/aisafety.html"),
  "utf8",
);
const hits = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "../extractors/impactboards/tests/eightyhours.json"),
    "utf8",
  ),
);
const config =
  'algoliaApplicationId:"EXAMPLE",algoliaApiKey:"public-search",algoliaJobsIndex:"jobs_prod"';
function context(terms = ["research"]): ExtractorRuntimeContext {
  return {
    source: "eightyhours",
    selectedSources: ["eightyhours"],
    searchTerms: terms,
    selectedCountry: "united kingdom",
    settings: { jobspyResultsWanted: "3" },
  };
}
function json(value: unknown) {
  return new Response(JSON.stringify(value));
}

describe("impact board public fixtures", () => {
  it("maps recorded AISafety cards and preserves ATS identity parameters", () => {
    const jobs = parseAiSafetyJobs(cards);
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({
      source: "aisafety",
      sourceJobId: "recazwsSpdJqB2cHS",
      title: "Offensive Security Engineer",
      employer: "UK Government, AI Security Institute",
      location: "London, UK",
      datePosted: "2026-10-28T00:00:00.000Z",
      jobType: "Full-time",
    });
    expect(jobs[0].jobDescription).toContain("offensive security");
    expect(jobs[1].jobUrl).toBe("https://ari.us/careers/?gh_jid=4468246009");
  });
  it("maps Algolia fields including summary fallback and Unix posting date", () => {
    const job = mapEightyHoursJob(hits[0]);
    expect(job).toMatchObject({
      source: "eightyhours",
      sourceJobId: "21433",
      title: "Offensive Security Engineer",
      employer: "UK Government, AI Security Institute",
      location: "London, UK",
    });
    expect(job?.jobDescription).toContain("offensive security");
    expect(job?.jobDescription).not.toContain("<li>");
    expect(job?.datePosted).toMatch(/^2026-10-28T/);
    expect(job?.jobUrl).toBe(parseAiSafetyJobs(cards)[0].jobUrl);
    expect(
      mapEightyHoursJob({ ...hits[0], url_external: "javascript:bad()" }),
    ).toBeNull();
  });
  it("removes tracking but keeps job IDs and client routing", () => {
    expect(
      canonicalJobUrl("https://example.org/?utm_source=x&job=2#position"),
    ).toBe("https://example.org/?job=2#position");
    expect(
      canonicalJobUrl("https://user:password@example.org/"),
    ).toBeUndefined();
  });
  it("paginates, deduplicates across pages and terms, and stops at the limit", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(config))
      .mockResolvedValueOnce(json({ hits: [hits[0]], nbPages: 3 }))
      .mockResolvedValueOnce(json({ hits: [hits[0], hits[1]], nbPages: 3 }))
      .mockResolvedValueOnce(
        json({
          hits: [
            {
              ...hits[0],
              objectID: "other",
              url_external: "https://example.org/job/3",
            },
          ],
          nbPages: 3,
        }),
      )
      .mockResolvedValueOnce(json({ hits, nbPages: 1 }));
    const result = await runImpactBoard(
      "eightyhours",
      context(["research", "security"]),
      fetcher,
    );
    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(3);
    expect(new URL(fetcher.mock.calls[2][0]).searchParams.get("page")).toBe(
      "1",
    );
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("fetches all AISafety cards once and searches locally across terms", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(cards));
    const result = await runImpactBoard(
      "aisafety",
      context(["security", "digital"]),
      fetcher,
    );
    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps concurrent runs independent, without sharing results or settings", async () => {
    const a = context(["security"]);
    const b = context(["digital"]);
    a.settings.jobspyResultsWanted = "1";
    const results = await Promise.all(
      [a, b].map((ctx) =>
        runImpactBoard(
          "aisafety",
          ctx,
          vi.fn().mockResolvedValue(new Response(cards)),
        ),
      ),
    );
    expect(results.map((r) => r.jobs[0].title)).toEqual([
      "Offensive Security Engineer",
      "Digital Associate",
    ]);
  });
  it("honors cancellation before requesting a public page", async () => {
    const fetcher = vi.fn();
    expect(
      await runImpactBoard(
        "aisafety",
        { ...context(), shouldCancel: () => true },
        fetcher,
      ),
    ).toEqual({ success: true, jobs: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("fails safely on HTTP errors and schema drift without raw bodies or keys", async () => {
    for (const response of [
      new Response("secret raw body", { status: 403 }),
      new Response("challenge page"),
    ]) {
      const result = await runImpactBoard(
        "aisafety",
        context(),
        vi.fn().mockResolvedValue(response),
      );
      expect(result.success).toBe(false);
      expect(result.error).not.toContain("secret");
      expect(result.jobs).toEqual([]);
    }
    expect(() => parseAiSafetyJobs("<html></html>")).toThrow("cards missing");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(config))
      .mockResolvedValueOnce(json({ results: [] }));
    expect(
      (await runImpactBoard("eightyhours", context(), fetcher)).success,
    ).toBe(false);
  });
});
