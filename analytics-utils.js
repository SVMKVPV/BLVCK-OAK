export function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value !== 'number' && /^[\s]*[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function reportCsv(report) {
  return '\uFEFF' + [report.columns, ...report.rows].map(row => row.map(csvCell).join(',')).join('\r\n');
}

export function periodChange(current, previous) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return 'Comparison unavailable';
  if (previous === 0) return current === 0 ? 'No change from previous period' : 'No previous-period baseline';
  const percentage = ((current - previous) / previous) * 100;
  return `${percentage > 0 ? '+' : ''}${percentage.toFixed(1)}% from previous period`;
}

export function reportTotals(report) {
  if (!report || report.error || !report.rows?.length) return {};
  return Object.fromEntries(report.columns.map((column, index) => [column, report.rows[0][index]]));
}

export const metricLabels = {
  activeUsers: 'Active users', newUsers: 'New users', sessions: 'Sessions', engagedSessions: 'Engaged sessions', engagementRate: 'Engagement rate',
  screenPageViews: 'Views', eventCount: 'Events', keyEvents: 'Key events', totalRevenue: 'Total revenue (AUD)', userEngagementDuration: 'Engagement time (seconds)',
  sessionDefaultChannelGroup: 'Channel', sessionSourceMedium: 'Source / medium', sessionCampaignName: 'Campaign', pagePath: 'Page', landingPage: 'Landing page',
  eventName: 'Event', totalUsers: 'Users', country: 'Country', city: 'City', deviceCategory: 'Device', browser: 'Browser', newVsReturning: 'Visitor type',
  itemName: 'Product', itemsViewed: 'Items viewed', itemsAddedToCart: 'Items added to cart', itemsPurchased: 'Items purchased', itemRevenue: 'Item revenue (AUD)',
  date: 'Date', label: 'Name', count: 'Views', views: 'Views', visitors: 'Approx. visitors', interactions: 'Interactions',
};

export function formatMetric(value, key) {
  if (typeof value !== 'number') return String(value ?? '—');
  if (/revenue|itemRevenue/i.test(key)) return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(value);
  if (/rate$/i.test(key)) return new Intl.NumberFormat('en-AU', { style: 'percent', maximumFractionDigits: 1 }).format(value);
  return new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(value);
}
