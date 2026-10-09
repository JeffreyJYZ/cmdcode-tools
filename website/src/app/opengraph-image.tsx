import { ImageResponse } from "next/og";
import { projects } from "@/content/projects";
import { SITE_NAME, SITE_URL } from "@/lib/consts";

export const alt = `Documentation for the ${SITE_NAME} packages`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
// `output: "export"` prerenders metadata routes; without this Next refuses to
// collect the OG image at build time.
export const dynamic = "force-static";

// satori (`next/og`) renders without a document, so it cannot read the CSS
// custom properties in `src/ui/styles/tokens.css`. The dark-theme token values
// are mirrored here; keep them in step with that file. Branding is dark-first,
// so the card is always dark regardless of the viewer's colour scheme.
const TOKENS = {
	bg: "#171717",
	fg: "#ffffff",
	muted: "#a3a3a3",
	hairline: "#404040",
	accent: "#add8e6",
};

export default function OpengraphImage() {
	const packageNames = projects
		.slice()
		.sort((a, b) => a.order - b.order)
		.map((project) => project.slug)
		.join("  ·  ");

	return new ImageResponse(
		<div
			style={{
				display: "flex",
				flexDirection: "column",
				justifyContent: "space-between",
				width: "100%",
				height: "100%",
				backgroundColor: TOKENS.bg,
				color: TOKENS.fg,
				padding: "80px",
				borderLeft: `1px solid ${TOKENS.hairline}`,
				borderRight: `1px solid ${TOKENS.hairline}`,
			}}
		>
			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "20px",
				}}
			>
				<div
					style={{
						fontSize: 26,
						letterSpacing: 8,
						textTransform: "uppercase",
						color: TOKENS.accent,
					}}
				>
					Docs
				</div>
				<div style={{ fontSize: 128, fontWeight: 700, lineHeight: 1 }}>
					{SITE_NAME}
				</div>
				<div
					style={{
						fontSize: 34,
						lineHeight: 1.35,
						color: TOKENS.muted,
						maxWidth: "900px",
					}}
				>
					Usage dashboards, model comparison, and opencode plugins —
					documented in one place.
				</div>
			</div>

			<div
				style={{
					display: "flex",
					flexDirection: "column",
					gap: "16px",
				}}
			>
				<div
					style={{
						display: "flex",
						flexWrap: "wrap",
						fontSize: 28,
						color: TOKENS.fg,
					}}
				>
					{packageNames}
				</div>
				<div style={{ fontSize: 26, color: TOKENS.muted }}>
					{SITE_URL}
				</div>
			</div>
		</div>,
		size,
	);
}
