import { enrichCompany } from "@/lib/enrichment";
import { inngest } from "@/lib/inngest";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey } from "@/lib/settings";

export const processCompanyBatch = inngest.createFunction(
  {
    id: "process-company-batch",
    retries: 2,
    concurrency: {
      limit: 5,
    },
  },
  { event: "app/csv.uploaded" },
  async ({ event, step }) => {
    const { batchId, leadIds } = event.data;

    const events = leadIds.map((leadId) => ({
      name: "app/company.process" as const,
      data: { leadId },
    }));

    const chunkSize = 200;
    for (let i = 0; i < events.length; i += chunkSize) {
      const chunk = events.slice(i, i + chunkSize);
      await step.sendEvent(`fan-out-${i / chunkSize}`, chunk);
    }

    return { batchId, queued: leadIds.length };
  },
);

export const processCompany = inngest.createFunction(
  {
    id: "process-company",
    retries: 2,
    concurrency: {
      limit: 8,
    },
    throttle: {
      limit: 8,
      period: "1s",
    },
  },
  { event: "app/company.process" },
  async ({ event, step }) => {
    const { leadId } = event.data;

    const result = await step.run("enrich-lead", async () => {
      const lead = await prisma.companyLead.findUnique({ where: { id: leadId } });
      if (!lead) {
        return { skipped: true as const, reason: "Lead not found" };
      }

      await prisma.companyLead.update({
        where: { id: leadId },
        data: { status: "PROCESSING", errorLog: null },
      });

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
    });

    return result;
  },
);
