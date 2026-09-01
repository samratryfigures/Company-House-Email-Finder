import { NextRequest, NextResponse } from "next/server";
import { isSerperKeyError } from "@/lib/lead-utils";
import { prisma } from "@/lib/prisma";
import { getSerperApiKey, setProcessingPaused } from "@/lib/settings";

export async function POST(request: NextRequest) {
  const serperKey = await getSerperApiKey();
  if (!serperKey) {
    return NextResponse.json({ error: "Save a Serper API key first." }, { status: 400 });
  }

  const body = (await request.json().catch(() => ({}))) as { batchId?: unknown };
  const batchId = typeof body.batchId === "string" ? body.batchId.trim() : undefined;

  const failed = await prisma.companyLead.findMany({
    where: {
      status: "FAILED",
      ...(batchId ? { batchId } : {}),
    },
    select: { id: true, errorLog: true },
  });

  const retryable = failed.filter((lead) => isSerperKeyError(lead.errorLog));
  if (retryable.length === 0) {
    return NextResponse.json({ queued: 0 });
  }

  await prisma.companyLead.updateMany({
    where: { id: { in: retryable.map((lead) => lead.id) } },
    data: { status: "PENDING", errorLog: null },
  });

  await setProcessingPaused(false);

  return NextResponse.json({ queued: retryable.length });
}
