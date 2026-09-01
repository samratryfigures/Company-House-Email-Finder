import { NextRequest, NextResponse } from "next/server";
import { normalizeCompanyNumber, uniqueCompanyRecords, type CompanyRecord } from "@/lib/csv";
import { leadIdentityKey } from "@/lib/lead-utils";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey, setProcessingPaused } from "@/lib/settings";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BATCH = 250;

function optionalText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return null;
}

function parseIncomingCompanies(raw: unknown): CompanyRecord[] {
  if (!Array.isArray(raw)) return [];

  const records: CompanyRecord[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      records.push({
        originalName: item.trim(),
        companyNumber: null,
        postcode: null,
        completeAddress: null,
        companyCategory: null,
        companyStatus: null,
        incorporationDate: null,
        accountsNextDueDate: null,
        accountsLastMadeUpDate: null,
      });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const originalName =
      (typeof row.originalName === "string" && row.originalName.trim()) ||
      (typeof row.company === "string" && row.company.trim()) ||
      "";
    if (!originalName) continue;
    records.push({
      originalName,
      companyNumber: normalizeCompanyNumber(
        typeof row.companyNumber === "string" || typeof row.companyNumber === "number"
          ? String(row.companyNumber)
          : null,
      ),
      postcode: optionalText(row.postcode),
      completeAddress: optionalText(row.completeAddress),
      companyCategory: optionalText(row.companyCategory),
      companyStatus: optionalText(row.companyStatus),
      incorporationDate: optionalText(row.incorporationDate),
      accountsNextDueDate: optionalText(row.accountsNextDueDate),
      accountsLastMadeUpDate: optionalText(row.accountsLastMadeUpDate),
    });
  }
  return uniqueCompanyRecords(records);
}

async function poolMap<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(worker));
  }
}

export async function POST(request: NextRequest) {
  try {
    const serperKey = await getSerperApiKey();
    if (!serperKey) {
      return NextResponse.json(
        { error: "Add your Serper API key in the box above before uploading." },
        { status: 400 },
      );
    }

    const body = (await request.json()) as {
      batchId?: string;
      companies?: unknown;
    };

    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    if (!batchId) {
      return NextResponse.json({ error: "batchId is required" }, { status: 400 });
    }

    const companies = parseIncomingCompanies(body.companies);
    if (companies.length === 0) {
      return NextResponse.json({ error: "No valid company names provided" }, { status: 400 });
    }

    if (companies.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Send at most ${MAX_BATCH} companies per request` },
        { status: 400 },
      );
    }

    const keys = companies.map((company) => leadIdentityKey(company.originalName, company.companyNumber));
    const existing = await prisma.companyLead.findMany({
      where: { nameKey: { in: keys } },
      select: {
        id: true,
        nameKey: true,
        status: true,
        verified: true,
        website: true,
      },
    });
    const existingByKey = new Map(existing.map((lead) => [lead.nameKey, lead]));

    const toInsert: Array<{
      batchId: string;
      nameKey: string;
      originalName: string;
      companyNumber: string | null;
      postcode: string | null;
      completeAddress: string | null;
      companyCategory: string | null;
      companyStatus: string | null;
      incorporationDate: string | null;
      accountsNextDueDate: string | null;
      accountsLastMadeUpDate: string | null;
      status: "PENDING";
    }> = [];
    const reuseIds: string[] = [];
    const requeueRows: Array<{ id: string; company: (typeof companies)[number] }> = [];

    for (const company of companies) {
      const nameKey = leadIdentityKey(company.originalName, company.companyNumber);
      const current = existingByKey.get(nameKey);

      if (!current) {
        toInsert.push({
          batchId,
          nameKey,
          originalName: company.originalName,
          companyNumber: company.companyNumber,
          postcode: company.postcode,
          completeAddress: company.completeAddress,
          companyCategory: company.companyCategory,
          companyStatus: company.companyStatus,
          incorporationDate: company.incorporationDate,
          accountsNextDueDate: company.accountsNextDueDate,
          accountsLastMadeUpDate: company.accountsLastMadeUpDate,
          status: "PENDING",
        });
        continue;
      }

      if (current.status === "COMPLETED" && current.website) {
        reuseIds.push(current.id);
        continue;
      }

      requeueRows.push({ id: current.id, company });
    }

    if (toInsert.length > 0) {
      await prisma.companyLead.createMany({ data: toInsert, skipDuplicates: true });
    }

    if (reuseIds.length > 0) {
      await prisma.companyLead.updateMany({
        where: { id: { in: reuseIds } },
        data: { batchId },
      });
    }

    await poolMap(requeueRows, 25, async ({ id, company }) => {
      await prisma.companyLead.update({
        where: { id },
        data: {
          batchId,
          originalName: company.originalName,
          companyNumber: company.companyNumber,
          postcode: company.postcode,
          completeAddress: company.completeAddress,
          companyCategory: company.companyCategory,
          companyStatus: company.companyStatus,
          incorporationDate: company.incorporationDate,
          accountsNextDueDate: company.accountsNextDueDate,
          accountsLastMadeUpDate: company.accountsLastMadeUpDate,
          status: "PENDING",
          errorLog: null,
          verified: false,
        },
      });
    });

    await setProcessingPaused(false);

    return NextResponse.json({
      batchId,
      inserted: toInsert.length,
      reused: reuseIds.length,
      queued: toInsert.length + requeueRows.length,
    });
  } catch (error) {
    console.error("Upload failed", error);
    const message = error instanceof Error ? error.message : "Failed to queue companies";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
