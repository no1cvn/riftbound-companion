// js/api.js — data clients (cards + prices), normalization, and the
// 08:00-Europe/Berlin price-day cache key.
//
// VERIFICATION NOTE (see DECISIONS.md for full log):
// The RiftScribe field names below are NOT guessed. They were confirmed by
// fetching the live OpenAPI schema at https://riftscribe.gg/openapi.json
// during the build (the FastAPI service's own auto-generated spec for
// `CardRead` / `CardSummaryRead` / `CardSearchResult` / `CardFiltersRead`),
// and cross-checked against https://riftscribe.gg/api-docs. Direct GETs to
// the dynamic JSON endpoints (/api/cards, /api/cards/{id}, /api/cards/filters)
// could not be completed from the build sandbox (the fetch tool returned an
// empty body for those specific routes — see DECISIONS.md), so normalizeCard()
// still keeps a couple of defensive fallbacks rather than assuming the schema
// can never drift. Re-verify with a live browser request on first real run.
//
// The TCGGO/RapidAPI price shape in fetchPriceByName() is UNVERIFIED — no
// RapidAPI key was available during the build to make a real request. It is
// implemented exactly against the documented example in CLAUDE.md §5.2 and
// is defensive about missing fields. Never fabricates a price: any shape
// mismatch or error resolves to "unavailable", not a guess.

import { CONFIG } from "./config.js";
import { getApiKey, getPriceCallCount, incrementPriceCallCount } from "./store.js";

/**
 * The RapidAPI key, preferring whatever the user pasted into the in-app
 * About > Settings field (browser localStorage, never committed) over the
 * CONFIG fallback (which should normally be left empty — see config.js).
 */
function effectiveApiKey() {
  const stored = getApiKey();
  return stored || CONFIG.prices.rapidApiKey || "";
}

/* ----------------------------- Cards (RiftScribe) ----------------------------- */

function qs(params) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== "") usp.set(k, v);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

/**
 * Maps a raw RiftScribe CardRead/CardSummaryRead response to the shape the
 * rest of the app uses. Field names are the confirmed live schema; the
 * `||` fallbacks only exist for older/alternate field names should the API
 * change, and are NOT a substitute for verifying a real response.
 */
export function normalizeCard(raw) {
  if (!raw) return null;
  const thumb = raw.image_thumb || {};
  const stats = raw.stats || {};
  return {
    id: raw.id,
    name: raw.name,
    setId: raw.set_id || raw.set || raw.setId,
    collectorNumber: raw.collector_number ?? raw.collectorNumber ?? null,
    variant: raw.variant || "",
    rarity: raw.rarity || null,
    faction: raw.faction || raw.domain || null,
    type: raw.type || null,
    orientation: raw.orientation || null,
    energy: stats.energy ?? raw.energy ?? null,
    might: stats.might ?? raw.might ?? null,
    power: stats.power ?? raw.power ?? null,
    image: raw.image || thumb.large || raw.image_url || null,
    imageThumb: {
      small: thumb.small || null,
      medium: thumb.medium || null,
      large: thumb.large || null,
    },
    imageBlurDataUrl: raw.image_blur_data_url || null,
    isBanned: !!raw.is_banned,
    description: raw.description || raw.rules || raw.text || null,
    flavorText: raw.flavor_text || null,
    artist: (raw.art && raw.art.artist) || null,
    keywords: raw.keywords || [],
    tags: raw.tags || [],
    prevCardId: raw.prev_card_id || null,
    nextCardId: raw.next_card_id || null,
    _raw: raw,
  };
}

export const RiftScribe = {
  /** GET /api/cards — list/filter. Returns { cards, total }. */
  async listCards({ q, set_id, faction, rarity, type, is_banned, sort, limit, offset } = {}) {
    const url = `${CONFIG.riftscribe.baseUrl}/cards${qs({ q, set_id, faction, rarity, type, is_banned, sort, limit, offset })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RiftScribe listCards failed: ${res.status}`);
    const data = await res.json();
    const total = Number(res.headers.get("X-Total-Count")) || data.length;
    return { cards: data.map(normalizeCard), total };
  },

  /** GET /api/cards/search?q=… — fuzzy name search (min 2 chars, max 20). */
  async search(q, { types, limit } = {}) {
    if (!q || q.trim().length < 2) return [];
    const url = `${CONFIG.riftscribe.baseUrl}/cards/search${qs({ q, types, limit })}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RiftScribe search failed: ${res.status}`);
    const data = await res.json();
    return data.map((r) => ({
      cardId: r.card_id,
      name: r.name,
      type: r.type || null,
      setId: r.set_id || null,
      thumbnailUrl: r.thumbnail_url || null,
      isBanned: !!r.is_banned,
    }));
  },

  /** GET /api/cards/filters — distinct sets/factions/rarities/types. */
  async getFilters() {
    const url = `${CONFIG.riftscribe.baseUrl}/cards/filters`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`RiftScribe getFilters failed: ${res.status}`);
    const data = await res.json();
    return {
      sets: data.sets || [],
      factions: data.factions || [],
      rarities: data.rarities || [],
      types: data.types || [],
    };
  },

  /** GET /api/cards/{card_id} — single card. Returns null on 404. */
  async getCard(cardId) {
    const url = `${CONFIG.riftscribe.baseUrl}/cards/${encodeURIComponent(cardId)}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`RiftScribe getCard failed: ${res.status}`);
    return normalizeCard(await res.json());
  },
};

/* ----------------------------- Prices (TCGGO / RapidAPI) ----------------------------- */
//
// VERIFIED 2026-06-21 against the live API with a real subscribed key (see
// DECISIONS.md item #4 — this was previously guessed and WRONG in several
// ways; the corrections below are from an actual captured response, not a
// new guess):
//   - Endpoint is GET /cards?search=<name>  (NOT /api/v1/cards — that path
//     404s: "Endpoint '/api/v1/cards' does not exist").
//   - The match list is under response.data (an array). response.results is
//     a total-count NUMBER, not an array — using it as a list (an earlier
//     bug) would have crashed on the first `.find()` call.
//   - Pagination info is response.paging = { current, total, per_page }.
//   - Each card's price lives at card.prices.cardmarket.lowest_near_mint
//     (EUR, the lowest current near-mint listing) — there is no
//     trend/avg_1d/avg_7d/avg_30d as originally assumed.
//   - card.prices.cardmarket.graded is an array that was empty in every
//     sample checked (several real cards). Its item shape is therefore
//     still UNVERIFIED — handled defensively below, never fabricated.
//   - A "tcgplayer" sibling under `prices` was never observed (tcgplayer_id
//     was null on every sample checked) — handled defensively, not assumed
//     absent forever.

export function hasPriceKey() {
  return !!effectiveApiKey().trim();
}

/**
 * Look up prices by card name via TCGGO. Never fabricates a price: returns
 * { unavailable: true } on missing key, network failure, or unexpected shape.
 *
 * Enforces CONFIG.prices.dailyLimit (default 100) outbound calls per
 * price-day BEFORE making the request — once hit, returns
 * { unavailable: true, limitReached: true } without touching the network,
 * so a long scanning session can't run past your RapidAPI quota or rack up
 * cost on a paid tier. Cache hits in getPriceForCard() never reach this
 * function at all, so re-viewing an already-priced-today card is free.
 */
export async function fetchPriceByName(name) {
  const key = effectiveApiKey();
  if (!key || !name) return { unavailable: true };

  const day = priceDayKey();
  const limit = CONFIG.prices.dailyLimit ?? 100;
  if (getPriceCallCount(day) >= limit) {
    return { unavailable: true, limitReached: true };
  }

  const url = `${CONFIG.prices.baseUrl}/cards${qs({ search: name })}`;
  let res;
  try {
    incrementPriceCallCount(day); // count the attempt itself, not just successes
    res = await fetch(url, {
      headers: {
        "X-RapidAPI-Key": key,
        "X-RapidAPI-Host": CONFIG.prices.host,
      },
    });
  } catch {
    return { unavailable: true };
  }
  if (!res.ok) return { unavailable: true };

  let data;
  try {
    data = await res.json();
  } catch {
    return { unavailable: true };
  }

  const list = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : [];
  if (!list.length) return { unavailable: true };

  const lowerName = name.trim().toLowerCase();
  const exact = list.find((r) => (r.name || "").trim().toLowerCase() === lowerName);
  const match = exact || list[0];
  if (!match) return { unavailable: true };

  const cm = (match.prices && match.prices.cardmarket) || null;
  const tp = (match.prices && match.prices.tcgplayer) || null;
  const gradedList = Array.isArray(cm?.graded) ? cm.graded : [];

  return {
    unavailable: false,
    name: match.name || name,
    cardmarket: cm
      ? {
          currency: cm.currency || "EUR",
          lowestNearMint: cm.lowest_near_mint ?? null,
          availableItems: cm.available_items ?? null,
        }
      : null,
    tcgplayer: tp ? { market: tp.market ?? tp.price ?? null } : null,
    // Defensive — graded array shape unverified (always empty in testing).
    graded: gradedList.map((g) => ({ grade: g.grade ?? g.name ?? null, price: g.price ?? g.value ?? null })),
    tcggoUrl: match.tcggo_url || null,
  };
}

/* ----------------------------- Price-day cache key ----------------------------- */

/** Berlin wall-clock components for a given instant, as UTC-equivalent Date math. */
function berlinWallClockAsUtc(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = {};
  for (const p of parts) map[p.type] = p.value;
  // hour12:false can format midnight as "24" in some engines — normalize.
  const hour = map.hour === "24" ? "00" : map.hour;
  return new Date(`${map.year}-${map.month}-${map.day}T${hour}:${map.minute}:${map.second}Z`);
}

/**
 * priceDayKey(now) — the cache "day" rolls over at 08:00 Europe/Berlin.
 * Implementation: Berlin wall-clock minus the rollover hour, formatted
 * YYYY-MM-DD. Pass an explicit `now` to test the rollover without mocking
 * the global clock.
 */
export function priceDayKey(now = new Date()) {
  const berlinAsUtc = berlinWallClockAsUtc(now);
  const rolloverMs = CONFIG.priceCache.rolloverHourBerlin * 3600 * 1000;
  const rolled = new Date(berlinAsUtc.getTime() - rolloverMs);
  const y = rolled.getUTCFullYear();
  const m = String(rolled.getUTCMonth() + 1).padStart(2, "0");
  const d = String(rolled.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Bridge: identify card via RiftScribe (already have `card`), fetch price by
 * name, cache per price-day (even a "no price" result, to respect the free
 * tier). `store` is the persistence module (see store.js).
 */
export async function getPriceForCard(card, store) {
  const day = priceDayKey();
  const cached = store.getCachedPrice(card.id);
  if (cached && cached.day === day) return cached.data;

  const data = await fetchPriceByName(card.name);
  store.setCachedPrice(card.id, day, data);
  return data;
}
