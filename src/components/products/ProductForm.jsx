import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { AlertTriangle } from "lucide-react";
import { X, Plus } from "lucide-react";

const DEFAULT_CATEGORIES = [
  "Services",
  "Enphase Products",
  "Conduit & Raceway",
  "Roof Mounting & Sealing",
  "Wiring & Cable Management",
  "Junction Boxes",
  "Critter Guard",
  "Rental Equipment",
  "Petaluma Installation-Do Not Use",
];

export default function ProductForm({ product, onSave, onCancel, isLoading, existingCategories = [], userRole, allProducts = [] }) {
  const [addingCategory, setAddingCategory] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [similarItems, setSimilarItems] = useState([]);
  const [acknowledgedSimilar, setAcknowledgedSimilar] = useState(false);

  const allCategories = [...new Set([...DEFAULT_CATEGORIES, ...existingCategories])];
  const canAddCategory = userRole === "approver" || userRole === "admin";
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    type: "product",
    product_link: "",
    unit_price: "",
    unit: "each",
    category: "",
    is_active: true
  });

  useEffect(() => {
    if (product) {
      setFormData({
        name: product.name || "",
        description: product.description || "",
        type: product.type || "product",
        product_link: product.product_link || "",
        unit_price: product.unit_price?.toString() || "",
        unit: product.unit || "each",
        category: product.category || "",
        is_active: product.is_active !== false
      });
    }
  }, [product]);

  // Check for similar items when name changes (only for new items)
  useEffect(() => {
    if (product) return; // skip when editing
    const name = formData.name.trim().toLowerCase();
    if (name.length < 3) { setSimilarItems([]); return; }
    const words = name.split(/\s+/).filter(w => w.length > 2);
    const matches = allProducts.filter(p => {
      const pName = p.name?.toLowerCase() || "";
      return words.some(w => pName.includes(w));
    });
    setSimilarItems(matches);
    setAcknowledgedSimilar(false);
  }, [formData.name]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!product && similarItems.length > 0 && !acknowledgedSimilar) return;
    onSave({
      ...formData,
      unit_price: parseFloat(formData.unit_price) || 0
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-900">
          {product ? "Edit Item" : "Add New Item"}
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="name">Name *</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter product or service name"
            required
            className="mt-1.5"
          />
        </div>

        {!product && similarItems.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Similar items already exist</p>
                <ul className="mt-1 space-y-1">
                  {similarItems.map(s => (
                    <li key={s.id} className="text-xs text-amber-700">
                      <span className="font-medium">{s.name}</span>
                      {s.category ? ` — ${s.category}` : ""} — ${s.unit_price?.toFixed(2)} / {s.unit || "unit"}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="ack-similar"
                checked={acknowledgedSimilar}
                onCheckedChange={setAcknowledgedSimilar}
              />
              <label htmlFor="ack-similar" className="text-xs text-amber-800 cursor-pointer">
                I acknowledge the similar item(s) and still want to add this new item
              </label>
            </div>
          </div>
        )}

        <div>
          <Label htmlFor="type">Type *</Label>
          <Select
            value={formData.type}
            onValueChange={(value) => setFormData({ ...formData, type: value })}
          >
            <SelectTrigger className="mt-1.5">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="product">Product</SelectItem>
              <SelectItem value="service">Service</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="product_link">Product Link</Label>
          <Input
            id="product_link"
            type="url"
            value={formData.product_link}
            onChange={(e) => setFormData({ ...formData, product_link: e.target.value })}
            placeholder="https://example.com/product-page"
            className="mt-1.5"
          />
          <p className="text-xs text-slate-500 mt-1">Webpage URL for ordering or reference</p>
        </div>

        <div>
          <Label htmlFor="description">Description</Label>
          <Textarea
            id="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            placeholder="Describe the product or service"
            rows={3}
            className="mt-1.5"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="unit_price">Unit Price *</Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
              <Input
                id="unit_price"
                type="number"
                step="0.01"
                min="0"
                value={formData.unit_price}
                onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
                placeholder="0.00"
                required
                className="pl-7"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="unit">Unit</Label>
            <Select
              value={formData.unit}
              onValueChange={(value) => setFormData({ ...formData, unit: value })}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="each">Each</SelectItem>
                <SelectItem value="hour">Hour</SelectItem>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="piece">Piece</SelectItem>
                <SelectItem value="kg">Kilogram</SelectItem>
                <SelectItem value="meter">Meter</SelectItem>
                <SelectItem value="sqm">Sq. Meter</SelectItem>
                <SelectItem value="project">Project</SelectItem>
                <SelectItem value="roll">Roll</SelectItem>
                <SelectItem value="ft">Foot</SelectItem>
                <SelectItem value="pack">Pack</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label htmlFor="category">Category</Label>
          {addingCategory ? (
            <div className="flex gap-2 mt-1.5">
              <Input
                autoFocus
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="New category name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (newCategory.trim()) {
                      setFormData({ ...formData, category: newCategory.trim() });
                      setAddingCategory(false);
                      setNewCategory("");
                    }
                  }
                  if (e.key === "Escape") { setAddingCategory(false); setNewCategory(""); }
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (newCategory.trim()) {
                    setFormData({ ...formData, category: newCategory.trim() });
                    setAddingCategory(false);
                    setNewCategory("");
                  }
                }}
              >
                Add
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setAddingCategory(false); setNewCategory(""); }}>
                <X className="w-4 h-4" />
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 mt-1.5">
              <Select
                value={formData.category}
                onValueChange={(value) => setFormData({ ...formData, category: value })}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {allCategories.map(cat => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {canAddCategory && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setAddingCategory(true)}
                  title="Add new category"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-lg">
          <div>
            <Label htmlFor="is_active" className="text-sm font-medium">Active</Label>
            <p className="text-xs text-slate-500 mt-0.5">Available for use in quotes</p>
          </div>
          <Switch
            id="is_active"
            checked={formData.is_active}
            onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
          />
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button type="submit" disabled={isLoading || (!product && similarItems.length > 0 && !acknowledgedSimilar)} className="flex-1 bg-indigo-600 hover:bg-indigo-700">
          {isLoading ? "Saving..." : product ? "Update" : "Add Item"}
        </Button>
      </div>
    </form>
  );
}