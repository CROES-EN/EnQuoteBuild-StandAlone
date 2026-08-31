import { base44 } from "@/api/base44Client";
import { QUOTE_DRAFT_PROMPT } from "./quoteDraftPrompt";
import { buildQuotePayload } from "./quoteDraftMapper";

export const quoteDraftResponseSchema = {
  type: "object",
  properties: {
    scopeOfWork: { type: "string" },
    homeownerSummary: { type: "string" },
    internalNotes: { type: "string" },
    riskStatement: { type: "string" },
    materials: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_id: { type: "string" },
          name: { type: "string" },
          quantity: { type: "number" },
          unit_price: { type: "number" },
          total: { type: "number" },
          taxable: { type: "boolean" },
          tax_code: { type: "string" }
        }
      }
    },
    labor: { type: "array", items: { type: "object" } },
    travel: { type: "array", items: { type: "object" } },
    taxSummary: { type: "array", items: { type: "object" } },
    quoteSummary: { type: "object" }
  },
  required: ["scopeOfWork", "homeownerSummary", "internalNotes", "riskStatement", "materials", "labor", "travel"]
};

export async function generateQuoteDraft(quote) {
  if (!quote || typeof quote !== "object") {
    throw new Error("A quote record is required to generate a draft.");
  }

  const prompt = `${QUOTE_DRAFT_PROMPT}

QUOTE REQUEST DATA
${JSON.stringify(buildQuotePayload(quote), null, 2)}

Return ONLY valid JSON matching the supplied response schema.`;

  const response = await base44.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: quoteDraftResponseSchema,
    add_context_from_internet: false
  });

  if (typeof response === "string") {
    try {
      return JSON.parse(response);
    } catch {
      throw new Error("Quote Draft Agent returned invalid JSON.");
    }
  }
  if (!response || typeof response !== "object") {
    throw new Error("Quote Draft Agent returned an empty response.");
  }
  return response;
}
