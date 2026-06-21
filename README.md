# Riftbound Companion

A lightweight, installable PWA for collectors of the **Riftbound TCG**
(Riot Games' League of Legends trading card game). Point your phone at a
card's collector number, identify the card and see its market value, and
manage a collection and deck lists.

**This is an unofficial fan project.** It is not affiliated with, endorsed
by, or sponsored by Riot Games. See [Legal](#legal) below.

## What it actually does (and doesn't)

- **Scanner scope is honest: OCR-on-a-number, not card-recognition ML.** You
  frame the printed collector number (e.g. `OGN 042/256`) inside an on-screen
  guide box; the app OCRs just that small region with Tesseract.js. There is
  no full-card image recognition, and manual entry (set + number) is always
  available as a guaranteed-to-work fallback.
- **No gameplay simulation.** This is a card gallery, collection tracker, and
  deck *list* builder — no automated rules enforcement, no digital play, no
  turn/board state. (Card libraries and deckbuilders are explicitly listed as
  an approved use case in Riot's Riftbound Digital Tools Policy — see Legal.)
- **No fabricated prices.** If a price provider key isn't configured, or a
  lookup fails, the UI says "price unavailable" — never a guessed number.
- **No bundled card art.** Card images always load live from the data
  provider at runtime; nothing is committed to this repo.

## Running it on your iPhone

This is a static, no-build-step app (plain HTML/CSS/ES modules), so there's
no toolchain to install.

**Camera access requires HTTPS or `localhost`** — plain `http://` on a LAN
IP will not work.

1. Push this folder to a GitHub repo and enable **GitHub Pages** (Settings →
   Pages → deploy from the branch/folder containing `index.html`).
2. On your iPhone, open the GitHub Pages URL in **Safari**.
3. Tap the Share icon → **Add to Home Screen**.
4. Launch it from the home screen icon — it opens full-screen (no Safari
   chrome), and the service worker caches the app shell for offline launch.

### Local development

```bash
npx serve .
```

Then open the printed `http://localhost:....` URL. `localhost` is treated as
a secure context, so camera access works without HTTPS during development.

## Enabling prices

Prices come from TCGGO's "riftbound-prices-api" via RapidAPI (free tier,
~100 requests/day, no credit card). Without a key, the app runs fine — it
just honestly shows "price unavailable" everywhere a price would go.

**Personal use (recommended):**

1. Sign up for a free RapidAPI account and subscribe to the
   `riftbound-prices-api` (host `riftbound-prices-api.p.rapidapi.com`).
2. Open the running app → **About** tab → paste your key into "Price API
   key" → **Save key**.
3. The key is saved only in your browser's `localStorage`, on your device.
   It is never written to any file, never committed to git, and never
   included in collection/deck exports — see `js/store.js`
   `getApiKey()`/`setApiKey()`. This is deliberate (CLAUDE.md guardrail #2:
   "never hardcode API keys"), so it's safe to push this repo (even to a
   public one) without ever having to remember to scrub a secret first.

`js/config.js` also has an optional `prices.rapidApiKey` field for local-only
dev convenience, but it should always stay empty in anything you commit —
use the in-app field instead.

**Public deployment (e.g. a public GitHub Pages fork others will use):**
The localStorage approach above means each user enters their own key on
their own device, so there's nothing to leak on the server/repo side. If you
instead want prices to work for users without them having a key (e.g. you
want to supply one key for everyone), don't put that key in any client-side
JS — anyone can read it from the page source. Put a tiny serverless function
(Cloudflare Worker, Vercel/Netlify function, etc.) in front of the RapidAPI
endpoint that attaches your key server-side, and point `prices.baseUrl` at
your proxy instead of RapidAPI directly. This repo doesn't include a proxy
implementation — that's intentionally a deployment-time decision since it
depends on where you host.

### Price cache behavior

Prices are cached per "price day," which rolls over at **08:00
Europe/Berlin** (see `priceDayKey()` in `js/api.js`) — Riftbound prices on
the free tier refresh daily, so re-opening a card the same price-day reuses
the cached value (including a cached "no price" result) instead of
re-fetching, to stay within the free-tier request budget.

## Project structure

```
riftbound-companion/
├── index.html              # app shell + bottom tab nav
├── manifest.webmanifest    # PWA manifest (installable)
├── sw.js                   # service worker (app shell only — never card data/images)
├── README.md
├── DECISIONS.md            # verification log + open questions + their answers
├── LICENSE                 # MIT (code only — not card data/art/trademarks)
├── .gitignore
├── css/
│   └── styles.css          # "Hexgate" theme
├── js/
│   ├── config.js           # price provider config + key (no real key committed)
│   ├── api.js               # RiftScribe + TCGGO clients, normalization, price-day cache key
│   ├── store.js             # localStorage persistence (collection/decks/wishlist/alerts/prices)
│   ├── parser.js            # pure collector-number parser (Node-testable)
│   ├── scan.js              # camera + OCR + lookup, built on parser.js
│   └── app.js                # views, routing, rendering
├── tests/
│   └── parser.test.mjs      # `node tests/parser.test.mjs`
└── icons/                   # generated "Hexgate" PWA icons — no Riot art
```

## Testing

```bash
node tests/parser.test.mjs
```

Covers the collector-number parser's acceptance table (standard, alt-art,
signature/star, token, OCR-confusion fix, bare-number fallback, and garbage
rejection). Camera/OCR/price flows need manual verification on a real device
— see `DECISIONS.md` for what's been confirmed against live sources so far
versus what still needs a real-device or real-key check.

## Roadmap (intentionally not in this version)

Friends/trading, real background web-push price alerts (iOS only supports
in-app checks on launch for now), a battle-log/match tracker, automatic
set-detection from card artwork, perceptual-hash image fallback matching,
continuous real-time scanning, collection value history charts, and sealed
product price tracking. See `CLAUDE.md` §7 for the full list and rationale.

## Legal

"Riftbound Companion" was created under Riot Games' "Legal Jibber Jabber"
policy using assets owned by Riot Games. Riot Games does not endorse or
sponsor this project.

Riftbound™ and all related card data, names, and imagery are the property of
Riot Games, Inc. Card images are loaded live from the data provider at
runtime and are never bundled with this app or repo.

This app uses [RiftScribe](https://riftscribe.gg) (an independent,
fan-made card database — not Riot's official API) for card data, and
optionally TCGGO via RapidAPI for prices. It does not currently hold an
official Riot API key. If you plan to publish, distribute widely, or
monetize a fork of this project, read Riot's
[Riftbound Digital Tools Policy](https://developer.riotgames.com/docs/riftbound)
and apply for an API key through the
[Riot Developer Portal](https://developer.riotgames.com) first — card
galleries and deckbuilders are listed as an approved use case there, but
review/approval is still required for anything beyond personal/community use.

The code in this repository is MIT-licensed (see `LICENSE`). That license
covers the original code only — it does not cover Riftbound card data, art,
or trademarks.
