import { projects } from "@/content/projects";
import {
	NPM_ORG_URL,
	RELEASES_PAGE_URL,
	REPO_URL,
	SITE_NAME,
} from "@/lib/consts";

const ELSEWHERE_LINKS = [
	{ href: REPO_URL, label: "GitHub" },
	{ href: NPM_ORG_URL, label: "npm" },
	{ href: RELEASES_PAGE_URL, label: "Releases" },
] as const;

export function SiteFooter() {
	return (
		<footer className="flex flex-col gap-4 border-t border-t-[var(--hairline)] py-8">
			<nav
				aria-label="Projects"
				className="flex flex-wrap gap-x-6 gap-y-2 text-sm"
			>
				{projects.map((project) => (
					<a
						key={project.slug}
						href={project.links.github}
						target="_blank"
						rel="noreferrer"
						className="ink-muted no-underline"
					>
						{project.name}
					</a>
				))}
			</nav>
			<div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
				<p className="ink-muted text-xs uppercase tracking-widest">
					Documentation for the {SITE_NAME} packages
				</p>
				<nav
					aria-label="Elsewhere"
					className="flex flex-wrap gap-x-6 gap-y-2"
				>
					{ELSEWHERE_LINKS.map((link) => (
						<a
							key={link.label}
							href={link.href}
							target="_blank"
							rel="noreferrer"
							className="ink-muted mono text-xs no-underline"
						>
							{link.label}
						</a>
					))}
				</nav>
			</div>
		</footer>
	);
}
