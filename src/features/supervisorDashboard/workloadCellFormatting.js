export function formatWorkloadCell(column, value) {
  const text = String(value ?? "");
  if (column.replace(/\s/g, "").toLowerCase() !== "age(days)" || !text.trim()) return text;
  const age = Number(text.replace(/,/g, ""));
  return Number.isFinite(age) ? String(Math.floor(age)) : text;
}
