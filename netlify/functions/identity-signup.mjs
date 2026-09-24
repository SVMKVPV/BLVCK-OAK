function ownerEmail() {
  return String(process.env.OWNER_AUTH_EMAIL || process.env.OWNER_EMAIL || '').trim().toLowerCase();
}

function allowed(user) {
  return Boolean(user?.email && user.email.toLowerCase() === ownerEmail() && user.provider === 'google');
}

export default async function handler(event) {
  const user = event?.user || event;
  if (!allowed(user)) return new Response('Not allowed.', { status: 403 });
  return new Response(JSON.stringify({
    user: {
      ...user,
      app_metadata: {
        ...(user.app_metadata || {}),
        roles: Array.from(new Set([...(user.app_metadata?.roles || []), 'owner'])),
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}
