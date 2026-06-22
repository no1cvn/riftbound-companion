# Decisions & verification log

This file records what was verified during the build (per the "verify, never
guess" ground rule in CLAUDE.md), the sources used, and any open items. Update
it whenever a non-obvious choice is made or a new fact is confirmed.

## Resolved open questions (CLAUDE.md §13)

### 1. Physical card numbering — does the set code appear on the card?

**Resolved: yes.** Cards print the full collector code on the card face in
the format `[SET CODE] [NUMBER]/[SET TOTAL]`, e.g. `OGN 042/256` — the set
code is included, not just the bare number.

Source: [Riftbound Set Codes Explained — riftboundsymbols.com](https://riftboundsymbols.com/riftbound-set-codes/)
(fan reference site, created under Riot's "Legal Jibber Jabber" policy).

Implication: the scanner's primary path (set + number both read from the
card) should work for the large majority of cards. The bare-number fallback
(`296/298` → manual set completion) is kept for damaged/cropped/worn cards,
but **set auto-detect is correctly deprioritized** to the roadmap as the spec
already assumed.

### 2. Exact deck construction rules

**Resolved (core numbers), advisory implementation per the spec's own
instruction.** Confirmed via Riot's official Deckbuilding Primer:

- Main Deck: 40 cards (you *can* go higher, but 40 is the designed target —
  the article explicitly warns against going higher).
- Max 3 copies of any single card; the Chosen Champion's "guaranteed" copy on
  the battlefield counts toward that 3.
- Legend + Chosen Champion restrict the deck to exactly 2 of the 6 domains.
- 3 distinct Battlefields (chosen from the colorless battlefield pool).

Source (official): [Deckbuilding Primer — riftbound.leagueoflegends.com](https://riftbound.leagueoflegends.com/en-us/news/rules-and-releases/deckbuilding-primer/)

Two numbers used in `js/app.js` (`SIDEBOARD_SIZES = [0, 8]` and the 12-card
Rune Pool mentioned in CLAUDE.md) were **not** found verbatim in the official
primer above — they're corroborated by multiple secondary sources (riftbound.gg,
mobalytics.gg, riftdaily.com) that agree with each other, but are not
1:1 confirmed against the official rulebook text itself. Per CLAUDE.md §6 P3,
**all deck-construction checks in the app are advisory (warn, never block)**
specifically because of this residual uncertainty — do not promote them to
hard validation without re-checking the official Tournament Rules / Core
Rules patch notes pages directly.

Also note: Riftbound has shipped multiple rules-patch updates since Origins
(Spiritforged, Unleashed, etc. — see the "Related Articles" list on the
primer page). If a rules patch changes copy limits or deck sizes, the
constants at the top of the Decks section in `js/app.js`
(`MAIN_DECK_TARGET`, `SIDEBOARD_SIZES`, `MAX_COPIES`, `BATTLEFIELD_COUNT`)
need a fresh check against the current Core Rules page — they are not
re-verified automatically.

### 3. RiftScribe live field names vs. `normalizeCard` assumptions

**Resolved via the live OpenAPI schema**, not guessed. During the build,
`https://riftscribe.gg/openapi.json` was fetched directly and returned the
real, auto-generated FastAPI schema (and embedded examples) for `CardRead`,
`CardSummaryRead`, `CardSearchResult`, and `CardFiltersRead`. The field names
used in `js/api.js#normalizeCard` (`id`, `name`, `set_id`, `collector_number`,
`variant`, `rarity`, `faction`, `type`, `orientation`, `stats.{energy,might,power}`,
`image`, `image_thumb.{small,medium,large}`, `is_banned`, `description`,
`flavor_text`, `art.artist`, `keywords`, `tags`, `prev_card_id`, `next_card_id`)
are copied directly from that live spec — confirmed `https://riftscribe.gg/api-docs`
matches the same endpoint list.

**Caveat that turned out to be a real, confirmed problem (RESOLVED with a
proxy) — 2026-06-21:** the build sandbox's fetch tool could retrieve
`https://riftscribe.gg/openapi.json` and the HTML doc pages, but every
attempt to GET the *dynamic* JSON endpoints directly returned an empty body.
At the time this was logged as "probably an environment-specific block."

**It was not environment-specific.** After deploying to GitHub Pages and
testing on a real iPhone and in a real desktop browser, the exact same
failure occurred for actual end users: `fetch()` from `no1cvn.github.io` to
`https://riftscribe.gg/api/cards/filters` returns **HTTP 503**, confirmed via
the browser's network panel — while directly navigating to the identical URL
in the same browser returns 200 with valid JSON instantly. This is a
cross-origin block (almost certainly a Cloudflare bot-protection rule keyed
on the browser sending an `Origin` header for a different site), not a rate
limit or an outage. Two public CORS proxies (corsproxy.io, api.allorigins.win)
were tried as a quick fix and both failed (one requires a paid plan for
non-localhost origins, the other failed to respond).

**Fix: a small Cloudflare Worker proxy.** Deployed at
`https://red-shape-f615.canca-burakcan.workers.dev` — forwards any
`/api/...` path to `https://riftscribe.gg/api/...` server-side (where the
Origin-based block doesn't apply), adds CORS headers, and passes through
`X-Total-Count`. `CONFIG.riftscribe.baseUrl` in `js/config.js` now points
here instead of `https://riftscribe.gg/api` directly. Source kept at
`riftscribe-proxy-worker.js` (not committed to this repo — it lives in
Cloudflare's dashboard for the owner's account). Free tier: 100,000
req/day, no credit card.

**Lesson for future shell-asset changes:** `sw.js` caches `js/config.js`
(and the other app-shell files) cache-first. Editing `config.js` alone is
not enough to reach already-visited users — `CACHE_VERSION` in `sw.js` must
also be bumped (e.g. `rbc-shell-v1` → `rbc-shell-v2`) so the browser detects
a new service-worker byte content, installs it, and the existing
`activate` handler purges the old cache. Without that bump, a returning
visitor (or a test browser that already loaded the old version) keeps
serving the stale cached file indefinitely. Confirmed by reproducing this
exact symptom during testing: a hard-reload alone didn't help until the
version bump shipped.

### 4. TCGGO price API — endpoint and shape (RESOLVED, was wrong twice)

**Now verified against a real subscribed key and real responses
(2026-06-21).** The original CLAUDE.md §5.2 example was not just unverified
— it was wrong in three concrete ways, found by testing live from the
deployed app:

1. **You must explicitly "Subscribe" to the API on RapidAPI**, even on the
   free tier — a generic RapidAPI account key alone returns
   `403 {"message":"You are not subscribed to this API."}`. Subscribe at
   https://rapidapi.com/tcggopro/api/riftbound-prices-api first.
2. **The endpoint is `GET /cards?search=<name>`, not `/api/v1/cards`** — the
   documented path 404s: `{"message":"Endpoint '/api/v1/cards' does not
   exist"}`. Confirmed by brute-force testing several candidate paths
   against the live API with a working key.
3. **The response shape is completely different than assumed:**
   - Matches are under `response.data` (array). `response.results` is a
     **total-count number**, not a list — the original code used
     `data.results || data.cards || [data]` as a fallback chain, which
     would have returned the number `7` and crashed on `.find()`. Fixed.
   - Pagination is `response.paging = { current, total, per_page }`.
   - Price is `card.prices.cardmarket.lowest_near_mint` (EUR, lowest current
     near-mint listing) — there is no `trend`/`avg_1d`/`avg_7d`/`avg_30d`.
     Verified with real prices: Ahri €195, Garen €0.30, Teemo €35, Ezreal
     €57.62, Lux €2.49.
   - `card.prices.cardmarket.graded` is an array, present but **empty in
     every sample checked** (7+ real cards) — its item shape is still
     unverified. `fetchPriceByName()` handles it defensively (tries
     `grade`/`name` and `price`/`value` keys, renders nothing if absent) and
     never fabricates a graded price.
   - A `tcgplayer` sibling under `prices` was never observed (`tcgplayer_id`
     was `null` on every sample) — handled defensively, not assumed gone
     forever.

`js/api.js#fetchPriceByName` and `js/app.js#priceLine` were rewritten to
match this real shape exactly. `CONFIG.prices.baseUrl` no longer has the
(wrong) `/api/v1` suffix.

The key itself lives only in a localStorage-backed Settings field in the
About view (see `js/store.js` `getApiKey()`/`setApiKey()` and
`js/api.js#effectiveApiKey()`) — per CLAUDE.md guardrail #2 ("never hardcode
API keys"). `js/config.js`'s `rapidApiKey` field stays permanently empty.

**Still open:** the exact shape of a non-empty `graded` array item, and
whether `tcgplayer` pricing is ever populated. Re-check if/when a card with
either is found.

## Compliance guardrail notes

- No Riot card images are bundled; `manifest.webmanifest`/`sw.js` only
  reference the procedurally generated hexgate icon set in `icons/`, and the
  service worker explicitly only caches same-origin app-shell requests (see
  the comment in `sw.js`) — card/price/image requests always hit the network.
- No real API key is committed; `js/config.js` ships with `rapidApiKey: ""`.
- No gameplay simulation exists anywhere in `js/app.js` — Decks is list/
  validation/cost-tracking only, no turn or board state.
- Unaffiliated-with-Riot disclaimer is in the About view and this file and
  the README.

## Riot's official Riftbound Digital Tools Policy (verified)

Fetched directly from [developer.riotgames.com/docs/riftbound](https://developer.riotgames.com/docs/riftbound)
during the build. Key points that confirm this project's architecture:

- **Card libraries and deckbuilders are explicitly listed as "Examples of
  Approved Use Cases."** This app's scope (gallery, collection, deck *lists*,
  prices) fits squarely there.
- **Explicitly prohibited:** automated rules enforcement, standalone
  Riftbound-only clients, monetization (incl. ads; donations are OK),
  skill-based matchmaking/ladders, and publishing metagame-defining data
  (win rates, play rates). None of these are implemented — matches
  CLAUDE.md §2 guardrail #3 already.
- **This build does not hold an official Riot API key** — it uses
  RiftScribe, an independent fan-made database, not Riot's first-party API.
  The Digital Tools Policy's approval process (and its requirement to use
  official Riot-provided card art/rulesets) only applies once an app
  integrates Riot's own API. **If this project is ever submitted for an
  official API key or public/monetized release, re-read the full policy
  page and apply through the Developer Portal first** — don't assume the
  current architecture is pre-approved.
- **Required attribution notice (Legal Jibber Jabber §6), verified verbatim**
  at [riotgames.com/en/legal](https://www.riotgames.com/en/legal):
  > "[The title of your Project] was created under Riot Games' 'Legal Jibber
  > Jabber' policy using assets owned by Riot Games. Riot Games does not
  > endorse or sponsor this project."

  This exact notice (with "Riftbound Companion" substituted) is in the About
  view footer (`js/app.js`) and the README's Legal section — not a paraphrase.

## Open items / roadmap reminders

- Set auto-detect, perceptual-hash fallback, real-time scanning, friends/
  trading, real web push, and battle-log tracking are intentionally **not**
  implemented — see CLAUDE.md §7.
- Deck validation should be tightened from advisory to firmer warnings only
  after the sideboard-size and rune-pool-size numbers are confirmed against
  an official source (see open question 2 above).
