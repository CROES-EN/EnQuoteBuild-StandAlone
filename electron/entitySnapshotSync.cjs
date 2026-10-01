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
  if (entities.length === 0) {
    return {
      importedRecordCount: 0,
      quoteSnapshotCount: 0,
      quoteAddedCount: 0,
      quoteUpdatedCount: 0
    };
  }

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
      if (!record.site_id || (!record.quote_number && !record.case_number)) continue;
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

  let existingQuotes = [];
  if (snapshot.quotes.length > 0) {
    existingQuotes = await repository.list();
  }

  const existingById = new Map();
  for (const quote of existingQuotes) {
    if (quote?.id) existingById.set(String(quote.id), quote);
    if (quote?.base44_id) existingById.set(String(quote.base44_id), quote);
  }

  let quoteAddedCount = 0;
  let quoteUpdatedCount = 0;
  if (importedRecordCount > 0) {
    const mergedQuotes = await repository.importData(snapshot);
    const mergedById = new Map();
    for (const quote of mergedQuotes || []) {
      if (quote?.id) mergedById.set(String(quote.id), quote);
      if (quote?.base44_id) mergedById.set(String(quote.base44_id), quote);
    }

    for (const quote of snapshot.quotes) {
      const existing = existingById.get(String(quote.id)) || existingById.get(String(quote.base44_id));
      if (!existing) {
        quoteAddedCount += 1;
        continue;
      }

      const merged = mergedById.get(String(existing.id)) || mergedById.get(String(quote.id));
      if ((merged?._rev || 0) > (existing?._rev || 0)) quoteUpdatedCount += 1;
    }
  }

  return {
    importedRecordCount,
    quoteSnapshotCount: snapshot.quotes.length,
    quoteAddedCount,
    quoteUpdatedCount
  };
}

module.exports = { importEntitySnapshot };
