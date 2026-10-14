/**
 * Markdown + PDF export for the Daily Snapshot report. Both formats render the same section list
 * (built from the imported reports and live EnQuote data in dailySnapshotSources.js), so they
 * can never drift apart. Missing values render as "N/A" rather than an invented number.
 */

import jsPDF from "jspdf";

const NA = "N/A";

function displayValue(value) {
  return value === null || value === undefined || value === "" ? NA : String(value);
}

// Characters jsPDF's default font can't render (same mapping as QuotePDFGenerator.jsx).
function normalizeText(text) {
  if (!text) return text;
  return String(text)
    .replace(/\u2011/g, "-")
    .replace(/\u2013/g, "-")
    .replace(/\u2014/g, "--")
    .replace(/\u2022/g, "*")
    .replace(/\u00b7/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"');
}

function sourceLine(section) {
  return [section.source, section.freshness].filter(Boolean).join(" \u00b7 ");
}

function dataNotes(reportData) {
  const notes = [];
  const stale = (reportData.sections || []).filter(section => String(section.freshness || "").startsWith("Stale")).map(section => section.source);
  if (stale.length) notes.push(`Stale sources (older than the prior business day): ${stale.join("; ")}`);
  if (reportData.missingReports?.length) notes.push(`Not imported: ${reportData.missingReports.join("; ")}`);
  return notes.concat(reportData.notes || []);
}

function summaryBullets(reportData) {
  return reportData.executiveSummaryBullets?.length ? reportData.executiveSummaryBullets : ["No summary bullets available."];
}

/** Builds the Daily Snapshot report as a Markdown string. */
export function buildSnapshotMarkdown(reportData) {
  const lines = [
    `# O&M Daily Operations Snapshot \u2014 ${displayValue(reportData.reportingDate)}`,
    `_${displayValue(reportData.reportingWindowLabel)} \u00b7 Prepared ${displayValue(reportData.preparedAt)}_`,
    "",
    "## Executive Summary",
    ...summaryBullets(reportData).map(bullet => `- ${bullet}`),
    ""
  ];
  for (const section of reportData.sections || []) {
    lines.push(`## ${section.title}`, `_Source: ${sourceLine(section)}_`, "");
    lines.push(...section.fields.map(([label, value]) => `- **${label}:** ${displayValue(value)}`), "");
  }
  const notes = dataNotes(reportData);
  if (notes.length) lines.push("## Data Notes", ...notes.map(note => `- ${note}`), "");
  return lines.join("\n").trim() + "\n";
}

function fileStem(reportData) {
  return `om-daily-snapshot_${reportData.reportingDateIso || reportData.reportingDate || "report"}`;
}

export function downloadSnapshotMarkdown(reportData) {
  const blob = new Blob([buildSnapshotMarkdown(reportData)], { type: "text/markdown;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileStem(reportData)}.md`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function copySnapshotMarkdown(reportData) {
  await navigator.clipboard.writeText(buildSnapshotMarkdown(reportData));
}

function ensureSpace(doc, yPos, needed = 30) {
  if (yPos + needed > 275) {
    doc.addPage();
    return 20;
  }
  return yPos;
}

export function downloadSnapshotPDF(reportData) {
  const doc = new jsPDF();
  let yPos = 20;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.setTextColor("#4f46e5");
  doc.text(normalizeText(`O&M Daily Operations Snapshot - ${displayValue(reportData.reportingDate)}`), 20, yPos);
  yPos += 7;
  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.setTextColor(100, 100, 100);
  doc.text(normalizeText(`${displayValue(reportData.reportingWindowLabel)} - Prepared ${displayValue(reportData.preparedAt)}`), 20, yPos);
  yPos += 9;

  const blocks = [
    {title: "Executive Summary", lines: summaryBullets(reportData).map(bullet => `\u2022 ${bullet}`)},
    ...(reportData.sections || []).map(section => ({
      title: section.title, subtitle: `Source: ${sourceLine(section)}`,
      lines: section.fields.map(([label, value]) => `${label}: ${displayValue(value)}`)
    }))
  ];
  const notes = dataNotes(reportData);
  if (notes.length) blocks.push({title: "Data Notes", lines: notes.map(note => `\u2022 ${note}`)});

  for (const block of blocks) {
    yPos = ensureSpace(doc, yPos, 20);
    doc.setFontSize(12);
    doc.setFont(undefined, "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(normalizeText(block.title), 20, yPos);
    yPos += 5;
    if (block.subtitle) {
      doc.setFontSize(8.5);
      doc.setFont(undefined, "italic");
      doc.setTextColor(110, 110, 110);
      const wrapped = doc.splitTextToSize(normalizeText(block.subtitle), 170);
      doc.text(wrapped, 20, yPos);
      yPos += wrapped.length * 4 + 1;
    }
    doc.setFontSize(9.5);
    doc.setFont(undefined, "normal");
    doc.setTextColor(0, 0, 0);
    for (const line of block.lines) {
      // Reserve the wrapped height so long summary bullets never run past the page bottom.
      const wrapped = doc.splitTextToSize(normalizeText(line), 170);
      yPos = ensureSpace(doc, yPos, wrapped.length * 4.5 + 2);
      doc.text(wrapped, 22, yPos);
      yPos += wrapped.length * 4.5;
    }
    yPos += 4;
  }

  doc.save(`${fileStem(reportData)}.pdf`);
}
