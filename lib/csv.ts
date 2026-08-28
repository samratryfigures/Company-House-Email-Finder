export type CompanyRecord = {
  originalName: string;
  companyNumber: string | null;
  postcode: string | null;
  completeAddress: string | null;
  companyCategory: string | null;
  companyStatus: string | null;
  incorporationDate: string | null;
  accountsNextDueDate: string | null;
  accountsLastMadeUpDate: string | null;
};

export function normalizeCompanyNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const raw = value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!raw) return null;
  if (/^\d+$/.test(raw)) return raw.padStart(8, "0");
  return raw;
}

const NAME_HEADERS = [
  "company_name",
  "companyname",
  "company name",
  "company",
  "business name",
  "business",
  "organisation",
  "organization",
  "org",
  "name",
];

const NUMBER_HEADERS = [
  "company_number",
  "companynumber",
  "company number",
  "crn",
  "registration number",
];

const POSTCODE_HEADERS = [
  "regaddress.postcode",
  "postcode",
  "post_code",
  "postal_code",
  "zip",
  "zipcode",
];

const TOWN_HEADERS = ["regaddress.posttown", "post_town", "posttown", "town", "city"];

const ADDRESS_HEADERS = [
  "registered_address",
  "registered address",
  "address",
  "company_address",
  "company address",
  "regaddress.addressline1",
];

export const MAX_UPLOAD_ROWS = 30_000;
export const PARSE_CHUNK_ROWS = 10_000;
export const API_UPLOAD_CHUNK = 1_000;

const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

function cellText(value: unknown): string | null {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function excelSerialToIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    if (/^\d+(\.\d+)?$/.test(trimmed)) return excelSerialToIsoDate(Number(trimmed));
    return trimmed;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value > 20000 && value < 90000) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000;
    return new Date(utc).toISOString().slice(0, 10);
  }
  return String(value);
}

function rowValue(row: Record<string, unknown>, keys: string[]): unknown {
  const entries = Object.entries(row);
  for (const wanted of keys) {
    const match = entries.find(([header]) => header.trim().toLowerCase() === wanted);
    if (match && match[1] !== "" && match[1] != null) return match[1];
  }
  return null;
}

function detectColumn(headers: string[], wanted: string[]): string | null {
  const normalized = headers.map((header) => ({
    original: header,
    key: header.trim().toLowerCase(),
  }));
  for (const name of wanted) {
    const match = normalized.find((header) => header.key === name);
    if (match) return match.original;
  }
  return null;
}

export function detectCompanyColumn(headers: string[]): string | null {
  return detectColumn(headers, NAME_HEADERS) ?? headers[0] ?? null;
}

export function extractUkPostcode(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.toUpperCase().match(UK_POSTCODE_RE);
  if (!match) return null;
  return `${match[1]} ${match[2]}`.toUpperCase();
}

export function extractCompanyRecords(rows: Record<string, unknown>[]): CompanyRecord[] {
  if (rows.length === 0) return [];
  const headers = Object.keys(rows[0]);
  const nameCol = detectCompanyColumn(headers);
  if (!nameCol) return [];
  const numberCol = detectColumn(headers, NUMBER_HEADERS);
  const addressCol = detectColumn(headers, ADDRESS_HEADERS);
  const postcodeCol = detectColumn(headers, POSTCODE_HEADERS);
  const townCol = detectColumn(headers, TOWN_HEADERS);
  const uriCol = detectColumn(headers, ["uri"]);

  const records: CompanyRecord[] = [];
  for (const row of rows) {
    const originalName = cellText(row[nameCol]);
    if (!originalName) continue;

    const line1 = cellText(rowValue(row, ["regaddress.addressline1", "address_line_1", "addressline1"]));
    const line2 = cellText(rowValue(row, ["regaddress.addressline2", "address_line_2", "addressline2"]));
    const town = townCol
      ? cellText(row[townCol])
      : cellText(rowValue(row, ["regaddress.posttown", "post_town", "town", "city"]));
    const county = cellText(rowValue(row, ["regaddress.county", "county"]));
    const country = cellText(rowValue(row, ["regaddress.country", "country", "countryoforigin"]));
    const rawPostcode =
      (postcodeCol ? cellText(row[postcodeCol]) : null) ??
      cellText(rowValue(row, ["regaddress.postcode", "postcode"]));
    const singleAddress = addressCol ? cellText(row[addressCol]) : null;

    const completeAddress =
      [line1, line2, town, county, country, rawPostcode].filter(Boolean).join(", ") || singleAddress;

    const fromUri = uriCol ? cellText(row[uriCol])?.match(/\/company\/([A-Z0-9]+)/i)?.[1] : null;
    const companyNumber = normalizeCompanyNumber(
      (numberCol ? cellText(row[numberCol]) : null) ?? fromUri ?? null,
    );
    const postcode = extractUkPostcode(rawPostcode) ?? extractUkPostcode(completeAddress);

    records.push({
      originalName,
      companyNumber,
      postcode,
      completeAddress: completeAddress || null,
      companyCategory: cellText(rowValue(row, ["companycategory", "company_category", "category"])),
      companyStatus: cellText(rowValue(row, ["companystatus", "company_status", "status"])),
      incorporationDate: excelSerialToIsoDate(rowValue(row, ["incorporationdate", "incorporation_date", "incorporated"])),
      accountsNextDueDate: excelSerialToIsoDate(
        rowValue(row, ["accounts.nextduedate", "accounts_next_due_date", "nextduedate"]),
      ),
      accountsLastMadeUpDate: excelSerialToIsoDate(
        rowValue(row, ["accounts.lastmadeupdate", "accounts_last_made_up_date", "lastmadeupdate"]),
      ),
    });
  }
  return records;
}

export function uniqueCompanyRecords(records: CompanyRecord[]): CompanyRecord[] {
  const unique: CompanyRecord[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const numberKey = record.companyNumber?.trim().toUpperCase().replace(/[\s-]/g, "");
    const nameKey = record.originalName.trim().toLowerCase().replace(/\s+/g, " ");
    const key = numberKey ? `num:${numberKey}` : `name:${nameKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique;
}
