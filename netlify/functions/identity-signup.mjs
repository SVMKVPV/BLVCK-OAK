function ownerEmail() {
  return String(process.env.OWNER_AUTH_EMAIL || process.env.OWNER_EMAIL || '').trim().toLowerCase();
}

export default async function handler(request) {
  const { payload } = await request.json();
  const user = payload?.user || payload || {};
  const email = String(user.email || '').trim().toLowerCase();
  const provider = String(user.provider || user.app_metadata?.provider || '').trim().toLowerCase();
  if (!email || email !== ownerEmail() || provider !== 'google') {
    return new Response('Not allowed.', { status: 403 });
  }
  return new Response(null, { status: 204 });
}
