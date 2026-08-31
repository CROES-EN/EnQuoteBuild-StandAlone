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
  let yPos = 20;
  
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
  doc.text(`Date: ${format(new Date(quote.created_date), "MMM d, yyyy")}`, 20, yPos);
  yPos += 6;
  if (quote.valid_until) {
    doc.text(`Valid Until: ${format(new Date(quote.valid_until), "MMM d, yyyy")}`, 20, yPos);
    yPos += 6;
  }
  yPos += 8;
  
  // Site Information
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Site Information", 20, yPos);
  yPos += 8;
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`Site ID: ${quote.site_id}`, 20, yPos);
  yPos += 6;
  if (quote.case_number) {
    doc.text(`Case Number: ${quote.case_number}`, 20, yPos);
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
  // Don't show travel/mileage details in site info - will show combined in totals
  yPos += 6;
  
  // Scope of Work
  if (quote.scope_of_work) {
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Scope of Work", 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const scopeLines = doc.splitTextToSize(normalizeText(quote.scope_of_work), 170);
    doc.text(scopeLines, 20, yPos);
    yPos += scopeLines.length * 5 + 8;
  }
  
  // Line Items Table
  if (yPos > 240) {
    doc.addPage();
    yPos = 20;
  }
  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text("Line Items", 20, yPos);
  yPos += 8;
  
  // Table Header
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text("Item", 20, yPos);
  doc.text("Qty", 105, yPos, { align: "right" });
  doc.text("Unit Price", 140, yPos, { align: "right" });
  doc.text("Total", 180, yPos, { align: "right" });
  yPos += 2;
  doc.line(20, yPos, 190, yPos);
  yPos += 6;
  
  // Table Rows
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  for (const item of quote.items || []) {
    if (yPos > 260) {
      doc.addPage();
      yPos = 20;
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
    
    const itemName = doc.splitTextToSize(item.name, 75);
    doc.text(itemName, 20, yPos);
    const nameHeight = itemName.length * 4;
    
    doc.text(`${item.quantity} ${item.unit}`, 105, yPos, { align: "right" });
    doc.text(formatCurrency(item.unit_price), 140, yPos, { align: "right" });
    doc.text(formatCurrency(item.total), 180, yPos, { align: "right" });
    
    yPos += Math.max(nameHeight, 5) + 3;
  }
  
  // Totals
  yPos += 8;
  if (yPos > 230) {
    doc.addPage();
    yPos = 20;
  }
  
  // Calculate summary figures
  const laborCharge = quote.labor_mode === "flat"
    ? (quote.flat_labor_fee || 0)
    : (quote.fst_count || 0) * (quote.labor_hours || 0) * (quote.labor_rate || 125);
  const travelCharge = (quote.travel_hours || 0) * (quote.travel_rate || 65);
  const mileageCharge = (quote.miles_traveled || 0) * (quote.mileage_rate || 0.73);
  const laborTravelTotal = laborCharge + travelCharge + mileageCharge;
  const materialsTotal = (quote.items || []).reduce((sum, item) => sum + (item.total || 0), 0);
  const subtotal = laborTravelTotal + materialsTotal;

  const taxableAmount = (quote.items || [])
    .filter(item => item.taxable !== false)
    .reduce((sum, item) => sum + (item.total || 0), 0);
  const discountAmount = subtotal * ((quote.discount_percent || 0) / 100);
  const taxableShare = subtotal > 0 ? taxableAmount / subtotal : 0;
  const taxableAfterDiscount = taxableAmount - taxableShare * discountAmount;
  const federalTax = quote.federal_tax_percent || 0;
  const stateTax = quote.state_tax_percent || 0;
  const localTax = quote.local_tax_percent || 0;
  const totalTaxPercent = federalTax + stateTax + localTax;
  const totalTaxAmount = taxableAfterDiscount * (totalTaxPercent / 100);

  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.line(20, yPos, 190, yPos);
  yPos += 7;

  // Line 1: Labor, Travel & Mileage combined
  if (laborTravelTotal > 0) {
    const laborLabel = "Labor, Travel & Mileage:";
    doc.text(laborLabel, 20, yPos);
    doc.text(formatCurrency(laborTravelTotal), 180, yPos, { align: "right" });
    yPos += 6;
  }

  // Line 2: Materials
  if (materialsTotal > 0) {
    doc.text("Materials:", 20, yPos);
    doc.text(formatCurrency(materialsTotal), 180, yPos, { align: "right" });
    yPos += 6;
  }

  // Subtotal
  doc.text("Subtotal:", 20, yPos);
  doc.text(formatCurrency(subtotal), 180, yPos, { align: "right" });
  yPos += 6;

  if ((quote.discount_percent || 0) > 0) {
    doc.text(`Discount (${quote.discount_percent}%):`, 20, yPos);
    doc.text(`-${formatCurrency(discountAmount)}`, 180, yPos, { align: "right" });
    yPos += 6;
  }

  // Line 3: Tax (only on taxable items)
  if (totalTaxPercent > 0 && totalTaxAmount > 0) {
    doc.text(`Tax (${totalTaxPercent}%):`, 20, yPos);
    doc.text(formatCurrency(totalTaxAmount), 180, yPos, { align: "right" });
    yPos += 6;
    doc.setFontSize(8);
    doc.setTextColor(120, 120, 120);
    doc.text(`(applied to taxable items only)`, 20, yPos);
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    yPos += 5;
  }
  
  yPos += 2;
  doc.line(20, yPos, 190, yPos);
  yPos += 7;
  
  doc.setFont(undefined, 'bold');
  doc.setFontSize(12);
  doc.text("Total:", 20, yPos);
  doc.text(formatCurrency(quote.total), 180, yPos, { align: "right" });
  
  // Notes
  if (quote.notes) {
    yPos += 15;
    if (yPos > 240) {
      doc.addPage();
      yPos = 20;
    }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Notes & Terms", 20, yPos);
    yPos += 8;
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const LINE_HEIGHT = 5.5;
    const PAGE_BOTTOM = 270;
    const notesParagraphs = normalizeText(quote.notes).split('\n');
    for (const paragraph of notesParagraphs) {
      const notesLines = doc.splitTextToSize(paragraph.trim() || ' ', 170);
      const blockHeight = notesLines.length * LINE_HEIGHT;
      // If this paragraph block won't fit, start a new page
      if (yPos + blockHeight > PAGE_BOTTOM) {
        doc.addPage();
        yPos = 20;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
      }
      doc.text(notesLines, 20, yPos);
      yPos += blockHeight + 1.5;
    }
  }
  
  // Version History
  if (template.include_version_history && versionHistory && versionHistory.length > 1) {
    yPos += 15;
    if (yPos > 230) {
      doc.addPage();
      yPos = 20;
    }
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text("Version History", 20, yPos);
    yPos += 8;
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    
    const sortedVersions = [...versionHistory].sort((a, b) => b.version_number - a.version_number);
    for (const version of sortedVersions) {
      if (yPos > 260) {
        doc.addPage();
        yPos = 20;
      }
      const versionText = `v${version.version_number} - ${format(new Date(version.created_date), "MMM d, yyyy")} - ${version.status} - ${formatCurrency(version.total)}`;
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
      console.warn("Could not generate simplified scope, skipping section");
    }

    if (customerScope) {
      if (yPos > 240) { doc.addPage(); yPos = 20; }
      doc.setFontSize(12);
      doc.setFont(undefined, 'bold');
      doc.text("Summary of Work", 20, yPos);
      yPos += 8;
      doc.setFontSize(10);
      doc.setFont(undefined, 'normal');
      const scopeLines = doc.splitTextToSize(normalizeText(customerScope), 170);
      doc.text(scopeLines, 20, yPos);
      yPos += scopeLines.length * 5 + 10;
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