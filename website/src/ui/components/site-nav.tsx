import Link from "next/link";
import { NAV_LINKS, SITE_NAME } from "@/lib/consts";

export function SiteNav() {
	return (
		<header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-b-[var(--hairline)] py-6">
			<Link href="/" className="ink-fg text-sm font-bold no-underline">
				{SITE_NAME}
			</Link>
			<nav
				aria-label="Primary"
				className="flex flex-wrap gap-x-6 gap-y-2"
			>
				{NAV_LINKS.map((link) => (
					<Link
						key={link.href}
						href={link.href}
						className="ink-muted text-xs uppercase tracking-widest no-underline"
					>
						{link.label}
					</Link>
				))}
			</nav>
		</header>
	);
}
