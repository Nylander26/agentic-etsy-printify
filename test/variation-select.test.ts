import { describe, it, expect } from "vitest";
import { selectVariationsPerConcept } from "../src/publisher/index.js";
import type { DesignMetadata, VariationKind } from "../src/generator/types.js";

function design(
  id: string,
  concept: string,
  variation: VariationKind,
  overall?: number,
  niche = "funny dad shirt"
): { meta: DesignMetadata; metaPath: string } {
  return {
    metaPath: `output/2026-06-08/${niche}/${id}/metadata.json`,
    meta: {
      id,
      niche,
      concept,
      style: "vintage",
      product: "tshirt",
      variation,
      prompt: "",
      status: "approved",
      createdAt: "2026-06-08T00:00:00.000Z",
      files: { original: `${id}.png` },
      ...(overall === undefined
        ? {}
        : {
            validation: {
              verdict: "approved" as const,
              scores: {
                nicheRelevance: 8,
                trendAlignment: 8,
                commercialAppeal: 8,
                printability: 8,
                overall,
              },
              reasons: { strengths: [], concerns: [], blockers: [] },
              suggestedImprovements: [],
              evaluatedAt: "2026-06-08T00:00:00.000Z",
              model: "gemini-2.5-flash",
            },
          }),
    } as DesignMetadata,
  };
}

describe("selectVariationsPerConcept", () => {
  it("keeps only the best-scoring variation of each concept", () => {
    // The real LaughLoudDesigns shape: 3 treatments of each idea.
    const designs = [
      design("grillfather-001-base", "The Grillfather BBQ dad", "base", 7.0),
      design("grillfather-001-dark", "The Grillfather BBQ dad", "dark", 8.5),
      design("grillfather-001-no-text", "The Grillfather BBQ dad", "no-text", 6.0),
      design("restingeyes-002-base", "Just resting my eyes", "base", 9.0),
      design("restingeyes-002-dark", "Just resting my eyes", "dark", 7.5),
    ];

    const kept = selectVariationsPerConcept(designs, 1);

    expect(kept.map((d) => d.meta.id)).toEqual([
      "grillfather-001-dark",
      "restingeyes-002-base",
    ]);
  });

  it("honors a higher per-concept cap", () => {
    const designs = [
      design("g-base", "The Grillfather BBQ dad", "base", 7.0),
      design("g-dark", "The Grillfather BBQ dad", "dark", 8.5),
      design("g-notext", "The Grillfather BBQ dad", "no-text", 6.0),
    ];

    expect(selectVariationsPerConcept(designs, 2).map((d) => d.meta.id)).toEqual([
      "g-base",
      "g-dark",
    ]);
  });

  it("breaks score ties by variation preference, then id", () => {
    const designs = [
      design("x-notext", "same concept", "no-text", 8.0),
      design("x-dark", "same concept", "dark", 8.0),
      design("x-base", "same concept", "base", 8.0),
    ];
    expect(selectVariationsPerConcept(designs, 1)[0]!.meta.id).toBe("x-base");
  });

  it("treats the same concept in different niches as separate concepts", () => {
    const designs = [
      design("a-base", "coffee lover", "base", 8.0, "funny dad shirt"),
      design("b-base", "coffee lover", "base", 7.0, "cat lover shirt"),
    ];
    expect(selectVariationsPerConcept(designs, 1)).toHaveLength(2);
  });

  it("never merges designs that carry no concept text", () => {
    const designs = [design("a", "", "base", 8.0), design("b", "", "dark", 7.0)];
    expect(selectVariationsPerConcept(designs, 1)).toHaveLength(2);
  });

  it("ranks unvalidated designs below validated ones", () => {
    const designs = [
      design("unscored", "same concept", "base"),
      design("scored", "same concept", "dark", 5.0),
    ];
    expect(selectVariationsPerConcept(designs, 1)[0]!.meta.id).toBe("scored");
  });

  it("preserves the input ordering of the designs it keeps", () => {
    const designs = [
      design("z-001-base", "zeta concept", "base", 9.0),
      design("a-002-base", "alpha concept", "base", 9.0),
    ];
    expect(selectVariationsPerConcept(designs, 1).map((d) => d.meta.id)).toEqual([
      "z-001-base",
      "a-002-base",
    ]);
  });
});
