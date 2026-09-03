'use strict';
const $ = (selector) => document.querySelector(selector);
const parameters = new URLSearchParams(location.search);
const projectId = parameters.get('project') || '';
const privateToken = location.hash.slice(1);
let lastRevision = null;
let loading = false;

function status(message, error = false) {
  $('[data-progress-status]').textContent = message;
  $('[data-progress-status]').classList.toggle('error', error);
}

function dateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Update time unavailable' : date.toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderList(selector, items, emptyMessage) {
  const list = $(selector); list.replaceChildren();
  const values = items.length ? items : [emptyMessage];
  values.forEach((value) => {
    const item = document.createElement('li');
    item.textContent = value;
    if (!items.length) item.className = 'progress-empty';
    list.append(item);
  });
}

function renderHistory(history) {
  const container = $('[data-progress-history]'); container.replaceChildren();
  if (!history.length) {
    const empty = document.createElement('p'); empty.className = 'muted'; empty.textContent = 'The first detailed update will appear here.'; container.append(empty); return;
  }
  [...history].reverse().forEach((entry) => {
    const article = document.createElement('article'); article.className = 'progress-history-entry';
    const header = document.createElement('header');
    const title = document.createElement('strong'); title.textContent = `${entry.percentage}% · ${entry.stageLabel}`;
    const time = document.createElement('time'); time.dateTime = entry.updatedAt || ''; time.textContent = dateTime(entry.updatedAt);
    header.append(title, time); article.append(header);
    if (entry.summary) { const summary = document.createElement('p'); summary.textContent = entry.summary; article.append(summary); }
    container.append(article);
  });
}

function renderProject(project) {
  const progress = project.progress;
  document.title = `${project.service} progress — Black Oak`;
  $('[data-progress-panel]').hidden = false;
  $('[data-project-title]').textContent = project.service;
  $('[data-project-client]').textContent = `Project for ${project.customerName}`;
  $('[data-progress-stage]').textContent = progress.stageLabel;
  $('[data-progress-percent]').textContent = `${progress.percentage}%`;
  $('[data-progress-bar]').style.width = `${progress.percentage}%`;
  $('[data-progress-track]').setAttribute('aria-valuenow', String(progress.percentage));
  $('[data-progress-updated]').textContent = progress.updatedAt ? `Last updated ${dateTime(progress.updatedAt)}` : 'Waiting for the first update';
  $('[data-progress-summary]').textContent = progress.summary || 'Black Oak will add the latest project note here.';
  renderList('[data-completed-list]', progress.completedItems, 'Completed items will be listed as work progresses.');
  renderList('[data-next-list]', progress.nextSteps, 'No further steps are currently listed.');
  renderHistory(progress.history);
  const changed = lastRevision !== null && progress.revision !== lastRevision;
  lastRevision = progress.revision;
  status(changed ? 'A new project update has just been received.' : 'Live progress is up to date. This page checks automatically every 15 seconds.');
}

async function loadProgress() {
  if (loading || document.hidden) return;
  if (!/^[a-f0-9]{32}$/.test(projectId) || !/^[A-Za-z0-9_-]{43}$/.test(privateToken)) {
    status('This private link is incomplete. Ask Black Oak or your referral partner for the full project progress link.', true); return;
  }
  loading = true;
  try {
    const response = await fetch('/api/project-progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'view', id: projectId, token: privateToken }), cache: 'no-store' });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('The progress service is not connected on this copy of the website. Contact Black Oak.');
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to load project progress.');
    renderProject(result.project);
  } catch (error) { status(error.message, true); }
  finally { loading = false; }
}

$('[data-payment-link]').href = `/pay.html?quote=${encodeURIComponent(projectId)}#${privateToken}`;
document.addEventListener('visibilitychange', () => { if (!document.hidden) loadProgress(); });
loadProgress();
setInterval(loadProgress, 15000);
