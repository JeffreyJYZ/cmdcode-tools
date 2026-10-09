import type { Metadata } from "next";
import Link from "next/link";
import { projects } from "@/content/projects";
import { SITE_NAME } from "@/lib/consts";

export const metadata: Metadata = {
	title: "Docs",
	description: `READMEs for every ${SITE_NAME} package, rendered as docs.`,
};

export default function DocsIndex() {
	return (
		<div className="mx-auto max-w-[var(--prose-max)]">
			<h1>Docs</h1>
			<p className="ink-muted mt-4">
				Each package&rsquo;s README is the canonical docs page. Pick one
				to read it here.
			</p>
			<ul className="mt-10 flex flex-col divide-y divide-[var(--hairline)] border-y border-y-[var(--hairline)]">
				{projects.map((project) => (
					<li key={project.slug} className="py-5">
						<Link
							href={`/docs/${project.slug}`}
							className="ink-fg no-underline"
						>
							<span className="text-lg font-semibold">
								{project.name}
							</span>
						</Link>
						<p className="ink-muted mt-1 text-sm">
							{project.tagline}
						</p>
					</li>
				))}
			</ul>
		</div>
	);
}
