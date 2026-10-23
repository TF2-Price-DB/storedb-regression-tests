import { randomInt } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, removeNSPrefix: true });
const list = value => value === undefined ? [] : Array.isArray(value) ? value : [value];

// Read sitemap XML only. Do not visit target pages before Lighthouse measures them.
export async function discoverCategories(indexUrl, load = async url => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Sitemap ${url}: HTTP ${response.status}`);
  return response.text();
}) {
  const categories = new Map();
  const visited = new Set();
  const origin = new URL(indexUrl).origin;
  async function visit(url, inheritedCategory) {
    if (new URL(url).origin !== origin) throw new Error(`Off-site sitemap: ${url}`);
    if (visited.has(url)) return;
    visited.add(url);
    const category = new URL(url).searchParams.get('section') || inheritedCategory;
    const xml = await load(url);
    const valid = XMLValidator.validate(xml);
    if (valid !== true) throw new Error(`Invalid sitemap XML at ${url}: ${valid.err.msg}`);
    const data = parser.parse(xml);
    if (data.sitemapindex) {
      for (const entry of list(data.sitemapindex.sitemap)) {
        if (!entry.loc) throw new Error(`Missing sitemap location in ${url}`);
        await visit(new URL(entry.loc, url).href, category);
      }
    } else if (data.urlset !== undefined) {
      if (!category) throw new Error(`Missing section category for ${url}`);
      if (!categories.has(category)) categories.set(category, new Set());
      for (const entry of list(data.urlset.url)) {
        const target = new URL(entry.loc);
        if (target.origin !== origin || target.hash) throw new Error(`Invalid audit URL: ${entry.loc}`);
        categories.get(category).add(target.href);
      }
    } else {
      throw new Error(`Expected sitemapindex or urlset at ${url}`);
    }
  }
  await visit(indexUrl);
  if (!categories.get('pages')?.size) throw new Error('The pages sitemap is missing or empty');
  return categories;
}

export function selectTargets(categories, choose = randomInt) {
  const targets = new Map();
  // Prioritize pages so a shared URL is still audited once, with all category labels.
  const entries = [...categories].sort(([a], [b]) => a === 'pages' ? -1 : b === 'pages' ? 1 : a.localeCompare(b));
  for (const [category, urls] of entries) {
    const pool = [...urls];
    const count = category === 'pages' ? pool.length : Math.min(5, pool.length);
    if (!count) throw new Error(`Empty sitemap category: ${category}`);
    for (let i = 0; i < count; i++) {
      const j = category === 'pages' ? i : i + choose(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
      if (!targets.has(pool[i])) targets.set(pool[i], { url: pool[i], categories: [] });
      targets.get(pool[i]).categories.push(category);
    }
  }
  return [...targets.values()];
}
