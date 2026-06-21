// js/config.js — local configuration. ALWAYS safe to commit: this file must
// never contain a real key, by design (CLAUDE.md guardrail #2: "never
// hardcode API keys"). The recommended way to enable prices is to open the
// running app, go to the About tab, and paste your RapidAPI key into the
// "Price API key" field there — it's saved only to your browser's
// localStorage, on your device, and never touches this source file, git, or
// GitHub. See js/store.js getApiKey()/setApiKey() and the About view in
// js/app.js.
//
// `prices.rapidApiKey` below is an optional fallback for local-only dev (e.g.
// testing with `npx serve` and never pushing this file). Leave it empty for
// anything you intend to put in a repo, even a private one.

export const CONFIG = {
  // RiftScribe — card database, no auth required. Routed through a small
  // Cloudflare Worker proxy, NOT riftscribe.gg directly: live testing showed
  // riftscribe.gg returns HTTP 503 to cross-origin browser fetch() calls
  // (confirmed — direct navigation to the same URL works fine, only
  // browser-based fetch from another origin is blocked, likely a Cloudflare
  // bot-protection rule on their side). The proxy makes the request
  // server-side, where that restriction doesn't apply. See DECISIONS.md.
  riftscribe: {
    baseUrl: "https://red-shape-f615.canca-burakcan.workers.dev/api",
  },

  // TCGGO "riftbound-prices-api" via RapidAPI — optional, free tier ~100
  // req/day. Leave rapidApiKey empty (prices disabled by default); the UI
  // will honestly show "price unavailable" instead of fabricating a value.
  // Use the in-app About > Settings field instead of editing this file.
  prices: {
    host: "riftbound-prices-api.p.rapidapi.com",
    baseUrl: "https://riftbound-prices-api.p.rapidapi.com/api/v1",
    rapidApiKey: "", // intentionally empty — never hardcode a real key here
  },

  // Price cache rolls over at 08:00 Europe/Berlin (owner's primary market).
  priceCache: {
    rolloverHourBerlin: 8,
  },
};
