import { PortalError, siteOrigin } from './portal-auth.mjs';

export const progressStages = Object.freeze({
  planning: 'Planning',
  design: 'Design',
  development: 'Development',
  client_review: 'Client review',
  launch: 'Launch',
  completed: 'Completed',
  on_hold: 'On hold',
});

function cleanSummary(value) {
  const summary = String(value || '').trim();
  if (summary.length > 1000) throw new PortalError('The latest update must be 1,000 characters or fewer.');
  return summary;
}

function cleanItems(value, label) {
  const source = Array.isArray(value) ? value : String(value || '').split(/\r?\n/);
  const items = source.map((item) => String(item).trim()).filter(Boolean);
  if (items.length > 12) throw new PortalError(`${label} can contain up to 12 items.`);
  if (items.some((item) => item.length > 160)) throw new PortalError(`Each ${label.toLowerCase()} item must be 160 characters or fewer.`);
  return items;
}

export function validateProjectProgress(input) {
  const percentage = Number(input.percentage);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new PortalError('Progress must be a whole number from 0 to 100.');
  if (!Object.hasOwn(progressStages, input.stage)) throw new PortalError('Choose a valid project stage.');
  if (input.stage === 'completed' && percentage !== 100) throw new PortalError('Completed projects must show 100% progress.');
  return {
    stage: input.stage,
    percentage,
    summary: cleanSummary(input.summary),
    completedItems: cleanItems(input.completedItems, 'Completed work'),
    nextSteps: cleanItems(input.nextSteps, 'Next steps'),
  };
}

export function readProjectProgress(quote) {
  const stored = quote?.projectProgress;
  if (!stored || !Number.isInteger(stored.revision)) {
    return {
      revision: 0,
      stage: 'planning',
      percentage: 0,
      summary: 'Your project has been approved and is being prepared for delivery.',
      completedItems: [],
      nextSteps: ['Black Oak will publish the first project update here.'],
      updatedAt: quote?.approvedAt || quote?.createdAt || null,
      history: [],
    };
  }
  const stage = Object.hasOwn(progressStages, stored.stage) ? stored.stage : 'planning';
  const percentage = Number.isInteger(stored.percentage) && stored.percentage >= 0 && stored.percentage <= 100 ? stored.percentage : 0;
  return {
    revision: Math.max(0, stored.revision),
    stage,
    percentage,
    summary: cleanSummary(stored.summary),
    completedItems: cleanItems(stored.completedItems, 'Completed work'),
    nextSteps: cleanItems(stored.nextSteps, 'Next steps'),
    updatedAt: typeof stored.updatedAt === 'string' ? stored.updatedAt : null,
    history: Array.isArray(stored.history) ? stored.history.slice(-50).map((entry) => ({
      revision: Number.isInteger(entry.revision) ? entry.revision : 0,
      stage: Object.hasOwn(progressStages, entry.stage) ? entry.stage : 'planning',
      percentage: Number.isInteger(entry.percentage) ? Math.min(100, Math.max(0, entry.percentage)) : 0,
      summary: cleanSummary(entry.summary),
      completedItems: cleanItems(entry.completedItems, 'Completed work'),
      nextSteps: cleanItems(entry.nextSteps, 'Next steps'),
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    })) : [],
  };
}

export function applyProjectProgress(quote, input, accountId, now = new Date().toISOString()) {
  const current = readProjectProgress(quote);
  if (!Number.isInteger(input.progressRevision) || input.progressRevision !== current.revision) throw new PortalError('This project changed. Refresh before saving progress.', 409);
  const update = validateProjectProgress(input);
  const snapshot = { revision: current.revision + 1, ...update, updatedAt: now };
  return {
    ...quote,
    projectProgress: {
      ...snapshot,
      updatedBy: accountId,
      history: [...current.history, snapshot].slice(-50),
    },
  };
}

export function projectProgressLink(quote) {
  return `${siteOrigin()}/progress.html?project=${quote.id}#${quote.publicToken}`;
}

export function publicProjectProgress(quote) {
  const progress = readProjectProgress(quote);
  return {
    id: quote.id,
    customerName: quote.customerName,
    service: quote.service,
    status: quote.status,
    progress: {
      ...progress,
      stageLabel: progressStages[progress.stage],
      history: progress.history.map((entry) => ({ ...entry, stageLabel: progressStages[entry.stage] })),
    },
  };
}
