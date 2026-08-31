const deferred = (methodName) => {
  throw new Error(
    `${methodName} is unavailable because Salesforce integration is deferred pending SFDC admin approval, sandbox access, OAuth PKCE configuration, API permissions, object mappings, and security review.`
  );
};

const methodNames = [
  "getCurrentUser",
  "getQuotes",
  "getQuoteById",
  "listRecentQuotes",
  "filterQuotes",
  "createQuote",
  "updateQuote",
  "deleteQuote",
  "bulkUpdateQuotes",
  "getProducts",
  "listProducts",
  "filterProducts",
  "createProduct",
  "updateProduct",
  "deleteProduct",
  "getReviews",
  "getReviewsForQuote",
  "createReview",
  "updateReview",
  "getQuoteActivities",
  "createQuoteActivity",
  "getFollowUps",
  "createFollowUp",
  "getUsers",
  "listLocalCollection",
  "createLocalRecord",
  "updateLocalRecord",
  "deleteLocalRecord",
  "resetLocalData",
  "exportLocalData",
  "importLocalData"
];

export const salesforceAdapter = Object.fromEntries(
  methodNames.map((methodName) => [methodName, () => deferred(methodName)])
);