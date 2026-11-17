export const LEGEND: [string, string][] = [
	["rates", "token price per 1M tokens, in/out/cache"],
	["allow", "monthly credits this plan gives the model"],
	["5h wk mo", "requests the rolling 5-hour / weekly / monthly window buys"],
	["$/1K", "your cost per 1,000 requests, at the plan's price"],
	["req/$", "requests one dollar of subscription buys"],
	["DEAL", "active CommandCode promotion: -98%, Free, 2x usage (expiry line is in --json)"],
	["WIN", "cheaper side: OC / CC / OD / tie · 'x only' = only that plan has it"],
	["ability", "benchmark score for the model (source above)"],
	["tps", "output tokens per second (source above)"],
	["COST", "0-100 volume index: requests/mo, lower is better (no ability)"],
	[
		"VAL",
		"0-100 ability-aware value: ability + speed + volume + cache + output · a free row wins volume only, so it can post COST 0 and a mid VAL",
	],
	[
		"OD",
		"OpenDesign allowance = plan credits ÷ the model's multiplier · OD 5h is dash on Plus and up, which have no 5-hour window",
	],
];

export const COLUMN_HELP = `Available columns (--columns a,b,c):
  model            model name
  oc-rates         OpenCode in/out/cache token rates ($/M)
  oc-allow         OpenCode monthly allowance for the model
  oc-req5h         requests the OpenCode 5-hour window allows
  oc-reqwk         requests the OpenCode weekly window allows
  oc-reqmo         requests the OpenCode monthly allowance buys
  oc-per1k         OpenCode cost per 1,000 requests
  oc-reqdollar     OpenCode requests per $1 of subscription
  cc-*             the same set for the CommandCode plan
  od-*             the same set for the OpenDesign plan (only with --od-plan)
  ability          benchmark score for the model
  tps              output tokens per second
  deal             active CommandCode promotion (-98%, Free, 2x usage)
  win              side with the lower per-request cost
  cost             0-100 cost index, lower is better
  val              0-100 ability-aware value score

Presets: default   = every column, trimmed to the terminal width (--no-fit keeps them all)
         --minimal = model + req/mo per side + win + val
         --medium  = allowance and the rate views per side + win + cost + val
         --detail  = every column, untrimmed (for copy/paste or agents)
         --columns = an exact list; bypasses presets and trimming
--od-plan adds the OpenDesign columns to a preset; an exact --columns list is left alone.`;
