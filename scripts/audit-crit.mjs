import fs from 'node:fs/promises';
import path from 'node:path';
import lighthouse from 'lighthouse';
import { launch } from 'chrome-launcher';
import { executablePath } from 'puppeteer';
import { discoverCategories, selectTargets } from './crit-sitemap.mjs';

const outputDir = 'audit-results/crit';
const historyDir = 'hist/crit';
await fs.mkdir(outputDir, { recursive: true });
await fs.mkdir(historyDir, { recursive: true });
const categories = await discoverCategories('https://crit.tf/sitemap.xml');
const targets = selectTargets(categories);
await fs.writeFile(`${outputDir}/targets.json`, JSON.stringify(targets, null, 2));
for (const [category, urls] of categories) {
  console.log(`${category}: ${urls.size} available, ${targets.filter(t => t.categories.includes(category)).length} selected`);
}

const metrics = ['performance', 'accessibility', 'seo', 'best-practices'];
const rows = [];
for (const [index, target] of targets.entries()) {
  console.log(`[${index + 1}/${targets.length}] ${target.url}`);
  let chrome;
  const row = { ...target };
  try {
    chrome = await launch({
      chromePath: await executablePath(),
      chromeFlags: ['--headless', '--no-sandbox', '--disable-dev-shm-usage'],
    });
    // One navigation per distinct URL: no warm-up, crawl, retries, or repeated samples.
    const result = await lighthouse(target.url, {
      port: chrome.port,
      logLevel: 'error',
      output: ['html', 'json'],
      onlyCategories: metrics,
      // This diagnostic navigates away and back, potentially requesting the URL twice.
      skipAudits: ['bf-cache'],
      formFactor: 'mobile',
      maxWaitForLoad: 90_000,
    });
    if (!result) throw new Error('Lighthouse returned no result');
    await fs.writeFile(`${outputDir}/${index + 1}.html`, result.report[0]);
    await fs.writeFile(`${outputDir}/${index + 1}.json`, result.report[1]);
    if (result.lhr.runtimeError) throw new Error(JSON.stringify(result.lhr.runtimeError));
    row.finalUrl = result.lhr.finalDisplayedUrl;
    row.scores = Object.fromEntries(metrics.map(metric => {
      const score = result.lhr.categories[metric]?.score;
      if (typeof score !== 'number') throw new Error(`Missing ${metric} score`);
      return [metric, Math.round(score * 100)];
    }));
    row.timings = Object.fromEntries(['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'server-response-time']
      .map(metric => [metric, result.lhr.audits[metric]?.numericValue ?? null]));
  } catch (error) {
    row.error = error.message;
    console.error(`${target.url}: ${error.message}`);
  } finally {
    if (chrome) await chrome.kill();
  }
  rows.push(row);
  await fs.writeFile(`${outputDir}/results.json`, JSON.stringify(rows, null, 2));
}

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summaries = Object.fromEntries([...categories].map(([category, urls]) => {
  const selected = rows.filter(row => row.categories.includes(category));
  const successful = selected.filter(row => row.scores);
  return [category, {
    available: urls.size, selected: selected.length, successful: successful.length,
    scores: Object.fromEntries(metrics.map(metric => [metric, median(successful.map(row => row.scores[metric]))])),
  }];
}));
const historyFiles = (await fs.readdir(historyDir)).filter(file => file.endsWith('.json')).sort();
const previous = historyFiles.length
  ? JSON.parse(await fs.readFile(path.join(historyDir, historyFiles.at(-1)), 'utf8')) : null;
const run = {
  timestamp: new Date().toISOString(),
  commit: process.env.GITHUB_SHA ?? null,
  runUrl: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  summaries, rows,
};
const filename = `${run.timestamp.replaceAll(':', '-')}-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}.json`;
await fs.writeFile(path.join(historyDir, filename), JSON.stringify(run, null, 2) + '\n');

let summary = '# crit.tf performance and accessibility audit\n\n';
summary += `${rows.length} distinct URLs, one Lighthouse navigation per URL. Mobile Lighthouse defaults. No target-page discovery requests or retries.\n\n`;
summary += '| Sitemap category | Available | Selected | Successful | Performance median | Accessibility median | SEO median | Best practices median |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n';
for (const [category, stats] of Object.entries(summaries)) {
  summary += `| ${category} | ${stats.available} | ${stats.selected} | ${stats.successful} | ${metrics.map(m => stats.scores[m] ?? '—').join(' | ')} |\n`;
}
summary += '\nAll pages are included. Other categories use up to five randomly selected distinct URLs across all their sitemap shards. Categories with fewer than five URLs use all available URLs. Samples rotate between runs; server caches may already be warm from other traffic.\n\n';
if (previous) {
  summary += `## Comparison with previous run (${previous.timestamp})\n\n`;
  const regressions = [];
  for (const [category, stats] of Object.entries(summaries)) {
    // Only compare complete categories; sampled category medians are a signal, not a controlled benchmark.
    const old = previous.summaries[category];
    if (!old || old.successful !== old.selected || stats.successful !== stats.selected) continue;
    for (const metric of ['performance', 'accessibility']) {
      if (old.scores[metric] - stats.scores[metric] > 2) {
        regressions.push(`- ${category}: ${metric} median ${old.scores[metric]} → ${stats.scores[metric]}`);
      }
    }
  }
  summary += regressions.length ? regressions.join('\n') + '\n' : 'No category median drops greater than two points.\n';
  summary += '\nChanging samples and single measurements can add noise. Drops are reported for review and do not fail the job.\n';
} else {
  summary += 'First run establishes the baseline.\n';
}
summary += '\n## Individual results\n\n| URL | Categories | Performance | Accessibility | Result |\n| --- | --- | ---: | ---: | --- |\n';
for (const row of rows) {
  summary += `| ${row.url} | ${row.categories.join(', ')} | ${row.scores?.performance ?? '—'} | ${row.scores?.accessibility ?? '—'} | ${row.error ? row.error.replaceAll('|', '\\|').replaceAll('\n', ' ') : 'OK'} |\n`;
}
await fs.writeFile(`${outputDir}/summary.md`, summary);
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
if (rows.some(row => row.error)) process.exitCode = 1;
