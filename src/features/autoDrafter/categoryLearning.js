// Reviewer-taught request categories. Two kinds of corrections, both saved in the local
// "autoDrafterLearnedSwaps" collection next to item swaps (learnedSwapsStore.js):
//  - category_case: "this case is <category>" (wins over everything for that one case).
//  - category_rule: "requests mentioning <phrase> are <category>" or "<phrase> is a PV module",
//    applied automatically to every later request, including the Quote Draft Agent.
import {reviewCaseKey} from "./caseKey.js";
import {setLearnedPvModulePhrases} from "./pvModuleRecognition.js";

export const PV_MODULE_RULE = "pv_module";
export const MIN_RULE_PHRASE_LENGTH = 4;

const normalize = text => String(text || "").toLowerCase().replace(/\s+/g, " ").trim();

let caseOverrides = new Map();
let categoryRules = [];

export const categoryCaseId = caseNumber => `category-case:${reviewCaseKey(caseNumber)}`;
export const categoryRuleId = phrase => `category-rule:${normalize(phrase)}`;

export function isCategoryLearningRecord(record) {
  return record?.kind === "category_case" || record?.kind === "category_rule";
}

export function setRuntimeCategoryLearning(records = []) {
  const active = (records || []).filter(record => record && !record.is_deleted && record.category);
  caseOverrides = new Map(active.filter(record => record.kind === "category_case" && reviewCaseKey(record.caseNumber))
    .map(record => [reviewCaseKey(record.caseNumber), record]));
  categoryRules = active.filter(record => record.kind === "category_rule" && normalize(record.phrase).length >= MIN_RULE_PHRASE_LENGTH)
    .map(record => ({...record, key: normalize(record.phrase)}))
    .sort((a, b) => b.key.length - a.key.length);
  setLearnedPvModulePhrases(categoryRules.filter(rule => rule.category === PV_MODULE_RULE).map(rule => rule.key));
}

export function findCategoryCaseOverride(caseNumber) {
  return caseOverrides.get(reviewCaseKey(caseNumber)) || null;
}

// Longest matching phrase wins, so a specific rule beats a general one.
export function findCategoryRule(requestText) {
  const text = normalize(requestText);
  if (!text) return null;
  return categoryRules.find(rule => rule.category !== PV_MODULE_RULE && text.includes(rule.key)) || null;
}

export function listCategoryRules() {
  return categoryRules.map(({key, ...rule}) => rule);
}
