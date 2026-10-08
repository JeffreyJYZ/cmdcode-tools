// Biome forbids control characters in regex literals, and a literal escape here
// would be one: build the pattern from a codepoint instead.
export const ESC = String.fromCharCode(27);
export const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
