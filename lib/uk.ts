import { companyNameKey } from "@/lib/lead-utils";

export function normalizeCompanyNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!raw) return null;
  if (/^(SC|NI|OC|SO|NC|R0|IP)\d{6,}$/.test(raw)) {
    const prefix = raw.slice(0, 2);
    const digits = raw.slice(2).replace(/\D/g, "").padStart(6, "0").slice(-6);
    return `${prefix}${digits}`;
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 1 && digits.length <= 8) return digits.padStart(8, "0");
  return raw;
}

export function normalizePostcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.toUpperCase().match(/\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

export function leadIdentityKey(originalName: string, companyNumber?: string | null): string {
  const number = normalizeCompanyNumber(companyNumber);
  if (number) return `num:${number}`;
  return `name:${companyNameKey(originalName)}`;
}

export function significantNameTokens(cleanedName: string): string[] {
  const stop = new Set(["the", "and", "for", "of", "uk", "ltd", "limited", "plc"]);
  return cleanedName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3 && !stop.has(token));
}

export function streetFragment(address: string | null | undefined): string | null {
  if (!address) return null;
  const first = address.split(",")[0]?.trim() ?? "";
  if (first.length < 8) return null;
  return first.toLowerCase();
}

export function emailMatchesWebsite(email: string, website: string): boolean {
  const hostname = website.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase();
  const domain = email.split("@")[1]?.toLowerCase();
  if (!hostname || !domain) return false;
  return domain === hostname || hostname.endsWith(`.${domain}`) || domain.endsWith(`.${hostname}`);
}
