// tests/parser.test.mjs — pure-function test for the collector-number
// parser. No framework required: run with `node tests/parser.test.mjs`.

import assert from "node:assert/strict";
import { parseCollectorNumber, splitCardId } from "../js/parser.js";

const cases = [
  ["OGN 296/298", "OGN-296"],
  ["OGN-296", "OGN-296"],
  ["UNL T03", "UNL-T03"],
  ["OGN 100A", "OGN-100a"],
  ["OGN 301*", "OGN-301-star"],
];

let passed = 0;
for (const [input, expected] of cases) {
  const result = parseCollectorNumber(input);
  assert.equal(result, expected, `parseCollectorNumber(${JSON.stringify(input)}) -> ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`);
  passed++;
  console.log(`ok  - "${input}" -> "${result}"`);
}

// Bare number, no set code -> needs manual set completion.
{
  const result = parseCollectorNumber("296/298");
  assert.equal(typeof result, "object");
  assert.equal(result.needsSet, true);
  assert.equal(result.number, "296");
  passed++;
  console.log(`ok  - "296/298" -> needsSet, number "${result.number}"`);
}

// Garbage -> no false match.
{
  const result = parseCollectorNumber("###@@@garbage!!!");
  assert.equal(result, null);
  passed++;
  console.log(`ok  - garbage input -> null (no false match)`);
}

// OCR digit-confusion fix: "O" misread for "0" right next to a digit.
{
  const result = parseCollectorNumber("OGN 1O0A"); // "1O0A" -> "100A"
  assert.equal(result, "OGN-100a");
  passed++;
  console.log(`ok  - OCR confusion "OGN 1O0A" -> "${result}"`);
}

// Case-insensitivity / lowercase input.
{
  const result = parseCollectorNumber("ogn-296");
  assert.equal(result, "OGN-296");
  passed++;
  console.log(`ok  - lowercase "ogn-296" -> "${result}"`);
}

// Real noisy camera-OCR examples reported in the field — the guide box also
// captures artwork/edge noise alongside the real code. These must still
// resolve correctly (regression test for the anchored ^...$ bug that made
// any surrounding noise cause a total miss).
{
  const result = parseCollectorNumber("| & UNL - 022a/219");
  assert.equal(result, "UNL-022a");
  passed++;
  console.log(`ok  - noisy "| & UNL - 022a/219" -> "${result}"`);
}
{
  const result = parseCollectorNumber('oH D— . a SED - 235/221 y7 4 a am ass ss os od');
  // "235" vs a printed total of "221" is impossible on a real card (the
  // numerator can never exceed the denominator), so the denominator sanity
  // check (added 2026-06-22, see below) catches this upstream now instead of
  // confidently returning the malformed "SED-235" and relying on RiftScribe's
  // 404 as the only safety net. Stripping the trailing digit ("23") also
  // happens to land back in range, which is the same shape as the real
  // misread-alt-art-suffix bug this check was added for.
  assert.equal(typeof result, "object");
  assert.equal(result.needsSet, true);
  assert.equal(result.setCode, "SED");
  passed++;
  console.log(`ok  - noisy unrestricted "...SED - 235/221..." -> needsSet (numerator > denominator caught upstream)`);
}

// With knownSets restriction (what scan.js actually passes), the same noisy
// text must NOT match on the fake "SED" code, and should fall through to
// the bare-number fallback instead.
{
  const knownSets = ["OGN", "OGS", "SFD", "UNL", "VEN"];
  const result = parseCollectorNumber('oH D— . a SED - 235/221 y7 4 a am ass ss os od', { knownSets });
  assert.equal(typeof result, "object");
  assert.equal(result.needsSet, true);
  passed++;
  console.log(`ok  - same noisy text WITH knownSets -> needsSet (no false "SED" match)`);
}
{
  const knownSets = ["OGN", "OGS", "SFD", "UNL", "VEN"];
  const result = parseCollectorNumber("| & UNL - 022a/219", { knownSets });
  assert.equal(result, "UNL-022a");
  passed++;
  console.log(`ok  - noisy text WITH knownSets still finds real "UNL-022a"`);
}

// Real field report (2026-06-22): an alt-art card printed "SFD 141a/221" but
// the camera OCR misread the small "a" suffix marker as a digit, producing
// "SFD 1412/221" — read confidently as the wrong card "SFD-1412" before this
// fix. 1412 > 221 is impossible on a real card, so it must now be caught and
// downgraded to a manual-completion prefill instead of a confident (wrong)
// lookup.
{
  const knownSets = ["OGN", "OGS", "SFD", "UNL", "VEN"];
  const result = parseCollectorNumber("SFD 1412/221", { knownSets });
  assert.equal(typeof result, "object");
  assert.equal(result.needsSet, true);
  assert.equal(result.setCode, "SFD");
  assert.equal(result.number, "141");
  assert.equal(result.suffixGuess, "a");
  passed++;
  console.log(`ok  - misread alt-art suffix "SFD 1412/221" -> needsSet, setCode "SFD", number "141", suffixGuess "a"`);
}

// A genuinely large but in-range numerator must NOT be flagged — the
// denominator check is a sanity check (numerator > denominator), not a
// magnitude check.
{
  const result = parseCollectorNumber("OGN 298/298");
  assert.equal(result, "OGN-298");
  passed++;
  console.log(`ok  - in-range numerator == denominator "OGN 298/298" -> "${result}" (not flagged)`);
}

// splitCardId() — used to prefill the manual form from a "not found" result.
{
  assert.deepEqual(splitCardId("SFD-141a"), { setCode: "SFD", number: "141", suffix: "a" });
  assert.deepEqual(splitCardId("OGN-301-star"), { setCode: "OGN", number: "301", suffix: "-star" });
  assert.deepEqual(splitCardId("UNL-1412"), { setCode: "UNL", number: "1412", suffix: "" });
  assert.equal(splitCardId("garbage"), null);
  passed++;
  console.log(`ok  - splitCardId() splits set/number/suffix correctly`);
}

console.log(`\n${passed} passed, 0 failed`);
