export const ENTITY_COLLECTIONS = Object.freeze({
  Quote: "quotes",
  Product: "products",
  QuoteReview: "reviews",
  QuoteActivity: "activities",
  FollowUpLog: "followUps",
  FollowUpConfig: "followUpConfigs",
  User: "users",
  SiteFlag: "siteFlags",
  QuoteDeletionRequest: "deletionRequests",
  MaterialOrder: "materialOrders",
  PVPanelRMA: "rmas",
  SVCancelTracker: "svCancels",
  SupportInteraction: "supportInteractions",
  PDFTemplate: "pdfTemplates",
  PriceReview: "priceReviews",
  PVManufacturer: "pvManufacturers",
  QuoteAlert: "quoteAlerts",
  StatusAlertDismissal: "statusAlertDismissals",
  EmailDistribution: "emailDistributions",
  Invitation: "invitations",
  FST: "fsts"
});

const aliases = {
  quoteReviews: "QuoteReview", quoteActivities: "QuoteActivity",
  followUpLogs: "FollowUpLog", quoteDeletionRequests: "QuoteDeletionRequest",
  pvPanelRMAs: "PVPanelRMA", svCancelTrackers: "SVCancelTracker",
  quote: "Quote", product: "Product"
};
export function entityForCollection(name) {
  if (ENTITY_COLLECTIONS[name]) return name;
  return aliases[name] || Object.keys(ENTITY_COLLECTIONS).find(key => ENTITY_COLLECTIONS[key] === name);
}
