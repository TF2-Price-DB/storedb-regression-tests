import fs from 'node:fs/promises';
import path from 'node:path';

export const performanceMetrics = [
  { id: 'largest-contentful-paint', label: 'LCP', unit: 'ms' },
  { id: 'cumulative-layout-shift', label: 'CLS', unit: '' },
  { id: 'first-contentful-paint', label: 'FCP', unit: 'ms' },
  { id: 'total-blocking-time', label: 'TBT', unit: 'ms' },
  { id: 'speed-index', label: 'Speed Index', unit: 'ms' },
];

export function extractLighthouseMetrics(report) {
  const metricScores = {}, metricValues = {};
  for (const { id } of performanceMetrics) {
    const audit = report.audits?.[id];
    if (typeof audit?.score === 'number' && Number.isFinite(audit.score)) metricScores[id] = Math.round(audit.score * 100);
    if (typeof audit?.numericValue === 'number' && Number.isFinite(audit.numericValue)) metricValues[id] = audit.numericValue;
  }
  return { ...(Object.keys(metricScores).length ? { metricScores } : {}), ...(Object.keys(metricValues).length ? { metricValues } : {}) };
}

// Unlighthouse's simple CI JSON has category scores only; use the original LHRs
// to obtain metric scores/values without making additional page requests.
export async function loadLighthouseReports(directory) {
  const reports = new Map();
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(filename);
      else if (entry.name === 'lighthouse.json') {
        const report = JSON.parse(await fs.readFile(filename, 'utf8'));
        if (!report.audits || !report.requestedUrl || report.runtimeError) continue;
        const url = new URL(report.requestedUrl);
        reports.set(url.pathname + url.search, report);
      }
    }
  }
  await visit(directory);
  return reports;
}
