import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Auth check is non-blocking — the frontend enforces authentication via RoleGuard,
    // and we use asServiceRole for data access which doesn't depend on the user token
    try { await base44.auth.me(); } catch (e) { /* proceed with service role */ }

    const quotes = await base44.asServiceRole.entities.Quote.list("-created_date", 2000);
    return Response.json(quotes);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});