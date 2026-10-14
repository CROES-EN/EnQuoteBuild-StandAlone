import {useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "@/components/ui/dialog";
import {CUSTOM_PRODUCT_CATEGORIES, PRODUCT_CATALOG} from "@/features/quoteDraftAgent/productCatalog";
import {removeCustomProduct, saveCustomProduct, validateCustomProduct} from "@/features/quoteDraftAgent/customProductsStore";
import {catalogItemForEnphaseProduct, enphaseSource, enphaseSpecSummary, searchEnphaseReference} from "@/features/quoteDraftAgent/enphaseKnowledgeBase";
import {getCurrentUser} from "@/api/dataClient";
import {toast} from "sonner";
import {BookOpen, ExternalLink, Plus, Trash2} from "lucide-react";

// Same fuzzy, tolerant matching as QuoteItemSelector.jsx. Automatic draft matching
// (draftEngine.js) stays strict; this picker is only ever a manual, reviewer-initiated search.
function normalizeSizeNotation(text) {
  let result = String(text || "");
  result = result.replace(
    /(\d+)\s*\/\s*(\d+)\s*[-]?\s*(?:inch(?:es)?|in\.?|")/gi,
    (match, num, denom) => `${num}over${denom}in`
  );
  result = result.replace(
    /(\d+(?:\.\d+)?)\s*[-]?\s*(?:inch(?:es)?|in\.?|")/gi,
    (match, num) => `${num.replace(".", "p")}in`
  );
  return result;
}

function normalizeForSearch(text) {
  return normalizeSizeNotation(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeForSearch(text) {
  return normalizeForSearch(text).split(" ").filter(Boolean);
}

function fuzzyMatches(name, description, searchTerm) {
  const searchTokens = tokenizeForSearch(searchTerm);
  if (searchTokens.length === 0) return true;
  const haystackTokens = [...tokenizeForSearch(name), ...tokenizeForSearch(description || "")];
  return searchTokens.every((searchToken) =>
    haystackTokens.some((token) => token.includes(searchToken))
  );
}

const UNITS = ["each", "ft", "pack", "box", "roll"];
const emptyForm = {name: "", sku: "", category: "", unit_price: "", unit: "each", reference: ""};

function referenceForm(entry) {
  return {
    name: `Enphase ${entry.name}`, sku: entry.sku, unit: entry.kind === "cable" ? "box" : "each", unit_price: "",
    category: entry.kind === "microinverter" ? "Microinverters" : "Enphase Products", reference: entry.id
  };
}

function AddProductForm({initial, caseNumber, onSaved, onCancel}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const problem = validateCustomProduct(form);
  const update = (field) => (event) => setForm((previous) => ({...previous, [field]: event.target.value}));

  async function submit(event) {
    event.preventDefault();
    if (problem) return;
    setSaving(true);
    try {
      const user = await getCurrentUser().catch(() => null);
      const product = await saveCustomProduct({...form, addedBy: user?.email, caseNumber});
      toast.success(`Added to catalog: ${product.name}`);
      onSaved(product);
    } catch (error) {
      console.error("Failed to save custom product:", error);
      toast.error(error.message || "The product could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form data-add-product-form className="space-y-3 rounded-lg border border-border p-3" onSubmit={submit}>
      <p className="text-sm font-medium text-foreground">Add a product to the catalog</p>
      <Input aria-label="Product name" placeholder="Product name" value={form.name} onChange={update("name")} />
      <div className="grid grid-cols-2 gap-2">
        <Input aria-label="SKU" placeholder="SKU (optional)" value={form.sku} onChange={update("sku")} />
        <Input aria-label="Unit price" type="number" min="0" step="0.01" placeholder="Unit price" value={form.unit_price} onChange={update("unit_price")} />
        <select aria-label="Category" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={form.category} onChange={update("category")}>
          <option value="">Category…</option>
          {CUSTOM_PRODUCT_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select aria-label="Unit" className="h-9 rounded-md border border-input bg-background px-2 text-sm" value={form.unit} onChange={update("unit")}>
          {UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}
        </select>
      </div>
      {problem && form.name && <p className="text-xs text-muted-foreground">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
        <Button type="submit" size="sm" disabled={Boolean(problem) || saving}>{saving ? "Saving…" : "Add and use"}</Button>
      </div>
    </form>
  );
}

// Lets a reviewer replace an unmatched or low-confidence line item with a priced catalog entry,
// look up Enphase reference data, or add a product that is missing from the catalog.
export default function CatalogPickerDialog({open, onOpenChange, onSelect, learnPhrase, caseNumber, mode = "swap"}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [remember, setRemember] = useState(true);
  const [addForm, setAddForm] = useState(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const term = searchTerm.trim();
  const results = term ? PRODUCT_CATALOG.filter((p) => fuzzyMatches(p.name, p.sku || "", term)).slice(0, 30) : [];
  const references = term ? searchEnphaseReference(term).filter((entry) => !catalogItemForEnphaseProduct(entry)).slice(0, 5) : [];

  function reset() {
    setSearchTerm("");
    setAddForm(null);
  }

  function handleSelect(product) {
    onSelect(product, Boolean(learnPhrase) && remember);
    onOpenChange(false);
    reset();
  }

  async function handleRemove(product) {
    try {
      await removeCustomProduct(product.name);
      setCatalogVersion((value) => value + 1);
      toast.success(`Removed from catalog: ${product.name}`);
    } catch (error) {
      console.error("Failed to remove custom product:", error);
      toast.error("The product could not be removed.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg" data-catalog-version={catalogVersion}>
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add Item from Catalog" : "Find in Catalog"}</DialogTitle>
          <DialogDescription>
            Search the product catalog and Enphase reference data, or use + to add a product that is missing.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            placeholder="Search by name or SKU..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Button type="button" variant="outline" size="icon" className="shrink-0" data-add-product-plus
            title="Add a new product to the catalog" aria-label="Add a new product to the catalog"
            disabled={Boolean(addForm)} onClick={() => setAddForm({...emptyForm, name: term})}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {learnPhrase && <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" className="mt-1" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>Remember this swap: future drafts use the selected item whenever a request says <strong>&ldquo;{learnPhrase}&rdquo;</strong>.</span>
        </label>}
        {addForm ? (
          <AddProductForm key={JSON.stringify(addForm)} initial={addForm} caseNumber={caseNumber}
            onSaved={handleSelect} onCancel={() => setAddForm(null)} />
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1 mt-2">
            {results.map((product, i) => (
              <div key={`${product.name}-${i}`} className="flex items-center gap-1">
                <button
                  type="button"
                  data-catalog-result
                  onClick={() => handleSelect(product)}
                  className="min-w-0 flex-1 text-left p-2 rounded-lg hover:bg-secondary flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate text-sm">{product.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {product.category}{product.sku ? ` · ${product.sku}` : ""}
                      {product.custom && <span data-custom-product className="ml-2 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-medium text-indigo-700">Added by reviewer</span>}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-foreground shrink-0">
                    ${product.unit_price?.toFixed(2)}
                  </span>
                </button>
                {product.custom && (
                  <Button type="button" variant="ghost" size="icon" title="Remove from catalog" onClick={() => handleRemove(product)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            ))}
            {references.length > 0 && (
              <div className="pt-2" data-enphase-reference-results>
                <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Enphase reference (not in price list)</p>
                {references.map((entry) => {
                  const source = enphaseSource(entry);
                  return (
                    <div key={entry.id} data-enphase-reference={entry.id} className="rounded-lg border border-dashed border-border p-2 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{entry.name}</p>
                          <p className="text-xs text-muted-foreground">{enphaseSpecSummary(entry)}</p>
                          {source && <a href={source.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                            <BookOpen className="h-3 w-3" />{source.title}<ExternalLink className="h-3 w-3" />
                          </a>}
                        </div>
                        <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setAddForm(referenceForm(entry))}>
                          <Plus className="mr-1 h-3 w-3" />Add
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {term && results.length === 0 && references.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No matches found.</p>
            )}
            {term && (
              <Button type="button" variant="ghost" size="sm" className="w-full justify-start text-primary" data-add-product
                onClick={() => setAddForm({...emptyForm, name: term})}>
                <Plus className="mr-1 h-4 w-4" />Can&apos;t find it? Add &ldquo;{term}&rdquo; to the catalog
              </Button>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
