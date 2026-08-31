import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import QuoteItemSelector from "./QuoteItemSelector";
import QuoteAIAssistant from "./QuoteAIAssistant";
import QuoteDraftButton from "@/features/quoteDraftAgent/QuoteDraftButton";

export default function QuoteForm({ quote, products, allQuotes = [], onSave, onSaveDraft, onSaveCopy, onCancel, isLoading, isAdmin }) {
  const [formData, setFormData] = useState({
    site_id: "",
    quote_requester: "",
    case_number: "",
    picklist: "",
    om_status: "",
    scope_of_work: "",
    homeowner_summary: "",
    fst_count: "",
    labor_hours: "",
    labor_mode: "hourly",
    flat_labor_fee: "",
    travel_hours: "",
    miles_traveled: "",
    items: [],
    discount_type: "percent",
    discount_percent: 0,
    discount_flat_amount: 0,
    federal_tax_percent: 0,
    state_tax_percent: 0,
    local_tax_percent: 0,
    notes: "",
    valid_until: ""
  });

  useEffect(() => {
    if (quote) {
      setFormData({
        site_id: quote.site_id || "",
        quote_requester: quote.quote_requester || "",
        case_number: quote.case_number || "",
        picklist: quote.picklist || "",
        om_status: quote.om_status || "",
        scope_of_work: quote.scope_of_work || "",
        homeowner_summary: quote.homeowner_summary || "",
        fst_count: quote.fst_count || "",
        labor_hours: quote.labor_hours || "",
        labor_mode: quote.labor_mode || "hourly",
        flat_labor_fee: quote.flat_labor_fee || "",
        travel_hours: quote.travel_hours || "",
        miles_traveled: quote.miles_traveled || "",
        items: quote.items || [],
        discount_type: quote.discount_type || "percent",
        discount_percent: quote.discount_percent || 0,
        discount_flat_amount: quote.discount_flat_amount || 0,
        federal_tax_percent: quote.federal_tax_percent || 0,
        state_tax_percent: quote.state_tax_percent || 0,
        local_tax_percent: quote.local_tax_percent || 0,
        notes: quote.notes || "",
        valid_until: quote.valid_until || ""
      });
    }
  }, [quote]);

  const isFlat = formData.labor_mode === "flat";
  const laborCharge = isFlat
    ? (parseFloat(formData.flat_labor_fee) || 0)
    : (parseFloat(formData.fst_count) || 0) * (parseFloat(formData.labor_hours) || 0) * 125;
  const mileageCharge = (parseFloat(formData.miles_traveled) || 0) * 0.73;
  const travelCharge = (parseFloat(formData.travel_hours) || 0) * 65;
  const subtotal = formData.items.reduce((sum, item) => sum + item.total, 0) + laborCharge + mileageCharge + travelCharge;
  const discountAmount = formData.discount_type === "flat"
    ? Math.min(parseFloat(formData.discount_flat_amount) || 0, subtotal)
    : subtotal * (parseFloat(formData.discount_percent) / 100);
  const afterDiscount = subtotal - discountAmount;
  const taxableAmount = formData.items
    .filter(item => item.taxable !== false)
    .reduce((sum, item) => sum + item.total, 0);
  const taxableAfterDiscount = taxableAmount - (taxableAmount / subtotal) * discountAmount;
  const federalTaxAmount = taxableAfterDiscount * (formData.federal_tax_percent / 100);
  const stateTaxAmount = taxableAfterDiscount * (formData.state_tax_percent / 100);
  const localTaxAmount = taxableAfterDiscount * (formData.local_tax_percent / 100);
  const totalTaxAmount = federalTaxAmount + stateTaxAmount + localTaxAmount;
  const total = afterDiscount + totalTaxAmount;

  const requiredFieldsComplete = Boolean(
    formData.picklist &&
    formData.om_status &&
    formData.site_id &&
    formData.quote_requester &&
    formData.case_number &&
    formData.valid_until &&
    formData.scope_of_work?.trim() &&
    formData.travel_hours &&
    formData.miles_traveled &&
    (isFlat ? formData.flat_labor_fee : formData.fst_count && formData.labor_hours)
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!requiredFieldsComplete) return;
    onSave({
      ...formData,
      subtotal,
      total,
      discount_type: formData.discount_type,
      discount_percent: parseFloat(formData.discount_percent) || 0,
      discount_flat_amount: parseFloat(formData.discount_flat_amount) || 0,
      federal_tax_percent: parseFloat(formData.federal_tax_percent) || 0,
      state_tax_percent: parseFloat(formData.state_tax_percent) || 0,
      local_tax_percent: parseFloat(formData.local_tax_percent) || 0,
      fst_count: parseFloat(formData.fst_count) || 0,
      labor_hours: parseFloat(formData.labor_hours) || 0,
      labor_rate: 125.0,
      labor_mode: formData.labor_mode,
      flat_labor_fee: parseFloat(formData.flat_labor_fee) || 0,
      travel_hours: parseFloat(formData.travel_hours) || 0,
      miles_traveled: parseFloat(formData.miles_traveled) || 0,
      mileage_rate: 0.73,
      travel_rate: 65.0
    });
  };

  const handleSaveDraft = (draftType) => {
    if (!requiredFieldsComplete) return;
    if (onSaveDraft) {
      onSaveDraft({
        ...formData,
        subtotal,
        total,
        status: draftType,
        discount_type: formData.discount_type,
        discount_percent: parseFloat(formData.discount_percent) || 0,
        discount_flat_amount: parseFloat(formData.discount_flat_amount) || 0,
        federal_tax_percent: parseFloat(formData.federal_tax_percent) || 0,
        state_tax_percent: parseFloat(formData.state_tax_percent) || 0,
        local_tax_percent: parseFloat(formData.local_tax_percent) || 0,
        fst_count: parseFloat(formData.fst_count) || 0,
        labor_hours: parseFloat(formData.labor_hours) || 0,
        labor_rate: 125.0,
        labor_mode: formData.labor_mode,
        flat_labor_fee: parseFloat(formData.flat_labor_fee) || 0,
        travel_hours: parseFloat(formData.travel_hours) || 0,
        miles_traveled: parseFloat(formData.miles_traveled) || 0,
        mileage_rate: 0.73,
        travel_rate: 65.0
      });
    }
  };

  const handleSaveCopy = () => {
    if (!requiredFieldsComplete || !onSaveCopy) return;
    onSaveCopy({
      ...formData,
      subtotal,
      total,
      discount_type: formData.discount_type,
      discount_percent: parseFloat(formData.discount_percent) || 0,
      discount_flat_amount: parseFloat(formData.discount_flat_amount) || 0,
      federal_tax_percent: parseFloat(formData.federal_tax_percent) || 0,
      state_tax_percent: parseFloat(formData.state_tax_percent) || 0,
      local_tax_percent: parseFloat(formData.local_tax_percent) || 0,
      fst_count: parseFloat(formData.fst_count) || 0,
      labor_hours: parseFloat(formData.labor_hours) || 0,
      labor_rate: 125.0,
      labor_mode: formData.labor_mode,
      flat_labor_fee: parseFloat(formData.flat_labor_fee) || 0,
      travel_hours: parseFloat(formData.travel_hours) || 0,
      miles_traveled: parseFloat(formData.miles_traveled) || 0,
      mileage_rate: 0.73,
      travel_rate: 65.0
    });
  };

  const handleAIScopeGenerated = (scope) => {
    setFormData({ ...formData, scope_of_work: scope });
  };

  const handleAIProductsSuggested = (suggestions) => {
    const newItems = suggestions
      .map(suggestion => {
        const product = products.find(p => p.id === suggestion.product_id);
        if (!product) return null;
        return {
          product_id: product.id,
          name: product.name,
          description: product.description,
          unit_price: product.unit_price,
          quantity: suggestion.quantity,
          unit: product.unit,
          total: product.unit_price * suggestion.quantity
        };
      })
      .filter(Boolean);
    
    setFormData({ ...formData, items: [...formData.items, ...newItems] });
  };

  const handleAIPriceEstimate = (estimate) => {
    const message = `AI Estimate:\n• Price Range: $${estimate.estimated_min.toFixed(0)} - $${estimate.estimated_max.toFixed(0)}\n• Labor: ${estimate.suggested_labor_hours} hours\n• FSTs: ${estimate.suggested_fst_count}\n\n${estimate.reasoning}`;
    alert(message);
    
    if (estimate.suggested_labor_hours && !formData.labor_hours) {
      setFormData({ 
        ...formData, 
        labor_hours: estimate.suggested_labor_hours,
        fst_count: estimate.suggested_fst_count || formData.fst_count
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* AI Assistant */}
      <QuoteAIAssistant
        products={products}
        allQuotes={allQuotes}
        currentScope={formData.scope_of_work}
        onScopeGenerated={handleAIScopeGenerated}
        onProductsSuggested={handleAIProductsSuggested}
        onPriceEstimate={handleAIPriceEstimate}
      />

      {/* Site Information */}
      <Card className="p-6 border-slate-200">
        <h3 className="text-lg font-semibold text-slate-900 mb-4">Site Information</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="picklist">Picklist *</Label>
            <Select
              value={formData.picklist}
              onValueChange={(value) => setFormData({ ...formData, picklist: value })}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="--None--" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ABC">ABC</SelectItem>
                <SelectItem value="Gateway Upgrade">Gateway Upgrade</SelectItem>
                <SelectItem value="Cell Modem Upgrade">Cell Modem Upgrade</SelectItem>
                <SelectItem value="SPWR Monitoring Upgrade">SPWR Monitoring Upgrade</SelectItem>
                <SelectItem value="LPUP Battery Upgrade">LPUP Battery Upgrade</SelectItem>
                <SelectItem value="LPUP Microinverter Upgrade">LPUP Microinverter Upgrade</SelectItem>
                <SelectItem value="Battery Install">Battery Install</SelectItem>
                <SelectItem value="Microinverter Install">Microinverter Install</SelectItem>
                <SelectItem value="TPUP Battery Upgrade">TPUP Battery Upgrade</SelectItem>
                <SelectItem value="TPUP Microinverter Upgrade">TPUP Microinverter Upgrade</SelectItem>
                <SelectItem value="Follow-Up SPWR Monitoring Upgrade">Follow-Up SPWR Monitoring Upgrade</SelectItem>
                <SelectItem value="Follow-Up Gateway Upgrade">Follow-Up Gateway Upgrade</SelectItem>
                <SelectItem value="Enphase Care">Enphase Care</SelectItem>
                <SelectItem value="On-Demand">On-Demand</SelectItem>
                <SelectItem value="Accessories">Accessories</SelectItem>
                <SelectItem value="Propel">Propel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="om_status">O&M Status *</Label>
            <Select
              value={formData.om_status}
              onValueChange={(value) => setFormData({ ...formData, om_status: value })}
            >
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="--None--" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Remote Troubleshooting">Remote Troubleshooting</SelectItem>
                <SelectItem value="Pre-Scheduled">Pre-Scheduled</SelectItem>
                <SelectItem value="Pending Schedule">Pending Schedule</SelectItem>
                <SelectItem value="Pending Travel Plan">Pending Travel Plan</SelectItem>
                <SelectItem value="Pending RMA">Pending RMA</SelectItem>
                <SelectItem value="Pending Quote">Pending Quote</SelectItem>
                <SelectItem value="Waiting on Customer">Waiting on Customer</SelectItem>
                <SelectItem value="Waiting on Installer">Waiting on Installer</SelectItem>
                <SelectItem value="Self-Clearing Issue">Self-Clearing Issue</SelectItem>
                <SelectItem value="Unresponsive Customer">Unresponsive Customer</SelectItem>
                <SelectItem value="Quote Requested">Quote Requested</SelectItem>
                <SelectItem value="Quote Missing Details">Quote Missing Details</SelectItem>
                <SelectItem value="Quote Draft">Quote Draft</SelectItem>
                <SelectItem value="Quote Pending Approval">Quote Pending Approval</SelectItem>
                <SelectItem value="Quote Pending Payment">Quote Pending Payment</SelectItem>
                <SelectItem value="Quote Pending Materials">Quote Pending Materials</SelectItem>
                <SelectItem value="Follow-Up Required">Follow-Up Required</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="site_id">Site ID *</Label>
            <Input
              id="site_id"
              value={formData.site_id}
              onChange={(e) => setFormData({ ...formData, site_id: e.target.value })}
              placeholder="e.g., SITE-001"
              required
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="quote_requester">Quote Requester *</Label>
            <Input
              id="quote_requester"
              value={formData.quote_requester}
              onChange={(e) => setFormData({ ...formData, quote_requester: e.target.value })}
              placeholder="Technician who requested this quote"
              required
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="case_number">Case Number *</Label>
            <Input
              id="case_number"
              value={formData.case_number}
              onChange={(e) => setFormData({ ...formData, case_number: e.target.value })}
              placeholder="e.g., CASE-12345"
              required
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="valid_until">Valid Until *</Label>
            <Input
              id="valid_until"
              type="date"
              value={formData.valid_until}
              onChange={(e) => setFormData({ ...formData, valid_until: e.target.value })}
              required
              className="mt-1.5"
            />
          </div>
          <div className="md:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <Label htmlFor="scope_of_work">Scope of Work Description *</Label>
              <QuoteDraftButton
                quote={{ ...quote, ...formData }}
                onApply={(draftData) => setFormData((current) => ({ ...current, ...draftData }))}
              />
            </div>
            <Textarea
              id="scope_of_work"
              value={formData.scope_of_work}
              onChange={(e) => setFormData({ ...formData, scope_of_work: e.target.value })}
              placeholder="Describe the scope of work..."
              required
              rows={3}
              className="mt-1.5"
            />
          </div>
          {/* Labor Mode Toggle (admin only) */}
          {isAdmin && (
            <div className="md:col-span-2 flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <span className={`text-sm font-medium ${!isFlat ? "text-slate-900" : "text-slate-400"}`}>Hourly Labor</span>
              <Switch
                checked={isFlat}
                onCheckedChange={(checked) => setFormData({ ...formData, labor_mode: checked ? "flat" : "hourly", flat_labor_fee: "", fst_count: "", labor_hours: "" })}
              />
              <span className={`text-sm font-medium ${isFlat ? "text-slate-900" : "text-slate-400"}`}>Flat Labor Fee</span>
              <span className="text-xs text-amber-700 ml-2">(Admin only)</span>
            </div>
          )}

          {!isFlat ? (
            <>
              <div>
                <Label htmlFor="fst_count">Number of FSTs Needed *</Label>
                <Input
                  id="fst_count"
                  type="number"
                  min="0"
                  value={formData.fst_count}
                  onChange={(e) => setFormData({ ...formData, fst_count: e.target.value })}
                  placeholder="e.g., 2"
                                required
                                className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="labor_hours">Number of Labor Hours on Site *</Label>
                <Input
                  id="labor_hours"
                  type="number"
                  min="0"
                  step="0.5"
                  value={formData.labor_hours}
                  onChange={(e) => setFormData({ ...formData, labor_hours: e.target.value })}
                  placeholder="e.g., 8"
                                required
                                className="mt-1.5"
                />
              </div>
            </>
          ) : (
            <div className="md:col-span-2">
              <Label htmlFor="flat_labor_fee">Flat Labor Fee ($) *</Label>
              <Input
                id="flat_labor_fee"
                type="number"
                min="0"
                step="0.01"
                value={formData.flat_labor_fee}
                onChange={(e) => setFormData({ ...formData, flat_labor_fee: e.target.value })}
                placeholder="e.g., 1500.00"
                              required
                              className="mt-1.5"
              />
              <p className="text-xs text-slate-500 mt-1">Fixed labor cost — no hourly calculation applied</p>
            </div>
          )}
          <div>
            <Label htmlFor="travel_hours">Total Travel Hours (combined) *</Label>
            <Input
              id="travel_hours"
              type="number"
              min="0"
              step="0.5"
              value={formData.travel_hours}
              onChange={(e) => setFormData({ ...formData, travel_hours: e.target.value })}
              placeholder="e.g., 1.5"
              required
              className="mt-1.5"
            />
            <p className="text-xs text-slate-500 mt-1">$65 per hour</p>
          </div>
          <div>
            <Label htmlFor="miles_traveled">Miles Traveled (combined) *</Label>
            <Input
              id="miles_traveled"
              type="number"
              min="0"
              step="0.1"
              value={formData.miles_traveled}
              onChange={(e) => setFormData({ ...formData, miles_traveled: e.target.value })}
              placeholder="e.g., 45"
              required
              className="mt-1.5"
            />
            <p className="text-xs text-slate-500 mt-1">$0.73 per mile</p>
          </div>
        </div>
      </Card>

      {/* Item Selection */}
      <Card className="p-6 border-slate-200">
        <QuoteItemSelector
          products={products}
          selectedItems={formData.items}
          onItemsChange={(items) => setFormData({ ...formData, items })}
        />
      </Card>

      {/* Totals & Notes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Notes & Terms</h3>
          <Textarea
            value={formData.notes}
            onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
            placeholder="Add any notes, terms, or conditions..."
            rows={6}
          />
        </Card>

        <Card className="p-6 border-slate-200">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Summary</h3>
          <div className="space-y-4">
            <div className="flex justify-between text-slate-600">
              <span>Items Subtotal</span>
              <span>${(subtotal - laborCharge - mileageCharge - travelCharge).toFixed(2)}</span>
            </div>
            {laborCharge > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>{isFlat ? "Labor (Flat Fee)" : `Labor (${formData.fst_count} FSTs × ${formData.labor_hours} hrs @ $125)`}</span>
                <span>${laborCharge.toFixed(2)}</span>
              </div>
            )}
            {travelCharge > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Travel ({formData.travel_hours} hrs @ $65)</span>
                <span>${travelCharge.toFixed(2)}</span>
              </div>
            )}
            {mileageCharge > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Mileage ({formData.miles_traveled} mi @ $0.73)</span>
                <span>${mileageCharge.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-700 font-medium pt-2 border-t border-slate-200">
              <span>Subtotal</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            
            <div className="flex items-center justify-between gap-4">
              <Label className="text-slate-600 shrink-0">Discount</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={formData.discount_type}
                  onValueChange={(value) => setFormData({ ...formData, discount_type: value })}
                >
                  <SelectTrigger className="w-28 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent">Percent %</SelectItem>
                    <SelectItem value="flat">Flat $</SelectItem>
                  </SelectContent>
                </Select>
                {formData.discount_type === "flat" ? (
                  <>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={formData.discount_flat_amount}
                      onChange={(e) => setFormData({ ...formData, discount_flat_amount: e.target.value })}
                      className="w-24 h-8 text-right"
                    />
                    <span className="text-slate-500">$</span>
                  </>
                ) : (
                  <>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      value={formData.discount_percent}
                      onChange={(e) => setFormData({ ...formData, discount_percent: e.target.value })}
                      className="w-20 h-8 text-right"
                    />
                    <span className="text-slate-500">%</span>
                  </>
                )}
                <span className="text-slate-600 w-24 text-right">-${discountAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="federal_tax" className="text-slate-600 shrink-0">Federal Tax</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="federal_tax"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.federal_tax_percent}
                  onChange={(e) => setFormData({ ...formData, federal_tax_percent: e.target.value })}
                  className="w-20 h-8 text-right"
                />
                <span className="text-slate-500">%</span>
                <span className="text-slate-600 w-24 text-right">+${federalTaxAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="state_tax" className="text-slate-600 shrink-0">State Tax</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="state_tax"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.state_tax_percent}
                  onChange={(e) => setFormData({ ...formData, state_tax_percent: e.target.value })}
                  className="w-20 h-8 text-right"
                />
                <span className="text-slate-500">%</span>
                <span className="text-slate-600 w-24 text-right">+${stateTaxAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label htmlFor="local_tax" className="text-slate-600 shrink-0">Local Tax</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="local_tax"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={formData.local_tax_percent}
                  onChange={(e) => setFormData({ ...formData, local_tax_percent: e.target.value })}
                  className="w-20 h-8 text-right"
                />
                <span className="text-slate-500">%</span>
                <span className="text-slate-600 w-24 text-right">+${localTaxAmount.toFixed(2)}</span>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-between items-center">
              <span className="text-lg font-semibold text-slate-900">Total</span>
              <span className="text-2xl font-bold text-orange-600">${total.toFixed(2)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-4 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1 md:flex-none">
          Cancel
        </Button>
        {onSaveDraft && !quote && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button 
                type="button" 
                variant="outline" 
                disabled={isLoading || !requiredFieldsComplete}
                className="flex-1 md:flex-none"
              >
                Save as Draft
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleSaveDraft("draft_without_internal")}>
                Draft w/o Internal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleSaveDraft("draft_without_fst")}>
                Draft w/o FST
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {quote && onSaveCopy && (
          <Button
            type="button"
            variant="outline"
            onClick={handleSaveCopy}
            disabled={isLoading || formData.items.length === 0 || !requiredFieldsComplete}
            className="flex-1 md:flex-none border-indigo-200 text-indigo-700 hover:bg-indigo-50"
          >
            Save Copy as Option
          </Button>
        )}
        <Button type="submit" disabled={isLoading || formData.items.length === 0 || !requiredFieldsComplete} className="flex-1 md:flex-none bg-orange-600 hover:bg-orange-700">
          {isLoading ? "Saving..." : quote ? "Update Quote" : "Preview & Submit"}
        </Button>
      </div>
    </form>
  );
}