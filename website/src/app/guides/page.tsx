import type { Metadata } from "next";
import Link from "next/link";
import { listGuides } from "@/lib/guides";

export const metadata: Metadata = {
	title: "Guides",
	description:
		"Task-oriented walkthroughs for wiring the cmdcode-tools together.",
};

export default function GuidesIndex() {
	const guides = listGuides();

	return (
		<div className="mx-auto max-w-[var(--prose-max)]">
			<h1>Guides</h1>
			<p className="ink-muted mt-4">
				Task-oriented walkthroughs. Each one links to the underlying
				package&rsquo;s docs page for the full reference.
			</p>
			<ul className="mt-10 flex flex-col divide-y divide-[var(--hairline)] border-y border-y-[var(--hairline)]">
				{guides.map((guide) => (
					<li key={guide.slug} className="py-5">
						<Link
							href={`/guides/${guide.slug}`}
							className="ink-fg no-underline"
						>
							<span className="text-lg font-semibold">
								{guide.title}
							</span>
						</Link>
						<p className="ink-muted mt-1 text-sm">
							{guide.description}
						</p>
					</li>
				))}
			</ul>
		</div>
	);
}
