import { describe, expect, test } from "bun:test";
import {
	deriveDescription,
	deriveTitle,
	type LinkContext,
	rewriteLinks,
	stripBadgeBlock,
	stripLeadParagraph,
} from "@/lib/docs";

describe("deriveTitle", () => {
	test("uses the first H1", () => {
		expect(deriveTitle("# cmduse\n\nLive dashboard", "x")).toBe("cmduse");
	});

	test("falls back when there is no H1", () => {
		expect(deriveTitle("no heading", "fallback")).toBe("fallback");
	});
});

describe("deriveDescription", () => {
	test("uses the first plain paragraph", () => {
		expect(
			deriveDescription(
				"# T\n\nLive [Command Code](https://commandcode.ai) usage dashboard.",
				"fb",
			),
		).toBe("Live [Command Code](https://commandcode.ai) usage dashboard.");
	});

	test("skips a leading fenced code block (Review Focus 1)", () => {
		expect(deriveDescription("# T\n\n```sh\nx\n```\n\nAfter.", "fb")).toBe(
			"After.",
		);
	});

	test("falls back when the only block is a fence", () => {
		expect(deriveDescription("# T\n\n```sh\nx\n```", "fb")).toBe("fb");
	});

	test("falls back when a heading comes first (no prose)", () => {
		expect(deriveDescription("# T\n\n## Heading\n\n### Sub", "fb")).toBe(
			"fb",
		);
	});

	test("falls back when a list comes first", () => {
		expect(deriveDescription("# T\n\n- one\n- two", "fb")).toBe("fb");
	});

	test("falls back when a table comes first", () => {
		expect(deriveDescription("# T\n\n| a | b |\n| - | - |", "fb")).toBe(
			"fb",
		);
	});

	test("does not read prose from inside a section (preamble only)", () => {
		expect(
			deriveDescription("# T\n\n## What it is\n\nReal prose here.", "fb"),
		).toBe("fb");
	});
});

describe("stripLeadParagraph", () => {
	test("removes the lead paragraph and one following blank line", () => {
		expect(
			stripLeadParagraph(
				"# T\n\ntagline here\n\n## X\n\nbody",
				"tagline here",
			),
		).toBe("# T\n\n## X\n\nbody");
	});

	test("leaves md unchanged when the first prose line is not the description (guard)", () => {
		expect(stripLeadParagraph("# T\n\n## X\n\nreal text", "fallback")).toBe(
			"# T\n\n## X\n\nreal text",
		);
	});

	test("skips a leading fenced block when finding the lead paragraph", () => {
		const md = "# T\n\n```sh\nx\n```\n\nreal lead\n\n## X";
		expect(stripLeadParagraph(md, "real lead")).toBe(
			"# T\n\n```sh\nx\n```\n\n## X",
		);
	});

	test("leaves a section's first paragraph alone when there is no tagline", () => {
		const md = "# T\n\n## What it is\n\nReal prose here.";
		expect(stripLeadParagraph(md, "fb")).toBe(md);
	});
});

describe("stripBadgeBlock", () => {
	const badge =
		"[![CI](https://img.shields.io/github/actions/workflow/status/x)](https://x)";

	test("drops a three-line badge block", () => {
		const md = `# T\n\ntagline\n\n[![a](https://img.shields.io/a)](u)\n${badge}\n[![c](https://img.shields.io/c)](u)\n\n## What it is\n`;
		expect(stripBadgeBlock(md)).toBe("# T\n\ntagline\n\n\n## What it is\n");
	});

	test("is byte-identical with no badge line (Review Focus 3)", () => {
		const md =
			"# T\n\nThe first paragraph must survive.\n\n## What it is\n";
		expect(stripBadgeBlock(md)).toBe(md);
	});

	test("stops dropping at the first non-badge non-empty line", () => {
		const late = "[![late](https://img.shields.io/late)](u)";
		const md = `# T\n\n[![a](https://img.shields.io/a)](u)\n\nA paragraph.\n${late}\n`;
		expect(stripBadgeBlock(md)).toBe(`# T\n\n\nA paragraph.\n${late}\n`);
	});
});

describe("rewriteLinks", () => {
	const ctx: LinkContext = {
		repoUrl: "https://github.com/JeffreyJYZ/cmdcode-tools",
		ref: "main",
		projectPath: "cmduse",
		projectByPath: {},
	};

	test("leaves absolute links untouched (Review Focus 2)", () => {
		expect(rewriteLinks("[x](https://a.b/c)", ctx)).toBe(
			"[x](https://a.b/c)",
		);
	});

	test("leaves bare anchors untouched (Review Focus 2)", () => {
		expect(rewriteLinks("[y](#anchor)", ctx)).toBe("[y](#anchor)");
	});

	test("rewrites a relative file link to a GitHub blob URL", () => {
		expect(rewriteLinks("[LICENSE](LICENSE-MIT)", ctx)).toBe(
			"[LICENSE](https://github.com/JeffreyJYZ/cmdcode-tools/blob/main/cmduse/LICENSE-MIT)",
		);
	});

	test("rewrites a cross-project README link to its docs route", () => {
		const cross: LinkContext = {
			...ctx,
			projectByPath: { "oc-cmd-compare": "mpc" },
		};
		expect(rewriteLinks("[MPC](../oc-cmd-compare/README.md)", cross)).toBe(
			"[MPC](/docs/mpc)",
		);
	});
});
