import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Check, X, AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export default function CategoryManager({ products, onRename, onDelete, onClose }) {
  const [editingCategory, setEditingCategory] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Build category counts from actual product data
  const categoryCounts = products.reduce((acc, p) => {
    const cat = p.category || "Uncategorized";
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, {});

  const categories = Object.keys(categoryCounts).sort();

  const startEdit = (cat) => {
    setEditingCategory(cat);
    setEditValue(cat);
  };

  const cancelEdit = () => {
    setEditingCategory(null);
    setEditValue("");
  };

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== editingCategory) {
      onRename(editingCategory, trimmed);
    }
    cancelEdit();
  };

  const handleDeleteConfirm = () => {
    onDelete(confirmDelete);
    setConfirmDelete(null);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between pb-3 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Manage Categories</h2>
          <p className="text-sm text-slate-500 mt-0.5">Rename or delete product categories</p>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      {categories.length === 0 ? (
        <p className="text-slate-500 text-sm text-center py-8">No categories found.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {categories.map((cat) => {
            const count = categoryCounts[cat];
            const isEditing = editingCategory === cat;

            return (
              <div key={cat} className="flex items-center gap-3 py-3">
                {isEditing ? (
                  <>
                    <Input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") cancelEdit();
                      }}
                      className="flex-1 h-8 text-sm"
                    />
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700" onClick={commitRename}>
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400" onClick={cancelEdit}>
                      <X className="w-4 h-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-sm font-medium text-slate-800">{cat}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count} {count === 1 ? "item" : "items"}
                    </Badge>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-slate-400 hover:text-slate-700" onClick={() => startEdit(cat)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-slate-400 hover:text-rose-600"
                      onClick={() => setConfirmDelete(cat)}
                      title={count > 0 ? "Category has items assigned" : "Delete category"}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Category</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to delete <strong>"{confirmDelete}"</strong>?
                </p>
                {confirmDelete && categoryCounts[confirmDelete] > 0 && (
                  <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
                    <span>
                      This category has <strong>{categoryCounts[confirmDelete]} {categoryCounts[confirmDelete] === 1 ? "item" : "items"}</strong> assigned to it.
                      Those items will have no category after deletion.
                    </span>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Cancel</Button>
            <Button className="bg-rose-600 hover:bg-rose-700" onClick={handleDeleteConfirm}>
              Delete Category
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}