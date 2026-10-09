import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { projects } from "@/content/projects";

const REQUIRED = ["## What it is", "## Install", "## Links"];

for (const p of projects) {
	const md = readFileSync(
		new URL(`../../${p.repoPath}/README.md`, import.meta.url),
		"utf8",
	);
	test(`${p.slug}: README follows the docs skeleton`, () => {
		const lines = md.split("\n");
		const nonEmpty = lines.filter((l) => l.trim() !== "");
		expect(nonEmpty[0]).toMatch(/^# \S/);
		expect(
			nonEmpty
				.slice(0, 6)
				.some((l) => l.includes("[![") && l.includes("img.shields.io")),
		).toBe(true);
		for (const h of REQUIRED) expect(md).toContain(`\n${h}`);
		expect(md).toMatch(/\n## (Usage|Commands)\b/);
		let inFence = false;
		for (const line of lines) {
			if (line.startsWith("```")) {
				if (!inFence) expect(line).toMatch(/^```\S/);
				inFence = !inFence;
			}
		}
		expect(inFence).toBe(false);
	});
}
