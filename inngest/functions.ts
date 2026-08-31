import { processLeadById } from "@/lib/process-lead";
import { inngest } from "@/lib/inngest";

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
      return processLeadById(leadId);
    });

    return result;
  },
);
