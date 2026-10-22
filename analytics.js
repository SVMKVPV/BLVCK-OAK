import { formatMetric, metricLabels, periodChange, reportCsv, reportTotals } from './analytics-utils.js';

const $ = selector => document.querySelector(selector);
let source = 'first_party';
let view = 'overview';
let requestVersion = 0;
let currentData = null;
let currentReports = [];
let currentTimeline = null;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function status(message, error = false) {
  $('#analytics-status').textContent = message;
  $('#analytics-status').dataset.error = String(error);
}

function sydneyToday() {
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Sydney', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

function setPeriod() {
  if ($('#period').value === 'custom') return;
  const end = sydneyToday();
  $('#end').value = end;
  $('#start').value = new Date(Date.parse(end + 'T00:00:00Z') - (Number($('#period').value) - 1) * 86400000).toISOString().slice(0, 10);
}

function parameters() {
  const form = new FormData($('#report-filters'));
  return new URLSearchParams([...form].filter(([key, value]) => key !== 'period' && String(value).trim()).map(([key, value]) => [key, String(value).trim()]));
}

async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Reports could not be loaded. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function clearPrivateReports() {
  currentData = null; currentReports = []; currentTimeline = null;
  $('#analytics-workspace').hidden = true;
  $('#report-content').hidden = true;
  ['#metrics', '#reports', '#chart', '#timeline-table', '#report-notes'].forEach(selector => $(selector).replaceChildren());
  ['#report-description', '#report-updated', '#missing-config'].forEach(selector => { $(selector).textContent = ''; });
  $('#export-timeline').disabled = true;
}

function denyAccess(error) {
  clearPrivateReports();
  $('#access-panel').hidden = false;
  $('#access-title').textContent = error.status === 401 ? 'Sign in to your owner account.' : 'This view belongs to the owner.';
  $('#access-message').textContent = error.status === 401 ? 'Use the same verified email you use to administer BLVCK OAK. Your partner login will bring you back here.' : 'Your current partner account does not have permission to view business analytics. Sign in with the configured owner email.';
  status('Private reports are protected by owner verification.', error.status !== 401);
}

function firstPartyReports(data) {
  const definitions = [
    ['sources', 'Traffic sources', 'Source', 'acquisition'], ['mediums', 'Campaign medium', 'Medium', 'acquisition'],
    ['campaigns', 'Campaigns', 'Campaign', 'acquisition'], ['referrals', 'Referral codes', 'Code', 'acquisition'],
    ['pages', 'Top pages', 'Page', 'engagement'], ['events', 'Recorded events', 'Event', 'engagement'],
    ['countries', 'Countries', 'Country', 'audience'], ['cities', 'Cities', 'City', 'audience'],
    ['devices', 'Devices', 'Device', 'audience'], ['browsers', 'Browsers', 'Browser', 'audience'],
  ];
  return definitions.map(([id, title, label, section]) => ({ id, title, section, columns: [label, id === 'events' ? 'Events' : 'Views'], rows: (data[id] || []).map(row => [row.label, row.count]) }));
}

const gaSections = { channels: 'acquisition', sources: 'acquisition', campaigns: 'acquisition', pages: 'engagement', landing: 'engagement', events: 'engagement', geography: 'audience', technology: 'audience', returning: 'audience', commerce: 'revenue', realtimeLocations: 'overview' };

function exportReport(report) {
  if (!report || report.error) return;
  const blob = new Blob([reportCsv(report)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = node('a'); link.href = url;
  link.download = `BLVCK-OAK-${source}-${report.id}-${$('#start').value}-${$('#end').value}.csv`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function table(report) {
  const wrapper = node('div', 'table-wrap');
  if (report.error || !report.rows?.length) {
    wrapper.append(node('p', 'empty-state', report.error || 'No recorded data for this period and filter.'));
    return wrapper;
  }
  const element = node('table');
  const caption = node('caption', 'sr-only', report.title);
  const head = node('thead'), heading = node('tr');
  report.columns.forEach(column => { const th = node('th', '', metricLabels[column] || column); th.scope = 'col'; heading.append(th); });
  head.append(heading); element.append(caption, head);
  const body = node('tbody');
  report.rows.forEach(row => {
    const tr = node('tr');
    row.forEach((value, index) => tr.append(node('td', '', formatMetric(value, report.columns[index]))));
    body.append(tr);
  });
  element.append(body); wrapper.append(element);
  return wrapper;
}

function reportCard(report) {
  const card = node('section', 'report-card');
  const heading = node('div', 'card-heading');
  heading.append(node('h2', '', report.title));
  const button = node('button', 'export-button', 'Export CSV ↓'); button.type = 'button';
  button.disabled = Boolean(report.error || !report.rows?.length);
  button.setAttribute('aria-label', `Export ${report.title} as CSV`);
  button.addEventListener('click', () => exportReport(report)); heading.append(button); card.append(heading, table(report));
  const notes = [];
  if (report.rowCount > report.rows.length) notes.push(`Showing ${report.rows.length} of ${report.rowCount} result rows.`);
  if (report.metadata?.subjectToThresholding) notes.push('Google applied a data threshold to this report.');
  if (report.metadata?.dataLossFromOtherRow) notes.push('Some detail is grouped into an “other” row by Google.');
  if (notes.length) card.append(node('p', 'table-note', notes.join(' ')));
  return card;
}

function metric(label, value, note, key = '') {
  const card = node('article', 'metric-card');
  card.append(node('h2', '', label), node('strong', '', value === undefined ? '—' : formatMetric(value, key)), node('p', '', note || ''));
  return card;
}

function renderMetrics(data) {
  const container = $('#metrics'); container.replaceChildren();
  if (source === 'first_party') {
    container.append(
      metric('Website views', data.summary.views, periodChange(data.summary.views, data.previous.views)),
      metric('Approx. visitors', data.summary.visitors, periodChange(data.summary.visitors, data.previous.visitors)),
      metric('Recorded interactions', data.summary.interactions, periodChange(data.summary.interactions, data.previous.interactions)),
      metric('Visitors · last 30 min', data.realtime.approximateVisitors, `${data.realtime.views} views · network-based estimate`),
    );
    return;
  }
  const summary = reportTotals(data.reports.find(report => report.id === 'summary'));
  const previous = reportTotals(data.reports.find(report => report.id === 'previous'));
  const realtime = reportTotals(data.reports.find(report => report.id === 'realtime'));
  for (const key of ['activeUsers', 'sessions', 'screenPageViews', 'engagementRate', 'newUsers', 'keyEvents', 'totalRevenue']) {
    container.append(metric(metricLabels[key], summary[key], periodChange(summary[key], previous[key]), key));
  }
  container.append(metric('Active users · last 30 min', realtime.activeUsers, 'GA4 realtime · up to 60 seconds cached'));
}

function svgElement(name, attributes) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function renderChart(report) {
  const container = $('#chart'); container.replaceChildren();
  $('#timeline-table').replaceChildren(table(report));
  $('#export-timeline').disabled = Boolean(report.error || !report.rows?.length);
  if (report.error || !report.rows?.length) { container.append(node('p', 'empty-state', report.error || 'Your daily picture will appear as visits are recorded.')); return; }
  const seriesKey = source === 'ga4' ? 'screenPageViews' : 'views';
  const valueIndex = report.columns.indexOf(seriesKey);
  const values = report.rows.map(row => Number(row[valueIndex]) || 0);
  const max = Math.max(1, ...values);
  const svg = svgElement('svg', { viewBox: '0 0 1000 240', role: 'presentation', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
  const width = 910, left = 55, top = 15, height = 180;
  [0, .5, 1].forEach(ratio => {
    const y = top + height * (1 - ratio);
    svg.append(svgElement('line', { x1: left, x2: left + width, y1: y, y2: y, stroke: '#30372d', 'stroke-width': 1 }));
    const label = svgElement('text', { x: 0, y: y + 4 }); label.textContent = formatMetric(Math.round(max * ratio), 'views'); svg.append(label);
  });
  const points = values.map((value, index) => `${left + (values.length === 1 ? width / 2 : index * width / (values.length - 1))},${top + height - value / max * height}`).join(' ');
  svg.append(svgElement('polyline', { points, fill: 'none', stroke: '#d6c39a', 'stroke-width': 2.5, 'vector-effect': 'non-scaling-stroke', 'stroke-linejoin': 'round' }));
  if (values.length === 1) svg.append(svgElement('circle', { cx: left + width / 2, cy: top + height - values[0] / max * height, r: 4, fill: '#d6c39a' }));
  const formatDate = value => /^\d{8}$/.test(value) ? `${value.slice(6,8)}/${value.slice(4,6)}` : `${value.slice(8,10)}/${value.slice(5,7)}`;
  [0, values.length - 1].forEach((index, position) => {
    const label = svgElement('text', { x: position ? left + width : left, y: 225, 'text-anchor': position ? 'end' : 'start' }); label.textContent = formatDate(String(report.rows[index][0])); svg.append(label);
  });
  container.append(svg);
  container.setAttribute('aria-label', `Daily website views from ${$('#start').value} to ${$('#end').value}. ${values.length} daily results; maximum ${max} views. Detailed values follow in the daily data table.`);
}

function renderSections() {
  if (!currentData) return;
  $('#chart-card').hidden = view !== 'overview';
  $('#metrics').hidden = !['overview', 'revenue'].includes(view);
  $('#reports').replaceChildren();
  let selected = currentReports.filter(report => report.section === view);
  if (view === 'overview') selected = currentReports.filter(report => source === 'ga4' ? ['channels', 'pages', 'realtimeLocations'].includes(report.id) : ['sources', 'pages'].includes(report.id));
  if (view === 'revenue' && source === 'first_party') {
    const card = node('section', 'report-card');
    card.append(node('h2', '', 'Revenue has its own source.'), node('p', 'empty-state', 'Website visit records do not establish revenue. Your existing business workspace contains Stripe payments, fees and customer revenue. Google Analytics ecommerce reports appear here once a collecting GA4 property is connected.'));
    const link = node('a', 'text-link', 'Open payment analytics ↗'); link.href = '/partners.html#owner-analytics-title'; card.append(link); $('#reports').append(card);
  } else selected.forEach(report => $('#reports').append(reportCard(report)));
}

function render(data) {
  currentData = data;
  $('#analytics-workspace').hidden = false; $('#access-panel').hidden = true;
  const disconnected = source === 'ga4' && Array.isArray(data.missing);
  $('#connection-panel').hidden = !disconnected;
  $('#report-content').hidden = disconnected;
  if (disconnected) {
    $('#connection-message').textContent = data.message;
    $('#missing-config').textContent = `Needed: ${data.missing.join(', ')}.`;
    $('#report-description').textContent = 'GA4 reports require a connected property. Website records remain available.';
    $('#report-updated').textContent = '';
    $('#report-notes').replaceChildren();
    status('Google Analytics connection is ready for configuration.');
    return;
  }
  $('#report-description').textContent = `${data.range.start} — ${data.range.end} · compared with ${data.range.previousStart} — ${data.range.previousEnd} · ${source === 'first_party' ? 'Australia/Sydney' : data.reports.find(report => report.metadata?.timeZone)?.metadata.timeZone || 'GA4 property timezone'}`;
  $('#report-updated').textContent = `Updated ${new Date(data.generatedAt).toLocaleString('en-AU', { timeZone: 'Australia/Sydney', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })} Sydney${data.cached ? ' · cached' : ''}`;
  if (data.analyticsUrl) $('#open-ga4').href = data.analyticsUrl;
  renderMetrics(data);
  if (source === 'first_party') {
    currentReports = firstPartyReports(data);
    currentTimeline = { id: 'timeline', title: 'Daily website records', columns: ['date', 'views', 'visitors', 'interactions'], rows: data.timeline.map(row => [row.date, row.views, row.visitors, row.interactions]) };
  } else {
    currentReports = data.reports.map(report => ({ ...report, section: gaSections[report.id] }));
    currentTimeline = data.reports.find(report => report.id === 'timeline');
  }
  renderChart(currentTimeline);
  renderSections();
  $('#report-notes').replaceChildren(...(data.notes || []).map(note => node('li', '', note)));
  const failed = source === 'ga4' ? data.reports.filter(report => report.error).length : 0;
  status(failed ? `${failed} Google Analytics report${failed === 1 ? '' : 's'} could not load. Available reports are shown below.` : source === 'first_party' ? 'Website records · private owner view.' : 'Google Analytics · private owner view.', Boolean(failed));
}

async function load() {
  const version = ++requestVersion;
  status(source === 'ga4' ? 'Loading Google Analytics reports…' : 'Loading website records…');
  $('#refresh-reports').disabled = true;
  $('#report-content').setAttribute('aria-busy', 'true');
  try {
    // Every load verifies the current owner session. The server can reuse report
    // data only after authorization; private responses are never cached here.
    const data = await api(`/.netlify/functions/${source === 'ga4' ? 'owner-ga4' : 'owner-traffic'}?${parameters()}`);
    if (version !== requestVersion) return;
    render(data);
  } catch (error) {
    if (version !== requestVersion) return;
    if (error.status === 401 || error.status === 403) denyAccess(error);
    else {
      currentData = null; currentReports = []; currentTimeline = null;
      $('#report-content').hidden = true;
      status(error.message, true);
      if ($('#analytics-workspace').hidden) {
        $('#access-panel').hidden = false;
        $('#access-title').textContent = 'Reports are temporarily unavailable.';
        $('#access-message').textContent = 'Your access or the reporting connection could not be checked. Reload this page, or return to your partner workspace.';
      }
    }
  } finally {
    if (version === requestVersion) { $('#refresh-reports').disabled = false; $('#report-content').setAttribute('aria-busy', 'false'); }
  }
}

$('#period').addEventListener('change', setPeriod);
['#start', '#end'].forEach(selector => $(selector).addEventListener('change', () => { $('#period').value = 'custom'; }));
$('#report-filters').addEventListener('submit', event => { event.preventDefault(); load(); });
document.querySelectorAll('[data-source]').forEach(button => button.addEventListener('click', () => {
  source = button.dataset.source;
  document.querySelectorAll('[data-source]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  load();
}));
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view;
  document.querySelectorAll('[data-view]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  renderSections();
}));
$('#export-timeline').addEventListener('click', () => exportReport(currentTimeline));
function recheckOwnerAccess() {
  clearPrivateReports();
  $('#access-panel').hidden = true;
  return load();
}
window.addEventListener('focus', recheckOwnerAccess);
window.addEventListener('pageshow', event => {
  if (event.persisted) return recheckOwnerAccess();
});
$('#start').max = sydneyToday(); $('#end').max = sydneyToday();
setPeriod();
load();
