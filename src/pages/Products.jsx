import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Search, Plus, Package, Settings2, Info, Download, Upload, ClipboardCheck } from "lucide-react";
import { exportProductsToExcel } from "@/utils/productExport";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import ProductCard from "@/components/products/ProductCard";
import ProductForm from "@/components/products/ProductForm";
import CategoryManager from "@/components/products/CategoryManager";
import ImportValidateDialog from "@/components/products/ImportValidateDialog";
import PriceReviewDialog from "@/components/products/PriceReviewDialog";
import CatalogReviewDialog from "@/components/products/CatalogReviewDialog";
import RoleGuard from "@/components/auth/RoleGuard";
import { useUserRole } from "@/components/auth/RoleGuard";
import { createProduct, deleteProduct, getProducts, updateProduct } from "@/api/dataClient";



function ProductsContent() {
  const queryClient = useQueryClient();
  const { role, user } = useUserRole();
  const [search, setSearch] = useState("");
  const [myItemsOnly, setMyItemsOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [editingProduct, setEditingProduct] = useState(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingProduct, setDeletingProduct] = useState(null);
  const [showCategoryManager, setShowCategoryManager] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [selectedReview, setSelectedReview] = useState(null);
  const [showCatalogReview, setShowCatalogReview] = useState(false);

  const { data: products = [], isLoading } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      return getProducts();
    },
  });

  const { data: priceReviews = [] } = useQuery({
    queryKey: ["pending-price-reviews"],
    queryFn: () => base44.entities.PriceReview.filter({ status: "pending" }),
  });

  const reviewMutation = useMutation({
    mutationFn: (decision) => base44.functions.invoke("resolvePriceReview", { reviewId: selectedReview.id, decision }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["pending-price-reviews"] });
      setSelectedReview(null);
    }
  });

  const createMutation = useMutation({
    mutationFn: (data) => createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowForm(false);
    }
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => updateProduct(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowForm(false);
      setEditingProduct(null);
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => deleteProduct(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      setShowDeleteDialog(false);
      setDeletingProduct(null);
    }
  });

  const filteredProducts = products.filter(product => {
    const matchesSearch = 
      product.name?.toLowerCase().includes(search.toLowerCase()) ||
      product.category?.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || product.category === categoryFilter;
    const matchesMine = !myItemsOnly || product.created_by_id === user?.id;
    return matchesSearch && matchesCategory && matchesMine;
  });

  // Group products by category
  const groupedProducts = filteredProducts.reduce((acc, product) => {
    const category = product.category || "Uncategorized";
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(product);
    return acc;
  }, {});

  const categoryOrder = [
    "Services",
    "Enphase Products",
    "Conduit & Raceway",
    "Roof Mounting & Sealing",
    "Wiring & Cable Management",
    "Junction Boxes",
    "Rental Equipment",
    "Petaluma Installation-Do Not Use",
    "Uncategorized"
  ];

  const sortedCategories = Object.keys(groupedProducts).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  const handleRenameCategory = async (oldName, newName) => {
    const toUpdate = products.filter(p => p.category === oldName);
    await Promise.all(toUpdate.map(p => updateProduct(p.id, { category: newName })));
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const handleDeleteCategory = async (catName) => {
    const toUpdate = products.filter(p => p.category === catName);
    await Promise.all(toUpdate.map(p => updateProduct(p.id, { category: "" })));
    queryClient.invalidateQueries({ queryKey: ["products"] });
  };

  const handleSave = (data) => {
    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (product) => {
    setEditingProduct(product);
    setShowForm(true);
  };

  const handleDelete = (product) => {
    setDeletingProduct(product);
    setShowDeleteDialog(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Products & Services</h1>
            <p className="text-slate-600 mt-1">Manage your pricing catalog</p>
          </div>
          <div className="flex gap-2">
            {(role === "admin" || role === "approver") && <Button variant="outline" onClick={() => setShowCatalogReview(true)}>
              <ClipboardCheck className="w-4 h-4 mr-2" />
              Review
            </Button>}
            <Button
              variant="outline"
              onClick={() => setShowImport(true)}
            >
              <Upload className="w-4 h-4 mr-2" />
              Import & Validate
            </Button>
            <Button
              variant="outline"
              onClick={() => exportProductsToExcel(products)}
              disabled={products.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export to Excel
            </Button>
            {role === "admin" && (
              <Button
                variant="outline"
                onClick={() => setShowCategoryManager(true)}
              >
                <Settings2 className="w-4 h-4 mr-2" />
                Categories
              </Button>
            )}
            <Button 
              onClick={() => { setEditingProduct(null); setShowForm(true); }}
              className="bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Item
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-6 border-slate-200">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <TooltipProvider>
                <div className={cn("flex items-center gap-2 shrink-0 rounded-lg px-3 py-2 border transition-colors", myItemsOnly ? "bg-orange-50 border-orange-300" : "bg-slate-100 border-slate-200")}>
                  <Switch
                    id="my-items-toggle"
                    checked={myItemsOnly}
                    onCheckedChange={setMyItemsOnly}
                  />
                  <label htmlFor="my-items-toggle" className={cn("text-sm font-medium cursor-pointer whitespace-nowrap", myItemsOnly ? "text-orange-700" : "text-slate-700")}>
                    My Items Only
                  </label>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Info className="w-3.5 h-3.5 text-slate-400 cursor-pointer hover:text-slate-600 transition-colors" />
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs text-center">
                      If enabled, you will not see other users added items, only the products you personally have submitted into the tool
                    </TooltipContent>
                  </Tooltip>
                </div>
              </TooltipProvider>
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search products & services..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 w-full"
                />
              </div>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0">
              {[{ value: "all", label: "All Categories" }, ...[...new Set(products.map(p => p.category).filter(Boolean))].sort().map(c => ({ value: c, label: c }))].map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => setCategoryFilter(filter.value)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors",
                    categoryFilter === filter.value
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  )}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Products by Category */}
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="h-48 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : filteredProducts.length > 0 ? (
          <div className="space-y-8">
            {sortedCategories.map((category) => (
              <div key={category}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-xl font-bold text-slate-900">{category}</h2>
                  <div className="h-px flex-1 bg-slate-200"></div>
                  <span className="text-sm text-slate-500">{groupedProducts[category].length} items</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {groupedProducts[category].map((product, index) => (
                    <ProductCard 
                      key={product.id} 
                      product={product}
                      pendingReview={priceReviews.find(review => review.product_id === product.id)}
                      onReview={setSelectedReview}
                      index={index}
                      onEdit={handleEdit}
                      onDelete={handleDelete}
                      canEdit={role === "admin" || role === "approver" || product.created_by_id === user?.id}
                      canDelete={role === "admin" || role === "approver"}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Card className="p-12 text-center border-slate-200">
            <Package className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No items found</h3>
            <p className="text-slate-600">
              {myItemsOnly
                ? "No items found that you personally added. Try turning off \"My Items Only\" to see all catalog items."
                : search || categoryFilter !== "all" 
                  ? "Try adjusting your filters" 
                  : "Add your first product or service"}
            </p>
            {myItemsOnly && (
              <Button variant="outline" className="mt-4" onClick={() => setMyItemsOnly(false)}>
                Show All Items
              </Button>
            )}
          </Card>
        )}
      </div>

      <CatalogReviewDialog
        open={showCatalogReview}
        onOpenChange={setShowCatalogReview}
        incompleteProducts={products.filter(product => !product.product_link)}
        priceReviews={priceReviews}
        onEditProduct={product => { setShowCatalogReview(false); handleEdit(product); }}
        onOpenReview={review => { setShowCatalogReview(false); setSelectedReview(review); }}
      />

      <PriceReviewDialog
        review={selectedReview}
        canReview={role === "admin" || role === "approver"}
        onClose={() => setSelectedReview(null)}
        onDecision={decision => reviewMutation.mutate(decision)}
        processing={reviewMutation.isPending}
      />

      <ImportValidateDialog
        open={showImport}
        onOpenChange={setShowImport}
        products={products}
        onImported={() => queryClient.invalidateQueries({ queryKey: ["products"] })}
      />

      {/* Product Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <ProductForm
            product={editingProduct}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingProduct(null); }}
            isLoading={createMutation.isPending || updateMutation.isPending}
            existingCategories={[...new Set(products.map(p => p.category).filter(Boolean))]}
            userRole={role}
            allProducts={products}
          />
        </SheetContent>
      </Sheet>

      {/* Category Manager Sheet */}
      <Sheet open={showCategoryManager} onOpenChange={setShowCategoryManager}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          <CategoryManager
            products={products}
            onRename={handleRenameCategory}
            onDelete={handleDeleteCategory}
            onClose={() => setShowCategoryManager(false)}
          />
        </SheetContent>
      </Sheet>

      {/* Delete Dialog */}
      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Item</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{deletingProduct?.name}"? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={() => deleteMutation.mutate(deletingProduct?.id)}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function Products() {
  return (
    <RoleGuard allowedRoles={["submitter", "approver", "admin"]}>
      <ProductsContent />
    </RoleGuard>
  );
}