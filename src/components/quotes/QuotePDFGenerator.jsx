import jsPDF from "jspdf";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { listLocalCollection } from "@/api/dataClient";
import { calculateQuoteTotals } from "@/utils/quoteCalculations";

function formatCurrency(value) {
  return "$" + (value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Normalize Unicode characters that jsPDF's default font can't render
function normalizeText(text) {
  if (!text) return text;
  return text
    .replace(/\u2011/g, '-')   // non-breaking hyphen → hyphen
    .replace(/\u2013/g, '-')   // en dash → hyphen
    .replace(/\u2014/g, '--')  // em dash → double hyphen
    .replace(/\u2022/g, '*')   // bullet → asterisk
    .replace(/\u2018|\u2019/g, "'")  // curly single quotes → straight
    .replace(/\u201c|\u201d/g, '"'); // curly double quotes → straight
}

export async function generateQuotePDF(quote, versionHistory = []) {
  // Fetch PDF template settings
  let template = {
    company_name: "QuotePro",
    primary_color: "#4f46e5",
    include_version_history: true
  };
  
  try {
    const templates = await listLocalCollection("pdfTemplates");
    if (templates.length > 0) {
      template = { ...template, ...templates[0] };
    }
  } catch (error) {
    console.warn("Could not load PDF template settings, using defaults");
  }

  const doc = new jsPDF();
  const PAGE_BOTTOM = 270;
  let yPos = 20;

  // Starts a new page whenever the upcoming content wouldn't fit in the
  // remaining space, so nothing ever gets drawn off-page (jsPDF does not
  // paginate automatically).
  function ensureSpace(neededHeight) {
    if (yPos + neededHeight > PAGE_BOTTOM) {
      doc.addPage();
      yPos = 20;
      return true;
    }
    return false;
  }

  // Guards against invalid/missing dates so a bad record can't crash PDF
  // generation entirely.
  function safeFormatDate(value, pattern = "MMM d, yyyy") {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return format(parsed, pattern);
  }
  
  // Company Header
  doc.setFontSize(20);
  doc.setFont(undefined, 'bold');
  doc.setTextColor("#FF6B35");
  doc.text(template.company_name || "ENquote", 20, yPos);
  yPos += 8;
  
  // Company Info (if available)
  if (template.company_address || template.company_phone || template.company_email) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    if (template.company_address) {
      doc.text(template.company_address, 20, yPos);
      yPos += 5;
    }
    if (template.company_phone) {
      doc.text(template.company_phone, 20, yPos);
      yPos += 5;
    }
    if (template.company_email) {
      doc.text(template.company_email, 20, yPos);
      yPos += 5;
    }
  }
  
  doc.setTextColor(0, 0, 0);
  yPos += 8;
  
  // Quote Title
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text("Quote", 20, yPos);
  yPos += 10;
  
  // Quote Number and Date
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Quote #: ${quote.quote_number || 'N/A'}`, 20, yPos);
  yPos += 6;
  doc.text(`Date: ${safeFormatDate(quote.created_date) || 'N/A'}`, 20, yPos);
  yPos += 6;
  const validUntilText = safeFormatDate(quote.valid_until);
  if (validUntilText) {
    doc.text(`Valid Until: ${validUntilText}`, 20, yPos);
    yPos += 6;
  }
  yPos += 8;
  
  // Site Information
  ensureSpace(40);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Site Information", 20, yPos);
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Site ID: ${quote.site_id || 'N/A'}`, 20, yPos);
  yPos += 6;
  if (quote.case_number) {
    doc.text(`Case Number: ${quote.case_number}`, 20, yPos);
    yPos += 6;
  }
  if (quote.picklist) {
    doc.text(`Project Picklist: ${quote.picklist}`, 20, yPos);
    yPos += 6;
  }
  if (quote.quote_requester) {
    doc.text(`FST Requester: ${quote.quote_requester}`, 20, yPos);
    yPos += 6;
  }
  if (quote.fst_count > 0) {
    doc.text(`FSTs Needed: ${quote.fst_count}`, 20, yPos);
    yPos += 6;
  }
  if (quote.labor_hours > 0) {
    doc.text(`Labor Hours: ${quote.labor_hours}`, 20, yPos);
    yPos += 6;
  }
  // Travel/mileage counts are shown broken out alongside their dollar amounts
  // in the totals section below, rather than duplicated here.
  yPos += 4;
  
  // Scope of Work
  if (quote.scope_of_work) {
    ensureSpace(20);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Scope of Work", 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const scopeLines = doc.splitTextToSize(normalizeText(quote.scope_of_work), 170);
    for (const line of scopeLines) {
      ensureSpace(5);
      doc.text(line, 20, yPos);
      yPos += 5;
    }
    yPos += 6;
  }
  
  // Line Items Table
  ensureSpace(25);
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Line Items", 20, yPos);
  yPos += 8;
  
  // Table Header
  function drawLineItemsHeader() {
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text("Item", 20, yPos);
    doc.text("Qty", 105, yPos, { align: "right" });
    doc.text("Unit Price", 140, yPos, { align: "right" });
    doc.text("Total", 180, yPos, { align: "right" });
    yPos += 2;
    doc.line(20, yPos, 190, yPos);
    yPos += 6;
    doc.setFont(undefined, 'normal');
  }
  drawLineItemsHeader();
  
  // Table Rows
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  const lineItems = quote.items || [];
  if (lineItems.length === 0) {
    doc.setFont(undefined, 'italic');
    doc.setTextColor(120, 120, 120);
    doc.text("No line items on this quote.", 20, yPos);
    doc.setTextColor(0, 0, 0);
    doc.setFont(undefined, 'normal');
    yPos += 8;
  }
  for (const item of lineItems) {
    const itemName = doc.splitTextToSize(item.name || "Untitled item", 75);
    const nameHeight = itemName.length * 4;
    const rowHeight = Math.max(nameHeight, 5) + 3;

    if (ensureSpace(rowHeight)) {
      drawLineItemsHeader();
    }
    
    doc.text(itemName, 20, yPos);
    
    doc.text(`${item.quantity ?? 0} ${item.unit || ''}`.trim(), 105, yPos, { align: "right" });
    doc.text(formatCurrency(item.unit_price), 140, yPos, { align: "right" });
    doc.text(formatCurrency(item.total), 180, yPos, { align: "right" });
    
    yPos += rowHeight;
  }
  
  // Totals - calculated with the same shared utility used elsewhere in the app
  yPos += 8;
  const totals = calculateQuoteTotals(quote);
  const laborCharge = totals.laborCost;
  const travelCharge = totals.travelCost;
  const mileageCharge = totals.mileageCost;
  const laborTravelTotal = laborCharge + travelCharge + mileageCharge;
  const materialsTotal = totals.itemsSubtotal;
  const subtotal = totals.subtotal;
  const discountAmount = totals.discountAmount;
  const federalTax = quote.federal_tax_percent || 0;
  const stateTax = quote.state_tax_percent || 0;
  const localTax = quote.local_tax_percent || 0;
  const totalTaxPercent = totals.combinedTaxRate;
  const totalTaxAmount = totals.taxAmount;

  ensureSpace(20);
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.line(20, yPos, 190, yPos);
  yPos += 7;

  // Labor, Travel & Mileage - combined charge with the stored rates/hours/
  // miles broken out beneath it so nothing is hidden inside one lump sum.
  if (laborTravelTotal > 0) {
    ensureSpace(6);
    doc.text("Labor, Travel & Mileage:", 20, yPos);
    doc.text(formatCurrency(laborTravelTotal), 180, yPos, { align: "right" });
    yPos += 5;

    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    if (laborCharge > 0) {
      ensureSpace(4);
      const laborDetail = quote.labor_mode === "flat"
        ? `Labor (flat fee): ${formatCurrency(laborCharge)}`
        : `Labor (${quote.fst_count || 0} FST${(quote.fst_count || 0) === 1 ? '' : 's'} x ${quote.labor_hours || 0} hrs @ $${(quote.labor_rate || 125).toFixed(2)}/hr): ${formatCurrency(laborCharge)}`;
      doc.text(laborDetail, 24, yPos);
      yPos += 4;
    }
    if (travelCharge > 0) {
      ensureSpace(4);
      doc.text(`Travel (${quote.travel_hours || 0} hrs @ $${(quote.travel_rate || 65).toFixed(2)}/hr): ${formatCurrency(travelCharge)}`, 24, yPos);
      yPos += 4;
    }
    if (mileageCharge > 0) {
      ensureSpace(4);
      doc.text(`Mileage (${quote.miles_traveled || 0} mi @ $${(quote.mileage_rate || 0.73).toFixed(2)}/mi): ${formatCurrency(mileageCharge)}`, 24, yPos);
      yPos += 4;
    }
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    yPos += 2;
  }

  // Materials
  if (materialsTotal > 0) {
    ensureSpace(6);
    doc.text("Materials:", 20, yPos);
    doc.text(formatCurrency(materialsTotal), 180, yPos, { align: "right" });
    yPos += 6;
  }

  // Subtotal
  ensureSpace(6);
  doc.text("Subtotal:", 20, yPos);
  doc.text(formatCurrency(subtotal), 180, yPos, { align: "right" });
  yPos += 6;

  if (discountAmount > 0) {
    ensureSpace(6);
    const discountLabel = quote.discount_type === "flat"
      ? `Discount (${formatCurrency(quote.discount_flat_amount || 0)} off):`
      : `Discount (${quote.discount_percent || 0}%):`;
    doc.text(discountLabel, 20, yPos);
    doc.text(`-${formatCurrency(discountAmount)}`, 180, yPos, { align: "right" });
    yPos += 6;
  }

  // Tax (only on taxable items) - broken out by jurisdiction when more than one applies
  if (totalTaxPercent > 0 && totalTaxAmount > 0) {
    ensureSpace(6);
    doc.text(`Tax (${totalTaxPercent}%):`, 20, yPos);
    doc.text(formatCurrency(totalTaxAmount), 180, yPos, { align: "right" });
    yPos += 5;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    const taxParts = [];
    if (federalTax > 0) taxParts.push(`Federal ${federalTax}%`);
    if (stateTax > 0) taxParts.push(`State ${stateTax}%`);
    if (localTax > 0) taxParts.push(`Local ${localTax}%`);
    ensureSpace(4);
    doc.text(
      taxParts.length > 1
        ? `(${taxParts.join(' + ')} - applied to taxable items only)`
        : `(applied to taxable items only)`,
      20, yPos
    );
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    yPos += 5;
  }
  
  yPos += 2;
  ensureSpace(15);
  doc.line(20, yPos, 190, yPos);
  yPos += 7;
  
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text("Total:", 20, yPos);
  doc.text(formatCurrency(quote.total), 180, yPos, { align: "right" });
  doc.setFont(undefined, 'normal');
  yPos += 10;
  
  // Notes
  if (quote.notes) {
    yPos += 5;
    ensureSpace(20);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Notes & Terms", 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const LINE_HEIGHT = 5.5;
    const notesParagraphs = normalizeText(quote.notes).split('\n');
    for (const paragraph of notesParagraphs) {
      const notesLines = doc.splitTextToSize(paragraph.trim() || ' ', 170);
      const blockHeight = notesLines.length * LINE_HEIGHT;
      // If this paragraph block won't fit, start a new page
      if (ensureSpace(blockHeight)) {
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
      }
      doc.text(notesLines, 20, yPos);
      yPos += blockHeight + 1.5;
    }
  }
  
  // Version History
  if (template.include_version_history && versionHistory && versionHistory.length > 1) {
    yPos += 10;
    ensureSpace(16);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Version History", 20, yPos);
    yPos += 8;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    
    const sortedVersions = [...versionHistory].sort((a, b) => (b.version_number || 0) - (a.version_number || 0));
    for (const version of sortedVersions) {
      ensureSpace(6);
      const versionDate = safeFormatDate(version.created_date) || "Unknown date";
      const versionText = `v${version.version_number || 1} - ${versionDate} - ${version.status || 'unknown'} - ${formatCurrency(version.total)}`;
      doc.text(versionText, 20, yPos);
      yPos += 6;
    }
  }
  
  // Footer
  if (template.footer_text) {
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(150, 150, 150);
      doc.text(template.footer_text, 105, 285, { align: "center" });
    }
  }
  
  // Convert to blob
  return doc.output('blob');
}

export async function generateCustomerQuotePDF(quote) {
  let template = {
    company_name: "QuotePro",
    primary_color: "#4f46e5",
  };
  try {
    const templates = await listLocalCollection("pdfTemplates");
    if (templates.length > 0) {
      template = { ...template, ...templates[0] };
    }
  } catch (error) {
    console.warn("Could not load PDF template settings, using defaults");
  }

  const doc = new jsPDF();
  let yPos = 20;

  // Company Header — Enphase logo (scaled proportionally)
  const logoUrl = "https://media.base44.com/images/public/6979390a3f44099ffca06859/b5a55d7e6_image.png";
  try {
    const props = doc.getImageProperties(logoUrl);
    const targetWidth = 36;
    const targetHeight = (props.height * targetWidth) / props.width;
    doc.addImage(logoUrl, "PNG", 20, yPos - 4, targetWidth, targetHeight);
    yPos += targetHeight + 6;
  } catch (e) {
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.setTextColor("#FF6B35");
    doc.text("ENPHASE", 20, yPos + 8);
    yPos += 16;
  }

  if (template.company_address || template.company_phone || template.company_email) {
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    if (template.company_address) { doc.text(template.company_address, 20, yPos); yPos += 5; }
    if (template.company_phone) { doc.text(template.company_phone, 20, yPos); yPos += 5; }
    if (template.company_email) { doc.text(template.company_email, 20, yPos); yPos += 5; }
  }

  doc.setTextColor(0, 0, 0);
  yPos += 8;

  // Quote Title
  doc.setFontSize(16);
  doc.setFont(undefined, 'bold');
  doc.text("Quote", 20, yPos);
  yPos += 10;

  // Quote Number and Date
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Quote #: ${quote.quote_number || 'N/A'}`, 20, yPos);
  yPos += 6;
  yPos += 8;

  // Site Information
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Site Information", 20, yPos);
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Site ID: ${quote.site_id || 'N/A'}`, 20, yPos);
  yPos += 10;

  // Scope of Work — AI-simplified for customer clarity
  if (quote.scope_of_work) {
    let customerScope = "";
    let usedRawFallback = false;
    try {
      const llmResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `You are writing a brief, plain-English summary of solar service work for a homeowner. Rewrite the following scope of work into 2-3 short sentences that a non-technical customer can easily understand. Remove all internal jargon, part numbers, technician notes, internal process references, or anything that could cause confusion or concern. Keep it reassuring and professional. Do not include pricing — just describe what work will be done.\n\nScope of work:\n${quote.scope_of_work}`,
        response_json_schema: {
          type: "object",
          properties: {
            summary: { type: "string" }
          }
        }
      });
      customerScope = llmResponse?.summary || "";
    } catch (error) {
      console.warn("Could not generate simplified scope, falling back to the raw scope of work");
    }

    // Always describe the work being done - fall back to the raw scope of
    // work text when the AI summary isn't available (e.g. no AI integration
    // configured) so this section is never left empty.
    if (!customerScope) {
      customerScope = quote.scope_of_work;
      usedRawFallback = true;
    }

    if (customerScope) {
      if (yPos > 240) { doc.addPage(); yPos = 20; }
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text(usedRawFallback ? "Scope of Work" : "Summary of Work", 20, yPos);
      yPos += 8;
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const scopeLines = doc.splitTextToSize(normalizeText(customerScope), 170);
      for (const line of scopeLines) {
        if (yPos > 270) {
          doc.addPage();
          yPos = 20;
          doc.setFontSize(10);
          doc.setFont(undefined, 'normal');
        }
        doc.text(line, 20, yPos);
        yPos += 5;
      }
      yPos += 10;
    }
  }

  // Calculate totals using the shared calculation utility
  const totals = calculateQuoteTotals(quote);
  const materialsTotal = totals.itemsSubtotal;
  const laborTravelTotal = totals.laborCost + totals.travelCost + totals.mileageCost;
  const subtotal = totals.subtotal;
  const discountAmount = totals.discountAmount;
  const taxAmount = totals.taxAmount;
  const total = totals.total;
  const hasDiscount = discountAmount > 0;
  const hasTax = taxAmount > 0;

  // Pricing Summary Table
  if (yPos > 220) { doc.addPage(); yPos = 20; }

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Pricing Summary", 20, yPos);
  yPos += 8;

  const tableLeft = 20;
  const tableRight = 190;
  const tableWidth = tableRight - tableLeft;
  const priceCol = tableRight - 4;
  const rowH = 9;
  const tableTop = yPos;

  // Header row
  doc.setFillColor(240, 240, 240);
  doc.rect(tableLeft, tableTop, tableWidth, rowH, 'F');
  doc.setFontSize(10);
  doc.setFont(undefined, 'bold');
  doc.text("Item", tableLeft + 4, tableTop + 6);
  doc.text("Price", priceCol, tableTop + 6, { align: "right" });

  let rowY = tableTop + rowH;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');

  const drawRow = (label, value, isBold) => {
    if (isBold) doc.setFont(undefined, 'bold');
    doc.text(label, tableLeft + 4, rowY + 6);
    doc.text(value, priceCol, rowY + 6, { align: "right" });
    if (isBold) doc.setFont(undefined, 'normal');
    doc.setDrawColor(220, 220, 220);
    doc.line(tableLeft, rowY + rowH, tableRight, rowY + rowH);
    rowY += rowH;
  };

  drawRow("Materials Total", formatCurrency(materialsTotal));
  if (laborTravelTotal > 0) {
    drawRow("Service Charge", formatCurrency(laborTravelTotal));
  }
  drawRow("Subtotal", formatCurrency(subtotal), true);
  if (hasDiscount) {
    const discountLabel = quote.discount_type === "flat"
      ? `Discount ($${discountAmount.toFixed(2)} off)`
      : `Discount (${quote.discount_percent || 0}%)`;
    drawRow(discountLabel, `-${formatCurrency(discountAmount)}`);
  }
  if (hasTax) {
    drawRow("Tax (materials only)", formatCurrency(taxAmount));
  }

  // Total row
  doc.setFontSize(12);
  drawRow("Total", formatCurrency(total), true);
  doc.setFontSize(10);

  // Outer border
  doc.setDrawColor(180, 180, 180);
  doc.rect(tableLeft, tableTop, tableWidth, rowY - tableTop);

  // Footer — service disclaimer + optional template footer text
  const disclaimerText = "Disclaimer: The quoted services cover only the scope of work identified during evaluation. If additional repairs, materials, or labor are found to be necessary, we will provide pricing for the additional work and proceed only with your approval. If the technician has the required materials on hand, approved work may be completed during the same visit. Otherwise, a follow-up quote and return service appointment may be required.";
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const disclaimerLines = doc.splitTextToSize(disclaimerText, 170);
    doc.text(disclaimerLines, 20, 275, { align: "left" });
    if (template.footer_text) {
      doc.setTextColor(150, 150, 150);
      doc.text(template.footer_text, 105, 290, { align: "center" });
    }
  }

  return doc.output('blob');
}