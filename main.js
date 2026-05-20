// B2B SaaS US Scraper — Apify Actor
// ------------------------------------------------------------------
// Crawls G2.com category pages, extracts B2B SaaS product listings,
// filters to US-headquartered vendors (optional), and outputs JSON
// records to the Actor's default dataset.
// ------------------------------------------------------------------

import { Actor, log } from 'apify';
import { PuppeteerCrawler, Dataset } from 'crawlee';

await Actor.init();

// ---------- 1. Load + validate input -----------------------------------
const input = (await Actor.getInput()) ?? {};
const {
    categoryUrls = ['https://www.g2.com/categories/crm'],
    maxItems = 50,
    usOnly = true,
    minRating = 0,
    marketSegment = 'all',
    proxyConfiguration: proxyInput,
} = input;

if (!Array.isArray(categoryUrls) || categoryUrls.length === 0) {
    throw new Error('Input "categoryUrls" must be a non-empty array of G2 category URLs.');
}

log.info('Actor starting', { categoryUrls, maxItems, usOnly, minRating, marketSegment });

// ---------- 2. Proxy + crawler setup -----------------------------------
const proxyConfiguration = await Actor.createProxyConfiguration(
    proxyInput ?? { groups: ['RESIDENTIAL'], countryCode: 'US' },
);

let collected = 0;

const crawler = new PuppeteerCrawler({
    proxyConfiguration,
    maxConcurrency: 2,
    maxRequestRetries: 3,
    navigationTimeoutSecs: 60,
    launchContext: {
        launchOptions: {
            headless: true,
            args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
        },
    },
    preNavigationHooks: [
        async ({ page }) => {
            await page.setUserAgent(
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
                '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            );
            await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' });
        },
    ],

    async requestHandler({ request, page, enqueueLinks }) {
        const { label } = request.userData;
        log.info(`Crawling [${label}] ${request.url}`);

        // ----- A. Category listing page -------------------------------
        if (label === 'CATEGORY') {
            // Wait for product cards to load
            await page.waitForSelector('div[data-eventaction="Product Click"], a[href*="/products/"]', {
                timeout: 30_000,
            }).catch(() => log.warning('Product cards selector timed out.'));

            // Collect product detail URLs from this category page
            const productUrls = await page.$$eval('a[href*="/products/"]', (links) =>
                [...new Set(
                    links
                        .map((a) => a.href)
                        .filter((href) => /\/products\/[a-z0-9-]+\/?(reviews|details)?$/i.test(href)),
                )],
            );

            log.info(`Found ${productUrls.length} product URLs on category page.`);

            for (const url of productUrls) {
                if (collected >= maxItems) break;
                await crawler.addRequests([{
                    url,
                    userData: {
                        label: 'PRODUCT',
                        category: deriveCategoryFromUrl(request.url),
                    },
                }]);
            }

            // Follow pagination (?page=2, ?page=3 ...) up to a soft cap
            if (collected < maxItems) {
                await enqueueLinks({
                    selector: 'a[rel="next"], a.pagination__next',
                    userData: { label: 'CATEGORY' },
                });
            }
            return;
        }

        // ----- B. Product detail page ---------------------------------
        if (label === 'PRODUCT') {
            if (collected >= maxItems) return;

            const product = await page.evaluate(() => {
                const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
                const attr = (sel, name) => document.querySelector(sel)?.getAttribute(name) ?? null;

                // Try multiple selectors — G2's DOM changes
                const productName =
                    text('h1[itemprop="name"]') ||
                    text('h1.product-head__title') ||
                    text('h1');

                const ratingText =
                    text('[itemprop="ratingValue"]') ||
                    text('.product-head__star-rating .stars') ||
                    text('.fw-semibold');
                const rating = ratingText ? parseFloat(ratingText.replace(/[^0-9.]/g, '')) : null;

                const reviewCountText =
                    text('[itemprop="reviewCount"]') ||
                    text('.product-head__reviews-count') ||
                    text('a[href*="#reviews"]');
                const reviewCount = reviewCountText
                    ? parseInt(reviewCountText.replace(/[^0-9]/g, ''), 10) || null
                    : null;

                const description =
                    text('[data-test="product-description"]') ||
                    text('.product-overview__description') ||
                    text('meta[name="description"]') ||
                    attr('meta[name="description"]', 'content');

                // Vendor / HQ — usually in a "Seller Details" sidebar
                const sellerBlock = [...document.querySelectorAll('div, section, li')].find(
                    (el) => /seller|company|headquarter/i.test(el.textContent?.slice(0, 200) ?? ''),
                );
                const sellerText = sellerBlock?.textContent ?? '';
                const hqMatch = sellerText.match(/Headquarters?[:\s]+([^\n]+)/i);
                const vendorHeadquarters = hqMatch ? hqMatch[1].trim().slice(0, 120) : null;

                const vendor =
                    text('a[href*="/sellers/"]') ||
                    text('[data-test="seller-name"]') ||
                    null;

                const websiteLink =
                    document.querySelector('a[data-track-elem="Website"], a[href*="vendor-website"]');
                const vendorUrl = websiteLink ? websiteLink.href : null;

                const pricingText =
                    text('[data-test="pricing-edition-price"]') ||
                    text('.product-pricing__price') ||
                    null;
                const freeTrial = /free trial/i.test(document.body.innerText);

                // Market segment percentages (Small-Business / Mid-Market / Enterprise)
                const segments = {};
                document.querySelectorAll('[data-test="market-segment-row"], .market-segment').forEach(
                    (row) => {
                        const label = row.querySelector('.label, .segment-label')?.textContent?.trim();
                        const pct = row.querySelector('.percent, .segment-pct')?.textContent?.trim();
                        if (label && pct) segments[label] = pct;
                    },
                );

                return {
                    productName,
                    vendor,
                    vendorHeadquarters,
                    vendorUrl,
                    rating,
                    reviewCount,
                    description: description?.slice(0, 1000) ?? null,
                    pricingModel: pricingText,
                    freeTrial,
                    marketSegments: segments,
                };
            });

            // Derive US flag
            const isUSBased =
                product.vendorHeadquarters
                    ? /\b(United States|USA|U\.S\.A?\.|, [A-Z]{2}\b)/.test(product.vendorHeadquarters)
                    : null;

            const record = {
                ...product,
                productUrl: request.loadedUrl ?? request.url,
                category: request.userData.category,
                isUSBased,
                scrapedAt: new Date().toISOString(),
            };

            // ----- C. Apply filters ----------------------------------
            if (usOnly && isUSBased === false) {
                log.debug(`Skipping non-US vendor: ${product.vendor}`);
                return;
            }
            if (minRating && (record.rating ?? 0) < minRating) {
                log.debug(`Skipping low-rated: ${product.productName} (${record.rating})`);
                return;
            }
            if (marketSegment !== 'all') {
                const segLabel = {
                    small_business: 'Small-Business',
                    mid_market: 'Mid-Market',
                    enterprise: 'Enterprise',
                }[marketSegment];
                const segPct = parseInt(record.marketSegments?.[segLabel] ?? '0', 10);
                if (segPct < 30) {
                    log.debug(`Skipping ${product.productName}: ${segLabel} only ${segPct}%`);
                    return;
                }
            }

            await Dataset.pushData(record);
            collected += 1;
            log.info(`Saved [${collected}/${maxItems}] ${record.productName}`);
        }
    },

    failedRequestHandler({ request, error }) {
        log.error(`Request ${request.url} failed`, { message: error.message });
    },
});

// ---------- 3. Seed initial requests ----------------------------------
await crawler.addRequests(
    categoryUrls.map((url) => ({
        url,
        userData: { label: 'CATEGORY' },
    })),
);

// ---------- 4. Run -----------------------------------------------------
await crawler.run();
log.info(`Done. Collected ${collected} products to default dataset.`);

await Actor.exit();

// ---------- Helpers ---------------------------------------------------
function deriveCategoryFromUrl(url) {
    const m = url.match(/\/categories\/([^/?#]+)/);
    return m ? m[1].replace(/-/g, ' ') : null;
}
