import { enrichCompany } from "@/lib/enrichment";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey } from "@/lib/settings";
import { isBlockedHost } from "@/lib/uk-verify";

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

async function requeueDirectoryMatches() {
  const suspect = await prisma.companyLead.findMany({
    where: {
      status: { in: ["COMPLETED", "FAILED"] },
      website: { not: null },
    },
    select: { id: true, website: true },
    take: 500,
  });

  const ids = suspect
    .filter((lead) => {
      try {
        const host = new URL(lead.website!).hostname;
        return isBlockedHost(host);
      } catch {
        return false;
      }
    })
    .map((lead) => lead.id);

  if (ids.length === 0) return 0;

  await prisma.companyLead.updateMany({
    where: { id: { in: ids } },
    data: {
      status: "PENDING",
      website: null,
      email: null,
      verified: false,
      errorLog: null,
    },
  });
  return ids.length;
}

export async function processPendingLeads(limit = 3) {
  await prisma.companyLead.updateMany({
    where: {
      status: "PROCESSING",
      updatedAt: { lt: new Date(Date.now() - STALE_MS) },
    },
    data: { status: "PENDING" },
  });

  await requeueDirectoryMatches();

  const pending = await prisma.companyLead.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { id: true },
  });

  const results = await Promise.all(pending.map((lead) => processLeadById(lead.id)));
  return { processed: results.length, results };
}
