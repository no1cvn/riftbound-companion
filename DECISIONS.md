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

**Caveat — flag this before fully trusting it in production:** the build
sandbox's fetch tool could retrieve `https://riftscribe.gg/openapi.json` and
the HTML doc pages successfully, but every attempt to GET the *dynamic* JSON
endpoints directly (`/api/cards`, `/api/cards/{id}`, `/api/cards/filters`,
`/api/cards/search`) returned an empty body with no error — including for a
deliberately-invalid card ID, which should have returned a 404 body. This
looks like an environment-specific block (bot/cache layer) rather than an API
problem, since the same routes are documented with working `curl` examples
on the official docs page and the API is publicly described as
unauthenticated. **Action for first real run:** open the app in an actual
browser and confirm `GET /api/cards/OGN-1` returns the shape above before
relying on it further. `normalizeCard()` keeps a few defensive `||`
fallbacks specifically because of this gap, not because the field names
themselves are in doubt.

### 4. TCGGO name-match reliability

**Still unverified — by design, not by choice.** A real RapidAPI key was
briefly placed in `js/config.js` (2026-06-21) to test this, but the build
sandbox's outbound network is allowlisted and blocks
`riftbound-prices-api.p.rapidapi.com` (both direct `curl` and the fetch tool
— confirmed with a deliberate test request, which failed at the proxy rather
than getting a response from RapidAPI). So the request/response shape in
`js/api.js#fetchPriceByName` is still implemented only against the
documented example in CLAUDE.md §5.2, not a live response. It never
fabricates a price: any unexpected shape, HTTP error, or missing key
resolves to `{ unavailable: true }`.

The key was then moved out of `js/config.js` entirely and into a
localStorage-backed Settings field in the About view (see `js/store.js`
`getApiKey()`/`setApiKey()` and `js/api.js#effectiveApiKey()`) — per
CLAUDE.md guardrail #2 ("never hardcode API keys") and so the repo can be
pushed to GitHub (even publicly) without a secret ever sitting in a tracked
file. `js/config.js`'s `rapidApiKey` field stays permanently empty.

**Action for the owner:** open the app for real (local `npx serve` or on a
device), paste your key into About → Settings, scan or manually look up a
card with a price, and check the Network tab / console for the actual JSON
shape TCGGO returns. If field names differ from the assumed
`prices.cardmarket.trend`, `prices.tcgplayer.market`, `graded_prices.psa_10`
etc., report back and `fetchPriceByName()` gets adjusted to match —
especially worth checking champion names with punctuation (e.g. "Kai'Sa")
and any card with no listed price at all (confirm it degrades to
`unavailable`, not a thrown error).

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
