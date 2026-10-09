"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Client-side Pagefind search for the docs sidebar.
 *
 * The index is produced by `pagefind --site out` (the `postbuild` script) and
 * lives at `/pagefind/`, so it does not exist during `next dev` or before a
 * build. This component therefore probes for the index at runtime and stays
 * hidden when it is absent, instead of erroring.
 *
 * The Default UI is loaded as a plain script from the generated bundle (a
 * static import would fail at build time — the files are written after
 * `next build`), then instantiated into a container React never reconciles.
 */

/** Bundle directory emitted by `pagefind --site out`; served from the site root. */
const PAGEFIND_DIR = "/pagefind";
const UI_SCRIPT = `${PAGEFIND_DIR}/pagefind-ui.js`;
const UI_STYLE = `${PAGEFIND_DIR}/pagefind-ui.css`;
const INDEX_MARKER = `${PAGEFIND_DIR}/pagefind-entry.json`;

type SearchState = "loading" | "ready" | "absent";

type PagefindResult = {
	url: string;
	meta?: { url?: string };
};

declare global {
	interface Window {
		PagefindUI?: new (options: {
			element: HTMLElement;
			bundlePath: string;
			showSubResults?: boolean;
			showImages?: boolean;
			processResult?: (result: PagefindResult) => PagefindResult;
		}) => unknown;
	}
}

/**
 * Pagefind indexes the exported `.html` files, but the site routes are
 * extensionless (`output: "export"` clean URLs). Rewrite result links to the
 * canonical path so they work on hosts that do not auto-serve `x.html`.
 */
function cleanUrl(url: string): string {
	if (url.endsWith("/index.html")) return url.slice(0, -"index.html".length);
	if (url.endsWith(".html")) return url.slice(0, -".html".length);
	return url;
}

/** True when the generated index is actually being served. */
async function indexAvailable(): Promise<boolean> {
	try {
		const response = await fetch(INDEX_MARKER, { cache: "no-store" });
		return response.ok;
	} catch {
		return false;
	}
}

/** Inject the bundle's stylesheet once. */
function loadStyle(): void {
	if (document.querySelector("link[data-pagefind-ui]")) return;
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = UI_STYLE;
	link.dataset.pagefindUi = "";
	document.head.appendChild(link);
}

/** Inject the bundle's UI script once and resolve when `PagefindUI` exists. */
function loadScript(): Promise<void> {
	return new Promise((resolve, reject) => {
		if (window.PagefindUI) {
			resolve();
			return;
		}
		const existing = document.querySelector<HTMLScriptElement>(
			"script[data-pagefind-ui]",
		);
		const script = existing ?? document.createElement("script");
		script.addEventListener("load", () => resolve());
		script.addEventListener("error", () =>
			reject(new Error("Failed to load Pagefind UI")),
		);
		if (!existing) {
			script.src = UI_SCRIPT;
			script.async = true;
			script.dataset.pagefindUi = "";
			document.head.appendChild(script);
		}
	});
}

export function Search() {
	const container = useRef<HTMLDivElement>(null);
	const [state, setState] = useState<SearchState>("loading");

	useEffect(() => {
		let cancelled = false;

		(async () => {
			if (!(await indexAvailable())) {
				if (!cancelled) setState("absent");
				return;
			}

			try {
				loadStyle();
				await loadScript();
			} catch {
				if (!cancelled) setState("absent");
				return;
			}

			if (cancelled || !container.current || !window.PagefindUI) return;

			new window.PagefindUI({
				element: container.current,
				bundlePath: `${PAGEFIND_DIR}/`,
				showSubResults: false,
				showImages: false,
				processResult: (result) => {
					result.url = cleanUrl(result.url);
					if (result.meta?.url)
						result.meta.url = cleanUrl(result.meta.url);
					return result;
				},
			});
			setState("ready");
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div
			ref={container}
			className="doc-search"
			data-state={state}
			hidden={state !== "ready"}
		/>
	);
}
