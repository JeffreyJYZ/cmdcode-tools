import type { Metadata } from "next";
import "@/ui/styles/fonts.css";
import "@/ui/styles/font-classes.css";
import "@/ui/styles/tokens.css";
import "@/ui/styles/variables.css";
import "@/ui/styles/base.css";
import "@/ui/styles/utilities.css";
import "@/ui/styles/headings.css";
import "@/ui/styles/links.css";
import "./globals.css";
import "@/ui/styles/prose.css";
import { SITE_NAME, SITE_URL } from "@/lib/consts";
import { SiteFooter } from "@/ui/components/site-footer";
import { SiteNav } from "@/ui/components/site-nav";
import { sans } from "@/ui/fonts";

const DESCRIPTION = `Documentation for the ${SITE_NAME} packages — Command Code usage dashboards, model comparison, and opencode plugins.`;

export const metadata: Metadata = {
	// Absolute URLs for OG/canonical tags; every path in this metadata is
	// resolved against the deployment origin.
	metadataBase: new URL(SITE_URL),
	title: {
		default: SITE_NAME,
		template: `%s · ${SITE_NAME}`,
	},
	description: DESCRIPTION,
	// A committed PNG, not the `opengraph-image.tsx` convention: under
	// `output: "export"` that convention emits an extensionless file which a
	// static host serves as `application/octet-stream`, breaking social cards
	// (vercel/next.js#82177). A real asset keeps the `image/png` type.
	openGraph: {
		type: "website",
		siteName: SITE_NAME,
		description: DESCRIPTION,
		images: [
			{
				url: "/media/og.png",
				width: 1200,
				height: 630,
				type: "image/png",
				alt: `${SITE_NAME} — docs for the cmdcode-tools packages`,
			},
		],
	},
	twitter: {
		card: "summary_large_image",
		description: DESCRIPTION,
		images: [
			{
				url: "/media/og.png",
				width: 1200,
				height: 630,
				alt: `${SITE_NAME} — docs for the cmdcode-tools packages`,
			},
		],
	},
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" className={sans.variable}>
			<body className="min-h-screen">
				<div className="rail-frame mx-auto flex min-h-screen w-full max-w-[var(--page-max)] flex-col px-6 sm:px-8">
					<SiteNav />
					<main className="flex-1 py-12">{children}</main>
					<SiteFooter />
				</div>
			</body>
		</html>
	);
}
