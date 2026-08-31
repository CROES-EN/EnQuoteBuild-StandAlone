import { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Upload, CheckCircle2, AlertTriangle } from "lucide-react";
import { createProduct, getProducts, isLocalDataSource, updateProduct } from "@/api/dataClient";

const schema = { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, type: { type: "string" }, category: { type: "string" }, unit_price: { type: "number" }, unit: { type: "string" }, product_link: { type: "string" }, is_active: { type: "string" }, id: { type: "string" } } };
const editable = ["name", "description", "type", "category", "unit_price", "unit", "product_link", "is_active"];

function parseLocalRows(text, fileName) {
  if (fileName.toLowerCase().endsWith(".json")) return JSON.parse(text);
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map(header => header.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.filter(Boolean).map(line => {
    const values = line.split(",");
    return Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() || ""]));
  });
}

export default function ImportValidateDialog({ open, onOpenChange, products, onImported }) {
  const inputRef = useRef(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  const validateFile = async (file) => {
    setLoading(true); setError(""); setResult(null);
    try {
      if (isLocalDataSource) {
        const rows = parseLocalRows(await file.text(), file.name);
        const normalized = (Array.isArray(rows) ? rows : rows.rows || []).map((row, index) => ({
          ...row,
          unit_price: Number(row.unit_price || row.price || 0),
          is_active: row.is_active !== "false" && row.is_active !== false,
          row_number: index + 2
        }));
        const existing = await getProducts();
        const resultRows = normalized.map(row => {
          const match = row.id ? existing.find(product => product.id === row.id) : existing.find(product => product.name?.toLowerCase() === row.name?.toLowerCase());
          const warnings = [];
          if (!row.name) warnings.push("Name is required");
          if (!(row.unit_price > 0)) warnings.push("Unit price must be greater than zero");
          return { ...row, action: match ? "update" : "create", id: match?.id || row.id, warnings };
        });
        setResult({ rows: resultRows, summary: {
          creates: resultRows.filter(row => row.action === "create" && !row.warnings.length).length,
          updates: resultRows.filter(row => row.action === "update" && !row.warnings.length).length,
          linked: 0,
          needs_review: resultRows.filter(row => row.warnings.length).length
        }, retailer_sources: [] });
        setLoading(false);
        return;
      }

      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      const extracted = await base44.integrations.Core.ExtractDataFromUploadedFile({ file_url, json_schema: schema });
      const rawRows = Array.isArray(extracted.output) ? extracted.output : [];
      if (!rawRows.length) throw new Error("No catalog rows were found in this file.");
      const response = await base44.functions.invoke("validateCatalogImport", { rows: rawRows.map((row, index) => ({ ...row, row_number: index + 2 })), currentProducts: products });
      setResult(response.data);
    } catch (err) { setError(err.message || "The file could not be validated."); }
    setLoading(false);
  };

  const applyImport = async () => {
    setImporting(true);
    const ready = result.rows.filter(row => row.name && row.unit_price > 0);
    const updates = ready.filter(row => row.action === "update").map(row => ({ id: row.id, ...Object.fromEntries(editable.map(key => [key, row[key]])) }));
    const creates = ready.filter(row => row.action === "create").map(row => Object.fromEntries(editable.map(key => [key, row[key]])));
    if (isLocalDataSource) {
      await Promise.all(updates.map(({ id, ...changes }) => updateProduct(id, changes)));
      await Promise.all(creates.map(createProduct));
    } else {
      if (updates.length) await base44.entities.Product.bulkUpdate(updates);
      if (creates.length) await base44.entities.Product.bulkCreate(creates);
    }
    setImporting(false); onImported(); onOpenChange(false); setResult(null);
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto"><DialogHeader><DialogTitle>Import & Validate Catalog</DialogTitle><DialogDescription>Upload an Excel file to stage changes. Existing IDs or exact item names update records; new names are added. Links are found from Product Link, Description, or earlier catalog entries.</DialogDescription></DialogHeader>
    {!result && <div className="py-5"><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={event => event.target.files?.[0] && validateFile(event.target.files[0])} /><Button onClick={() => inputRef.current?.click()} disabled={loading} className="w-full"> <Upload className="mr-2 w-4 h-4" />{loading ? "Reading and validating…" : "Choose Excel File"}</Button>{error && <p className="mt-3 text-sm text-rose-600">{error}</p>}<p className="mt-3 text-xs text-slate-500">Accepted columns: ID, Name, Type, Category, Description, Unit Price, Unit, Product Link, and Active.</p></div>}
    {result && <div className="space-y-4"><div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-sm"><div className="rounded-lg bg-emerald-50 p-3"><b>{result.summary.creates}</b><br />new</div><div className="rounded-lg bg-indigo-50 p-3"><b>{result.summary.updates}</b><br />updates</div><div className="rounded-lg bg-sky-50 p-3"><b>{result.summary.linked}</b><br />retailer links</div><div className="rounded-lg bg-amber-50 p-3"><b>{result.summary.needs_review}</b><br />review</div></div><div className="max-h-64 overflow-auto border rounded-lg"><table className="w-full text-sm"><thead className="sticky top-0 bg-slate-100"><tr><th className="p-2 text-left">Item</th><th className="p-2 text-left">Action</th><th className="p-2 text-left">Matched retailer</th><th className="p-2 text-left">Review</th></tr></thead><tbody>{result.rows.map((row, i) => <tr key={i} className="border-t"><td className="p-2">{row.name || "Untitled"}</td><td className="p-2 capitalize">{row.action}</td><td className="p-2">{row.retailer ? <a className="text-indigo-600 underline" href={row.retailer.url} target="_blank" rel="noreferrer">{row.retailer.name}</a> : "—"}</td><td className="p-2">{row.warnings.length ? <span className="flex gap-1 text-amber-700"><AlertTriangle className="w-4 h-4 shrink-0" />{row.warnings.join("; ")}</span> : <CheckCircle2 className="w-4 h-4 text-emerald-600" />}</td></tr>)}</tbody></table></div><div><p className="text-sm font-medium">Comparison sources</p><p className="text-xs text-slate-600">{result.retailer_sources.map(source => source.name).join(" · ")}</p></div></div>}
    <DialogFooter>{result && <><Button variant="outline" onClick={() => setResult(null)}>Choose another file</Button><Button onClick={applyImport} disabled={importing}>{importing ? "Applying…" : "Apply validated changes"}</Button></>}</DialogFooter></DialogContent></Dialog>;
}