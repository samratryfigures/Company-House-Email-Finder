import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function csvEscape(value: string | null | undefined): string {
  const text = value ?? "";
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export async function GET(request: NextRequest) {
  const batchId = request.nextUrl.searchParams.get("batchId")?.trim() || undefined;

  const leads = await prisma.companyLead.findMany({
    where: batchId ? { batchId } : {},
    orderBy: { createdAt: "asc" },
  });

  const header = [
    "company name",
    "clean company name",
    "company number",
    "complete address",
    "postal code",
    "CompanyCategory",
    "CompanyStatus",
    "IncorporationDate",
    "Accounts.NextDueDate",
    "Accounts.LastMadeUpDate",
    "website",
    "email",
    "verified",
    "status",
    "error",
  ];
  const rows = leads.map((lead) =>
    [
      csvEscape(lead.originalName),
      csvEscape(lead.cleanedName),
      csvEscape(lead.companyNumber),
      csvEscape(lead.completeAddress),
      csvEscape(lead.postcode),
      csvEscape(lead.companyCategory),
      csvEscape(lead.companyStatus),
      csvEscape(lead.incorporationDate),
      csvEscape(lead.accountsNextDueDate),
      csvEscape(lead.accountsLastMadeUpDate),
      csvEscape(lead.website),
      csvEscape(lead.email),
      csvEscape(lead.verified ? "yes" : "no"),
      csvEscape(lead.status),
      csvEscape(lead.errorLog),
    ].join(","),
  );

  const csv = [header.join(","), ...rows].join("\n");
  const filename = batchId ? `leads-${batchId}.csv` : "leads-export.csv";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
