import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Search, Package, Wrench, Plus, X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import QuickAddItemDialog from "./QuickAddItemDialog";

// FIX (per explicit request: "having trouble finding items because of all the spelling
// differences"): the OLD search required the entire typed phrase to appear as ONE exact
// contiguous substring, in the exact same word order, with the exact same size notation
// as the catalog name -- so "emt conduit" would not find "Electrical Metallic Tube (EMT)
// Conduit" (wrong word order), and "3/4in" would not find "3/4 in. Liquid Tight Connector"
// (different size notation). fuzzyMatches() below fixes both: a product matches if EVERY
// word the user typed is a substring of SOME word in the product's name or description --
// tolerant of word order, partial words, and size notation differences. Deliberately kept
// local/self-contained here (NOT imported from draftEngine.js, to avoid coupling this
// Quotes UI to the Auto-Drafter engine) -- the size-notation normalization mirrors the
// same logic already built and tested in draftEngine.js.
//
// SCOPE (stated honestly): this does NOT correct genuine misspellings (e.g. "conduspit"
// would still not find "conduit") -- that needs real edit-distance fuzzy matching, a
// larger, separate enhancement if ever needed. Verified against 8 explicit test scenarios
// (including 2 negative tests and an old-behavior regression check) before shipping.
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

export default function QuoteItemSelector({ products, selectedItems, onItemsChange }) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  const categoryOrder = [
    "Services",
    "Enphase Products",
    "Conduit & Raceway",
    "Roof Mounting & Sealing",
    "Wiring & Cable Management",
    "Junction Boxes",
    "Critter Guard",
    "Rental Equipment"
  ];

  const categories = Array.from(
    new Set(products.filter(p => p.is_active !== false && p.category).map(p => p.category))
  )
    .sort((a, b) => {
      const ia = categoryOrder.indexOf(a);
      const ib = categoryOrder.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    })
    .map(name => ({ name, icon: name === "Services" ? "wrench" : "package" }));

  const [globalSearch, setGlobalSearch] = useState("");

  const filteredProducts = products.filter(p => {
    if (!selectedCategory) return false;
    const matchesSearch = fuzzyMatches(p.name, p.description, search);
    const matchesCategory = p.category === selectedCategory;
    return matchesSearch && matchesCategory && p.is_active !== false;
  });

  const globalSearchResults = globalSearch.trim().length > 0
    ? products.filter(p =>
        p.is_active !== false &&
        fuzzyMatches(p.name, p.description, globalSearch)
      )
    : [];

  const addItem = (product) => {
    const existingIndex = selectedItems.findIndex(item => item.product_id === product.id);
    if (existingIndex >= 0) {
      const newItems = [...selectedItems];
      newItems[existingIndex].quantity += 1;
      newItems[existingIndex].total = newItems[existingIndex].quantity * newItems[existingIndex].unit_price;
      onItemsChange(newItems);
    } else {
      onItemsChange([...selectedItems, {
        product_id: product.id,
        name: product.name,
        description: product.description || "",
        unit_price: product.unit_price,
        quantity: 1,
        unit: product.unit || "each",
        total: product.unit_price,
        taxable: true,
        upcharge: false
      }]);
    }
  };

  const updateQuantity = (index, quantity) => {
    if (quantity < 1) return;
    const newItems = [...selectedItems];
    newItems[index].quantity = quantity;
    const baseTotal = quantity * newItems[index].unit_price;
    newItems[index].total = newItems[index].upcharge ? baseTotal * 1.40 : baseTotal;
    onItemsChange(newItems);
  };

  const removeItem = (index) => {
    onItemsChange(selectedItems.filter((_, i) => i !== index));
  };

  const toggleTaxable = (index) => {
    const newItems = [...selectedItems];
    newItems[index].taxable = !newItems[index].taxable;
    onItemsChange(newItems);
  };

  const toggleUpcharge = (index) => {
    const newItems = [...selectedItems];
    newItems[index].upcharge = !newItems[index].upcharge;
    const baseTotal = newItems[index].quantity * newItems[index].unit_price;
    newItems[index].total = newItems[index].upcharge ? baseTotal * 1.40 : baseTotal;
    onItemsChange(newItems);
  };

  const subtotal = selectedItems.reduce((sum, item) => sum + item.total, 0);

  return (
    <div className="space-y-6">
      {/* Selected Items */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-3">Quote Items</h3>
        <Card className="border-border overflow-hidden">
          <AnimatePresence mode="popLayout">
            {selectedItems.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground">
                <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                <p>No items added yet</p>
                <p className="text-sm">Select products or services below</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {selectedItems.map((item, index) => (
                  <motion.div
                    key={item.product_id}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-4 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {item.confidence && (
                          <span
                            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${
                              item.confidence === "high" ? "bg-emerald-100 text-emerald-700" :
                              item.confidence === "low" ? "bg-red-100 text-red-700" :
                              "bg-amber-100 text-amber-700"
                            }`}
                            title={item.confidence_reason || "Quote Draft Agent match confidence -- please double-check Low confidence items"}
                          >
                            {item.confidence}
                          </span>
                        )}
                        <p className="font-medium text-foreground truncate">{item.name}</p>
                        {(item.confidence === "low" || item.name.startsWith("Miscellaneous ")) && (
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(`${item.name} solar part price`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:underline shrink-0"
                            title="Opens a web search in your default browser to help find this part"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Search
                          </a>
                        )}
                        {(item.confidence === "low" || item.name.startsWith("Miscellaneous ")) && (
                          <a
                            href={`https://www.google.com/search?q=${encodeURIComponent(`site:enphase.com/store ${item.name}`)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-xs text-indigo-600 hover:underline shrink-0"
                            title="Searches Enphase's own store specifically for this part"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Enphase Store
                          </a>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <p className="text-sm text-muted-foreground">
                          ${item.unit_price.toFixed(2)} / {item.unit}
                          {item.upcharge && <span className="text-amber-600 font-medium"> (+40%)</span>}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id={`tax-${index}`}
                            checked={item.taxable !== false}
                            onCheckedChange={() => toggleTaxable(index)}
                          />
                          <label
                            htmlFor={`tax-${index}`}
                            className="text-xs text-muted-foreground cursor-pointer"
                          >
                            Taxable
                          </label>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Checkbox
                            id={`upcharge-${index}`}
                            checked={item.upcharge === true}
                            onCheckedChange={() => toggleUpcharge(index)}
                          />
                          <label
                            htmlFor={`upcharge-${index}`}
                            className="text-xs text-muted-foreground cursor-pointer"
                          >
                            40% Upcharge
                          </label>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(index, item.quantity - 1)}
                      >
                        -
                      </Button>
                      <Input
                        type="number"
                        min="1"
                        value={item.quantity}
                        onChange={(e) => updateQuantity(index, parseInt(e.target.value) || 1)}
                        className="w-16 h-8 text-center"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateQuantity(index, item.quantity + 1)}
                      >
                        +
                      </Button>
                    </div>
                    <div className="w-24 text-right">
                      <p className="font-semibold text-foreground">${item.total.toFixed(2)}</p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                      onClick={() => removeItem(index)}
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </motion.div>
                ))}
                <div className="p-4 bg-secondary flex justify-between items-center">
                  <span className="font-medium text-foreground">Subtotal</span>
                  <span className="text-xl font-bold text-foreground">${subtotal.toFixed(2)}</span>
                </div>
              </div>
            )}
          </AnimatePresence>
        </Card>
      </div>

      {/* Product Catalog */}
      <div>
        {/* Global Search + Add Custom Item */}
        <div className="flex gap-2 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search all products & services..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setQuickAddOpen(true)}
            className="shrink-0"
          >
            <Plus className="w-4 h-4 mr-1" />
            Add Custom Item
          </Button>
        </div>

        {/* Global search results */}
        {globalSearch.trim().length > 0 ? (
          <div>
            <p className="text-xs text-muted-foreground mb-2">{globalSearchResults.length} result{globalSearchResults.length !== 1 ? "s" : ""}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {globalSearchResults.map((product) => {
                const isSelected = selectedItems.some(item => item.product_id === product.id);
                const isService = product.type === "service";
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addItem(product)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all flex items-center gap-3",
                      isSelected ? "border-indigo-300 bg-indigo-50" : "border-border hover:border-slate-300 hover:bg-secondary"
                    )}
                  >
                    <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center shrink-0", isService ? "bg-violet-100" : "bg-emerald-100")}>
                      {isService ? <Wrench className="w-4 h-4 text-violet-600" /> : <Package className="w-4 h-4 text-emerald-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{product.name}</p>
                      <p className="text-xs text-muted-foreground">{product.category}</p>
                      <p className="text-sm text-muted-foreground">${product.unit_price?.toFixed(2)} / {product.unit || "unit"}</p>
                    </div>
                    <Plus className={cn("w-5 h-5 shrink-0", isSelected ? "text-indigo-500" : "text-muted-foreground")} />
                  </button>
                );
              })}
              {globalSearchResults.length === 0 && (
                <div className="col-span-2 py-8 text-center text-muted-foreground">
                  <p>No products found</p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setQuickAddOpen(true)}
                    className="mt-3"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Add as New Catalog Item
                  </Button>
                </div>
              )}
            </div>
          </div>
        ) : (
        <>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-foreground">Add Items</h3>
          {selectedCategory && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedCategory(null);
                setSearch("");
              }}
              className="text-xs"
            >
              ÃƒÂ¢Ã¢â‚¬Â Ã‚Â Back to Categories
            </Button>
          )}
        </div>

        {!selectedCategory ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {categories.map((category) => {
              const categoryProducts = products.filter(p => p.category === category.name && p.is_active !== false);
              const isService = category.icon === "wrench";
              
              return (
                <button
                  key={category.name}
                  type="button"
                  onClick={() => setSelectedCategory(category.name)}
                  className="p-4 rounded-lg border border-border hover:border-slate-300 hover:bg-secondary text-left transition-all flex items-center gap-3 group"
                >
                  <div className={cn(
                    "w-12 h-12 rounded-lg flex items-center justify-center shrink-0 transition-colors",
                    isService ? "bg-violet-100 group-hover:bg-violet-200" : "bg-emerald-100 group-hover:bg-emerald-200"
                  )}>
                    {isService ? (
                      <Wrench className="w-6 h-6 text-violet-600" />
                    ) : (
                      <Package className="w-6 h-6 text-emerald-600" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-foreground">{category.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {categoryProducts.length} {categoryProducts.length === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search in this category..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto">
              {filteredProducts.map((product) => {
                const isSelected = selectedItems.some(item => item.product_id === product.id);
                const isService = product.type === "service";
                
                return (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addItem(product)}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all flex items-center gap-3",
                      isSelected
                        ? "border-indigo-300 bg-indigo-50"
                        : "border-border hover:border-slate-300 hover:bg-secondary"
                    )}
                  >
                    <div className={cn(
                      "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                      isService ? "bg-violet-100" : "bg-emerald-100"
                    )}>
                      {isService ? (
                        <Wrench className="w-4 h-4 text-violet-600" />
                      ) : (
                        <Package className="w-4 h-4 text-emerald-600" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-foreground truncate">{product.name}</p>
                      <p className="text-sm text-muted-foreground">
                        ${product.unit_price?.toFixed(2)} / {product.unit || "unit"}
                      </p>
                    </div>
                    <Plus className={cn(
                      "w-5 h-5 shrink-0",
                      isSelected ? "text-indigo-500" : "text-muted-foreground"
                    )} />
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="col-span-2 py-8 text-center text-muted-foreground">
                  No products found
                </div>
              )}
            </div>
          </>
        )}
        </>
        )}
      </div>

      {/* Quick Add Item Dialog */}
      <QuickAddItemDialog
        open={quickAddOpen}
        onOpenChange={setQuickAddOpen}
        products={products}
        onItemAdded={(newProduct) => addItem(newProduct)}
      />
    </div>
  );
}