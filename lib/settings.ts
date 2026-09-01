import { prisma } from "@/lib/prisma";

const SETTINGS_ID = "default";

export async function getSerperApiKey(): Promise<string> {
  const row = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return row?.serperApiKey?.trim() ?? "";
}

export async function saveSerperApiKey(serperApiKey: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { serperApiKey: serperApiKey.trim() },
    create: { id: SETTINGS_ID, serperApiKey: serperApiKey.trim() },
  });
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "";
  if (trimmed.length <= 4) return "••••";
  return `••••••••${trimmed.slice(-4)}`;
}

export async function isProcessingPaused(): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { id: SETTINGS_ID } });
  return Boolean(row?.processingPaused);
}

export async function setProcessingPaused(paused: boolean): Promise<void> {
  await prisma.appSetting.upsert({
    where: { id: SETTINGS_ID },
    update: { processingPaused: paused },
    create: { id: SETTINGS_ID, serperApiKey: "", processingPaused: paused },
  });
}
