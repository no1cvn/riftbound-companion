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

const SET_CODE = "[A-Z]{2,4}";

export function parseCollectorNumber(rawText) {
  if (typeof rawText !== "string" || !rawText.trim()) return null;
  const text = normalize(rawText);

  // Token: "UNL T03" / "UNL-T03" / "UNLT03"
  const tokenMatch = text.match(new RegExp(`^(${SET_CODE})[\\s-]*T\\s*([0-9]+)$`));
  if (tokenMatch) {
    const [, setCode, digits] = tokenMatch;
    const num = digits.length < 2 ? digits.padStart(2, "0") : digits;
    return `${setCode}-T${num}`;
  }

  // Signature/star: "OGN 301*" / "OGN-301/298*"
  const starMatch = text.match(new RegExp(`^(${SET_CODE})[\\s-]*([0-9]+)(?:/[0-9]+)?\\s*\\*$`));
  if (starMatch) {
    const [, setCode, number] = starMatch;
    return `${setCode}-${number}-star`;
  }

  // Alternate art: "OGN 100A" / "OGN-100A/298"
  const altMatch = text.match(new RegExp(`^(${SET_CODE})[\\s-]*([0-9]+)([A-Z])(?:/[0-9]+)?$`));
  if (altMatch) {
    const [, setCode, number, letter] = altMatch;
    return `${setCode}-${number}${letter.toLowerCase()}`;
  }

  // Standard: "OGN 296/298" / "OGN-296"
  const stdMatch = text.match(new RegExp(`^(${SET_CODE})[\\s-]*([0-9]+)(?:/[0-9]+)?$`));
  if (stdMatch) {
    const [, setCode, number] = stdMatch;
    return `${setCode}-${number}`;
  }

  // Number only, no set code read — caller completes the set via manual form.
  const numOnlyMatch = text.match(/^([0-9]+)(?:\/[0-9]+)?$/);
  if (numOnlyMatch) {
    return { number: numOnlyMatch[1], needsSet: true };
  }

  return null; // garbage — no confident match
}
