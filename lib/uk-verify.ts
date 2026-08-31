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
  "creditsafe.co.uk",
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
  "rocketreach.co",
  "apollo.io",
  "signalhire.com",
  "owler.com",
  "pitchbook.com",
  "cbinsights.com",
  "craft.co",
  "kompass.com",
  "europages.co.uk",
  "europages.com",
  "scoot.co.uk",
  "192.com",
  "thegazette.co.uk",
  "companiesintheuk.co.uk",
  "ukdata.com",
  "bizdb.co.uk",
  "freecompanydata.com",
  "polylogarithm.com",
  "jars.lt",
  "bringo.co.uk",
  "companyshark.co.uk",
  "companynewshq.com",
];

export type UkCompanyContext = {
  originalName: string;
  cleanedName: string;
  companyNumber: string | null;
  postcode: string | null;
};

export function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./i, "").toLowerCase();
  if (host.includes("polylogarithm")) return true;
  return BLOCKED_HOSTS.some((blocked) => host === blocked || host.endsWith(`.${blocked}`));
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
  return `${ctx.originalName} website`;
}
