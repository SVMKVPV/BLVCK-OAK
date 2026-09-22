'use strict';

const packageCatalog = Object.freeze({
  'link-in-bio': {
    id: 'link-in-bio',
    name: 'Link in bio',
    price: '$13.13 AUD / month',
    billing: 'monthly',
  },
  essential: {
    id: 'essential',
    name: 'Essential',
    price: '$500 AUD',
  },
  professional: {
    id: 'professional',
    name: 'Professional',
    price: '$1,500 AUD',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: '$2,900 AUD',
    referralPrice: '$1,160 AUD',
  },
});

const REFERRAL_STORAGE_KEY = 'blackOakReferralCode';
const referralCodePattern = /^BO-[A-F0-9]{10}$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normaliseReferralCode(value = '') {
  return String(value)
    .trim()
    .toUpperCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '')
    .slice(0, 13);
}
