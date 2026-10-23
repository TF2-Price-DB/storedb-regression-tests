import assert from 'node:assert/strict';
import test from 'node:test';
import { metrics, readHistoryCsv, writeHistoryCsv, summarizeRows } from './history-csv.mjs';

test('history uses the PriceDB columns and retains paths, zero scores, and failures', () => {
  const rows = [
    { url: 'https://crit.tf/', scores: { performance: 0, accessibility: 96, seo: 100, 'best-practices': 100 } },
    { url: 'https://crit.tf/search?a=1,2', scores: Object.fromEntries(metrics.map(metric => [metric, 90])) },
    { url: 'https://crit.tf/item/1', error: 'Navigation failed' },
  ];
  const csv = writeHistoryCsv(rows);
  assert.equal(csv, 'Path,Performance,Accessibility,SEO,Best Practices\n/,0,96,100,100\n"/search?a=1,2",90,90,90,90\n/item/1,,,,\n');
  assert.deepEqual(readHistoryCsv(csv), rows.map(({ error, ...row }) => row));
  assert.deepEqual(readHistoryCsv(csv.replaceAll('\n', '\r\n')), readHistoryCsv(csv));
  assert.deepEqual(readHistoryCsv(csv.trimEnd()), readHistoryCsv(csv));
});

test('CSV history reconstructs category comparisons without treating failed scores as zero', () => {
  const rows = [
    { url: 'https://crit.tf/', categories: ['pages'], scores: Object.fromEntries(metrics.map(metric => [metric, 100])) },
    { url: 'https://crit.tf/item/1', categories: ['hats'], scores: Object.fromEntries(metrics.map(metric => [metric, 80])) },
    { url: 'https://crit.tf/item/2', categories: ['hats'], error: 'Navigation failed' },
  ];
  const categories = new Map([['pages', new Set(['https://crit.tf/'])], ['hats', new Set(['https://crit.tf/item/1', 'https://crit.tf/item/2'])]]);
  assert.deepEqual(summarizeRows(readHistoryCsv(writeHistoryCsv(rows)), categories), summarizeRows(rows, categories));
  const summary = summarizeRows(readHistoryCsv(writeHistoryCsv(rows)), categories).hats;
  assert.equal(summary.selected, 2);
  assert.equal(summary.successful, 1);
  assert.equal(summary.scores.performance, 80);
});

test('malformed history fails rather than silently altering comparisons', () => {
  assert.throws(() => readHistoryCsv('Wrong,Columns\n'), /header/);
  assert.throws(() => readHistoryCsv('Path,Performance,Accessibility,SEO,Best Practices\n/,bad,100,100,100\n'), /score/);
  assert.throws(() => readHistoryCsv('Path,Performance,Accessibility,SEO,Best Practices\n"/'), /Unterminated/);
});
