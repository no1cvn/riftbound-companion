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

console.log(`\n${passed} passed, 0 failed`);
