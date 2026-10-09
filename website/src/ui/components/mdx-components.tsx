import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";
import { CodeBlock } from "@/ui/components/code-block";

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function isExternal(href: string): boolean {
	return SCHEME_RE.test(href) || href.startsWith("//");
}

function Anchor({
	href = "",
	children,
	...rest
}: ComponentPropsWithoutRef<"a">) {
	if (href.startsWith("#")) {
		return (
			<a href={href} {...rest}>
				{children}
			</a>
		);
	}
	if (isExternal(href)) {
		return (
			<a href={href} target="_blank" rel="noreferrer" {...rest}>
				{children}
			</a>
		);
	}
	return (
		<Link href={href} {...rest}>
			{children}
		</Link>
	);
}

/**
 * MDX component map for the docs pages.
 *
 * Headings keep the `id` `rehype-slug` assigns (the sidebar anchors target it);
 * `rehype-autolink-headings` appends a `#` anchor into each heading, which
 * renders through `Anchor` and gets the `.heading-anchor` class from the plugin
 * properties. Tables get a scroll wrapper; `pre` renders through the client
 * `CodeBlock` for its copy button; inline `code` is styled by `prose.css`.
 */
export const mdxComponents = {
	a: Anchor,
	h2: ({ children, ...rest }: ComponentPropsWithoutRef<"h2">) => (
		<h2 {...rest}>{children}</h2>
	),
	h3: ({ children, ...rest }: ComponentPropsWithoutRef<"h3">) => (
		<h3 {...rest}>{children}</h3>
	),
	table: ({ children, ...rest }: ComponentPropsWithoutRef<"table">) => (
		<div className="table-wrap">
			<table {...rest}>{children}</table>
		</div>
	),
	pre: CodeBlock,
};
