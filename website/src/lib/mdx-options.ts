import type { MDXRemoteProps } from "next-mdx-remote/rsc";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

/**
 * Shared remark/rehype pipeline for every MDX render (README docs + guides).
 *
 * One source so `/docs/[project]` and `/guides/[slug]` cannot silently diverge
 * in heading anchors or code theme. Consumed as
 * `<MDXRemote options={{ mdxOptions }} />`.
 */
export const mdxOptions: NonNullable<
	NonNullable<MDXRemoteProps["options"]>["mdxOptions"]
> = {
	remarkPlugins: [remarkGfm],
	rehypePlugins: [
		rehypeSlug,
		[
			rehypeAutolinkHeadings,
			{
				behavior: "append",
				properties: {
					className: ["heading-anchor"],
					ariaHidden: true,
					tabIndex: -1,
				},
				content: { type: "text", value: "#" },
			},
		],
		[rehypePrettyCode, { theme: "github-dark-default" }],
	],
};
