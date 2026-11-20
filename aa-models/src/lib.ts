/**
 * The library entry: the catalogue loader and the types its result carries.
 * Nothing here is CLI code, so importing this module reads no `process.argv`
 * and prints nothing.
 */
export { loadCatalogue } from "./sources/index.ts";
export type { Catalogue, LoadOptions } from "./sources/index.ts";
export type { Model } from "./model.ts";
