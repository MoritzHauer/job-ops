import type { ExtractorManifest } from "@shared/types/extractors";
import { runImpactBoard } from "./run";

export const manifest: ExtractorManifest = {
  id: "impactboards",
  displayName: "Impact job boards",
  providesSources: ["eightyhours", "aisafety"],
  locationCapabilities: {
    eightyhours: { supportedCountryKeys: null },
    aisafety: { supportedCountryKeys: null },
  },
  async run(context) {
    const jobs = [];
    const sourceErrors: string[] = [];
    for (const source of context.selectedSources) {
      if (source !== "eightyhours" && source !== "aisafety") continue;
      const result = await runImpactBoard(source, context);
      if (!result.success) {
        sourceErrors.push(result.error ?? "Impact board discovery failed");
        continue;
      }
      jobs.push(...result.jobs);
    }
    if (sourceErrors.length && !jobs.length)
      return { success: false, jobs: [], error: sourceErrors.join("; ") };
    const seen = new Set<string>();
    return {
      success: true,
      sourceErrors,
      jobs: jobs.filter((job) => {
        if (seen.has(job.jobUrl)) return false;
        seen.add(job.jobUrl);
        return true;
      }),
    };
  },
};
export default manifest;
