function ownerEmail() {
  return String(process.env.OWNER_AUTH_EMAIL || process.env.OWNER_EMAIL || '').trim().toLowerCase();
}

export default async function handler(event) {
  const user = event?.user || event;
  const email = String(user?.email || '').trim().toLowerCase();
  if (!email || email !== ownerEmail() || user?.provider !== 'google') {
    return new Response('Not allowed.', { status: 403 });
  }
  return new Response('', { status: 204 });
}
