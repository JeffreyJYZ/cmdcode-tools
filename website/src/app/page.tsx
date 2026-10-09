import type { Metadata } from "next";
import Link from "next/link";
import { projects } from "@/content/projects";
import { SITE_NAME } from "@/lib/consts";
import { CopyBlock } from "@/ui/components/copy-block";
import { ProjectCard } from "@/ui/components/project-card";

export const metadata: Metadata = {
	title: { absolute: SITE_NAME },
	description:
		"Personal tooling for opencode and Command Code — usage dashboards, model comparison, and plugins, kept in one repo.",
};

const INSTALL_COMMANDS = [
	"brew install JeffreyJYZ/tap/cmduse",
	"cargo install cmd-usage",
	"bun add -g @jeffreyjyz/mpc",
] as const;

const BROWSE_LINKS = [
	{
		href: "/docs",
		label: "Docs",
		blurb: "Every package README, rendered as a docs page.",
	},
	{
		href: "/guides",
		label: "Guides",
		blurb: "Task-oriented walkthroughs for wiring the tools together.",
	},
	{
		href: "/compare",
		label: "Compare",
		blurb: "Side-by-side pricing and capability comparisons.",
	},
	{
		href: "/changelog",
		label: "Changelog",
		blurb: "What changed, release by release.",
	},
] as const;

const SECTION_LABEL = "ink-muted text-xs uppercase tracking-widest";

export default function Home() {
	const ordered = [...projects].sort((a, b) => a.order - b.order);

	return (
		<div className="flex flex-col gap-16">
			<section>
				<h1>{SITE_NAME}</h1>
				<p className="ink-muted mt-4 max-w-[var(--prose-max)] text-lg">
					Personal tooling for opencode and Command Code — usage
					dashboards, model comparison, and plugins, kept in one repo.
				</p>
			</section>

			<section>
				<h2 className={SECTION_LABEL}>Install</h2>
				<div className="mt-5 flex flex-col gap-3 sm:items-start">
					{INSTALL_COMMANDS.map((command) => (
						<CopyBlock key={command} value={command} />
					))}
				</div>
				<p className="ink-muted mono mt-4 text-xs">
					cargo binstall cmd-usage also works (prebuilt from the
					release).
				</p>
			</section>

			<section>
				<h2 className={SECTION_LABEL}>Projects</h2>
				<div className="mt-5 grid gap-4 sm:grid-cols-2">
					{ordered.map((project) => (
						<ProjectCard key={project.slug} project={project} />
					))}
				</div>
			</section>

			<section>
				<h2 className={SECTION_LABEL}>Browse</h2>
				<div className="mt-5 grid gap-4 sm:grid-cols-2">
					{BROWSE_LINKS.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							className="flex flex-col gap-1 rounded-lg border border-[var(--hairline)] p-5 no-underline transition-colors hover:border-[var(--accent)]"
						>
							<span className="ink-fg font-semibold">
								{link.label}
							</span>
							<span className="ink-muted text-sm">
								{link.blurb}
							</span>
						</Link>
					))}
				</div>
			</section>
		</div>
	);
}
