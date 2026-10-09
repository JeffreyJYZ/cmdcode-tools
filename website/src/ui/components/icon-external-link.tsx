type Props = { className?: string };

export function IconExternalLink({ className }: Props) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			strokeLinejoin="round"
			role="img"
			className={className}
		>
			<title>External link</title>
			<path d="M7 17 17 7" />
			<path d="M7 7h10v10" />
		</svg>
	);
}
