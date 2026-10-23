import { performanceMetrics } from './lighthouse-metrics.mjs';

export const metrics = ['performance', 'accessibility', 'seo', 'best-practices'];
const legacyHeader = 'Path,Performance,Accessibility,SEO,Best Practices';
const metricColumns = [
  ...performanceMetrics.map(metric => ({ label: `${metric.label} Score`, key: metric.id, property: 'metricScores' })),
  ...performanceMetrics.map(metric => ({ label: metric.unit ? `${metric.label} (${metric.unit})` : metric.label, key: metric.id, property: 'metricValues', round: metric.unit === 'ms' })),
];
const header = [legacyHeader, ...metricColumns.map(column => column.label)].join(',');

export function writeHistoryCsv(rows) {
  const quote = value => /[,"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return header + '\n' + rows.map(row => {
    const url = new URL(row.url);
    return [url.pathname + url.search, ...metrics.map(metric => row.scores?.[metric] ?? ''),
      ...metricColumns.map(column => {
        const value = row[column.property]?.[column.key];
        return value == null ? 'N/A' : column.round ? Math.round(value) : value;
      })]
      .map(value => quote(String(value))).join(',');
  }).join('\n') + '\n';
}

export function readHistoryCsv(csv, site = 'https://crit.tf') {
  const records = [];
  let record = [], value = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (char === '"') {
      if (quoted && csv[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (char === ',' || char === '\n')) {
      record.push(value.replace(/\r$/, ''));
      value = '';
      if (char === '\n') { records.push(record); record = []; }
    } else value += char;
  }
  if (quoted) throw new Error('Unterminated CSV field');
  if (value || record.length) records.push([...record, value]);
  const actualHeader = records.shift()?.join(',');
  if (actualHeader !== header && actualHeader !== legacyHeader) throw new Error('Unexpected history CSV header');
  const extended = actualHeader === header;
  return records.map(([pathname, ...values]) => {
    if (!pathname || values.length !== metrics.length + (extended ? metricColumns.length : 0)) throw new Error('Invalid history CSV row');
    const scores = values.slice(0, metrics.length).map(value => value === '' ? null : Number(value));
    if (scores.some(value => value !== null && (!Number.isFinite(value) || value < 0 || value > 100))) {
      throw new Error('Invalid history score');
    }
    const row = {
      url: new URL(pathname, site).href,
      ...(scores.every(value => value !== null) ? { scores: Object.fromEntries(metrics.map((metric, i) => [metric, scores[i]])) } : {}),
    };
    if (extended) metricColumns.forEach((column, i) => {
      const value = values[metrics.length + i];
      if (value === '' || value === 'N/A') return;
      const number = Number(value);
      if (!Number.isFinite(number) || number < 0 || (column.property === 'metricScores' && number > 100)) {
        throw new Error(`Invalid history metric: ${column.label}`);
      }
      (row[column.property] ??= {})[column.key] = number;
    });
    return row;
  });
}

export function summarizeRows(rows, categories) {
  const median = values => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  return Object.fromEntries([...categories].map(([category, urls]) => {
    const selected = rows.filter(row => row.categories ? row.categories.includes(category) : urls.has(row.url));
    const successful = selected.filter(row => row.scores);
    return [category, {
      available: urls.size, selected: selected.length, successful: successful.length,
      scores: Object.fromEntries(metrics.map(metric => [metric, median(successful.map(row => row.scores[metric]))])),
    }];
  }));
}
