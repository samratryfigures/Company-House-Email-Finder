import { EventSchemas, Inngest } from "inngest";

type Events = {
  "app/csv.uploaded": {
    data: {
      batchId: string;
      leadIds: string[];
    };
  };
  "app/company.process": {
    data: {
      leadId: string;
    };
  };
};

export const inngest = new Inngest({
  id: "ai-lead-generation",
  schemas: new EventSchemas().fromRecord<Events>(),
});
