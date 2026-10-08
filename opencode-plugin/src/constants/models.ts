// Per-model defaults shared by the v1 and v2 halves and the provider wire.

/** Every Command Code model shares these capabilities; hoisted so each record
 * does not rebuild them. Vision (`attachment` + `input.image`) is applied per
 * model from the generated catalog in the two model builders. */
export const MODEL_CAPABILITIES = {
	temperature: true,
	reasoning: true,
	attachment: false,
	toolcall: true,
	input: { text: true, audio: false, image: false, video: false, pdf: false },
	output: {
		text: true,
		audio: false,
		image: false,
		video: false,
		pdf: false,
	},
};

/** Context window advertised when the listing API gives no length. */
export const DEFAULT_CONTEXT_LENGTH = 128_000;

/** Max output tokens advertised per model. */
export const DEFAULT_OUTPUT_TOKENS = 32_000;

/** Provider wire ceiling for a request's max tokens. */
export const DEFAULT_MAX_TOKENS = 64_000;
