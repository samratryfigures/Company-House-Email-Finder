import { after } from "next/server";
import { NextResponse } from "next/server";
import { processPendingLeads } from "@/lib/process-lead";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await processPendingLeads(8);
    if (result.processed > 0) {
      after(() => {
        void processPendingLeads(8);
      });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Process queue failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to process leads" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return POST();
}
