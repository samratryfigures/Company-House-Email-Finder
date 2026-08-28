import { NextRequest, NextResponse } from "next/server";
import { getSerperApiKey, maskApiKey, saveSerperApiKey } from "@/lib/settings";

export async function GET() {
  const key = await getSerperApiKey();
  return NextResponse.json({
    configured: Boolean(key),
    hint: maskApiKey(key),
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { serperApiKey?: unknown };
  const serperApiKey = typeof body.serperApiKey === "string" ? body.serperApiKey.trim() : "";

  if (!serperApiKey) {
    return NextResponse.json({ error: "Paste a Serper API key first." }, { status: 400 });
  }

  await saveSerperApiKey(serperApiKey);
  return NextResponse.json({ configured: true, hint: maskApiKey(serperApiKey) });
}
