import localFont from "next/font/local";

// Self-hosted Satoshi (variable). Mono is the system stack, declared in
// `src/ui/styles/variables.css` — never self-host a system font.
export const sans = localFont({
	src: [
		{
			path: "../../public/fonts/satoshi/Satoshi-Variable.woff2",
			weight: "300 900",
			style: "normal",
		},
		{
			path: "../../public/fonts/satoshi/Satoshi-VariableItalic.woff2",
			weight: "300 900",
			style: "italic",
		},
	],
	variable: "--font-sans",
	display: "swap",
});
