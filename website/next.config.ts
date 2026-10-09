import type { NextConfig } from "next";

const nextConfig: NextConfig = {
	reactCompiler: true,
	output: "export",
	// next-mdx-remote ships untranspiled ESM; Turbopack needs it in the
	// transpile list (its own README documents this).
	transpilePackages: ["next-mdx-remote"],
	images: {
		unoptimized: true,
	},
};

export default nextConfig;
