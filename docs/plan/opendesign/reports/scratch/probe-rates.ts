// Throwaway arithmetic probe for the pre-release review. Not part of the build.
const root = "/Users/jyz/dev/cmdcode-tools";
const od = JSON.parse(await Bun.file(`${root}/core/od.json`).text());
const f = od.models.find((m) => m.id === "deepseek-v4.1-flash");
const list = (1e6 * f.input + 1e6 * f.output + 1e6 * f.cacheRead) / 1e6;
console.log("flash 1M/1M/1M list $", list.toFixed(4), "credits $", (list * f.multiplier).toFixed(4));
console.log("expected list 1.5060 = 0.3 + 1.2 + 0.006; credits 0.7530");
const lc = od.models.find((m) => m.id === "gpt-6-luna");
console.log("gpt-6-luna longContext:", JSON.stringify(lc.longContext));
