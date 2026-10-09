import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
	title: "Page not found",
};

export default function NotFound() {
	return (
		<div className="mx-auto flex max-w-[var(--prose-max)] flex-col gap-6">
			<p className="ink-muted text-xs uppercase tracking-widest">404</p>
			<h1>Page not found</h1>
			<p className="ink-muted max-w-[var(--prose-max)]">
				That page does not exist. It may have moved, or the link that
				brought you here may be out of date.
			</p>
			<div className="flex flex-wrap gap-x-6 gap-y-2">
				<Link href="/" className="no-underline">
					Back home
				</Link>
				<Link href="/docs" className="no-underline">
					Browse the docs
				</Link>
			</div>
		</div>
	);
}
