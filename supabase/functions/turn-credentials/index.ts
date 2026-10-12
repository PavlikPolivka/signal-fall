// Short-lived TURN relay credentials for a match, minted from Cloudflare's TURN service.
// Secrets (set with `supabase secrets set`): CF_TURN_KEY_ID, CF_TURN_API_TOKEN.
// Without them, only STUN is returned: direct connections still work, relayed ones don't.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const STUN = [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }];
/** Credentials outlive the longest match comfortably. */
const TTL_SECONDS = 4 * 60 * 60;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Only signed-in (anonymous is fine) players get credentials.
  const auth = req.headers.get('Authorization') ?? '';
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return json({ error: 'sign in first' }, 401);

  const keyId = Deno.env.get('CF_TURN_KEY_ID');
  const token = Deno.env.get('CF_TURN_API_TOKEN');
  if (!keyId || !token) return json({ iceServers: STUN, relay: false });

  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  if (!res.ok) {
    console.error('cloudflare turn', res.status, await res.text());
    return json({ iceServers: STUN, relay: false });
  }
  const body = (await res.json()) as { iceServers: RTCIceServer[] | RTCIceServer };
  const servers = Array.isArray(body.iceServers) ? body.iceServers : [body.iceServers];
  return json({ iceServers: [...STUN, ...servers], relay: true });
});
