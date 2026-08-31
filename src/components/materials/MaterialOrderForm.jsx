import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { X } from "lucide-react";

export default function MaterialOrderForm({ order, onSave, onCancel, isLoading }) {
  const [formData, setFormData] = useState({
    site_id: "",
    item_name: "",
    sku: "",
    item_link: "",
    cost: "",
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
        cost: order.cost?.toString() || "",
        quantity: order.quantity || 1,
        shipping_address: order.shipping_address || "",
        notes: order.notes || ""
      });
    }
  }, [order]);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave({
      ...formData,
      cost: formData.cost ? parseFloat(formData.cost) : null,
      quantity: parseInt(formData.quantity) || 1
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-center justify-between pb-4 border-b border-slate-200">
        <h2 className="text-xl font-semibold text-slate-900">
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

        <div className="grid grid-cols-2 gap-4">
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
        </div>

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
          <Label htmlFor="cost">Estimated Cost ($)</Label>
          <div className="relative mt-1.5">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
            <Input
              id="cost"
              type="number"
              step="0.01"
              min="0"
              value={formData.cost}
              onChange={(e) => setFormData({ ...formData, cost: e.target.value })}
              placeholder="0.00"
              className="pl-7"
            />
          </div>
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
          onClick={() => onSave({ ...formData, cost: formData.cost ? parseFloat(formData.cost) : null, quantity: parseInt(formData.quantity) || 1, status: "draft" }, "draft")}
        >
          Save as Draft
        </Button>
        <Button
          type="button"
          disabled={isLoading}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          onClick={() => onSave({ ...formData, cost: formData.cost ? parseFloat(formData.cost) : null, quantity: parseInt(formData.quantity) || 1, status: "submitted" }, "submit")}
        >
          {isLoading ? "Submitting..." : "Submit Request"}
        </Button>
      </div>
    </form>
  );
}