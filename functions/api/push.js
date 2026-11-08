// Cloudflare Pages Function: POST /api/push
// Envía un aviso Web Push (sin contenido, firmado con VAPID) a las suscripciones recibidas.
// La app abre el aviso y los mensajes pendientes se entregan por la red en vivo.
const VAPID_PUBLIC = 'BAABlEH7Ftw8VxQd5PD6U1LguI_T-kxxdLG6dHkpWtnOQrs0GTZKmQrZo0B08PWyynJKFfKl_EynpU-SncasvII';
const VAPID_X = 'AAGUQfsW3DxXFB3k8PpTUuC4j9P6THF0sbp0eSla2c4';
const VAPID_Y = 'Qrs0GTZKmQrZo0B08PWyynJKFfKl_EynpU-SncasvII';
const VAPID_D_DEFAULT = 'WqknZ2hgDpeeYWD7NVIO6PX1MVCgaN7lgypkG8kNwDM';

const enc = new TextEncoder();

function b64u(bytes) {
  let s = '';
  const u = new Uint8Array(bytes);
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function vapidHeader(endpoint, subject, env) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: VAPID_X, y: VAPID_Y, d: (env && env.VAPID_PRIVATE) || VAPID_D_DEFAULT, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body));
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${VAPID_PUBLIC}`;
}

export async function onRequestPost({ request, env }) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  if (origin && origin !== url.origin) return new Response('forbidden', { status: 403 });

  let data;
  try { data = await request.json(); } catch (e) { return new Response('bad json', { status: 400 }); }
  const subs = (Array.isArray(data.subs) ? data.subs : []).slice(0, 10);
  const subject = url.origin;

  const results = await Promise.all(subs.map(async (s) => {
    try {
      if (!s || !s.endpoint || !/^https:\/\//.test(s.endpoint)) return { endpoint: s && s.endpoint, status: 400 };
      const auth = await vapidHeader(s.endpoint, subject, env);
      const r = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: auth, TTL: '86400', Urgency: 'high' }
      });
      return { endpoint: s.endpoint, status: r.status };
    } catch (e) {
      return { endpoint: s && s.endpoint, status: 0 };
    }
  }));

  return new Response(JSON.stringify({ results }), { headers: { 'Content-Type': 'application/json' } });
}
