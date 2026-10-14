import React, {useDeferredValue, useMemo, useState} from "react";
import {Download} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from "@/components/ui/table";
import {CaseNumberLink, SiteIdLink} from "@/components/links/ExternalIdLinks";
import {buildQuoteRequestHygieneReport, HYGIENE_VERIFICATION_NOTE} from "@/features/autoDrafter/quoteRequestHygiene";
import {buildHygieneWorkbook, hygieneWorkbookFileName} from "@/features/autoDrafter/hygieneWorkbookExport";
import {useCaseIdIndex} from "@/features/links/caseIdIndexCache";

const PAGE_SIZE = 100;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function downloadFile(fileName, data, type) {
  const url = URL.createObjectURL(new Blob([data], {type}));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function QuoteRequestHygieneReview({table, authorFilter = ""}) {
  const report = useMemo(() => buildQuoteRequestHygieneReport(table), [table]);
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const caseIndex = useCaseIdIndex();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Typing stays responsive on large reports; the table catches up right after.
  const deferredSearch = useDeferredValue(search);
  const term = deferredSearch.trim().toLowerCase();
  const records = useMemo(() => report.records.filter(record => (!authorFilter || record.author.toLowerCase() === authorFilter.toLowerCase()) &&
    (!flaggedOnly || record.flags.length) &&
    (!term || [record.author, record.caseNumber, record.siteId, ...record.flags].some(value => value.toLowerCase().includes(term)))),
  [report, authorFilter, flaggedOnly, term]);
  const authorRows = useMemo(() => {
    const recordAuthors = new Set(records.map(record => record.author.toLowerCase()));
    return report.authors.filter(author => (!authorFilter || author.author.toLowerCase() === authorFilter.toLowerCase()) &&
      (!term || author.author.toLowerCase().includes(term) || recordAuthors.has(author.author.toLowerCase())));
  }, [report, authorFilter, term, records]);
  const shownRecords = records.slice(0, visibleCount);
  async function exportWorkbook() {
    setExporting(true);
    setExportError("");
    try {
      const {default: ExcelJS} = await import("exceljs");
      const workbook = buildHygieneWorkbook(ExcelJS, records, {author: authorFilter, search: search.trim(), flaggedOnly, caseIndex});
      downloadFile(hygieneWorkbookFileName(authorFilter), await workbook.xlsx.writeBuffer(), XLSX_TYPE);
    } catch (error) {
      setExportError(error?.message || String(error));
    } finally {
      setExporting(false);
    }
  }
  return <div className="space-y-4">
    <div className="text-sm space-y-1">
      <p className="font-medium">{report.flagged.length} of {report.records.length} request cases need intake review.</p>
      <p className="text-muted-foreground">Latest imported report only, independent of drafting filters or existing quotes. One retained request per case; ordinary later notes do not replace a structured request.</p>
      <p className="text-muted-foreground">{HYGIENE_VERIFICATION_NOTE}</p>
      <p className="text-muted-foreground">Flags are review findings, not proof of technician misconduct. A later workflow status may be legitimate.</p>
      {report.importedAt && <p className="text-xs">Imported {new Date(report.importedAt).toLocaleString()}{report.sourceFileName ? ` from ${report.sourceFileName}` : ""}</p>}
    </div>
    <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
      <Input aria-label="Search hygiene review" placeholder="Search comment author, case, or issue..." value={search} onChange={event => {setSearch(event.target.value); setVisibleCount(PAGE_SIZE);}} />
      <label className="flex items-center gap-2 whitespace-nowrap text-sm">
        <Checkbox checked={flaggedOnly} onCheckedChange={value => {setFlaggedOnly(value === true); setVisibleCount(PAGE_SIZE);}} />Flagged only
      </label>
      <Button type="button" variant="outline" size="sm" className="whitespace-nowrap" disabled={!records.length || exporting} data-hygiene-export
        title={`Exports the ${records.length} request case${records.length === 1 ? "" : "s"} shown below (current author, search and Flagged only filters) as a formatted Excel workbook.`}
        onClick={exportWorkbook}>
        <Download className="h-4 w-4 mr-1.5" />{exporting ? "Exporting…" : `Export Excel (${records.length})`}
      </Button>
    </div>
    {exportError && <p role="alert" className="text-sm text-destructive">Export failed: {exportError}</p>}
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow><TableHead>Comment author (requester to verify)</TableHead><TableHead>Request cases</TableHead><TableHead>Flagged cases</TableHead><TableHead>Flagged-case rate</TableHead></TableRow></TableHeader>
        <TableBody>{authorRows.map(author => <TableRow key={author.author.toLowerCase()}>
          <TableCell>{author.author}</TableCell><TableCell>{author.requests}</TableCell><TableCell>{author.flagged}</TableCell><TableCell>{Math.round(author.flagged / author.requests * 100)}%</TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </div>
    <div className="overflow-x-auto">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Case / Site</TableHead><TableHead>Comment author</TableHead><TableHead>Current O&M Status</TableHead><TableHead>Review findings</TableHead>
        </TableRow></TableHeader>
        <TableBody>{shownRecords.map((record, index) => <TableRow key={`${record.caseNumber}-${index}`}>
          <TableCell><CaseNumberLink caseNumber={record.caseNumber} fallback="Missing case number" /><br /><SiteIdLink siteId={record.siteId} fallback="No Site ID" /></TableCell>
          <TableCell>{record.author}{record.created && <p className="text-xs text-muted-foreground">{record.created}</p>}</TableCell>
          <TableCell>{record.omStatus || "Blank / unavailable"}</TableCell>
          <TableCell className="min-w-72 max-w-xl">
            {record.flags.length ? <ul className="list-disc pl-4 text-sm">{record.flags.map((flag, flagIndex) => <li key={flagIndex}>{flag}</li>)}</ul>
              : <p className="text-sm">No detectable intake issues. Manual verification still required.</p>}
            {record.observations.map(note => <p key={note} className="mt-1 text-xs text-muted-foreground">{note}</p>)}
            <details className="mt-2 text-sm"><summary className="cursor-pointer">Source comment</summary><p className="max-h-60 overflow-auto whitespace-pre-wrap mt-2">{record.comment || "Empty comment"}</p></details>
          </TableCell>
        </TableRow>)}
          {!records.length && <TableRow><TableCell colSpan={4} className="text-center">No matching request cases.</TableCell></TableRow>}
        </TableBody>
      </Table>
      {records.length > shownRecords.length && <div className="flex items-center justify-center gap-3 py-3 text-sm text-muted-foreground">
        Showing {shownRecords.length} of {records.length} request cases
        <Button type="button" variant="outline" size="sm" onClick={() => setVisibleCount(count => count + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, records.length - shownRecords.length)} more</Button>
      </div>}
    </div>
  </div>;
}
