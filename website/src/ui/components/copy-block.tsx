"use client";

import { useState } from "react";
import { IconCheck } from "@/ui/components/icon-check";
import { IconCopy } from "@/ui/components/icon-copy";

/**
 * Bordered mono button that copies `value` to the clipboard and swaps the
 * copy icon for a check for ~1.2s. Same pattern as the vobes site's
 * `CopyBlock`, restyled on the site's design tokens.
 */
export function CopyBlock({ value }: { value: string }) {
	const [copied, setCopied] = useState(false);

	const copy = async () => {
		try {
			// A denied write (no clipboard permission, unfocused doc) rejects;
			// the check feedback is only meaningful once the text really copied.
			await navigator.clipboard?.writeText(value);
		} catch {
			return;
		}
		setCopied(true);
		setTimeout(() => setCopied(false), 1200);
	};

	return (
		<button
			type="button"
			onClick={copy}
			aria-label={`Copy: ${value}`}
			className="group flex w-full items-center justify-between gap-3 rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2 text-left text-sm transition-colors hover:border-[var(--accent)] sm:w-auto"
		>
			<span className="mono ink-fg">{value}</span>
			<span className="ink-muted shrink-0 transition-colors group-hover:text-[var(--fg)]">
				{copied ? (
					<IconCheck className="size-4" />
				) : (
					<IconCopy className="size-4" />
				)}
			</span>
		</button>
	);
}
