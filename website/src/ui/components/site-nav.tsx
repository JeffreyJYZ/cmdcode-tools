import Link from "next/link";

const NAV_LINKS = [
	{ href: "/", label: "Home" },
	{ href: "/docs", label: "Docs" },
	{ href: "/guides", label: "Guides" },
	{ href: "/compare", label: "Compare" },
	{ href: "/changelog", label: "Changelog" },
] as const;

export function SiteNav() {
	return (
		<header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-b-[var(--hairline)] py-6">
			<Link href="/" className="ink-fg text-sm font-bold no-underline">
				cmdcode-tools
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
