import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { quoteSummaries } = await req.json();

    if (!quoteSummaries || quoteSummaries.length === 0) {
      return Response.json({
        summary: "No rejected quotes found to analyze.",
        total_analyzed: 0,
        top_categories: [],
        insights: []
      });
    }

    const prompt = `
You are an expert analyst specializing in residential solar maintenance quoting for Enphase Energy systems (PV and PV+Storage). 

You are reviewing rejected service quotes from field coordinators at Enphase Energy. These quotes are for on-site maintenance, repair, and troubleshooting work on residential solar and battery storage systems using Enphase microinverters, IQ batteries, and Envoy/IQ Gateway equipment.

Here is the data from ${quoteSummaries.length} currently-rejected quotes, including rejection reasons, scope of work, line items, and any completed coaching reviews:

${JSON.stringify(quoteSummaries, null, 2)}

---

Your job is to deeply analyze these rejections and identify the root causes and patterns of why quotes are being rejected. Consider:

1. **Scope of Work quality** - Is the scope vague, missing key details, or not clearly tied to the site issue?
2. **Pricing issues** - Are quotes under/over-priced for residential solar maintenance? Are labor hours unrealistic? Are travel costs missing or excessive?
3. **Line item problems** - Missing items, wrong quantities, incorrect part naming for Enphase equipment (microinverters, IQ8 series, IQ batteries, Envoy/IQ Gateway, trunk cable, Q-cable, etc.)
4. **Justification gaps** - Lacking technical justification for the work being proposed
5. **Process/compliance issues** - Missing required fields, wrong formats, SLA violations
6. **Common coordinator knowledge gaps** - Patterns by coordinator suggesting training needs
7. **Enphase-specific nuances** - Technical accuracy in describing Enphase component replacements, firmware issues, commissioning steps, etc.

Use your domain knowledge of Enphase Energy's residential solar and storage product lines to supplement your analysis where the data suggests technical knowledge gaps.

Provide a structured, actionable analysis with specific categories, estimated impact percentages (how much of total rejections this category accounts for), severity levels, and concrete recommendations.
`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      model: "gpt_5_4",
      response_json_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          total_analyzed: { type: "number" },
          top_categories: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                percent: { type: "number" },
                color: { type: "string", enum: ["red", "orange", "yellow", "blue", "purple"] }
              }
            }
          },
          insights: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                category: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                estimated_impact_percent: { type: "number" },
                description: { type: "string" },
                evidence: { type: "array", items: { type: "string" } },
                recommendation: { type: "string" },
                enphase_context: { type: "string" }
              }
            }
          }
        }
      }
    });

    // InvokeLLM returns { response: {...} } or the object directly
    const data = result?.response || result;
    return Response.json(data);
  } catch (error) {
    console.error("analyzeRejections error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});