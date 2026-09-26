import {createClientFromRequest} from 'npm:@base44/sdk@0.8.40';

// Direct client-side writes to another user's User record are blocked by the platform
// (a user can only update their own record via base44.auth.updateMe). Admins need a
// privileged path to assign roles/permissions to OTHER users from the Users page, so this
// function verifies the caller is an admin and then applies the change with asServiceRole,
// which is allowed to write any User record regardless of ownership.
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    const callerRoles = [caller?.app_role, ...(caller?.additional_roles || [])];
    if (!caller || !callerRoles.includes('admin')) {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { userId, data } = await req.json();
    if (!userId || !data || typeof data !== 'object') {
      return Response.json({ error: 'userId and data are required' }, { status: 400 });
    }

    // Only allow the specific fields the Users page is meant to manage - never let an
    // arbitrary payload overwrite unrelated fields (e.g. email) on someone else's account.
    const ALLOWED_FIELDS = ['app_role', 'additional_roles', 'department', 'display_name'];
    const sanitizedData = Object.fromEntries(
      Object.entries(data).filter(([key]) => ALLOWED_FIELDS.includes(key))
    );

    const updated = await base44.asServiceRole.entities.User.update(userId, sanitizedData);
    return Response.json({ user: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
