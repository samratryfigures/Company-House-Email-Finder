import { load } from "cheerio";
import { SERPER_CREDITS_ERROR, SERPER_KEY_MISSING } from "@/lib/lead-utils";
import {
  companyNumberAppearsInText,
  emailBelongsToWebsite,
  nameAppearsInText,
  postcodeAppearsInText,
  serperQueryForUkCompany,
  verifyUkCompanyMatch,
  type UkCompanyContext,
} from "@/lib/uk-verify";

const LEGAL_SUFFIX_RE =
  /\b(ltd|limited|inc|incorporated|llc|llp|l\.l\.c\.|corp|corporation|co|company|group|plc|gmbh|ag|s\.a\.|pty|pvt|private|holdings?)\b\.?/gi;

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

const DUMMY_EMAIL_RE =
  /(example@|sentry@|test@|dummy@|email@email|user@domain|your@|name@|noreply@|no-reply@|privacy@|webmaster@|wixpress|cloudflare|akamai|schema\.org|sentry\.io|w3\.org)/i;

const IMAGE_OR_ASSET_RE = /\.(png|jpe?g|gif|svg|webp|css|js)$/i;

const BLOCKED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "wikipedia.org",
  "crunchbase.com",
  "bloomberg.com",
  "yellowpages.com",
  "yelp.com",
  "reddit.com",
  "tiktok.com",
  "pinterest.com",
  "maps.google.com",
  "companieshouse.gov.uk",
  "company-information.service.gov.uk",
  "find-and-update.company-information.service.gov.uk",
  "business.data.gov.uk",
  "endole.co.uk",
  "companycheck.co.uk",
  "datalog.co.uk",
  "opencorporates.com",
  "duedil.com",
  "creditsafe.com",
  "dnb.com",
  "zoominfo.com",
  "yell.com",
  "thomsonlocal.com",
  "checkcompany.co.uk",
];

function toTitleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      if (word.includes("&") || word.includes("-")) {
        return word
          .split(/([&-])/)
          .map((part) =>
            part === "&" || part === "-" ? part : part.charAt(0).toUpperCase() + part.slice(1),
          )
          .join("");
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function cleanCompanyName(name: string): string {
  const stripped = name
    .replace(/["'`]/g, " ")
    .replace(LEGAL_SUFFIX_RE, " ")
    .replace(/[.,/#!$%^*;:{}=_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return toTitleCase(stripped || name.trim());
}

function hostnameFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return null;
  }
}

function isBlockedHost(hostname: string): boolean {
  return BLOCKED_HOSTS.some((blocked) => hostname === blocked || hostname.endsWith(`.${blocked}`));
}

type SearchHit = {
  title: string;
  snippet: string;
  website: string;
};

export async function findCompanyWebsiteCandidates(
  ctx: UkCompanyContext,
  apiKey: string,
): Promise<SearchHit[]> {
  if (!apiKey) {
    throw new Error(SERPER_KEY_MISSING);
  }

  const query = serperQueryForUkCompany(ctx);
  let response: Response;
  try {
    response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: 10, gl: "uk", hl: "en" }),
    });
  } catch (error) {
    throw new Error(`Serper request failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  const payload = (await response.json().catch(() => ({}))) as {
    organic?: Array<{ link?: string; title?: string; snippet?: string }>;
    message?: string;
    error?: string;
  };

  if (response.status === 401 || response.status === 403 || response.status === 429) {
    throw new Error(`${SERPER_CREDITS_ERROR}: ${payload.message || payload.error || `HTTP ${response.status}`}`);
  }

  const message = `${payload.message ?? ""} ${payload.error ?? ""}`.toLowerCase();
  if (message.includes("credit") || message.includes("quota") || message.includes("invalid api")) {
    throw new Error(`${SERPER_CREDITS_ERROR}: ${payload.message || payload.error}`);
  }

  if (!response.ok) {
    throw new Error(`Serper returned ${response.status}`);
  }

  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  for (const result of payload.organic ?? []) {
    if (!result.link) continue;
    const hostname = hostnameFromUrl(result.link);
    if (!hostname || isBlockedHost(hostname)) continue;
    if (seen.has(hostname)) continue;
    seen.add(hostname);
    hits.push({
      title: result.title ?? "",
      snippet: result.snippet ?? "",
      website: `https://${hostname}`,
    });
  }
  return hits;
}

export async function findCompanyDomain(cleanedName: string, apiKey: string): Promise<string | null> {
  const hits = await findCompanyWebsiteCandidates(
    { originalName: cleanedName, cleanedName, companyNumber: null, postcode: null },
    apiKey,
  );
  return hits[0]?.website ?? null;
}

function collectEmails(html: string): string[] {
  const matches = html.match(EMAIL_RE) ?? [];
  const unique = new Set<string>();

  for (const raw of matches) {
    const email = raw.toLowerCase().replace(/[.,;:]+$/, "");
    if (IMAGE_OR_ASSET_RE.test(email)) continue;
    if (DUMMY_EMAIL_RE.test(email)) continue;
    if (email.length > 80) continue;
    unique.add(email);
  }

  return [...unique];
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5_000),
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; LeadEnrichmentBot/1.0; +https://localhost) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    });

    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  }
}

export async function scrapeForEmail(domain: string): Promise<string | null> {
  const origin = domain.startsWith("http") ? domain.replace(/\/$/, "") : `https://${domain}`;
  const paths = ["/", "/contact", "/contact-us", "/about", "/about-us"];
  const found: string[] = [];

  for (const path of paths) {
    const html = await fetchHtml(`${origin}${path === "/" ? "" : path}`);
    if (!html) continue;

    const $ = load(html);
    const mailto = $("a[href^='mailto:']")
      .map((_, el) => $(el).attr("href") ?? "")
      .get()
      .map((href) => href.replace(/^mailto:/i, "").split("?")[0]);

    found.push(...collectEmails(mailto.join(" ")));
    $("script, style, noscript").remove();
    found.push(...collectEmails($.root().text()));
    found.push(...collectEmails(html));
  }

  const unique = [...new Set(found)];
  return unique.find((email) => emailBelongsToWebsite(email, origin)) ?? null;
}

async function verifyCandidate(hit: SearchHit, ctx: UkCompanyContext): Promise<boolean> {
  const hostname = hostnameFromUrl(hit.website);
  if (!hostname) return false;

  const titleMatch = nameAppearsInText(ctx.originalName, `${hit.title} ${hit.snippet}`);
  const html = (await fetchHtml(hit.website)) ?? "";
  const pageText = `${hit.title}\n${hit.snippet}\n${html}`;
  if (verifyUkCompanyMatch(pageText, hostname, ctx)) return true;

  const preview = `${hit.title}\n${hit.snippet}`;
  return (
    titleMatch &&
    (companyNumberAppearsInText(ctx.companyNumber, preview) ||
      postcodeAppearsInText(ctx.postcode, preview) ||
      companyNumberAppearsInText(ctx.companyNumber, html) ||
      postcodeAppearsInText(ctx.postcode, html))
  );
}

export async function enrichCompany(
  originalName: string,
  apiKey: string,
  extras?: { companyNumber?: string | null; postcode?: string | null },
): Promise<{
  cleanedName: string;
  website: string | null;
  email: string | null;
  errorLog: string | null;
  status: "COMPLETED" | "FAILED";
  verified: boolean;
}> {
  const cleanedName = cleanCompanyName(originalName);
  const ctx: UkCompanyContext = {
    originalName,
    cleanedName,
    companyNumber: extras?.companyNumber ?? null,
    postcode: extras?.postcode ?? null,
  };

  try {
    const candidates = await findCompanyWebsiteCandidates(ctx, apiKey);
    if (candidates.length === 0) {
      return {
        cleanedName,
        website: null,
        email: null,
        errorLog: "No official UK website found in search results",
        status: "FAILED",
        verified: false,
      };
    }

    let verifiedSite: string | null = null;
    for (const hit of candidates.slice(0, 5)) {
      try {
        if (await verifyCandidate(hit, ctx)) {
          verifiedSite = hit.website;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!verifiedSite) {
      return {
        cleanedName,
        website: null,
        email: null,
        errorLog: "Search hits did not match this company's name, company number, or UK postcode",
        status: "FAILED",
        verified: false,
      };
    }

    try {
      const email = await scrapeForEmail(verifiedSite);
      return {
        cleanedName,
        website: verifiedSite,
        email,
        errorLog: email
          ? null
          : "Website verified for this UK company, but no matching company-domain email was found",
        status: "COMPLETED",
        verified: true,
      };
    } catch (error) {
      return {
        cleanedName,
        website: verifiedSite,
        email: null,
        errorLog: `Scrape failed: ${error instanceof Error ? error.message : "unknown error"}`,
        status: "FAILED",
        verified: true,
      };
    }
  } catch (error) {
    return {
      cleanedName,
      website: null,
      email: null,
      errorLog: error instanceof Error ? error.message : "Unknown enrichment error",
      status: "FAILED",
      verified: false,
    };
  }
}
