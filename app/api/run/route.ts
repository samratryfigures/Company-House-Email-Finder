import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isProcessingPaused, setProcessingPaused } from "@/lib/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ paused: await isProcessingPaused() });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { paused?: unknown };
  const paused = body.paused === true;

  await setProcessingPaused(paused);

  if (paused) {
    await prisma.companyLead.updateMany({
      where: { status: "PROCESSING" },
      data: { status: "PENDING" },
    });
  }

  return NextResponse.json({ paused });
}
