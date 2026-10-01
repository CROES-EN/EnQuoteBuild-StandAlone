const ENTITY_COLLECTION_MAP = {
  MaterialOrder: "materialOrders",
  QuoteAlert: "quoteAlerts",
  StatusAlertDismissal: "statusAlertDismissals",
  QuoteReview: "reviews",
  QuoteActivity: "activities",
  QuoteDeletionRequest: "deletionRequests",
  FollowUpConfig: "followUpConfigs",
  FollowUpLog: "followUps",
  PDFTemplate: "pdfTemplates",
  PVManufacturer: "pvManufacturers",
  PVPanelRMA: "rmas",
  SiteFlag: "siteFlags",
  SVCancelTracker: "svCancels",
  SupportInteraction: "supportInteractions",
  PriceReview: "priceReviews"
};

async function importEntitySnapshot(repository, entities) {
  if (!Array.isArray(entities)) {
    throw new Error("Entity snapshot did not contain an entities array.");
  }
  if (entities.length === 0) return 0;

  const snapshot = { version: 1, quotes: [], products: [] };
  let importedRecordCount = 0;

  for (const entity of entities) {
    if (!entity?.localId || !entity.record || typeof entity.record !== "object") continue;
    const record = {
      ...entity.record,
      id: typeof entity.record.id === "string" && entity.record.id ? entity.record.id : entity.localId,
      base44_id: entity.localId
    };

    if (entity.entityType === "Quote") {
      if (!record.site_id || !record.quote_number) continue;
      snapshot.quotes.push(record);
    } else if (entity.entityType === "Product") {
      snapshot.products.push(record);
    } else if (entity.entityType !== "EmailDistribution" && entity.entityType !== "FST" && entity.entityType !== "Invitation") {
      const collectionName = ENTITY_COLLECTION_MAP[entity.entityType];
      if (!collectionName) continue;
      snapshot[collectionName] ||= [];
      snapshot[collectionName].push(record);
    } else {
      continue;
    }

    importedRecordCount += 1;
  }

  if (importedRecordCount > 0) {
    await repository.importData(snapshot);
  }
  return importedRecordCount;
}

module.exports = { importEntitySnapshot };
