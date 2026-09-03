import { PortalError } from './portal-auth.mjs';

export const LEAD_SEARCH_RADII = Object.freeze([2000, 5000, 10000, 20000]);
export const LEAD_SEARCH_CATEGORIES = Object.freeze({
  all: ['accounting', 'bakery', 'barber_shop', 'beauty_salon', 'cafe', 'car_repair', 'electrician', 'fitness_center', 'florist', 'gym', 'hair_salon', 'insurance_agency', 'lawyer', 'locksmith', 'moving_company', 'nail_salon', 'painter', 'plumber', 'real_estate_agency', 'restaurant'],
  food: ['bakery', 'cafe', 'coffee_shop', 'restaurant'],
  trades: ['electrician', 'locksmith', 'moving_company', 'painter', 'plumber', 'roofing_contractor'],
  beauty: ['barber_shop', 'beautician', 'beauty_salon', 'hair_salon', 'nail_salon', 'wellness_center'],
  automotive: ['car_repair', 'car_wash', 'tire_shop'],
  professional: ['accounting', 'consultant', 'insurance_agency', 'lawyer', 'real_estate_agency'],
  retail: ['book_store', 'butcher_shop', 'clothing_store', 'florist', 'gift_shop', 'hardware_store', 'pet_store'],
  fitness: ['fitness_center', 'gym', 'sports_club', 'sports_coaching', 'yoga_studio'],
});

const finiteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

export function validateLeadSearch(value = {}) {
  const latitude = Number(value.latitude);
  const longitude = Number(value.longitude);
  const radius = Number(value.radius);
  const category = String(value.category || 'all');
  if (!finiteNumber(latitude) || latitude < -90 || latitude > 90 || !finiteNumber(longitude) || longitude < -180 || longitude > 180) {
    throw new PortalError('Your location could not be read. Allow location access and try again.');
  }
  if (!LEAD_SEARCH_RADII.includes(radius)) throw new PortalError('Choose a valid search distance.');
  if (!Object.hasOwn(LEAD_SEARCH_CATEGORIES, category)) throw new PortalError('Choose a valid business type.');
  return { latitude, longitude, radius, category };
}

function safeGoogleMapsUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !(url.hostname === 'google.com' || url.hostname.endsWith('.google.com'))) return null;
    return url.toString();
  } catch { return null; }
}

function safePhone(value) {
  const phone = String(value || '').trim();
  return phone.length >= 5 && phone.length <= 40 && /^[+\d().\-\s]+$/.test(phone) ? phone : null;
}

export function websiteFreeLeads(places = []) {
  if (!Array.isArray(places)) return [];
  return places.filter((place) => place && place.businessStatus === 'OPERATIONAL' && !place.websiteUri).map((place) => {
    const name = String(place.displayName?.text || '').trim().slice(0, 160);
    const mapsUrl = safeGoogleMapsUrl(place.googleMapsUri);
    if (!name || !mapsUrl) return null;
    const rating = finiteNumber(place.rating) && place.rating >= 0 && place.rating <= 5 ? place.rating : null;
    const ratingCount = Number.isInteger(place.userRatingCount) && place.userRatingCount >= 0 ? place.userRatingCount : null;
    return {
      id: String(place.id || '').slice(0, 200),
      name,
      address: String(place.formattedAddress || '').trim().slice(0, 300),
      type: String(place.primaryTypeDisplayName?.text || 'Local business').trim().slice(0, 80),
      phone: safePhone(place.nationalPhoneNumber),
      rating,
      ratingCount,
      mapsUrl,
    };
  }).filter(Boolean);
}

export async function searchNearbyBusinesses(input, apiKey, fetcher = fetch) {
  if (!apiKey) throw new PortalError('The lead finder is not configured yet. Add the Google Places API key in Netlify.', 503);
  const request = validateLeadSearch(input);
  let response;
  try {
    response = await fetcher('https://places.googleapis.com/v1/places:searchNearby', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.id,places.businessStatus,places.displayName,places.formattedAddress,places.primaryTypeDisplayName,places.googleMapsUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.websiteUri',
      },
      body: JSON.stringify({
        includedTypes: LEAD_SEARCH_CATEGORIES[request.category],
        maxResultCount: 20,
        rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: request.latitude, longitude: request.longitude }, radius: request.radius } },
        languageCode: 'en-AU',
        regionCode: 'AU',
      }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new PortalError('The nearby business search is temporarily unavailable. Try again shortly.', 503);
  }
  if (!response.ok) {
    console.error('Google Places nearby search failed:', response.status);
    throw new PortalError(response.status === 429 ? 'The lead finder has reached its provider limit. Try again later.' : 'The nearby business search is temporarily unavailable. Try again shortly.', 503);
  }
  const data = await response.json().catch(() => null);
  if (!data || !Array.isArray(data.places)) return [];
  return websiteFreeLeads(data.places);
}

export async function consumeLeadSearchQuota(store, accountId, isOwner = false, now = new Date()) {
  const limit = isOwner ? 100 : 25;
  const key = `lead-search-quota/${accountId}/${now.toISOString().slice(0, 10)}`;
  for (let tries = 0; tries < 5; tries += 1) {
    const entry = await store.getWithMetadata(key, { type: 'json' });
    const count = Number.isInteger(entry?.data?.count) ? entry.data.count : 0;
    if (count >= limit) throw new PortalError('Daily lead-search limit reached. Try again tomorrow.', 429);
    const saved = await store.setJSON(key, { count: count + 1 }, entry?.etag ? { onlyIfMatch: entry.etag } : { onlyIfNew: true });
    if (saved.modified) return { used: count + 1, remaining: limit - count - 1, limit };
  }
  throw new PortalError('Another search is processing. Try again.', 409);
}
