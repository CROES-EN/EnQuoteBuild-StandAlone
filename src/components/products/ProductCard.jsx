import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Package, Wrench, Pencil, Trash2, ExternalLink, CircleAlert } from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

export default function ProductCard({ product, onEdit, onDelete, onReview, pendingReview, index = 0, canEdit = true, canDelete = true }) {
  const isService = product.type === "service";
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className={cn(
        "p-5 border-slate-200 transition-all duration-300 hover:shadow-md",
        !product.is_active && "opacity-60"
      )}>
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-10 h-10 rounded-xl flex items-center justify-center",
              isService ? "bg-violet-50" : "bg-emerald-50"
            )}>
              {isService ? (
                <Wrench className="w-5 h-5 text-violet-600" />
              ) : (
                <Package className="w-5 h-5 text-emerald-600" />
              )}
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">{product.name}</h3>
              <Badge variant="secondary" className="mt-1 text-xs">
                {product.category || "Uncategorized"}
              </Badge>
            </div>
          </div>
          {!product.is_active && (
            <Badge variant="outline" className="text-slate-500 border-slate-300">
              Inactive
            </Badge>
          )}
        </div>
        
        {product.description && (
          <p className="text-sm text-slate-600 mb-4 line-clamp-2">
            {product.description}
          </p>
        )}
        
        <div className="flex items-center justify-between pt-3 border-t border-slate-100">
          <div>
            <span className="text-2xl font-bold text-slate-900">
              ${product.unit_price?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            <span className="text-sm text-slate-500 ml-1">/ {product.unit || "unit"}</span>
            {pendingReview && <Button variant="ghost" size="icon" className="ml-1 h-7 w-7 text-amber-600 hover:text-amber-700" onClick={() => onReview(pendingReview)} title="Price discrepancy needs review"><CircleAlert className="w-4 h-4" /></Button>}
          </div>
          
          <div className="flex items-center gap-1">
            {product.product_link && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-500 hover:text-blue-600"
                onClick={() => window.open(product.product_link, "_blank")}
                title="Open product page"
              >
                <ExternalLink className="w-4 h-4" />
              </Button>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-500 hover:text-indigo-600"
                onClick={() => onEdit(product)}
              >
                <Pencil className="w-4 h-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-slate-500 hover:text-rose-600"
                onClick={() => onDelete(product)}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}