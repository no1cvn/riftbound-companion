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
import { getApiKey } from "./store.js";

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

export function hasPriceKey() {
  return !!effectiveApiKey().trim();
}

/**
 * Look up prices by card name via TCGGO. Never fabricates a price: returns
 * { unavailable: true } on missing key, network failure, or unexpected shape.
 */
export async function fetchPriceByName(name) {
  const key = effectiveApiKey();
  if (!key || !name) return { unavailable: true };

  const url = `${CONFIG.prices.baseUrl}/cards${qs({ search: name })}`;
  let res;
  try {
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

  const results = Array.isArray(data) ? data : data.results || data.cards || [data];
  if (!results || results.length === 0) return { unavailable: true };

  const lowerName = name.trim().toLowerCase();
  const exact = results.find((r) => (r.name || "").trim().toLowerCase() === lowerName);
  const match = exact || results[0];
  if (!match) return { unavailable: true };

  const prices = match.prices || {};
  const graded = match.graded_prices || {};

  return {
    unavailable: false,
    name: match.name || name,
    cardmarket: prices.cardmarket
      ? {
          trend: prices.cardmarket.trend ?? null,
          avg1d: prices.cardmarket.avg_1d ?? null,
          avg7d: prices.cardmarket.avg_7d ?? null,
          avg30d: prices.cardmarket.avg_30d ?? null,
          low: prices.cardmarket.low ?? null,
        }
      : null,
    tcgplayer: prices.tcgplayer
      ? { market: prices.tcgplayer.market ?? null, low: prices.tcgplayer.low ?? null }
      : null,
    graded: {
      psa10: graded.psa_10 ?? null,
      psa9: graded.psa_9 ?? null,
      bgs95: graded.bgs_9_5 ?? null,
    },
    lastUpdated: match.last_updated || null,
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
