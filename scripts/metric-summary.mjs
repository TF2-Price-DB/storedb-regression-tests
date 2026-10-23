import { performanceMetrics } from './lighthouse-metrics.mjs';

const escapeCell = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('|', '&#124;').replaceAll('\n', ' ').replaceAll('\r', ' ');

export function renderMetricSummary(rows) {
  const table = (property, labels, format) => {
    let markdown = `| Path | ${labels.join(' | ')} |\n| --- | ${labels.map(() => '---:').join(' | ')} |\n`;
    for (const row of rows) {
      const url = new URL(row.url);
      const values = performanceMetrics.map(metric => {
        const value = row[property]?.[metric.id];
        return typeof value === 'number' && Number.isFinite(value) ? format(value, metric) : 'N/A';
      });
      markdown += `| <code>${escapeCell(url.pathname + url.search)}</code> | ${values.join(' | ')} |\n`;
    }
    return markdown;
  };
  return '\n\n## Individual performance metrics\n\n'
    + 'Scores use Lighthouse’s 0–100 scale. Missing measurements are shown as N/A.\n\n'
    + '### Metric scores\n\n'
    + table('metricScores', performanceMetrics.map(metric => metric.label), value => String(value))
    + '\n### Measured values\n\n'
    + 'Durations are rounded to the nearest millisecond. CLS is unitless and shown to four significant digits; CSV files retain its full precision.\n\n'
    + table('metricValues', performanceMetrics.map(metric => metric.unit ? `${metric.label} (${metric.unit})` : metric.label),
      (value, metric) => metric.unit === 'ms' ? String(Math.round(value)) : String(Number(value.toPrecision(4))));
}
