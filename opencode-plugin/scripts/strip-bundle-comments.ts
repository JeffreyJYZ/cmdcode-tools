// bun build writes a `// <module path>` comment above every inlined module, and
// that path depends on how node_modules was installed: a bun workspace shows
// `// node_modules/zod/v4/core/core.js`, CI's npm install shows
// `// ../node_modules/.bun/zod@4.1.8/node_modules/zod/v4/core/core.js`. The code
// is byte-identical, but `verify-release.ts` hashes the tarball, so a healthy
// publish read as "served bytes do not match the local pack — do not install".
//
// Stripping the comments makes the bundle a function of its source alone, and
// they carry no runtime meaning beyond leaking an install path.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist", import.meta.url).pathname;
const BUNDLE_PATH_COMMENT = /^\/\/ .*node_modules\/.*$/gm;

let stripped = 0;
for (const name of readdirSync(dist)) {
	if (!name.endsWith(".js")) continue;
	const path = join(dist, name);
	if (!statSync(path).isFile()) continue;
	const text = readFileSync(path, "utf8");
	const next = text.replace(BUNDLE_PATH_COMMENT, "");
	if (next === text) continue;
	writeFileSync(path, next);
	stripped += 1;
}
console.log(`stripped bundle path comments in ${stripped} file(s)`);
