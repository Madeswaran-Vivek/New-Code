# B2B SaaS US Scraper

An Apify Actor that crawls G2.com category pages, extracts B2B SaaS product listings, filters to US-headquartered vendors, and outputs structured JSON records to the Actor's default dataset.

## What it does

Given one or more G2 category URLs (e.g. `https://www.g2.com/categories/crm`), the Actor:

1. Visits each category page and collects product detail URLs.
2. Follows pagination until the `maxItems` cap is reached.
3. Opens each product page and extracts: name, vendor, vendor headquarters, vendor website, G2 rating, review count, description, pricing signal, free-trial flag, and market-segment mix.
4. Detects whether the vendor is US-based by parsing the "Headquarters" field.
5. Applies optional filters (`usOnly`, `minRating`, `marketSegment`) and pushes the surviving records as JSON to the default dataset.

## Input

See `.actor/INPUT_SCHEMA.json` for the canonical schema. Example input:

```json
{
    "categoryUrls": [
        "https://www.g2.com/categories/crm",
        "https://www.g2.com/categories/marketing-automation"
    ],
    "maxItems": 100,
    "usOnly": true,
    "minRating": 4,
    "marketSegment": "mid_market",
    "proxyConfiguration": {
        "useApifyProxy": true,
        "apifyProxyGroups": ["RESIDENTIAL"],
        "apifyProxyCountry": "US"
    }
}
```

| Field | Type | Default | Notes |
|---|---|---|---|
| `categoryUrls` | string[] | required | G2 category URLs to crawl. |
| `maxItems` | integer | 50 | Total products saved across all categories. |
| `usOnly` | boolean | true | Skip non-US vendors. |
| `minRating` | integer | 0 | 0 disables; otherwise 1–5. |
| `marketSegment` | enum | `all` | `all`, `small_business`, `mid_market`, `enterprise`. |
| `proxyConfiguration` | object | RES-US | Apify Proxy config. Residential US strongly recommended. |

## Output

Each record pushed to the default dataset:

```json
{
    "productName": "HubSpot Sales Hub",
    "vendor": "HubSpot",
    "vendorHeadquarters": "Cambridge, MA",
    "isUSBased": true,
    "vendorUrl": "https://www.hubspot.com",
    "productUrl": "https://www.g2.com/products/hubspot-sales-hub/reviews",
    "category": "crm",
    "rating": 4.4,
    "reviewCount": 11234,
    "description": "HubSpot Sales Hub is a powerful and easy-to-use sales CRM ...",
    "pricingModel": "Starts at $20/user/month",
    "freeTrial": true,
    "marketSegments": {
        "Small-Business": "61%",
        "Mid-Market": "32%",
        "Enterprise": "7%"
    },
    "scrapedAt": "2026-05-21T14:33:01.812Z"
}
```

## Local development

```bash
npm install
# Provide input via storage/key_value_stores/default/INPUT.json
mkdir -p storage/key_value_stores/default
echo '{"categoryUrls":["https://www.g2.com/categories/crm"],"maxItems":5,"usOnly":false}' \
    > storage/key_value_stores/default/INPUT.json
npm start
# Results appear in storage/datasets/default/
```

## Deploying to Apify

1. Install the Apify CLI: `npm install -g apify-cli`
2. From the project root: `apify login`
3. Push the Actor: `apify push`
4. The Actor will be built on the Apify platform; run it from the Console or via API.

## Notes & caveats

- **G2 has anti-bot protection.** This Actor uses Puppeteer with a stealth-style user agent, but you should run it through Apify Residential US proxies. Without them, expect frequent 403/429 responses.
- **Selectors may break.** G2's HTML is not a stable API; if extraction returns nulls, inspect the page and update the selectors in `src/main.js` under the `page.evaluate` block.
- **Respect G2's Terms of Service.** Verify your usage complies with G2's ToS and robots.txt before deploying at scale. For commercial use, consider their official API or licensed data feeds.
- **Rate limit yourself.** `maxConcurrency` is set to 2 by default. Don't raise it aggressively.

## File layout

```
b2b-saas-us-scraper/
├── .actor/
│   ├── actor.json          # Actor metadata + dataset view config
│   └── INPUT_SCHEMA.json   # Input form schema (renders in Apify Console)
├── src/
│   └── main.js             # Crawler entry point
├── Dockerfile              # Build image (apify/actor-node-puppeteer-chrome:20)
├── package.json
├── .dockerignore
├── .gitignore
└── README.md
```
