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
import { SiteFooter } from "@/ui/components/site-footer";
import { SiteNav } from "@/ui/components/site-nav";
import { sans } from "@/ui/fonts";

export const metadata: Metadata = {
	title: "cmdcode-tools",
	description: "Documentation for the cmdcode-tools packages",
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
