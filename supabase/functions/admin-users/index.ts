// supabase/functions/admin-users/index.ts
//
// Admin-only user management for TeacherPal. Runs on Supabase Edge Runtime
// (Deno). Uses the service_role key server-side to call GoTrue's admin API
// (which is the only way to set a password without an email round-trip, and
// the only reliable way to hash a password so GoTrue can verify it).
//
// Actions:
//   POST /functions/v1/admin-users
//     { action: "create", username, email, password }  → { user_id }
//     { action: "reset",  user_id, password }          → { ok: true }
//
// Auth model:
//   • Caller must send their session's access_token in Authorization.
//   • Function verifies the caller is an authenticated user AND that
//     profiles.is_admin is true for their user_id.
//   • Only then does it upgrade to the service_role client.
//
// The service_role key never leaves the function; the browser only ever
// sees the anon key.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const SUPABASE_URL              = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY         = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function ok(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
function fail(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST')    return fail(405, 'method not allowed');

  // ---- 1. Identify + authorize the caller ---------------------------------
  const auth = req.headers.get('Authorization') ?? '';
  const jwt  = auth.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return fail(401, 'missing authorization');

  // Use the caller's JWT with the anon client so RLS applies as them.
  const asCaller = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });

  const { data: userRes, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userRes?.user) return fail(401, 'invalid session');

  const { data: profile, error: profileErr } = await asCaller
    .from('profiles')
    .select('is_admin')
    .eq('user_id', userRes.user.id)
    .single();
  if (profileErr) return fail(403, 'profile lookup failed');
  if (!profile?.is_admin) return fail(403, 'not authorized');

  // ---- 2. Parse the request ----------------------------------------------
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail(400, 'invalid json'); }
  const action = String(body.action ?? '');

  // Server-side (service_role) client. Never expose this key to the browser.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ---- 3. Dispatch -------------------------------------------------------
  if (action === 'create') {
    const username = String(body.username ?? '').trim();
    const email    = String(body.email    ?? '').trim().toLowerCase();
    const password = String(body.password ?? '');
    if (!username || !email || password.length < 6) {
      return fail(400, 'username, email, and 6+ char password required');
    }

    // GoTrue's admin API: creates the auth user + auth.identities row and
    // hashes the password using the same code path as sign-up.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {},
    });
    if (createErr || !created?.user) return fail(400, createErr?.message ?? 'create failed');

    // Matching profiles row so the app's username sign-in works.
    const { error: profileInsertErr } = await admin.from('profiles').insert({
      user_id:  created.user.id,
      username,
      email,
      is_admin: false,
    });
    if (profileInsertErr) {
      // Roll back the auth user so we don't leave an orphan.
      await admin.auth.admin.deleteUser(created.user.id);
      return fail(400, `profile insert failed: ${profileInsertErr.message}`);
    }

    return ok({ user_id: created.user.id });
  }

  if (action === 'reset') {
    const userId   = String(body.user_id  ?? '').trim();
    const password = String(body.password ?? '');
    if (!userId || password.length < 6) {
      return fail(400, 'user_id and 6+ char password required');
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return fail(400, error.message);
    return ok({ ok: true });
  }

  return fail(400, `unknown action: ${action}`);
});
