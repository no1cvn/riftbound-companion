// tests/parser.test.mjs — pure-function test for the collector-number
// parser. No framework required: run with `node tests/parser.test.mjs`.

import assert from "node:assert/strict";
import { parseCollectorNumber } from "../js/parser.js";

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
  // "SED" is not a real set code, but with no knownSets restriction the
  // generic pattern still extracts *something* well-formed rather than
  // nothing — RiftScribe's own lookup is the safety net that turns this
  // into "not found" rather than a silently-wrong card. See DECISIONS.md.
  assert.equal(result, "SED-235");
  passed++;
  console.log(`ok  - noisy unrestricted "...SED - 235/221..." -> "${result}" (expected to 404 downstream)`);
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

console.log(`\n${passed} passed, 0 failed`);
