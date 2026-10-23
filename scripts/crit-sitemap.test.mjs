import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverCategories, selectTargets } from './crit-sitemap.mjs';

const sitemap = urls => `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(url => `<url><loc>${url}</loc></url>`).join('')}</urlset>`;
const index = urls => `<sitemapindex>${urls.map(url => `<sitemap><loc>${url.replaceAll('&', '&amp;')}</loc></sitemap>`).join('')}</sitemapindex>`;
const urls = (prefix, count) => Array.from({ length: count }, (_, i) => `https://crit.tf/${prefix}/${i}`);

test('discovers new categories and combines all shards before sampling five', async () => {
  const fixtures = new Map([
    ['https://crit.tf/sitemap.xml', index([
      'https://crit.tf/sitemap.xml?section=pages&page=0',
      'https://crit.tf/sitemap.xml?section=hats&page=0',
      'https://crit.tf/sitemap.xml?section=hats&page=1',
      'https://crit.tf/sitemap.xml?section=future&page=0',
      'https://crit.tf/sitemap.xml?section=small&page=0',
    ])],
    ['https://crit.tf/sitemap.xml?section=pages&page=0', sitemap(urls('pages', 8))],
    ['https://crit.tf/sitemap.xml?section=hats&page=0', sitemap(urls('item', 3))],
    ['https://crit.tf/sitemap.xml?section=hats&page=1', sitemap(urls('item', 10))],
    ['https://crit.tf/sitemap.xml?section=future&page=0', sitemap(urls('future', 20))],
    ['https://crit.tf/sitemap.xml?section=small&page=0', sitemap(urls('small', 2))],
  ]);
  const fetched = [];
  const categories = await discoverCategories('https://crit.tf/sitemap.xml', async url => {
    fetched.push(url);
    assert.ok(fixtures.has(url), `Unexpected request: ${url}`);
    return fixtures.get(url);
  });
  assert.equal(categories.get('hats').size, 10);
  const selected = selectTargets(categories, size => size - 1);
  assert.equal(selected.length, 20);
  for (const [category, count] of [['pages', 8], ['hats', 5], ['future', 5], ['small', 2]]) {
    assert.equal(selected.filter(row => row.categories.includes(category)).length, count);
  }
  assert.ok(selected.some(row => row.url === 'https://crit.tf/item/9'), 'Selection includes the second shard');
  assert.equal(new Set(selected.map(row => row.url)).size, selected.length);
  assert.equal(fetched.length, fixtures.size, 'Discovery only fetches sitemap files');
});

test('a URL shared across categories is audited once with both labels', () => {
  const categories = new Map([
    ['pages', new Set(['https://crit.tf/shared'])],
    ['users', new Set(['https://crit.tf/shared'])],
  ]);
  assert.deepEqual(selectTargets(categories), [{ url: 'https://crit.tf/shared', categories: ['pages', 'users'] }]);
});

test('rejects missing pages, invalid XML, and off-site sitemap targets', async () => {
  await assert.rejects(discoverCategories('https://crit.tf/sitemap.xml', async () => '<urlset/>'), /Missing section/);
  await assert.rejects(discoverCategories('https://crit.tf/sitemap.xml', async () => '<broken>'), /Invalid sitemap XML/);
  await assert.rejects(discoverCategories('https://crit.tf/sitemap.xml', async () => index(['https://other.test/sitemap.xml'])), /Off-site sitemap/);
});
