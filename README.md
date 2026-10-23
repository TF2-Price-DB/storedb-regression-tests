# Website regression audits

The workflows run daily on Blacksmith and can also be started manually from GitHub Actions.

- `perf-and-a18y-regression-tests.yml`: existing pricedb.io audit.
- `crit-regression-tests.yml`: crit.tf audit at 15:23 UTC daily, also triggered by changes to its workflow or scripts on `main`.

The crit.tf audit discovers categories from the `section` query parameter in the site's sitemap index. It combines all sitemap shards within each category, includes every URL in `pages`, and selects five random distinct URLs from each other category (or all URLs if fewer than five exist). New sections require no workflow changes. Shared URLs are measured once and retain all selected category labels.

Each URL gets one mobile Lighthouse navigation in a fresh Chrome instance. Lighthouse's back/forward cache diagnostic is disabled because it navigates away and back and may reload the URL. There are no target-page discovery loads, warm-ups, retries, or repeated samples. Changing samples reduces repeated requests between runs, but cannot guarantee a cold server cache. Five samples per category are an initial monitoring signal; they do not establish statistical confidence about small performance changes.

History for both sites uses the PriceDB CSV format: `Path,Performance,Accessibility,SEO,Best Practices`, with relative paths and scores from 0 to 100. PriceDB history lives under `hist/pricedb/`; crit.tf history lives under `hist/crit/`. Crit.tf filenames include the UTC date and time. Failed crit.tf measurements have empty score cells rather than zero scores.

Each crit.tf run uploads its selected URLs, individual HTML/JSON Lighthouse reports, raw results, complete run metadata, CSV, and a summary as a GitHub Actions artifact. The job summary includes category medians and reports performance/accessibility median drops greater than two points against the previous CSV. Historical URLs are grouped using the current sitemap; URLs no longer in it are excluded from category comparisons. These comparisons are informational because samples change. Audit errors fail the workflow and remain visible in the report; failed URLs are not retried.

Use Node.js 24, `npm ci`, and `npm test` to check selection logic. `npm run audit:crit` performs a live audit and writes local reports under `audit-results/crit/` and history under `hist/crit/`. Avoid live runs solely for testing, since they can warm the site's caches.
