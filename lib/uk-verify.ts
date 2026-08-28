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
]);

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

export function nameAppearsInText(name: string, text: string): boolean {
  const haystack = text.toLowerCase();
  const tokens = significantNameTokens(name);
  if (tokens.length === 0) {
    const fallback = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    return fallback.length >= 4 && haystack.includes(fallback);
  }
  const hits = tokens.filter((token) => haystack.includes(token));
  if (tokens.length === 1) return hits.length === 1;
  return hits.length >= Math.ceil(tokens.length * 0.7);
}

export function companyNumberAppearsInText(companyNumber: string | null, text: string): boolean {
  if (!companyNumber) return false;
  const haystack = text.toUpperCase().replace(/[\s-]/g, "");
  const compact = companyNumber.toUpperCase().replace(/[\s-]/g, "");
  if (haystack.includes(compact)) return true;
  const unpadded = compact.replace(/^0+/, "");
  return unpadded.length >= 6 && haystack.includes(unpadded);
}

export function postcodeAppearsInText(postcode: string | null, text: string): boolean {
  const compact = compactPostcode(postcode);
  if (!compact) return false;
  const haystack = text.toUpperCase().replace(/\s+/g, "");
  return haystack.includes(compact);
}

export function isUkPage(text: string, hostname: string): boolean {
  const haystack = text.toLowerCase();
  return (
    hostname.endsWith(".uk") ||
    hostname.endsWith(".co.uk") ||
    haystack.includes("united kingdom") ||
    haystack.includes("england") ||
    haystack.includes("scotland") ||
    haystack.includes("wales") ||
    haystack.includes("northern ireland") ||
    /\b(ltd|limited|plc)\b/i.test(text)
  );
}

export function verifyUkCompanyMatch(pageText: string, hostname: string, ctx: UkCompanyContext): boolean {
  const hasName = nameAppearsInText(ctx.originalName, pageText) || nameAppearsInText(ctx.cleanedName, pageText);
  if (!hasName) return false;

  const hasNumber = companyNumberAppearsInText(ctx.companyNumber, pageText);
  const hasPostcode = postcodeAppearsInText(ctx.postcode, pageText);
  if (hasNumber || hasPostcode) return true;

  return isUkPage(pageText, hostname) && nameAppearsInText(ctx.originalName, `${pageText} ${hostname}`);
}

export function emailBelongsToWebsite(email: string, website: string): boolean {
  try {
    const host = new URL(website.startsWith("http") ? website : `https://${website}`).hostname
      .replace(/^www\./i, "")
      .toLowerCase();
    const domain = email.split("@")[1]?.toLowerCase();
    if (!host || !domain) return false;
    if (["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "aol.com", "live.com", "msn.com"].includes(domain)) {
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
    ctx.companyNumber,
    ctx.postcode,
    "UK official website",
  ]
    .filter(Boolean)
    .join(" ");
}
