import {reviewCaseKey} from "./caseKey.js";
import {alternateRequestType, preferQuoteRequestComment, quoteRequestCommentEvidence} from "../quoteRequestIntake/quoteRequestComment.js";

export const quoteCaseKey = value => reviewCaseKey(value).replace(/^#\s*/, "").replace(/^0+(?=\d)/, "");

export function quoteRequestColumns(columns = []) {
  const find = (names, excluded = []) => columns.find(column =>
    names.some(name => column.toLowerCase().includes(name)) &&
    !excluded.some(name => column.toLowerCase().includes(name)));
  return {
    caseNumber: find(["case number"]),
    comment: find(["case comment", "comment"], ["created date", "created"]),
    created: find(["case comment created date", "created date"])
  };
}

export function qualifyingQuoteRequestRows(table) {
  const rows = table?.rows || [];
  const {caseNumber, comment, created} = quoteRequestColumns(table?.columns);
  const alternateRows = new Set(comment ? rows.filter(row => alternateRequestType(row[comment])) : []);
  const caseKeyOf = row => caseNumber ? reviewCaseKey(row[caseNumber]) : "";
  const alternateCases = new Set([...alternateRows].map(caseKeyOf).filter(Boolean));
  const requestCases = new Set(alternateCases.size && comment ? rows
    .filter(row => !alternateRows.has(row) && quoteRequestCommentEvidence(row[comment]).hasRequest)
    .map(caseKeyOf).filter(Boolean) : []);
  const quoteRows = rows.filter(row => !alternateRows.has(row) &&
    !(alternateCases.has(caseKeyOf(row)) && !requestCases.has(caseKeyOf(row))));
  if (!caseNumber) return quoteRows;
  const byCase = new Map();
  quoteRows.forEach((row, index) => {
    const key = caseKeyOf(row) || `__no-case-number-${index}__`;
    const existing = byCase.get(key);
    if (!existing || preferQuoteRequestComment(row[comment], existing[comment], row[created], existing[created])) {
      byCase.set(key, row);
    }
  });
  return [...byCase.values()];
}

export function awaitingQuoteRequestRows(rows, caseNumberColumn, existingCaseNumbers, removedRecords) {
  if (!caseNumberColumn) return rows;
  const removedCases = new Set(removedRecords
    .filter(record => record.removedFromAutoDrafter)
    .map(record => quoteCaseKey(record.caseNumber ?? record.id)));
  return rows.filter(row => !existingCaseNumbers.has(quoteCaseKey(row[caseNumberColumn])) &&
    !removedCases.has(quoteCaseKey(row[caseNumberColumn])));
}

export function selectAwaitingQuoteRequests(table, quotes = [], drafts = []) {
  return awaitingQuoteRequestRows(qualifyingQuoteRequestRows(table), quoteRequestColumns(table?.columns).caseNumber,
    new Set(quotes.map(quote => quoteCaseKey(quote.case_number)).filter(Boolean)), drafts);
}
