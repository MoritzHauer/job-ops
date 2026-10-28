import {
  EXTRACTOR_SOURCE_METADATA,
  PIPELINE_EXTRACTOR_SOURCE_IDS,
} from "@shared/extractors";
import { describe, expect, it, vi } from "vitest";
import { manifest } from "../src/manifest";
import { runImpactBoard } from "../src/run";

vi.mock("../src/run", () => ({ runImpactBoard: vi.fn() }));
const context = {
  source: "eightyhours",
  selectedSources: ["eightyhours", "aisafety"],
  settings: {},
  selectedCountry: "united kingdom",
  searchTerms: ["research"],
};
const job = {
  source: "eightyhours",
  title: "Researcher",
  employer: "Example",
  jobUrl: "https://example.org/job/1",
};

describe("impact boards source integration", () => {
  it("exposes both independently selectable pipeline sources", () => {
    for (const source of manifest.providesSources) {
      expect(PIPELINE_EXTRACTOR_SOURCE_IDS).toContain(source);
      expect(
        EXTRACTOR_SOURCE_METADATA[source as "eightyhours" | "aisafety"]
          .category,
      ).toBe("pipeline");
    }
  });
  it("deduplicates employer URLs across both boards", async () => {
    vi.mocked(runImpactBoard).mockResolvedValue({ success: true, jobs: [job] });
    const result = await manifest.run(context);
    expect(result.jobs).toEqual([job]);
  });
  it("keeps successful listings if the other board fails", async () => {
    vi.mocked(runImpactBoard)
      .mockResolvedValueOnce({ success: true, jobs: [job] })
      .mockResolvedValueOnce({
        success: false,
        jobs: [],
        error: "AISafety.com unavailable",
      });
    expect(await manifest.run(context)).toMatchObject({
      success: true,
      jobs: [job],
      sourceErrors: ["AISafety.com unavailable"],
    });
  });
});
