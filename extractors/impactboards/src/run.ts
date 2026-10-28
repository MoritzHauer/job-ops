import type {
  ExtractorRunResult,
  ExtractorRuntimeContext,
} from "@shared/types/extractors";
import type { CreateJobInput } from "@shared/types/jobs";
import { load } from "cheerio";

export type ImpactSource = "eightyhours" | "aisafety";
class PublicBoardError extends Error {}

const BOARD_URLS = {
  eightyhours: "https://jobs.80000hours.org/",
  aisafety: "https://aisafety.com/jobs",
};

export function canonicalJobUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return undefined;
    for (const key of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(key)) url.searchParams.delete(key);
    }
    // Keep fragments: some applicant tracking systems route jobs with them.
    url.searchParams.sort();
    return url.toString();
  } catch {
    return undefined;
  }
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
function list(value: unknown): string | undefined {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).join("; ") || undefined
    : undefined;
}
function plainHtml(value: unknown): string | undefined {
  const raw = text(value);
  if (!raw) return undefined;
  const $ = load(raw);
  $("script, style").remove();
  $("li, p, br").before("\n");
  return $("body").text().trim() || undefined;
}

export function mapEightyHoursJob(value: unknown): CreateJobInput | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const title = text(row.title);
  const employer = text(row.company_name);
  const jobUrl = canonicalJobUrl(row.url_external);
  const id = text(row.objectID);
  if (!title || !employer || !jobUrl || !id) return null;
  const location = list(row.card_locations) ?? list(row.tags_location_80k);
  const workplace = list(row.tags_location_type);
  const posted =
    typeof row.posted_at === "number"
      ? new Date(row.posted_at * 1000)
      : undefined;
  return {
    source: "eightyhours",
    sourceJobId: id,
    title,
    employer,
    jobUrl,
    jobUrlDirect: jobUrl,
    applicationLink: jobUrl,
    location,
    jobDescription:
      plainHtml(row.description) ?? plainHtml(row.description_short),
    datePosted:
      posted && Number.isFinite(posted.getTime())
        ? posted.toISOString()
        : undefined,
    salary: text(row.salary),
    jobType: list(row.tags_role_type),
    skills: list(row.tags_skill),
    jobLevel: list(row.tags_exp_required),
    workFromHomeType: workplace,
    isRemote: /remote/i.test(workplace ?? location ?? ""),
  };
}

export function parseAiSafetyJobs(html: string): CreateJobInput[] {
  const $ = load(html);
  if ($('a[rel="next"]').length)
    throw new PublicBoardError(
      "AISafety.com pagination changed; adapter update required",
    );
  const cards = $("a.card[id][href]");
  // An unexpected empty page must not look like a successful search.
  if (!cards.length)
    throw new PublicBoardError(
      "AISafety.com job cards missing; page format may have changed",
    );
  const jobs: CreateJobInput[] = [];
  cards.each((_, element) => {
    const card = $(element);
    const title = card.find("h3").text().trim();
    const fields = card
      .find("p.paragraph-xs")
      .map((_, p) => $(p).text().trim())
      .get();
    const employer = fields[0];
    const location = fields[1];
    const jobUrl = canonicalJobUrl(card.attr("href"));
    const id = card.attr("id");
    if (!title || !employer || !jobUrl || !id) return;
    const posted = fields
      .find((field) => field.startsWith("Posted "))
      ?.slice(7);
    const date = posted ? new Date(`${posted} 00:00:00 UTC`) : undefined;
    jobs.push({
      source: "aisafety",
      sourceJobId: id,
      title,
      employer,
      jobUrl,
      jobUrlDirect: jobUrl,
      applicationLink: jobUrl,
      location,
      jobDescription: card.find("p.paragraph-small").text().trim() || undefined,
      datePosted:
        date && Number.isFinite(date.getTime())
          ? date.toISOString()
          : undefined,
      skills: fields.find((field) => field.startsWith("Skillset: "))?.slice(10),
      jobLevel: fields
        .find((field) => field.startsWith("Min experience: "))
        ?.slice(16),
      jobType: fields.find((field) =>
        /^(Full-time|Part-time|Contract|Internship|Volunteer)/i.test(field),
      ),
      salary: fields.find((field) => /[$£€]/.test(field)),
      isRemote: /remote/i.test(location ?? ""),
    });
  });
  if (!jobs.length)
    throw new PublicBoardError("AISafety.com returned no valid job cards");
  return jobs;
}

async function read(
  url: string | URL,
  fetchImpl: typeof fetch,
): Promise<Response> {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok)
    throw new PublicBoardError(
      `Impact board request failed (HTTP ${response.status})`,
    );
  return response;
}

export function parseSearchConfig(html: string): {
  app: string;
  key: string;
  index: string;
} {
  const get = (field: string) =>
    html.match(new RegExp(`${field}:"([^"]+)"`))?.[1];
  const app = get("algoliaApplicationId");
  const key = get("algoliaApiKey");
  const index = get("algoliaJobsIndex");
  if (
    !app ||
    !/^[A-Z0-9]+$/i.test(app) ||
    !key ||
    !index ||
    !/^[\w-]+$/.test(index)
  ) {
    throw new PublicBoardError(
      "80,000 Hours public search configuration missing",
    );
  }
  return { app, key, index };
}

export async function runImpactBoard(
  source: ImpactSource,
  context: ExtractorRuntimeContext,
  fetchImpl: typeof fetch = fetch,
): Promise<ExtractorRunResult> {
  const jobs: CreateJobInput[] = [];
  // Everything here is run-local: no tenant settings, results or state are cached.
  const seenUrls = new Set<string>();
  const seenIds = new Set<string>();
  const terms = context.searchTerms.length ? context.searchTerms : [""];
  const parsedLimit = Number(context.settings.jobspyResultsWanted);
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.floor(parsedLimit)
      : 50;
  try {
    if (context.shouldCancel?.()) return { success: true, jobs };
    const html = await (await read(BOARD_URLS[source], fetchImpl)).text();
    const config =
      source === "eightyhours" ? parseSearchConfig(html) : undefined;
    const allCards = source === "aisafety" ? parseAiSafetyJobs(html) : [];
    for (const [termIndex, term] of terms.entries()) {
      let count = 0;
      let page = 0;
      let pages = 1;
      do {
        if (context.shouldCancel?.()) return { success: true, jobs };
        let candidates = allCards.filter((job) =>
          `${job.title} ${job.employer} ${job.jobDescription ?? ""}`
            .toLowerCase()
            .includes(term.toLowerCase()),
        );
        if (config) {
          const url = new URL(
            `https://${config.app}-dsn.algolia.net/1/indexes/${config.index}`,
          );
          url.search = new URLSearchParams({
            query: term,
            page: String(page),
            hitsPerPage: "100",
            "x-algolia-application-id": config.app,
            "x-algolia-api-key": config.key,
          }).toString();
          const payload = (await (await read(url, fetchImpl)).json()) as Record<
            string,
            unknown
          >;
          if (
            !Array.isArray(payload.hits) ||
            !Number.isInteger(payload.nbPages) ||
            (payload.nbPages as number) < 0
          ) {
            throw new PublicBoardError(
              "80,000 Hours returned an invalid search response",
            );
          }
          pages = payload.nbPages as number;
          candidates = payload.hits
            .map(mapEightyHoursJob)
            .filter((job): job is CreateJobInput => job !== null);
        }
        for (const job of candidates) {
          if (
            seenUrls.has(job.jobUrl) ||
            (job.sourceJobId && seenIds.has(job.sourceJobId))
          )
            continue;
          seenUrls.add(job.jobUrl);
          if (job.sourceJobId) seenIds.add(job.sourceJobId);
          jobs.push(job);
          count++;
          if (count >= limit) break;
        }
        page++;
        context.onProgress?.({
          phase: "list",
          currentUrl: term,
          listPagesProcessed: page,
          termsProcessed: termIndex,
          termsTotal: terms.length,
          jobCardsFound: jobs.length,
        });
        // Algolia restricts accessible result windows; never silently truncate.
        if (page >= 10 && page < pages && count < limit)
          throw new PublicBoardError(
            "80,000 Hours search exceeds 1,000 accessible hits; narrow search terms",
          );
      } while (page < pages && count < limit);
      context.onProgress?.({
        phase: "list",
        currentUrl: term,
        termsProcessed: termIndex + 1,
        termsTotal: terms.length,
        jobCardsFound: jobs.length,
      });
    }
    return { success: true, jobs };
  } catch (error) {
    // Fetch errors can contain URLs (including public search keys). Never expose
    // those or raw upstream payloads through pipeline logs/API error details.
    return {
      success: false,
      jobs: [],
      error:
        error instanceof PublicBoardError
          ? error.message
          : `${source === "eightyhours" ? "80,000 Hours" : "AISafety.com"} discovery failed; upstream unavailable or public page format changed`,
    };
  }
}
