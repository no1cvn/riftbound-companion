// js/parser.js — Riftbound collector-number parser.
//
// Pure function, no DOM/camera/OCR dependencies, so it can run unmodified in
// Node for tests (see tests/parser.test.mjs) and in the browser.
//
// Confirmed real-world numbering (verified via riftboundsymbols.com "Set
// Codes Explained" during the build — see DECISIONS.md open question #1):
// physical cards print the set code WITH the collector number, e.g.
// "OGN 042/256", not just the bare number. The bare-number case is kept as
// a fallback for crops/wear where the set code wasn't read.
//
// VERIFIED LIVE SET CODES (see DECISIONS.md): OGN, OGS, SFD, UNL, VEN.
//
// Output of parse():
//   - string                  -> a RiftScribe-ready card ID, e.g. "OGN-296",
//                                "OGN-100a", "OGN-301-star", "UNL-T03"
//   - { number, needsSet }    -> a bare collector number with no set code;
//                                caller should open the manual form prefilled
//                                with this number (CLAUDE.md §6 P1 step 5)
//   - null                    -> no confident match; prompt retry/manual

/**
 * Fixes common OCR confusions (O<->0, I/l<->1) ONLY when the letter is
 * directly adjacent to a digit. Implemented with capture-group replacement
 * (not lookbehind) for older-Safari compatibility, per the build spec.
 */
function fixDigitAdjacentOcrConfusions(text) {
  let out = text;
  out = out.replace(/([0-9])([OIL])/g, (_, digit, letter) => digit + (letter === "O" ? "0" : "1"));
  out = out.replace(/([OIL])([0-9])/g, (_, letter, digit) => (letter === "O" ? "0" : "1") + digit);
  return out;
}

function normalize(raw) {
  return fixDigitAdjacentOcrConfusions(raw.toUpperCase().trim().replace(/\s+/g, " "));
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * On a real printed card the numerator can never exceed the denominator
 * (e.g. "141/221" — number/set total). When a match's captured numerator
 * *does* exceed its captured denominator, that's a reliable signal the OCR
 * fused an adjacent character into the digit run — confirmed from a real
 * field report: an alt-art card printed "SFD 141a/221" had its small "a"
 * suffix marker misread as a trailing digit, producing "SFD 1412/221" (a
 * confident-looking but impossible "SFD-1412"). Rather than hand that to
 * RiftScribe as a guess, this is downgraded to a manual-completion result.
 *
 * If stripping the trailing digit brings the numerator back in range, that
 * stripped number plus a guessed "a" (alt-art) suffix are offered as a
 * *prefill* for the manual form — never a confident final answer, since the
 * user still has to press "Look up" to confirm it. A wrong guess here costs
 * a glance, not a silently-wrong card.
 */
function lowConfidenceNumber(setCode, number, total) {
  if (!total || Number(number) <= Number(total)) return null;
  const stripped = number.slice(0, -1);
  if (stripped && Number(stripped) <= Number(total)) {
    return { number: stripped, needsSet: true, setCode, suffixGuess: "a" };
  }
  return { number, needsSet: true, setCode };
}

/**
 * @param {string} rawText
 * @param {{ knownSets?: string[] }} [opts] — when provided (a non-empty
 *   array of currently-valid set codes, e.g. from RiftScribe's live
 *   /cards/filters), the set-code alternative is restricted to exactly
 *   those codes instead of any generic 2-4 uppercase letters. This cuts
 *   down on false matches from camera-scan noise (a stray uppercase run
 *   like "SED" from a misread word never gets treated as a set code),
 *   while staying forward-compatible with future sets since the list is
 *   fetched live, not hardcoded. Omit it (e.g. in Node tests) to fall back
 *   to the generic pattern.
 */
export function parseCollectorNumber(rawText, opts = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) return null;
  const text = normalize(rawText);

  const knownSets = Array.isArray(opts.knownSets) ? opts.knownSets.filter(Boolean) : [];
  const SET_CODE = knownSets.length
    ? `(?:${knownSets.map((s) => escapeRegExp(s.toUpperCase())).join("|")})`
    : "[A-Z]{2,4}";

  // Boundary-aware, NOT a full-string anchor: real camera captures often
  // include noise from artwork/edges inside the guide box alongside the
  // actual collector code (e.g. OCR text like "| & UNL - 022A/219 Y7 4 ...").
  // Anchoring the whole pattern to ^...$ (the original approach) means any
  // such noise causes a total miss. PRE/POST require the code to start at
  // the beginning of the string OR right after a non-letter/non-alnum
  // character (not lookbehind/lookahead — capture-group based, Safari-safe,
  // per the same constraint as the OCR-confusion fix above), so a match
  // embedded in noisy text is still found without requiring the entire OCR
  // string to be clean. A still-confident card ID found this way then goes
  // through RiftScribe's own lookup, which 404s on anything bogus — so a
  // stray false "set code" from noise (e.g. with the generic, no-knownSets
  // pattern) surfaces as "not found", never a silently-wrong card.
  const PRE = "(?:^|[^A-Z])";
  const POST = "(?:$|[^A-Z0-9])";

  // Token: "UNL T03" / "UNL-T03" / "UNLT03"
  const tokenMatch = text.match(new RegExp(`${PRE}(${SET_CODE})[\\s-]*T\\s*([0-9]+)${POST}`));
  if (tokenMatch) {
    const [, setCode, digits] = tokenMatch;
    const num = digits.length < 2 ? digits.padStart(2, "0") : digits;
    return `${setCode}-T${num}`;
  }

  // Signature/star: "OGN 301*" / "OGN-301/298*"
  const starMatch = text.match(new RegExp(`${PRE}(${SET_CODE})[\\s-]*([0-9]+)(?:/([0-9]+))?\\s*\\*${POST}`));
  if (starMatch) {
    const [, setCode, number, total] = starMatch;
    const low = lowConfidenceNumber(setCode, number, total);
    if (low) return low;
    return `${setCode}-${number}-star`;
  }

  // Alternate art: "OGN 100A" / "OGN-100A/298"
  const altMatch = text.match(new RegExp(`${PRE}(${SET_CODE})[\\s-]*([0-9]+)([A-Z])(?:/([0-9]+))?${POST}`));
  if (altMatch) {
    const [, setCode, number, letter, total] = altMatch;
    const low = lowConfidenceNumber(setCode, number, total);
    if (low) return low;
    return `${setCode}-${number}${letter.toLowerCase()}`;
  }

  // Standard: "OGN 296/298" / "OGN-296"
  const stdMatch = text.match(new RegExp(`${PRE}(${SET_CODE})[\\s-]*([0-9]+)(?:/([0-9]+))?${POST}`));
  if (stdMatch) {
    const [, setCode, number, total] = stdMatch;
    const low = lowConfidenceNumber(setCode, number, total);
    if (low) return low;
    return `${setCode}-${number}`;
  }

  // Number only, no set code read — caller completes the set via manual form.
  const numOnlyMatch = text.match(/(?:^|[^0-9])([0-9]{1,4})(?:\/[0-9]+)?(?:$|[^0-9])/);
  if (numOnlyMatch) {
    return { number: numOnlyMatch[1], needsSet: true };
  }

  return null; // garbage — no confident match
}

/**
 * Splits a RiftScribe-ready card ID (as produced above, e.g. "SFD-141a",
 * "OGN-301-star") back into its set/number/variant-suffix parts. Used to
 * prefill the manual entry form when a scan's guessed ID comes back
 * "not found" — lets the user correct a likely OCR misread without
 * retyping everything from scratch. Returns null if `id` doesn't look like
 * a set-number ID at all.
 */
export function splitCardId(id) {
  if (typeof id !== "string") return null;
  const m = id.match(/^([A-Z0-9]+)-(.+)$/);
  if (!m) return null;
  const [, setCode, rest] = m;
  if (rest.endsWith("-star")) {
    return { setCode, number: rest.slice(0, -5), suffix: "-star" };
  }
  const altSuffix = rest.match(/^([0-9]+)([a-z])$/);
  if (altSuffix) {
    return { setCode, number: altSuffix[1], suffix: altSuffix[2] };
  }
  return { setCode, number: rest, suffix: "" };
}
