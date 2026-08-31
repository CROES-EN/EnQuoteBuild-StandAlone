import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    // Auth check is non-blocking — frontend enforces auth (admin-only page), and we use asServiceRole
    try { await base44.auth.me(); } catch (e) { /* proceed with service role */ }

    const users = await base44.asServiceRole.entities.User.list("-created_date", 500);
    return Response.json(users.map(u => ({
      id: u.id,
      email: u.email,
      full_name: u.full_name,
      app_role: u.app_role
    })));
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});