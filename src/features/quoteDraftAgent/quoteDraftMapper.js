const firstValue = (record, keys, fallback = null) => {
  for (const key of keys) {
    if (record?.[key] !== undefined && record[key] !== null && record[key] !== "") {
      return record[key];
    }
  }
  return fallback;
};

export function buildQuotePayload(quote = {}) {
  return {
    quote: {
      id: quote.id,
      quote_number: quote.quote_number,
      site_id: quote.site_id,
      case_number: quote.case_number,
      quote_requester: quote.quote_requester,
      status: quote.status,
      valid_until: quote.valid_until,
      scope_of_work: quote.scope_of_work,
      notes: quote.notes,
      homeowner_summary: quote.homeowner_summary,
      internal_notes: quote.internal_notes,
      fst_count: quote.fst_count,
      labor_hours: quote.labor_hours,
      labor_rate: quote.labor_rate,
      labor_mode: quote.labor_mode,
      flat_labor_fee: quote.flat_labor_fee,
      travel_hours: quote.travel_hours,
      travel_rate: quote.travel_rate,
      miles_traveled: quote.miles_traveled,
      mileage_rate: quote.mileage_rate,
      tax_rates: {
        federal: quote.federal_tax_percent,
        state: quote.state_tax_percent,
        local: quote.local_tax_percent
      },
      items: Array.isArray(quote.items) ? quote.items : [],
      totals: {
        subtotal: quote.subtotal,
        total: quote.total,
        materials_total: quote.materials_total,
        labor_total: quote.labor_total,
        travel_total: quote.travel_total,
        sales_tax: quote.sales_tax
      }
    }
  };
}

function mapMaterials(materials, existingItems = []) {
  if (!Array.isArray(materials)) return existingItems;
  return materials.map((item) => {
    const productId = firstValue(item, ["product_id", "productId", "id"]);
    const existing = existingItems.find((candidate) => candidate.product_id === productId);
    const quantity = Number(firstValue(item, ["quantity", "qty"], 1)) || 1;
    const unitPrice = Number(firstValue(item, ["unit_price", "unitPrice", "price"], 0)) || 0;
    return {
      ...(existing || {}),
      product_id: productId || existing?.product_id || null,
      name: firstValue(item, ["name", "description"], existing?.name || "Material"),
      description: firstValue(item, ["description", "name"], existing?.description || ""),
      unit: firstValue(item, ["unit", "unit_of_measure"], existing?.unit || "each"),
      quantity,
      unit_price: unitPrice,
      total: Number(firstValue(item, ["total", "amount"], quantity * unitPrice)) || 0,
      taxable: item.taxable !== false,
      tax_code: firstValue(item, ["tax_code", "taxCode"], existing?.tax_code || null)
    };
  });
}

export function mapDraftToQuoteUpdate(draft = {}, quote = {}) {
  const labor = Array.isArray(draft.labor) ? draft.labor : [];
  const travel = Array.isArray(draft.travel) ? draft.travel : [];
  const laborHours = labor.reduce((sum, line) =>
    sum + (Number(firstValue(line, ["hours", "quantity", "qty"], 0)) || 0), 0);
  const travelHours = travel
    .filter((line) => !String(firstValue(line, ["description", "name"], "")).toLowerCase().includes("mile"))
    .reduce((sum, line) => sum + (Number(firstValue(line, ["hours", "quantity", "qty"], 0)) || 0), 0);
  const miles = travel
    .filter((line) => String(firstValue(line, ["description", "name"], "")).toLowerCase().includes("mile"))
    .reduce((sum, line) => sum + (Number(firstValue(line, ["miles", "quantity", "qty"], 0)) || 0), 0);
  const summary = firstValue(draft, ["homeownerSummary", "homeowner_summary"]);
  const internalNotes = firstValue(draft, ["internalNotes", "internal_notes"]);
  const riskStatement = firstValue(draft, ["riskStatement", "riskAdjustmentStatement", "risk_adjustment_statement"]);

  return {
    ...(draft.scopeOfWork || draft.scope_of_work ? {
      scope_of_work: firstValue(draft, ["scopeOfWork", "scope_of_work"])
    } : {}),
    ...(summary ? { homeowner_summary: summary } : {}),
    ...(internalNotes || riskStatement ? {
      notes: [internalNotes, riskStatement].filter(Boolean).join("\n\n")
    } : {}),
    ...(draft.materials ? { items: mapMaterials(draft.materials, quote.items || []) } : {}),
    ...(laborHours ? { labor_hours: laborHours } : {}),
    ...(draft.fst_count !== undefined ? { fst_count: Number(draft.fst_count) || 0 } : {}),
    ...(travelHours ? { travel_hours: travelHours } : {}),
    ...(miles ? { miles_traveled: miles } : {}),
    ...(draft.labor_rate !== undefined ? { labor_rate: Number(draft.labor_rate) || 0 } : {}),
    ...(draft.travel_rate !== undefined ? { travel_rate: Number(draft.travel_rate) || 0 } : {}),
    ...(draft.mileage_rate !== undefined ? { mileage_rate: Number(draft.mileage_rate) || 0 } : {})
  };
}

