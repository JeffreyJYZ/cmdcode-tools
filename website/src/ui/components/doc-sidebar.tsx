"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Project } from "@/content/projects";
import type { TocEntry } from "@/lib/toc";
import { Search } from "@/ui/components/search";

/**
 * Scrollspy: observe every rendered heading id and mark the topmost one that is
 * in view. The negative bottom root margin biases the reading line toward the
 * top of the viewport, so the section under the reading position wins.
 */
function useActiveHeading(ids: string[]): string {
	const key = ids.join("\u0000");
	const [active, setActive] = useState("");

	useEffect(() => {
		const list = key ? key.split("\u0000") : [];
		const els = list
			.map((id) => document.getElementById(id))
			.filter((el): el is HTMLElement => el !== null);
		if (els.length === 0) return;

		const observer = new IntersectionObserver(
			(entries) => {
				const shown = entries
					.filter((entry) => entry.isIntersecting)
					.sort(
						(a, b) =>
							a.boundingClientRect.top - b.boundingClientRect.top,
					);
				if (shown[0]) setActive(shown[0].target.id);
			},
			{ rootMargin: "0px 0px -70% 0px", threshold: 0 },
		);
		for (const el of els) observer.observe(el);
		return () => observer.disconnect();
	}, [key]);

	return active;
}

function SectionLink({ entry, active }: { entry: TocEntry; active: boolean }) {
	return (
		<li className={entry.depth === 3 ? "pl-4" : undefined}>
			<a
				href={`#${entry.id}`}
				className={`block py-0.5 text-sm no-underline ${
					active
						? "text-[var(--accent)]"
						: "ink-muted hover:text-[var(--fg)]"
				}`}
			>
				{entry.text}
			</a>
		</li>
	);
}

/**
 * Docs navigation: every project in the manifest; the active one expands to its
 * H2/H3 sections as anchor links, with H3 nested under its H2.
 */
export function DocSidebar({
	projects,
	activeSlug,
	toc,
}: {
	projects: Project[];
	activeSlug: string;
	toc: TocEntry[];
}) {
	const activeId = useActiveHeading(toc.map((entry) => entry.id));

	return (
		<nav
			aria-label="Docs"
			className="w-full shrink-0 lg:sticky lg:top-8 lg:h-fit lg:w-64"
		>
			<Search />
			<ul className="flex flex-col gap-1">
				{projects.map((project) => {
					const isActive = project.slug === activeSlug;
					return (
						<li key={project.slug}>
							<Link
								href={`/docs/${project.slug}`}
								aria-current={isActive ? "page" : undefined}
								className={`block py-1 text-sm no-underline ${
									isActive
										? "ink-fg font-semibold"
										: "ink-muted hover:text-[var(--fg)]"
								}`}
							>
								{project.name}
							</Link>
							{isActive && toc.length > 0 && (
								<ul className="mt-1 flex flex-col border-l border-l-[var(--hairline)] pl-3">
									{toc.map((entry) => (
										<SectionLink
											key={entry.id}
											entry={entry}
											active={entry.id === activeId}
										/>
									))}
								</ul>
							)}
						</li>
					);
				})}
			</ul>
		</nav>
	);
}
