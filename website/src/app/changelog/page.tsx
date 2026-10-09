import type { Metadata } from "next";
import snapshotJson from "@/data/releases.json";
import type { ReleasesSnapshot } from "@/lib/releases";
import { ReleaseTimeline } from "@/ui/components/release-timeline";

export const metadata: Metadata = {
	title: "Changelog",
	description:
		"Every cmdcode-tools release, from the GitHub Releases API, npm and crates.io — captured as a build-time snapshot.",
};

// The snapshot is committed and regenerated with `bun snapshot:releases`; the
// page never fetches the registries itself (Vercel will not do it at request
// time, and the page is static).
const snapshot = snapshotJson as ReleasesSnapshot;

function formatGeneratedAt(iso: string): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	const formatted = new Intl.DateTimeFormat("en-US", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "UTC",
	}).format(date);
	return `${formatted} UTC`;
}

export default function ChangelogPage() {
	return (
		<div>
			<div className="max-w-[var(--prose-max)]">
				<h1>Changelog</h1>
				<p className="ink-muted mt-4">
					Every published release of these packages — GitHub Releases,
					npm versions and crates.io versions — newest first, grouped
					by package. Captured at build time from public registries;
					the page makes no request of its own.
				</p>
			</div>

			<ReleaseTimeline snapshot={snapshot} />

			<p className="ink-muted mt-6 text-xs">
				Data as of{" "}
				<time dateTime={snapshot.generatedAt}>
					{formatGeneratedAt(snapshot.generatedAt)}
				</time>
				. Regenerate with{" "}
				<code className="mono">bun snapshot:releases</code>.
			</p>
		</div>
	);
}
