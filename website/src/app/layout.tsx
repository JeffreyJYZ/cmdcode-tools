import type { Metadata } from "next";
import "./globals.css";

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
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
