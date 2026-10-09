import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MDXRemote } from "next-mdx-remote/rsc";
import { listGuides, loadGuide } from "@/lib/guides";
import { mdxOptions } from "@/lib/mdx-options";
import { mdxComponents } from "@/ui/components/mdx-components";

type Params = { slug: string };

export function generateStaticParams(): Params[] {
	return listGuides().map((guide) => ({ slug: guide.slug }));
}

export async function generateMetadata({
	params,
}: {
	params: Promise<Params>;
}): Promise<Metadata> {
	const guide = loadGuide((await params).slug);
	if (!guide) return {};
	return { title: guide.title, description: guide.description };
}

export default async function GuidePage({
	params,
}: {
	params: Promise<Params>;
}) {
	const guide = loadGuide((await params).slug);
	if (!guide) notFound();

	return (
		<article className="docs-prose mx-auto max-w-[var(--prose-max)]">
			<header className="mb-10">
				<h1>{guide.title}</h1>
				<p className="ink-muted mt-3">{guide.description}</p>
			</header>
			<MDXRemote
				source={guide.body}
				components={mdxComponents}
				options={{ mdxOptions }}
			/>
		</article>
	);
}
