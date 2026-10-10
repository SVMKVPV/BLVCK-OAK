(() => {
  'use strict';
  const publicPaths = new Set(['/', '/index.html', '/partners', '/partners.html', '/privacy', '/privacy.html', '/terms', '/terms.html', '/refunds', '/refunds.html', '/referrals', '/referrals.html', '/oakpay', '/oakpay.html']);
  const isCommunity = /^\/community(?:\.html)?\/?$/.test(location.pathname) || /^\/community\/[a-z0-9-]+\/(?:index\.html)?$/.test(location.pathname);
  const isLogin = /^\/partners(?:\.html)?\/?$/.test(location.pathname);
  const isPublic = isCommunity || publicPaths.has(location.pathname.replace(/\/$/, '') || '/');
  let authenticated = false;
  let checked = false;
  let replaying = false;
  let pending;
  const currentPath = () => location.pathname + location.search + location.hash;
  function login(next = currentPath()) {
    location.assign('/partners.html?next=' + encodeURIComponent(next));
  }
  async function check() {
    if (pending) return pending;
    pending = (async () => {
      try {
        const response = await fetch('/.netlify/functions/site-session', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
        if (response.status !== 401 && response.status !== 403 && !response.ok) throw new Error('Session check unavailable');
        authenticated = response.ok && (await response.json()).authenticated === true;
        checked = true;
        document.documentElement.dataset.signedIn = String(authenticated);
        document.querySelectorAll('a[href="partners.html"],a[href="/partners.html"]').forEach(link => {
          if (!link.closest('[data-auth-panel]')) link.textContent = authenticated ? 'My account' : 'Log in';
        });
        return authenticated;
      } catch {
        checked = false;
        return null;
      } finally { pending = null; }
    })();
    return pending;
  }
  const ready = check();
  window.blackOakAccess = { ready, check, get authenticated() { return authenticated; }, login };
  if (!isPublic) {
    document.documentElement.setAttribute('data-access-pending', '');
    ready.then(result => {
      if (result === true) document.documentElement.removeAttribute('data-access-pending');
      else login();
    });
  }
  function needsLogin(control) {
    if (!control) return false;
    if (isCommunity && control.closest('[data-public-community]')) return false;
    if (control.closest('[data-auth-panel],[data-dashboard]') || control.matches('[data-signout]')) return false;
    if (control.matches('[data-menu-toggle],[data-menu-close],[data-dismiss-notice],[data-oak-skip],[data-close-modal]')) return false;
    if (control.tagName === 'A') {
      const url = new URL(control.href, location.href);
      if (url.origin === location.origin && (publicPaths.has(url.pathname.replace(/\/$/, '') || '/') || /^\/community(?:\.html)?\/?$/.test(url.pathname) || /^\/community\/[a-z0-9-]+\/(?:index\.html)?$/.test(url.pathname))) return false;
      return true;
    }
    return !isLogin;
  }
  function nextFor(control) {
    if (control.tagName === 'A') {
      const url = new URL(control.href, location.href);
      // External previews open only after returning to this page with a valid session.
      if (url.origin === location.origin) return url.pathname + url.search + url.hash;
      sessionStorage.setItem('blackoak-preview-next', url.href);
      return currentPath();
    }
    const packageId = control.dataset.package || (control.matches('[data-enterprise-apply]') ? 'enterprise' : '');
    if (packageId) {
      const url = new URL(location.href);
      url.searchParams.set('package', packageId);
      url.hash = 'packages';
      return url.pathname + url.search + url.hash;
    }
    return currentPath();
  }
  function intercept(event) {
    const control = event.target.closest?.('a,button,input,select,textarea,form,[role="button"]');
    if (event.type === 'focusin' && !control?.matches('input,select,textarea')) return;
    if (replaying || !needsLogin(control) || (checked && authenticated)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const next = nextFor(control);
    check().then(result => {
      if (result !== true) { login(next); return; }
      // Resume the interaction only after the server confirms the existing session.
      replaying = true;
      try {
        if (event.type === 'submit') control.requestSubmit(event.submitter || undefined);
        else if (event.type === 'focusin') control.focus();
        else control.click();
      } finally { replaying = false; }
    });
  }
  ['click', 'auxclick', 'submit', 'focusin'].forEach(type => document.addEventListener(type, intercept, true));
  window.addEventListener('pageshow', event => { if (event.persisted) { checked = false; check(); } });
  window.addEventListener('focus', () => { checked = false; check(); });
  document.addEventListener('DOMContentLoaded', async () => {
    await ready;
    await check();
    if (authenticated && !isLogin) {
      const preview = sessionStorage.getItem('blackoak-preview-next');
      sessionStorage.removeItem('blackoak-preview-next');
      if (preview && /^https:\/\//.test(preview)) location.assign(preview);
    }
  });
})();
