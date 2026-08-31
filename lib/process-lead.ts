import { enrichCompany } from "@/lib/enrichment";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey } from "@/lib/settings";

const STALE_MS = 3 * 60 * 1000;

export async function processLeadById(leadId: string) {
  const lead = await prisma.companyLead.findUnique({ where: { id: leadId } });
  if (!lead) return { skipped: true as const, reason: "Lead not found" };

  const claimed = await prisma.companyLead.updateMany({
    where: { id: leadId, status: { in: ["PENDING", "PROCESSING"] } },
    data: { status: "PROCESSING", errorLog: null },
  });
  if (claimed.count === 0) {
    return { skipped: true as const, reason: "Already claimed" };
  }

  const apiKey = await getSerperApiKey();
  if (!apiKey) {
    await prisma.companyLead.update({
      where: { id: leadId },
      data: {
        status: "FAILED",
        errorLog: "SERPER_KEY_MISSING: Add a Serper key in the app and click Save & continue.",
      },
    });
    return { skipped: false as const, status: "FAILED" as const };
  }

  const enriched = await enrichCompany(lead.originalName, apiKey, {
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

export async function processPendingLeads(limit = 2) {
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

  const results = [];
  for (const lead of pending) {
    results.push(await processLeadById(lead.id));
  }
  return { processed: results.length, results };
}
