export function compareRecordValues(a, b, direction) {
  const missing = value => value === null || value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value));
  if (missing(a)) return missing(b) ? 0 : 1;
  if (missing(b)) return -1;
  const comparison = typeof a === "number" && typeof b === "number"
    ? a - b : String(a).localeCompare(String(b), undefined, {numeric: true, sensitivity: "base"});
  return direction === "desc" ? -comparison : comparison;
}

export function sortRecords(records, columns, sort) {
  const column = columns.find(item => item.key === sort?.key);
  return column ? [...records].sort((a, b) => compareRecordValues(column.value(a), column.value(b), sort.direction)) : records;
}

export function nextRecordSort(sort, key) {
  return {key, direction: sort?.key === key && sort.direction === "asc" ? "desc" : "asc"};
}

export function numericSortValue(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function dateSortValue(value) {
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
