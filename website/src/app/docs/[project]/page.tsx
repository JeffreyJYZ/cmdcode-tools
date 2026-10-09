import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { projectBySlug, projects } from "@/content/projects";
import { loadProjectDoc } from "@/lib/load";
import { mdxOptions } from "@/lib/mdx-options";
import { DocSidebar } from "@/ui/components/doc-sidebar";
import { mdxComponents } from "@/ui/components/mdx-components";

type Params = { project: string };

export function generateStaticParams(): Params[] {
	return projects.map((project) => ({ project: project.slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<Params>;
}): Promise<Metadata> {
	const project = projectBySlug((await params).project);
	if (!project) return {};
	const doc = await loadProjectDoc(project);
	return { title: doc.title, description: doc.description };
}

export default async function ProjectDocPage({
	params,
}: {
	params: Promise<Params>;
}) {
	const project = projectBySlug((await params).project);
	if (!project) notFound();

	const doc = await loadProjectDoc(project);

	return (
		<div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
			<DocSidebar
				projects={projects}
				activeSlug={project.slug}
				toc={doc.toc}
			/>
			<article className="docs-prose min-w-0 max-w-[var(--prose-max)] flex-1">
				<header className="mb-10">
					<h1>{doc.title}</h1>
					<p className="ink-muted mt-3">{doc.description}</p>
				</header>
				<MDXRemote
					source={doc.body}
					components={mdxComponents}
					options={{ mdxOptions }}
				/>
			</article>
		</div>
	);
}
