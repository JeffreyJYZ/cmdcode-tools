"use client";

import {
	type ComponentPropsWithoutRef,
	useCallback,
	useRef,
	useState,
} from "react";

/**
 * `pre` replacement for docs code blocks: a copy button over the highlighted
 * `<pre>`. The button reads the rendered text (shiki has already split it into
 * spans), so it copies plain source regardless of highlighting.
 */
export function CodeBlock({
	children,
	...props
}: ComponentPropsWithoutRef<"pre">) {
	const ref = useRef<HTMLPreElement>(null);
	const [copied, setCopied] = useState(false);

	const onCopy = useCallback(() => {
		const text = ref.current?.textContent ?? "";
		navigator.clipboard?.writeText(text).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 1500);
		});
	}, []);

	return (
		<div className="code-block">
			<button
				type="button"
				className="code-copy"
				onClick={onCopy}
				aria-label="Copy code"
			>
				{copied ? "Copied" : "Copy"}
			</button>
			<pre ref={ref} {...props}>
				{children}
			</pre>
		</div>
	);
}
