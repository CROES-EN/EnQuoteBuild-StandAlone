import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { createProduct } from "@/api/dataClient";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import ProductForm from "@/components/products/ProductForm";
import { useUserRole } from "@/components/auth/RoleGuard";

/**
 * Dialog that lets a user create a new catalog item mid-quote.
 * Saves the product to the database (syncing with Products & Services)
 * and immediately adds it to the current quote via onItemAdded.
 */
export default function QuickAddItemDialog({ open, onOpenChange, products, onItemAdded }) {
  const queryClient = useQueryClient();
  const { role } = useUserRole();
  const [isCreating, setIsCreating] = useState(false);

  const existingCategories = [...new Set(products.map(p => p.category).filter(Boolean))];

  const handleSave = async (data) => {
    setIsCreating(true);
    try {
      const newProduct = await createProduct(data);
      queryClient.invalidateQueries({ queryKey: ["products"] });
      onItemAdded?.(newProduct);
      onOpenChange(false);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add to Catalog & Quote</DialogTitle>
        </DialogHeader>
        <ProductForm
          onSave={handleSave}
          onCancel={() => onOpenChange(false)}
          isLoading={isCreating}
          existingCategories={existingCategories}
          userRole={role}
          allProducts={products}
        />
      </DialogContent>
    </Dialog>
  );
}