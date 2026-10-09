import { describe, expect, test } from "bun:test";
import { compareGuides, listGuides, parseGuide } from "@/lib/guides";

describe("parseGuide", () => {
	test("defaults a missing order to MAX_SAFE_INTEGER (Review Focus 5)", () => {
		const guide = parseGuide("x", "---\ntitle: X\n---\n\nbody");
		expect(guide.order).toBe(Number.MAX_SAFE_INTEGER);
		expect(Number.isNaN(guide.order)).toBe(false);
	});

	test("defaults a non-numeric order too", () => {
		const guide = parseGuide("x", "---\ntitle: X\norder: soon\n---\n");
		expect(guide.order).toBe(Number.MAX_SAFE_INTEGER);
	});

	test("reads frontmatter and strips it from the body", () => {
		const guide = parseGuide(
			"x",
			"---\ntitle: Hello\ndescription: A guide.\norder: 3\n---\n\n# Hi\n",
		);
		expect(guide.title).toBe("Hello");
		expect(guide.description).toBe("A guide.");
		expect(guide.order).toBe(3);
		expect(guide.body).toBe("\n# Hi\n");
	});
});

describe("compareGuides", () => {
	test("orders ascending by order", () => {
		const a = { slug: "a", title: "A", description: "", order: 1 };
		const b = { slug: "b", title: "A", description: "", order: 2 };
		expect(compareGuides(a, b)).toBeLessThan(0);
	});

	test("tie-breaks equal orders by title", () => {
		const a = { slug: "a", title: "B", description: "", order: 1 };
		const b = { slug: "b", title: "A", description: "", order: 1 };
		expect(compareGuides(a, b)).toBeGreaterThan(0);
	});
});

describe("listGuides", () => {
	test("every order is a finite number, never undefined/NaN", () => {
		for (const guide of listGuides()) {
			expect(typeof guide.order).toBe("number");
			expect(Number.isFinite(guide.order)).toBe(true);
		}
	});

	test("is sorted by order then title", () => {
		const guides = listGuides();
		for (let i = 1; i < guides.length; i++) {
			expect(compareGuides(guides[i - 1], guides[i])).toBeLessThanOrEqual(
				0,
			);
		}
	});

	test("handles a guide with no order without NaN and is stable across calls (Review Focus 5)", () => {
		const first = listGuides();
		const second = listGuides();
		expect(first).toEqual(second);

		// At least one real guide omits `order`; it must sort last, not vanish
		// or produce a NaN comparison.
		const unordered = first.filter(
			(guide) => guide.order === Number.MAX_SAFE_INTEGER,
		);
		expect(unordered.length).toBeGreaterThan(0);
		expect(first[first.length - 1].order).toBe(Number.MAX_SAFE_INTEGER);
	});
});
