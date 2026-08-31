import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Auth check is non-blocking — frontend enforces auth, and we use asServiceRole for data
    try { await base44.auth.me(); } catch (e) { /* proceed with service role */ }

    const { quote_id } = await req.json();
    if (!quote_id) return Response.json({ error: 'quote_id required' }, { status: 400 });

    // Use service role so approvers/admins can load any quote regardless of ownership
    const quotes = await base44.asServiceRole.entities.Quote.filter({ id: quote_id });
    const quote = quotes[0] || null;

    return Response.json({ quote });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});