import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { extractLighthouseMetrics, loadLighthouseReports } from './lighthouse-metrics.mjs';

test('extracts actual Lighthouse scores rather than deriving scores from raw values', () => {
  assert.deepEqual(extractLighthouseMetrics({ audits: {
    'largest-contentful-paint': { score: 0.83, numericValue: 2793.118 },
    'cumulative-layout-shift': { score: 1, numericValue: 0.0002816448606159141 },
    'total-blocking-time': { score: 0, numericValue: 0 },
    'first-contentful-paint': { score: null, numericValue: null },
  } }), {
    metricScores: { 'largest-contentful-paint': 83, 'cumulative-layout-shift': 100, 'total-blocking-time': 0 },
    metricValues: { 'largest-contentful-paint': 2793.118, 'cumulative-layout-shift': 0.0002816448606159141, 'total-blocking-time': 0 },
  });
  assert.deepEqual(extractLighthouseMetrics({}), {});
});

test('finds full reports in nested Unlighthouse output, preserving queries and requested URL', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lighthouse-metrics-'));
  try {
    await fs.mkdir(path.join(dir, 'reports', 'convert'), { recursive: true });
    const report = { requestedUrl: 'https://pricedb.io/convert?a=1,2', finalDisplayedUrl: 'https://pricedb.io/', audits: {} };
    await fs.writeFile(path.join(dir, 'reports', 'convert', 'lighthouse.json'), JSON.stringify(report));
    await fs.writeFile(path.join(dir, 'ci-result.json'), JSON.stringify([{ path: '/convert', performance: 0.9 }]));
    const reports = await loadLighthouseReports(dir);
    assert.equal(reports.size, 1);
    assert.deepEqual(reports.get('/convert?a=1,2'), report);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
