import { extractUkPostcode } from "@/lib/csv";

const NAME_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "of",
  "uk",
  "ltd",
  "limited",
  "plc",
  "llp",
  "llc",
  "inc",
  "co",
  "company",
  "group",
  "holdings",
  "services",
  "solutions",
  "consulting",
  "international",
]);

export const BLOCKED_HOSTS = [
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
  "tracxn.com",
  "b2bhint.com",
  "okredo.co.uk",
  "okredo.com",
  "northdata.com",
  "northdata.de",
  "dnb.com",
  "rocketreach.co",
  "apollo.io",
  "signalhire.com",
  "owler.com",
  "pitchbook.com",
  "cbinsights.com",
  "craft.co",
  "zoominfo.com",
  "kompass.com",
  "europages.co.uk",
  "europages.com",
  "scoot.co.uk",
  "192.com",
  "thegazette.co.uk",
  "duedil.com",
  "fame.bvdinfo.com",
  "companynewshq.com",
  "companiesintheuk.co.uk",
  "ukdata.com",
  "bizdb.co.uk",
  "freecompanydata.com",
  "company-information.service.gov.uk",
  "polylogarithm.com",
  "companynet.polylogarithm.com",
  "jars.lt",
  "kompany.com",
  "creditsafe.co.uk",
  "graydon.co.uk",
  "due.dil",
];

const DIRECTORY_SNIPPET_MARKERS = [
  "credit report",
  "credit score",
  "similar companies",
  "company profile on",
  "business directory",
  "view this company",
  "find company information",
];

export type UkCompanyContext = {
  originalName: string;
  cleanedName: string;
  companyNumber: string | null;
  postcode: string | null;
};

export function significantNameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !NAME_STOPWORDS.has(token));
}

export function compactPostcode(postcode: string | null | undefined): string | null {
  const extracted = extractUkPostcode(postcode ?? null);
  return extracted ? extracted.replace(/\s+/g, "") : null;
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
}

export function looksLikeDirectoryPage(text: string): boolean {
  const haystack = text.toLowerCase();
  return DIRECTORY_SNIPPET_MARKERS.filter((marker) => haystack.includes(marker)).length >= 1;
}

export function domainMatchesCompanyName(hostname: string, name: string): boolean {
  const compactHost = hostname.replace(/^www\./i, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const tokens = significantNameTokens(name).sort((a, b) => b.length - a.length);
  const strong = tokens.filter((token) => token.length >= 4);
  if (strong.some((token) => compactHost.includes(token))) return true;
  if (tokens.length >= 2 && tokens.filter((token) => compactHost.includes(token)).length >= 2) return true;
  return false;
}

export function nameAppearsInText(name: string, text: string): boolean {
  const haystack = text.toLowerCase();
  const tokens = significantNameTokens(name);
  if (tokens.length === 0) {
    const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return fallback.length >= 4 && haystack.includes(fallback);
  }
  const hits = tokens.filter((token) => haystack.includes(token));
  if (tokens.length === 1) return hits.length === 1;
  return hits.length >= Math.ceil(tokens.length * 0.8);
}

export function preferredCompanyTld(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host.endsWith(".co.uk") ||
    host.endsWith(".org.uk") ||
    host.endsWith(".uk") ||
    host.endsWith(".com") ||
    host.endsWith(".net") ||
    host.endsWith(".org") ||
    host.endsWith(".io")
  );
}

export function emailBelongsToWebsite(email: string, website: string): boolean {
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
    const domain = email.split("@")[1]?.toLowerCase();
    if (!host || !domain) return false;
    if (isBlockedHost(domain)) return false;
    if (
      ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "aol.com", "live.com", "msn.com"].includes(
        domain,
      )
    ) {
      return false;
    }
    return domain === host || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

export function serperQueryForUkCompany(ctx: UkCompanyContext): string {
  return [
    `"${ctx.originalName}"`,
    "official website",
    "-site:linkedin.com",
    "-site:facebook.com",
    "-site:endole.co.uk",
    "-site:companycheck.co.uk",
    "-site:tracxn.com",
    "-site:crunchbase.com",
    "-site:b2bhint.com",
    "-site:okredo.co.uk",
  ].join(" ");
}
