/**
 * Exports an array of products to an Excel-compatible .xlsx file.
 * Includes ALL catalog details — entity fields plus built-in metadata
 * (ID, created/updated dates, created by) for pricing-accuracy monitoring
 * and historical/competitor analysis.
 */
export function exportProductsToExcel(products) {
  const headers = [
    "ID",
    "Name",
    "Type",
    "Category",
    "Description",
    "Unit Price ($)",
    "Unit",
    "Product Link",
    "Active",
    "Created Date",
    "Last Updated",
    "Created By (User ID)"
  ];

  const formatDate = (d) => {
    if (!d) return "";
    try {
      return new Date(d).toLocaleString("en-US", { timeZone: "America/Denver" });
    } catch {
      return String(d);
    }
  };

  const rows = products.map(p => [
    p.id ?? "",
    p.name ?? "",
    p.type ?? "",
    p.category ?? "",
    p.description ?? "",
    p.unit_price ?? "",
    p.unit ?? "",
    p.product_link ?? "",
    p.is_active ? "Yes" : "No",
    formatDate(p.created_date),
    formatDate(p.updated_date),
    p.created_by_id ?? ""
  ]);

  const headerRow = `<tr>${headers.map(h => `<th style="background-color:#4f46e5;color:white;padding:8px;border:1px solid #ddd;text-align:left;white-space:nowrap;">${h}</th>`).join("")}</tr>`;
  const dataRows = rows
    .map(
      r =>
        `<tr>${r
          .map(
            cell =>
              `<td style="padding:8px;border:1px solid #ddd;text-align:left;white-space:nowrap;">${String(
                cell
              ).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</td>`
          )
          .join("")}</tr>`
    )
    .join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet><x:Name>Products &amp; Services</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions></x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head><body><table>${headerRow}${dataRows}</table></body></html>`;

  const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  link.download = `products_catalog_${dateStr}.xls`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}