import { createClientFromRequest } from 'npm:@base44/sdk@0.8.20';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sv_address, fsts } = await req.json();

    if (!sv_address || !fsts || fsts.length === 0) {
      return Response.json({ error: 'Missing sv_address or fsts' }, { status: 400 });
    }

    const prompt = `You are a routing assistant. Given a site visit (SV) destination address and a list of FST (Field Service Technicians) with their home base addresses, estimate the driving distance (in miles) and driving time (in minutes) from each FST's location to the SV address.

Use your knowledge of US geography to make reasonable estimates. Be realistic about driving distances — account for road networks, not straight-line distances.

SV Destination Address: ${sv_address}

FSTs:
${fsts.map((f, i) => `${i + 1}. Name: ${f.name} | Address: ${f.address}, ${f.city || ''}, ${f.state || ''} ${f.zip || ''}`.trim()).join('\n')}

Return a JSON object with a "rankings" array. Each element should have:
- fst_index: (number, 0-based index matching the input list)
- name: FST name
- estimated_miles: estimated driving miles (number, one decimal)
- estimated_minutes: estimated driving time in minutes (number, integer)
- estimated_hours_display: human friendly string like "1h 15m" or "45 min"
- notes: one short sentence about the route or any relevant geographic context

Sort the array from shortest to longest travel time.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: "object",
        properties: {
          rankings: {
            type: "array",
            items: {
              type: "object",
              properties: {
                fst_index: { type: "number" },
                name: { type: "string" },
                estimated_miles: { type: "number" },
                estimated_minutes: { type: "number" },
                estimated_hours_display: { type: "string" },
                notes: { type: "string" }
              }
            }
          }
        }
      }
    });

    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});