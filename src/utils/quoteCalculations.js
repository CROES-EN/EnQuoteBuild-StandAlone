/**
 * Shared quote calculation logic — matches the PDF generator.
 * Tax is applied ONLY to line items marked taxable (item.taxable !== false).
 * Labor, travel, and mileage are never taxed.
 * Discounts are proportionally allocated to the taxable portion.
 */
export function calculateQuoteTotals(quote) {
  const items = quote.items || [];
  const itemsSubtotal = items.reduce((sum, item) => sum + (item.total || 0), 0);

  const laborCost = quote.labor_mode === "flat"
    ? (quote.flat_labor_fee || 0)
    : (quote.fst_count || 0) * (quote.labor_hours || 0) * (quote.labor_rate || 125);
  const travelCost = (quote.travel_hours || 0) * (quote.travel_rate || 65);
  const mileageCost = (quote.miles_traveled || 0) * (quote.mileage_rate || 0.73);

  const subtotal = quote.subtotal || (itemsSubtotal + laborCost + travelCost + mileageCost);

  const discountAmount = quote.discount_type === "flat"
    ? (quote.discount_flat_amount || 0)
    : (subtotal * (quote.discount_percent || 0) / 100);

  const combinedTaxRate = (quote.federal_tax_percent || 0) + (quote.state_tax_percent || 0) + (quote.local_tax_percent || 0);

  // Only taxable items are subject to tax
  const taxableItemsAmount = items
    .filter(item => item.taxable !== false)
    .reduce((sum, item) => sum + (item.total || 0), 0);

  // Proportionally allocate discount to the taxable portion
  const taxableShare = subtotal > 0 ? taxableItemsAmount / subtotal : 0;
  const taxableAfterDiscount = Math.max(0, taxableItemsAmount - taxableShare * discountAmount);

  const taxAmount = taxableAfterDiscount * combinedTaxRate / 100;
  const afterDiscount = subtotal - discountAmount;
  const total = afterDiscount + taxAmount;

  return {
    itemsSubtotal,
    laborCost,
    travelCost,
    mileageCost,
    subtotal,
    discountAmount,
    combinedTaxRate,
    taxableItemsAmount,
    taxableAfterDiscount,
    taxAmount,
    afterDiscount,
    total
  };
}