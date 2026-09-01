import { enrichCompany } from "@/lib/enrichment";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey } from "@/lib/settings";

const STALE_MS = 20 * 1000;

export async function processLeadById(leadId: string, apiKey?: string) {
  const lead = await prisma.companyLead.findUnique({ where: { id: leadId } });
  if (!lead) return { skipped: true as const, reason: "Lead not found" };

  const claimed = await prisma.companyLead.updateMany({
    where: { id: leadId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "PROCESSING", errorLog: null },
  });
  if (claimed.count === 0) {
    return { skipped: true as const, reason: "Already claimed" };
  }

  const key = apiKey || (await getSerperApiKey());
  if (!key) {
    await prisma.companyLead.update({
      where: { id: leadId },
      data: {
        status: "FAILED",
        errorLog: "SERPER_KEY_MISSING: Add a Serper key in the app and click Save & continue.",
      },
    });
    return { skipped: false as const, status: "FAILED" as const };
  }

  const enriched = await enrichCompany(lead.originalName, key, {
    companyNumber: lead.companyNumber,
    postcode: lead.postcode,
  });

  await prisma.companyLead.update({
    where: { id: leadId },
    data: {
      cleanedName: enriched.cleanedName,
      website: enriched.website,
      email: enriched.email,
      status: enriched.status,
      errorLog: enriched.errorLog,
      verified: enriched.verified,
    },
  });

  return { skipped: false as const, status: enriched.status };
}

export async function processPendingLeads(limit = 8) {
  await prisma.companyLead.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    data: { status: "PENDING" },
  });

  const pending = await prisma.companyLead.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  if (pending.length === 0) {
    return { processed: 0, results: [] as Awaited<ReturnType<typeof processLeadById>>[] };
  }

  const apiKey = await getSerperApiKey();
  const results = await Promise.all(pending.map((lead) => processLeadById(lead.id, apiKey)));
  return { processed: results.length, results };
}
