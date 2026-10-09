// Single source of truth for the docs the site renders.
// Each entry maps a package in the repo root to its README and public links.
// The README is the canonical docs page: the site reads the file at
// `<repoRoot>/<repoPath>/README.md` and derives the title/description from it.

export type Project = {
	slug: string;
	name: string;
	tagline: string;
	kind: "crate" | "npm-plugin" | "npm-cli";
	repoPath: string; // dir under repo root holding README.md
	links: { github: string; npm?: string; crates?: string; source: string };
	order: number;
};

const REPO = "https://github.com/JeffreyJYZ/cmdcode-tools";

const githubTree = (repoPath: string) => `${REPO}/tree/main/${repoPath}`;

export const projects: Project[] = [
	{
		slug: "cmduse",
		name: "cmduse",
		tagline: "Live Command Code usage dashboard for your terminal.",
		kind: "crate",
		repoPath: "cmduse",
		links: {
			github: githubTree("cmduse"),
			crates: "https://crates.io/crates/cmd-usage",
			source: REPO,
		},
		order: 0,
	},
	{
		slug: "mpc",
		name: "mpc",
		tagline:
			"Compare what the same model actually costs you on OpenCode Go vs CommandCode, using one fixed per-request workload.",
		kind: "npm-cli",
		repoPath: "oc-cmd-compare",
		links: {
			github: githubTree("oc-cmd-compare"),
			npm: "https://www.npmjs.com/package/@jeffreyjyz/mpc",
			source: REPO,
		},
		order: 1,
	},
	{
		slug: "reqshape",
		name: "reqshape",
		tagline:
			"Measure the shape of your requests from opencode's own history, then price that shape against any model.",
		kind: "npm-cli",
		repoPath: "reqshape",
		links: {
			github: githubTree("reqshape"),
			npm: "https://www.npmjs.com/package/@jeffreyjyz/reqshape",
			source: REPO,
		},
		order: 2,
	},
	{
		slug: "opencode-context",
		name: "@jeffreyjyz/opencode-context",
		tagline:
			"Context-window breakdown for opencode: where the window went, with a stacked bar and a measured used / limit header.",
		kind: "npm-plugin",
		repoPath: "opencode-context",
		links: {
			github: githubTree("opencode-context"),
			npm: "https://www.npmjs.com/package/@jeffreyjyz/opencode-context",
			source: REPO,
		},
		order: 3,
	},
	{
		slug: "opencode-shell-rc",
		name: "@jeffreyjyz/opencode-shell-rc",
		tagline:
			"Make the opencode agent shell load your zsh aliases and functions.",
		kind: "npm-plugin",
		repoPath: "opencode-shell-rc",
		links: {
			github: githubTree("opencode-shell-rc"),
			npm: "https://www.npmjs.com/package/@jeffreyjyz/opencode-shell-rc",
			source: REPO,
		},
		order: 4,
	},
	{
		slug: "opencode-session-dir",
		name: "@jeffreyjyz/opencode-session-dir",
		tagline:
			"Bind extra working directories to one opencode session — durably, across restarts. Other sessions never see them.",
		kind: "npm-plugin",
		repoPath: "opencode-session-dir",
		links: {
			github: githubTree("opencode-session-dir"),
			npm: "https://www.npmjs.com/package/@jeffreyjyz/opencode-session-dir",
			source: REPO,
		},
		order: 5,
	},
];

export function projectBySlug(slug: string): Project | undefined {
	return projects.find((p) => p.slug === slug);
}
