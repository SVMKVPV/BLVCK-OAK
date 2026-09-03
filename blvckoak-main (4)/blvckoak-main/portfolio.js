'use strict';

const grid = document.querySelector('[data-portfolio-grid]');
const status = document.querySelector('[data-portfolio-status]');
const count = document.querySelector('[data-portfolio-count]');
const projectWord = document.querySelector('[data-project-word]');

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Completed project' : `Completed ${new Intl.DateTimeFormat('en-AU', { month: 'long', year: 'numeric' }).format(date)}`;
}

function projectCard(project, index) {
  const article = document.createElement('article');
  article.className = 'portfolio-card';
  article.dataset.projectIndex = String(index + 1).padStart(2, '0');

  const visual = document.createElement('div');
  visual.className = 'portfolio-card-visual';
  visual.setAttribute('aria-hidden', 'true');
  const monogram = document.createElement('span');
  monogram.textContent = project.title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'BO';
  visual.append(monogram);

  const body = document.createElement('div');
  body.className = 'portfolio-card-body';
  const meta = document.createElement('p');
  meta.className = 'portfolio-card-meta';
  const category = document.createElement('span'); category.textContent = project.category;
  const completed = document.createElement('time'); completed.dateTime = project.completedAt || ''; completed.textContent = formatDate(project.completedAt);
  meta.append(category, completed);
  const title = document.createElement('h3'); title.textContent = project.title;
  const summary = document.createElement('p'); summary.textContent = project.summary;
  body.append(meta, title, summary);
  if (project.websiteUrl) {
    const link = document.createElement('a');
    link.className = 'portfolio-project-link'; link.href = project.websiteUrl; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.textContent = 'Visit live website';
    const arrow = document.createElement('span'); arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '↗';
    link.append(arrow); body.append(link);
  }
  article.append(visual, body);
  return article;
}

async function loadPortfolio() {
  try {
    const response = await fetch('/api/portfolio', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!(response.headers.get('content-type') || '').includes('application/json')) throw new Error('Portfolio service unavailable.');
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.projects)) throw new Error(data.error || 'Portfolio service unavailable.');
    count.textContent = String(data.projects.length);
    projectWord.textContent = data.projects.length === 1 ? 'project' : 'projects';
    grid.replaceChildren(...data.projects.map(projectCard));
    if (!data.projects.length) {
      const empty = document.createElement('div');
      empty.className = 'portfolio-empty';
      const label = document.createElement('p'); label.className = 'section-label'; label.textContent = 'Work in progress';
      const heading = document.createElement('h3'); heading.textContent = 'New launches will appear here.';
      const copy = document.createElement('p'); copy.textContent = 'Completed projects are added only after the owner reviews and publishes their public details.';
      empty.append(label, heading, copy); grid.append(empty);
    }
    status.hidden = true;
  } catch {
    count.textContent = '—';
    status.textContent = 'The live portfolio could not be loaded right now. Please try again shortly.';
    status.classList.add('portfolio-error');
  }
}

loadPortfolio();
