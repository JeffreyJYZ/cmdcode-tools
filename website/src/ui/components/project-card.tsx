import Link from "next/link";
import type { Project } from "@/content/projects";
import { IconExternalLink } from "@/ui/components/icon-external-link";

const KIND_LABEL: Record<Project["kind"], string> = {
	crate: "crate",
	"npm-cli": "npm cli",
	"npm-plugin": "npm plugin",
};

const FOOTER_LINK =
	"inline-flex items-center gap-1 no-underline text-[var(--muted)] hover:text-[var(--accent)] transition-colors";

/**
 * One package in the landing-page grid. The name links to the package's
 * rendered README (`/docs/<slug>`); the footer carries its published
 * registry link(s) plus the GitHub tree.
 */
export function ProjectCard({ project }: { project: Project }) {
	return (
		<div className="flex flex-col gap-3 rounded-lg border border-[var(--hairline)] bg-[var(--surface)] p-5">
			<div className="flex items-start justify-between gap-4">
				<Link
					href={`/docs/${project.slug}`}
					className="ink-fg text-lg font-semibold no-underline"
				>
					{project.name}
				</Link>
				<span className="mono ink-muted shrink-0 text-[0.65rem] uppercase tracking-widest">
					{KIND_LABEL[project.kind]}
				</span>
			</div>
			<p className="ink-muted flex-1 text-sm">{project.tagline}</p>
			<div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
				<Link href={`/docs/${project.slug}`} className={FOOTER_LINK}>
					Docs
				</Link>
				{project.links.npm && (
					<a
						href={project.links.npm}
						target="_blank"
						rel="noreferrer"
						className={FOOTER_LINK}
					>
						npm
						<IconExternalLink className="size-3" />
					</a>
				)}
				{project.links.crates && (
					<a
						href={project.links.crates}
						target="_blank"
						rel="noreferrer"
						className={FOOTER_LINK}
					>
						crates
						<IconExternalLink className="size-3" />
					</a>
				)}
				<a
					href={project.links.github}
					target="_blank"
					rel="noreferrer"
					className={FOOTER_LINK}
				>
					GitHub
					<IconExternalLink className="size-3" />
				</a>
			</div>
		</div>
	);
}
