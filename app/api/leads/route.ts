import { LeadStatus } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { isSerperKeyError } from "@/lib/lead-utils";
import { prisma } from "@/lib/prisma";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const batchId = searchParams.get("batchId")?.trim() || undefined;
  const page = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
  );
  const statusParam = searchParams.get("status")?.trim().toUpperCase();
  const status =
    statusParam && Object.values(LeadStatus).includes(statusParam as LeadStatus)
      ? (statusParam as LeadStatus)
      : undefined;

  const where = {
    ...(batchId ? { batchId } : {}),
    ...(status ? { status } : {}),
  };

  const [total, leads, grouped, emailsFound, failedRows] = await Promise.all([
    prisma.companyLead.count({ where }),
    prisma.companyLead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.companyLead.groupBy({
      by: ["status"],
      where: batchId ? { batchId } : {},
      _count: { _all: true },
    }),
    prisma.companyLead.count({
      where: {
        ...(batchId ? { batchId } : {}),
        email: { not: null },
      },
    }),
    prisma.companyLead.findMany({
      where: {
        ...(batchId ? { batchId } : {}),
        status: "FAILED",
      },
      select: { errorLog: true },
    }),
  ]);

  const counts = Object.fromEntries(grouped.map((row) => [row.status, row._count._all])) as Record<
    string,
    number
  >;
  const pending = counts.PENDING ?? 0;
  const processing = counts.PROCESSING ?? 0;
  const completed = counts.COMPLETED ?? 0;
  const failed = counts.FAILED ?? 0;
  const needsNewKey = failedRows.filter((row) => isSerperKeyError(row.errorLog)).length;

  return NextResponse.json({
    data: leads,
    page,
    pageSize,
    total,
    stats: {
      totalUploaded: pending + processing + completed + failed,
      processing: pending + processing,
      emailsFound,
      failed,
      completed,
      pending,
      needsNewKey,
    },
  });
}

export async function DELETE() {
  try {
    const result = await prisma.companyLead.deleteMany({});
    return NextResponse.json({ deleted: result.count });
  } catch (error) {
    console.error("Clear all failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to clear leads" },
      { status: 500 },
    );
  }
}
