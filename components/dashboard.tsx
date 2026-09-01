"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { toast } from "sonner";
import { Download, KeyRound, LoaderCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  API_UPLOAD_CHUNK,
  extractCompanyRecords,
  MAX_UPLOAD_ROWS,
  PARSE_CHUNK_ROWS,
  uniqueCompanyRecords,
  type CompanyRecord,
} from "@/lib/csv";
import { cn } from "@/lib/utils";

type LeadStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED";

type Lead = {
  id: string;
  batchId: string;
  originalName: string;
  companyNumber: string | null;
  cleanedName: string | null;
  completeAddress: string | null;
  postcode: string | null;
  companyCategory: string | null;
  companyStatus: string | null;
  incorporationDate: string | null;
  accountsNextDueDate: string | null;
  accountsLastMadeUpDate: string | null;
  website: string | null;
  email: string | null;
  verified: boolean;
  status: LeadStatus;
  errorLog: string | null;
};

type LeadsResponse = {
  data: Lead[];
  page: number;
  pageSize: number;
  total: number;
  stats: {
    totalUploaded: number;
    processing: number;
    emailsFound: number;
    failed: number;
    needsNewKey: number;
  };
};

const PAGE_SIZE = 25;
const BATCH_STORAGE_KEY = "lead-enrichment-batch-id";

function statusClass(status: LeadStatus): string {
  switch (status) {
    case "COMPLETED":
      return "bg-emerald-100 text-emerald-800";
    case "FAILED":
      return "bg-red-100 text-red-800";
    case "PROCESSING":
      return "bg-blue-100 text-blue-800";
    default:
      return "bg-amber-100 text-amber-800";
  }
}

export function Dashboard() {
  const [batchId, setBatchId] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLabel, setUploadLabel] = useState("");
  const [page, setPage] = useState(1);
  const [payload, setPayload] = useState<LeadsResponse | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [keyHint, setKeyHint] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processInflight = useRef(0);
  const payloadRef = useRef<LeadsResponse | null>(null);
  const MAX_PROCESS_INFLIGHT = 2;

  useEffect(() => {
    const stored = window.localStorage.getItem(BATCH_STORAGE_KEY);
    if (stored) setBatchId(stored);

    void (async () => {
      const response = await fetch("/api/settings");
      if (!response.ok) return;
      const json = (await response.json()) as { configured: boolean; hint: string };
      setKeyConfigured(json.configured);
      setKeyHint(json.hint);
    })();
  }, []);

  const fetchLeads = useCallback(async (currentBatchId: string | null, currentPage: number) => {
    const params = new URLSearchParams({
      page: String(currentPage),
      pageSize: String(PAGE_SIZE),
    });
    if (currentBatchId) params.set("batchId", currentBatchId);

    const response = await fetch(`/api/leads?${params.toString()}`);
    if (!response.ok) throw new Error("Failed to load leads");
    const json = (await response.json()) as LeadsResponse;
    payloadRef.current = json;
    setPayload(json);
    return json;
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        if (cancelled) return;
        await fetchLeads(batchId, page);
      } catch {
        // Keep the last successful snapshot if the database is briefly unreachable.
      }
    };

    const kickProcess = () => {
      const remaining = payloadRef.current?.stats.processing ?? 0;
      if (cancelled || remaining <= 0 || processInflight.current >= MAX_PROCESS_INFLIGHT) return;
      processInflight.current += 1;
      void fetch("/api/process", { method: "POST" }).finally(() => {
        processInflight.current = Math.max(0, processInflight.current - 1);
      });
    };

    void refresh();
    kickProcess();
    const refreshTimer = window.setInterval(() => {
      void refresh();
    }, 2_000);
    const processTimer = window.setInterval(kickProcess, 2_000);

    return () => {
      cancelled = true;
      window.clearInterval(refreshTimer);
      window.clearInterval(processTimer);
    };
  }, [batchId, page, fetchLeads]);

  const stats = payload?.stats ?? {
    totalUploaded: 0,
    processing: 0,
    emailsFound: 0,
    failed: 0,
    needsNewKey: 0,
  };
  const isProcessing = stats.processing > 0;
  const totalPages = Math.max(1, Math.ceil((payload?.total ?? 0) / PAGE_SIZE));

  const progressValue = useMemo(() => {
    if (uploading) return uploadProgress;
    if (!stats.totalUploaded) return 0;
    return Math.round(((stats.totalUploaded - stats.processing) / stats.totalUploaded) * 100);
  }, [uploading, uploadProgress, stats]);

  async function uploadRecords(
    currentBatchId: string,
    records: CompanyRecord[],
    uploadedSoFar: number,
    total: number,
  ) {
    for (let i = 0; i < records.length; i += API_UPLOAD_CHUNK) {
      const slice = records.slice(i, i + API_UPLOAD_CHUNK);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: currentBatchId, companies: slice }),
      });

      if (!response.ok) {
        const error = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(error?.error ?? "Upload failed");
      }

      const done = Math.min(total, uploadedSoFar + i + slice.length);
      setUploadProgress(Math.round((done / total) * 100));
      setUploadLabel(`Queued ${done.toLocaleString()} of ${total.toLocaleString()} companies`);
    }
  }

  async function saveSerperKey(continueSearch: boolean) {
    const key = apiKeyInput.trim();
    if (!key) {
      toast.error("Paste your Serper API key first");
      return;
    }

    setSavingKey(true);
    try {
      const saveResponse = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serperApiKey: key }),
      });
      const saveJson = (await saveResponse.json()) as { error?: string; hint?: string; configured?: boolean };
      if (!saveResponse.ok) throw new Error(saveJson.error ?? "Could not save key");

      setKeyConfigured(true);
      setKeyHint(saveJson.hint ?? "");
      setApiKeyInput("");
      toast.success("Serper key saved");

      if (continueSearch) {
        const retryResponse = await fetch("/api/retry", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId }),
        });
        const retryJson = (await retryResponse.json()) as { queued?: number; error?: string };
        if (!retryResponse.ok) throw new Error(retryJson.error ?? "Could not continue");
        toast.success(`Continued with ${retryJson.queued ?? 0} remaining companies`);
        await fetchLeads(batchId, page);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save key");
    } finally {
      setSavingKey(false);
    }
  }

  async function queueAllRecords(currentBatchId: string, records: CompanyRecord[]) {
    const unique = uniqueCompanyRecords(records).slice(0, MAX_UPLOAD_ROWS);

    if (unique.length === 0) {
      throw new Error("No company names found in that file");
    }

    for (let i = 0; i < unique.length; i += PARSE_CHUNK_ROWS) {
      const chunk = unique.slice(i, i + PARSE_CHUNK_ROWS);
      await uploadRecords(currentBatchId, chunk, i, unique.length);
    }

    toast.success(`Queued ${unique.length.toLocaleString()} companies`);
    if (records.length > unique.length) {
      toast.message(`Deduped to ${unique.length.toLocaleString()} unique companies`);
    }
    await fetchLeads(currentBatchId, 1);
  }

  function parseAndUpload(file: File) {
    if (uploading) return;
    if (!keyConfigured) {
      toast.error("Save your Serper API key first, then upload the file");
      return;
    }
    const lower = file.name.toLowerCase();
    const isCsv = lower.endsWith(".csv");
    const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xls");
    if (!isCsv && !isExcel) {
      toast.error("Please upload a CSV or Excel file");
      return;
    }

    const currentBatchId = crypto.randomUUID();
    setBatchId(currentBatchId);
    window.localStorage.setItem(BATCH_STORAGE_KEY, currentBatchId);
    setPage(1);
    setUploading(true);
    setUploadProgress(0);
    setUploadLabel(isExcel ? "Parsing Excel…" : "Parsing CSV…");

    if (isExcel) {
      void (async () => {
        try {
          const XLSX = await import("xlsx");
          const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
          const sheet = workbook.Sheets[workbook.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
          await queueAllRecords(currentBatchId, extractCompanyRecords(rows));
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Could not parse that Excel file");
        } finally {
          setUploading(false);
          setUploadLabel("");
        }
      })();
      return;
    }

    let totalQueued = 0;
    const parseBuffer: CompanyRecord[] = [];
    let truncated = false;
    let cancelled = false;

    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      chunkSize: 1024 * 64,
      chunk: (results, parser) => {
        if (truncated) {
          parser.abort();
          return;
        }

        parser.pause();
        const records = extractCompanyRecords(results.data);
        if (results.meta.fields?.length && records.length === 0 && totalQueued === 0 && parseBuffer.length === 0) {
          cancelled = true;
          parser.abort();
          toast.error("Could not find a company name column");
          setUploading(false);
          return;
        }

        const remaining = MAX_UPLOAD_ROWS - totalQueued;
        if (records.length > remaining) {
          parseBuffer.push(...records.slice(0, remaining));
          truncated = true;
        } else {
          parseBuffer.push(...records);
        }

        void (async () => {
          try {
            while (parseBuffer.length >= PARSE_CHUNK_ROWS && totalQueued < MAX_UPLOAD_ROWS) {
              const chunk = parseBuffer.splice(0, PARSE_CHUNK_ROWS);
              await uploadRecords(
                currentBatchId,
                chunk,
                totalQueued,
                Math.min(MAX_UPLOAD_ROWS, totalQueued + chunk.length + parseBuffer.length),
              );
              totalQueued += chunk.length;
            }
          } catch (error) {
            cancelled = true;
            parser.abort();
            toast.error(error instanceof Error ? error.message : "Upload failed");
            setUploading(false);
            return;
          }
          parser.resume();
        })();
      },
      complete: () => {
        if (cancelled) return;
        void (async () => {
          try {
            if (parseBuffer.length && totalQueued < MAX_UPLOAD_ROWS) {
              const remaining = parseBuffer.slice(0, MAX_UPLOAD_ROWS - totalQueued);
              await uploadRecords(currentBatchId, remaining, totalQueued, totalQueued + remaining.length);
              totalQueued += remaining.length;
            }

            if (totalQueued === 0) {
              toast.error("No company names found in that CSV");
            } else {
              toast.success(`Queued ${totalQueued.toLocaleString()} companies`);
              if (truncated) {
                toast.message(`Stopped at ${MAX_UPLOAD_ROWS.toLocaleString()} rows`);
              }
            }
            await fetchLeads(currentBatchId, 1);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Upload failed");
          } finally {
            setUploading(false);
            setUploadLabel("");
          }
        })();
      },
      error: () => {
        toast.error("Could not parse that CSV");
        setUploading(false);
      },
    });
  }

  function onFile(fileList: FileList | null) {
    const file = fileList?.[0];
    if (file) parseAndUpload(file);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Lead Enrichment</h1>
          <p className="mt-2 text-muted-foreground">
            Upload a Companies House Excel/CSV. We search for each company website, skip directories, and scrape emails from that site. Duplicate companies are skipped. Street addresses are not saved.
          </p>
        </div>
        <Button asChild variant="outline" disabled={!batchId && !payload?.total}>
          <a href={batchId ? `/api/leads/export?batchId=${batchId}` : "/api/leads/export"}>
            <Download />
            Export to CSV
          </a>
        </Button>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Serper API key
          </CardTitle>
          <CardDescription>
            Get a key at serper.dev. If credits run out mid-search, paste a new key here and click Save & continue — the
            same upload keeps going. Already-found companies are not searched again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {keyConfigured ? (
            <p className="text-sm text-muted-foreground">Saved key: {keyHint}</p>
          ) : (
            <p className="text-sm text-amber-700">No key saved yet. Add one before uploading.</p>
          )}
          {stats.needsNewKey > 0 ? (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {stats.needsNewKey.toLocaleString()} companies stopped because this key is invalid or out of credits. Paste a
              new key and continue the same search.
            </p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              type="password"
              autoComplete="off"
              placeholder="Paste Serper API key"
              value={apiKeyInput}
              onChange={(event) => setApiKeyInput(event.target.value)}
            />
            <Button type="button" variant="outline" disabled={savingKey} onClick={() => void saveSerperKey(false)}>
              Save key
            </Button>
            <Button type="button" disabled={savingKey} onClick={() => void saveSerperKey(true)}>
              {savingKey ? "Saving…" : "Save & continue"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Total uploaded", value: stats.totalUploaded },
          { label: "Processing", value: stats.processing },
          { label: "Emails found", value: stats.emailsFound },
          { label: "Failed", value: stats.failed },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardHeader className="pb-2">
              <CardDescription>{stat.label}</CardDescription>
              <CardTitle className="text-3xl">{stat.value.toLocaleString()}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>CSV upload</CardTitle>
          <CardDescription>
            Drag and drop a CSV or Excel file (including Companies House format). Duplicate companies are treated as one. Social networks and company-directory sites are skipped.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => onFile(event.target.files)}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragActive(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragActive(false);
              onFile(event.dataTransfer.files);
            }}
            className={cn(
              "flex h-40 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-sm transition-colors",
              dragActive ? "border-foreground bg-muted/60" : "border-muted-foreground/30",
              uploading && "pointer-events-none opacity-60",
            )}
          >
            {uploading ? <LoaderCircle className="h-6 w-6 animate-spin" /> : <Upload className="h-6 w-6" />}
            <span>{uploading ? uploadLabel || "Uploading…" : "Drop a CSV or Excel file here or click to browse"}</span>
            <span className="text-muted-foreground">Detects CompanyName / company_name, CompanyNumber, and postcode</span>
          </button>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{isProcessing ? "Enrichment in progress" : uploading ? "Queuing records" : "Idle"}</span>
              <span>{progressValue}%</span>
            </div>
            <Progress value={progressValue} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Leads</CardTitle>
            <CardDescription>
              {batchId ? `Batch ${batchId.slice(0, 8)}…` : "All batches"} · refreshes every 3 seconds
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company name</TableHead>
                <TableHead>Clean name</TableHead>
                <TableHead>Number</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Postcode</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>CH status</TableHead>
                <TableHead>Incorporated</TableHead>
                <TableHead>Accounts due</TableHead>
                <TableHead>Last accounts</TableHead>
                <TableHead>Website</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(payload?.data ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={14} className="py-10 text-center text-muted-foreground">
                    No leads yet. Upload a CSV to start enrichment.
                  </TableCell>
                </TableRow>
              ) : (
                payload?.data.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell className="max-w-[180px] truncate">{lead.originalName}</TableCell>
                    <TableCell className="max-w-[160px] truncate">{lead.cleanedName ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs">{lead.companyNumber ?? "—"}</TableCell>
                    <TableCell className="max-w-[220px] truncate">{lead.completeAddress ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{lead.postcode ?? "—"}</TableCell>
                    <TableCell className="max-w-[140px] truncate">{lead.companyCategory ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{lead.companyStatus ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{lead.incorporationDate ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{lead.accountsNextDueDate ?? "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{lead.accountsLastMadeUpDate ?? "—"}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {lead.website ? (
                        <a className="underline underline-offset-2" href={lead.website} target="_blank" rel="noreferrer">
                          {lead.website.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate">{lead.email ?? "—"}</TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          lead.verified ? "bg-emerald-100 text-emerald-800" : "bg-slate-100 text-slate-600",
                        )}
                      >
                        {lead.verified ? "yes" : "no"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass(lead.status))}>
                        {lead.status.toLowerCase()}
                      </span>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {page} of {totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
