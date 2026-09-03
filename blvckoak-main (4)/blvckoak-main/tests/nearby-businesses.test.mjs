import assert from 'node:assert/strict';
import test from 'node:test';

import { consumeLeadSearchQuota, searchNearbyBusinesses, validateLeadSearch, websiteFreeLeads } from '../netlify/lib/nearby-businesses.mjs';

class MemoryStore {
  map = new Map();
  revision = 0;
  async getWithMetadata(key) {
    const value = this.map.get(key);
    return value ? { data: structuredClone(value.data), etag: value.etag } : null;
  }
  async setJSON(key, data, options = {}) {
    const current = this.map.get(key);
    if ((options.onlyIfNew && current) || (options.onlyIfMatch && options.onlyIfMatch !== current?.etag)) return { modified: false };
    this.map.set(key, { data: structuredClone(data), etag: String(++this.revision) });
    return { modified: true };
  }
}

test('lead search accepts only bounded coordinates, configured radii and known categories', () => {
  assert.deepEqual(validateLeadSearch({ latitude: -33.8688, longitude: 151.2093, radius: 5000, category: 'trades' }), { latitude: -33.8688, longitude: 151.2093, radius: 5000, category: 'trades' });
  for (const input of [
    { latitude: 91, longitude: 151, radius: 5000, category: 'trades' },
    { latitude: -33, longitude: 181, radius: 5000, category: 'trades' },
    { latitude: -33, longitude: 151, radius: 100000, category: 'trades' },
    { latitude: -33, longitude: 151, radius: 5000, category: 'anything' },
  ]) assert.throws(() => validateLeadSearch(input));
});

test('only operational Google Maps listings without a website become leads', () => {
  const leads = websiteFreeLeads([
    { id: 'one', businessStatus: 'OPERATIONAL', displayName: { text: 'Local Sparkie' }, formattedAddress: '1 Test St', primaryTypeDisplayName: { text: 'Electrician' }, googleMapsUri: 'https://maps.google.com/?cid=1', nationalPhoneNumber: '(02) 9000 0000', rating: 4.8, userRatingCount: 12 },
    { id: 'two', businessStatus: 'OPERATIONAL', displayName: { text: 'Has A Site' }, websiteUri: 'https://example.test', googleMapsUri: 'https://maps.google.com/?cid=2' },
    { id: 'three', businessStatus: 'CLOSED_PERMANENTLY', displayName: { text: 'Closed Shop' }, googleMapsUri: 'https://maps.google.com/?cid=3' },
    { id: 'four', businessStatus: 'OPERATIONAL', displayName: { text: 'Unsafe Link' }, googleMapsUri: 'https://attacker.example/listing' },
  ]);
  assert.deepEqual(leads, [{ id: 'one', name: 'Local Sparkie', address: '1 Test St', type: 'Electrician', phone: '(02) 9000 0000', rating: 4.8, ratingCount: 12, mapsUrl: 'https://maps.google.com/?cid=1' }]);
});

test('Google request keeps the API key in a server header and filters the returned places', async () => {
  let request;
  const leads = await searchNearbyBusinesses({ latitude: -33.8688, longitude: 151.2093, radius: 2000, category: 'food' }, 'server-secret', async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ places: [{ id: 'cafe', businessStatus: 'OPERATIONAL', displayName: { text: 'Corner Cafe' }, googleMapsUri: 'https://www.google.com/maps/place/?q=place_id:cafe' }] }) };
  });
  assert.equal(request.url, 'https://places.googleapis.com/v1/places:searchNearby');
  assert.equal(request.options.headers['X-Goog-Api-Key'], 'server-secret');
  assert.match(request.options.headers['X-Goog-FieldMask'], /places\.websiteUri/);
  assert.deepEqual(request.body.includedTypes, ['bakery', 'cafe', 'coffee_shop', 'restaurant']);
  assert.equal(request.body.locationRestriction.circle.radius, 2000);
  assert.equal(leads[0].name, 'Corner Cafe');
});

test('per-account quota stops searches after the daily partner allowance', async () => {
  const store = new MemoryStore();
  const day = new Date('2026-09-02T01:00:00Z');
  for (let count = 0; count < 25; count += 1) await consumeLeadSearchQuota(store, 'partner-1', false, day);
  await assert.rejects(consumeLeadSearchQuota(store, 'partner-1', false, day), /Daily lead-search limit/);
  assert.equal((await consumeLeadSearchQuota(store, 'owner-1', true, day)).remaining, 99);
});
