import test from "node:test";
import assert from "node:assert/strict";
import {
  parseAmount,
  formatUSD,
  roundHalfEven,
  splitEvenly,
  applyDiscount,
  isLeapYear,
} from "../src/money.mjs";

test("parseAmount reads thousands separators", () => {
  assert.equal(parseAmount("$1,234.50"), 123450);
});

test("formatUSD pads cents to two digits", () => {
  assert.equal(formatUSD(1205), "$12.05");
  assert.equal(formatUSD(-50), "-$0.50");
});

test("roundHalfEven rounds ties to the even neighbour", () => {
  assert.equal(roundHalfEven(2.5), 2);
  assert.equal(roundHalfEven(3.5), 4);
  assert.equal(roundHalfEven(2.4), 2);
});

test("splitEvenly never loses a cent", () => {
  const parts = splitEvenly(1000, 3);
  assert.equal(parts.reduce((a, b) => a + b, 0), 1000);
  assert.deepEqual(parts, [334, 333, 333]);
});

test("applyDiscount takes a percentage off", () => {
  assert.equal(applyDiscount(10000, 15), 8500);
});

test("isLeapYear handles century years", () => {
  assert.equal(isLeapYear(2024), true);
  assert.equal(isLeapYear(1900), false);
  assert.equal(isLeapYear(2000), true);
});
