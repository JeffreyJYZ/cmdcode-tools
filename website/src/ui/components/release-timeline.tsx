import {
	buildTimeline,
	formatDate,
	groupTimeline,
	type ReleasesSnapshot,
	sourceLabel,
} from "@/lib/releases";

/** `@scope/pkg` -> a DOM-safe anchor fragment. */
function anchorId(pkg: string): string {
	return `changelog-${pkg.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

/**
 * The `/changelog` timeline: every release/registry entry, grouped by package,
 * newest first. A server component — the snapshot is read statically at build
 * time, nothing is fetched at runtime.
 *
 * Release notes come from GitHub and are rendered as **plain text** (React
 * escapes them); no `dangerouslySetInnerHTML`, no raw-HTML path.
 */
export function ReleaseTimeline({ snapshot }: { snapshot: ReleasesSnapshot }) {
	const groups = groupTimeline(buildTimeline(snapshot));

	if (groups.length === 0) {
		return (
			<p className="ink-muted mt-8 text-sm">
				No releases recorded in the snapshot.
			</p>
		);
	}

	return (
		<div className="mt-10 flex flex-col gap-6">
			{groups.map((group) => {
				const source = sourceLabel(group.entries[0].url);
				const headingId = anchorId(group.package);
				return (
					<section
						key={group.package}
						aria-labelledby={headingId}
						className="sep rounded-lg p-5"
					>
						<header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
							<h2
								id={headingId}
								className="mono ink-fg text-sm font-semibold"
							>
								{group.package}
							</h2>
							<span className="mono ink-muted text-xs uppercase tracking-widest">
								{source} · {group.entries.length}{" "}
								{group.entries.length === 1
									? "release"
									: "releases"}
							</span>
						</header>

						<ol className="mt-5 flex flex-col">
							{group.entries.map((entry) => (
								<li
									key={`${entry.version}@${entry.date}`}
									className="group flex gap-4"
								>
									<div
										className="flex shrink-0 flex-col items-center pt-1.5"
										aria-hidden
									>
										<span className="size-2 rounded-full bg-[var(--accent)]" />
										<span className="mt-1 w-px flex-1 bg-[var(--hairline)] group-last:hidden" />
									</div>

									<div className="flex flex-1 flex-col gap-1 pb-5 group-last:pb-0">
										<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
											<span className="mono ink-fg text-sm">
												{entry.version}
											</span>
											<time
												className="ink-muted text-xs"
												dateTime={entry.date}
											>
												{formatDate(entry.date)}
											</time>
											<a
												href={entry.url}
												target="_blank"
												rel="noreferrer"
												className="mono text-xs no-underline hover:underline"
											>
												{sourceLabel(entry.url)} ↗
											</a>
										</div>
										{entry.notes && (
											<p className="ink-muted text-xs leading-relaxed whitespace-pre-wrap">
												{entry.notes}
											</p>
										)}
									</div>
								</li>
							))}
						</ol>
					</section>
				);
			})}
		</div>
	);
}
