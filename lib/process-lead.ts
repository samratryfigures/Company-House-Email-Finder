import { enrichCompany } from "@/lib/enrichment";
import { alreadyUsedSerperCredit, isSerperKeyError, SERPER_CREDIT_USED } from "@/lib/lead-utils";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey, isProcessingPaused } from "@/lib/settings";

const STALE_MS = 90 * 1000;

export async function processLeadById(leadId: string, apiKey?: string) {
  const lead = await prisma.companyLead.findUnique({ where: { id: leadId } });
  if (!lead) return { skipped: true as const, reason: "Lead not found" };
  if (lead.status === "COMPLETED") {
    return { skipped: true as const, reason: "Already completed" };
  }
  if (lead.website) {
    await prisma.companyLead.update({
      where: { id: leadId },
      data: { status: "COMPLETED" },
    });
    return { skipped: true as const, reason: "Website already stored" };
  }
  if (lead.status === "FAILED" && !isSerperKeyError(lead.errorLog)) {
    return { skipped: true as const, reason: "Already searched" };
  }
  if (alreadyUsedSerperCredit(lead.errorLog) && !isSerperKeyError(lead.errorLog)) {
    await prisma.companyLead.update({
      where: { id: leadId },
      data: {
        status: "FAILED",
        errorLog: `${SERPER_CREDIT_USED}: Search credit already spent for this company; not searched again.`,
      },
    });
    return { skipped: true as const, reason: "Credit already used" };
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

  await prisma.companyLead.update({
    where: { id: leadId },
    data: { errorLog: SERPER_CREDIT_USED },
  });

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
      errorLog: enriched.errorLog
        ? `${SERPER_CREDIT_USED}: ${enriched.errorLog}`
        : SERPER_CREDIT_USED,
      verified: enriched.verified,
    },
  });

  return { skipped: false as const, status: enriched.status };
}

export async function processPendingLeads(limit = 4) {
  if (await isProcessingPaused()) {
    return { processed: 0, paused: true, results: [] as Awaited<ReturnType<typeof processLeadById>>[] };
  }

  await prisma.companyLead.updateMany({
    where: {
      status: "PROCESSING",
      errorLog: SERPER_CREDIT_USED,
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    data: {
      status: "FAILED",
      errorLog: `${SERPER_CREDIT_USED}: Search credit already spent for this company; not searched again.`,
    },
  });

  await prisma.companyLead.updateMany({
    where: {
      status: "PROCESSING",
      errorLog: null,
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
  const results = [];
  for (const lead of pending) {
    results.push(await processLeadById(lead.id, apiKey));
  }
  const searched = results.filter((row) => !row.skipped).length;
  return { processed: searched, results };
}
