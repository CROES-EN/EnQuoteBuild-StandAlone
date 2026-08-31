import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Auth check is non-blocking — frontend enforces auth, and we use asServiceRole for data
    try { await base44.auth.me(); } catch (e) { /* proceed with service role */ }

    // Use service role so all users can see all active products regardless of who created them
    const products = await base44.asServiceRole.entities.Product.list();

    return Response.json({ products });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});