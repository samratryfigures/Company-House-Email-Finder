import { enrichCompany } from "@/lib/enrichment";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey, isProcessingPaused } from "@/lib/settings";

const STALE_MS = 90 * 1000;

export async function processLeadById(leadId: string, apiKey?: string) {
  const lead = await prisma.companyLead.findUnique({ where: { id: leadId } });
  if (!lead) return { skipped: true as const, reason: "Lead not found" };
  if (lead.status === "COMPLETED") {
    return { skipped: true as const, reason: "Already completed" };
  }

  const claimed = await prisma.companyLead.updateMany({
    where: { id: leadId, status: "PENDING" },
    data: { status: "PROCESSING" },
  });
  if (claimed.count === 0) {
    return { skipped: true as const, reason: "Already claimed" };
  }

  if (await isProcessingPaused()) {
    await prisma.companyLead.update({
      where: { id: leadId },
      data: { status: "PENDING" },
    });
    return { skipped: true as const, reason: "Paused" };
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
  if (await isProcessingPaused()) {
    return { processed: 0, paused: true, results: [] as Awaited<ReturnType<typeof processLeadById>>[] };
  }
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
  const searched = results.filter((row) => !row.skipped).length;
  return { processed: searched, results };
}
