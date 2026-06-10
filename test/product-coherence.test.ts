import { describe, it, expect } from "vitest";
import {
  productsNamedIn,
  keywordMatchesProducts,
  coherenceRejectReason,
  allowedProductNouns,
  forbiddenProductNouns,
} from "../src/research/product-coherence.js";

describe("productsNamedIn", () => {
  it("detects the product noun in a keyword", () => {
    expect(productsNamedIn("Independence Day Mug")).toEqual(["mug"]);
    expect(productsNamedIn("funny dad shirt")).toEqual(["tshirt"]);
    expect(productsNamedIn("vintage wall art print")).toEqual(["poster"]);
  });

  it("returns [] for product-agnostic keywords", () => {
    expect(productsNamedIn("funny dad bbq")).toEqual([]);
  });

  it("matches whole words only (no 'tee' inside 'teenager')", () => {
    expect(productsNamedIn("teenager mom life")).toEqual([]);
  });
});

describe("keywordMatchesProducts", () => {
  const products = ["tshirt"] as const;

  it("accepts product-agnostic keywords", () => {
    expect(keywordMatchesProducts("funny dad bbq", [...products])).toBe(true);
  });

  it("accepts keywords naming only configured products", () => {
    expect(keywordMatchesProducts("funny dad shirt", [...products])).toBe(true);
  });

  it("rejects keywords naming a non-configured product", () => {
    expect(keywordMatchesProducts("independence day mug", [...products])).toBe(false);
  });
});

describe("coherenceRejectReason", () => {
  it("returns null when coherent", () => {
    expect(coherenceRejectReason("funny dad shirt", ["tshirt"])).toBeNull();
  });

  it("names the offending product when incoherent", () => {
    const reason = coherenceRejectReason("independence day mug", ["tshirt"]);
    expect(reason).toContain("mug");
  });
});

describe("allowed/forbidden product nouns", () => {
  it("splits nouns by configured vs not", () => {
    expect(allowedProductNouns(["tshirt"])).toContain("shirt");
    const forbidden = forbiddenProductNouns(["tshirt"]);
    expect(forbidden).toContain("mug");
    expect(forbidden).toContain("poster");
    expect(forbidden).not.toContain("shirt");
  });
});
