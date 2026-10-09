import { projects } from "@/content/projects";

const SOURCE_URL = "https://github.com/JeffreyJYZ/cmdcode-tools";

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
					Documentation for the cmdcode-tools packages
				</p>
				<a
					href={SOURCE_URL}
					target="_blank"
					rel="noreferrer"
					className="ink-muted mono text-xs no-underline"
				>
					github.com/JeffreyJYZ/cmdcode-tools
				</a>
			</div>
		</footer>
	);
}
