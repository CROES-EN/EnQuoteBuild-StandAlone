import {useEffect, useState} from "react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Textarea} from "@/components/ui/textarea";
import {X} from "lucide-react";

/**
 * Pricing model: Qty x Unit Price = Total - matching how quote line items already
 * work elsewhere in the app (QuoteItemSelector/QuoteForm.jsx). Total is ALWAYS
 * computed, never independently editable, so it can never drift out of sync with
 * quantity/unit price.
 *
 * Backwards compatible with older material orders saved before this field existed,
 * which only have a flat `cost` (no `unit_price`) - unitPriceFromOrder() below
 * back-computes a sensible starting unit price from cost/quantity for those.
 */
function unitPriceFromOrder(order) {
  if (!order) return "";
  if (order.unit_price !== undefined && order.unit_price !== null) return order.unit_price.toString();
  const qty = Number(order.quantity) || 0;
  if (order.cost !== undefined && order.cost !== null && qty > 0) {
    return (Number(order.cost) / qty).toString();
  }
  if (order.cost !== undefined && order.cost !== null) return order.cost.toString();
  return "";
}

export default function MaterialOrderForm({ order, onSave, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    site_id: "",
    item_name: "",
    sku: "",
    item_link: "",
    unit_price: "",
    quantity: 1,
    shipping_address: "",
    notes: ""
  });

  useEffect(() => {
    if (order) {
      setFormData({
        site_id: order.site_id || "",
        item_name: order.item_name || "",
        sku: order.sku || "",
        item_link: order.item_link || "",
        unit_price: unitPriceFromOrder(order),
        quantity: order.quantity || 1,
        shipping_address: order.shipping_address || "",
        notes: order.notes || ""
      });
    }
  }, [order]);

  const parsedQuantity = parseInt(formData.quantity) || 1;
  const parsedUnitPrice = parseFloat(formData.unit_price) || 0;
  const computedTotal = parsedQuantity * parsedUnitPrice;

  function buildSavePayload(extra = {}) {
    return {
      ...formData,
      quantity: parsedQuantity,
      unit_price: parsedUnitPrice,
      total: computedTotal,
      ...extra
    };
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(buildSavePayload());
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <h2 className="text-xl font-semibold text-foreground">
          {order ? "Edit Order Request" : "New Material Order Request"}
        </h2>
        <Button type="button" variant="ghost" size="icon" onClick={onCancel}>
          <X className="w-5 h-5" />
        </Button>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="site_id">Site ID *</Label>
          <Input
            id="site_id"
            value={formData.site_id}
            onChange={(e) => setFormData({ ...formData, site_id: e.target.value })}
            placeholder="e.g. SITE-1234"
            required
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="item_name">Item Name *</Label>
          <Input
            id="item_name"
            value={formData.item_name}
            onChange={(e) => setFormData({ ...formData, item_name: e.target.value })}
            placeholder="Name of the item to order"
            required
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="sku">SKU / Part Number</Label>
          <Input
            id="sku"
            value={formData.sku}
            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
            placeholder="Optional"
            className="mt-1.5"
          />
        </div>

        {/* Qty x Unit Price = Total - Total is always computed, never directly editable. */}
        <div className="grid grid-cols-3 gap-4 items-end">
          <div>
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              min="1"
              value={formData.quantity}
              onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="unit_price">Unit Price ($)</Label>
            <div className="relative mt-1.5">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="unit_price"
                type="number"
                step="0.01"
                min="0"
                value={formData.unit_price}
                onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
          </div>
          <div>
            <Label>Total</Label>
            <div className="mt-1.5 h-10 flex items-center px-3 rounded-md border border-border bg-muted text-foreground font-semibold">
              ${computedTotal.toFixed(2)}
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          {parsedQuantity} x ${parsedUnitPrice.toFixed(2)} = ${computedTotal.toFixed(2)}
        </p>

        <div>
          <Label htmlFor="item_link">Item Link / URL</Label>
          <Input
            id="item_link"
            value={formData.item_link}
            onChange={(e) => setFormData({ ...formData, item_link: e.target.value })}
            placeholder="https://..."
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="shipping_address">Shipping Address</Label>
          <Textarea
            id="shipping_address"
            value={formData.shipping_address}
            onChange={(e) => setFormData({ ...formData, shipping_address: e.target.value })}
            placeholder="Full shipping address"
            rows={2}
            className="mt-1.5"
          />
        </div>

        <div>
          <Label htmlFor="notes">Notes / Purpose</Label>
          <Textarea
            id="notes"
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="What is this item for?"
            rows={3}
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          Cancel
        </Button>
        <Button
          type="submit"
          name="draft"
          disabled={isLoading}
          variant="outline"
          className="flex-1 border-slate-300"
          onClick={() => onSave(buildSavePayload({ status: "draft" }), "draft")}
        >
          Save as Draft
        </Button>
        <Button
          type="button"
          disabled={isLoading}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          onClick={() => onSave(buildSavePayload({ status: "submitted" }), "submit")}
        >
          {isLoading ? "Submitting..." : "Submit Request"}
        </Button>
      </div>
    </form>
  );
}