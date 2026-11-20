// argv handling that the shared parser cannot do on its own: oduse's `model`
// takes a positional id, and a few run settings derive from flags plus config.
//
// `oduse` also refuses `--gated`: OpenDesign prices models differently per plan
// and never restricts which ones a plan may call, so a filter flag would invent a
// restriction the source does not have.
use crate::cli;
use crate::report_render::Fmt;
use std::ffi::OsString;

/// Flags whose value is the next argv token (mirrors the shared parser). Used
/// only to find `model <id>` before that parser runs.
const VALUE_FLAGS: &[&str] = &[
    "-i",
    "--interval",
    "-w",
    "--bar-width",
    "-b",
    "--bursts",
    "--days",
    "--last",
    "-l",
    "--since",
    "--hours",
    "--tz",
    "--db",
    "--plan",
    "--window",
    "--period-start",
    "--rows",
    "--cache",
];

/// `oduse model <id>` takes a plain positional the shared parser (written for
/// cmduse) rejects, so pull the id out first.
pub fn split_model_id(argv: Vec<OsString>) -> (Vec<OsString>, Option<String>) {
    let strs: Vec<String> = argv
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let mut drop_at = None;
    let mut skip_value = false;
    let mut after_model = false;
    for (i, tok) in strs.iter().enumerate() {
        if skip_value {
            skip_value = false;
            continue;
        }
        if tok.starts_with('-') {
            if VALUE_FLAGS.contains(&tok.as_str()) {
                skip_value = true;
            }
            continue;
        }
        if after_model {
            drop_at = Some(i);
            break;
        }
        after_model = tok == "model";
    }
    let id = drop_at.map(|i| strs[i].clone());
    let argv = argv
        .into_iter()
        .enumerate()
        .filter(|(i, _)| Some(*i) != drop_at)
        .map(|(_, a)| a)
        .collect();
    (argv, id)
}

/// `--session-cookie <path>` (or `--session-cookie=<path>`) is oduse-only, so it
/// is pulled out of argv before the shared parser sees it — the same seam
/// `split_model_id` uses. The value is a file path, never a cookie value: a
/// secret on the command line would be visible to every process on the machine.
pub fn split_session_cookie(argv: Vec<OsString>) -> (Vec<OsString>, Option<String>) {
    let mut rest = Vec::with_capacity(argv.len());
    let mut path = None;
    let mut args = argv.into_iter();
    while let Some(arg) = args.next() {
        let text = arg.to_string_lossy();
        if text == "--session-cookie" {
            match args.next() {
                Some(value) => path = Some(value.to_string_lossy().into_owned()),
                // Leave a bare flag for the shared parser to refuse.
                None => rest.push(arg),
            }
            continue;
        }
        if let Some(value) = text.strip_prefix("--session-cookie=") {
            path = Some(value.to_string());
            continue;
        }
        rest.push(arg);
    }
    (rest, path)
}

/// `--no-catalog` and `--cache <dur>` are oduse-only, so they are pulled out of
/// argv before the shared parser (which rejects flags it does not know) — the
/// same seam `split_model_id` uses. `--cache 0` disables the disk cache; a bare
/// unit-less number is seconds.
pub fn split_catalog_flags(
    argv: Vec<OsString>,
) -> Result<(Vec<OsString>, crate::oduse::catalogue::Settings), String> {
    use crate::oduse::catalogue::{Settings, TTL_SECS};
    let mut settings = Settings {
        no_catalog: false,
        cache_secs: TTL_SECS,
    };
    let mut rest = Vec::with_capacity(argv.len());
    let mut args = argv.into_iter();
    while let Some(arg) = args.next() {
        let text = arg.to_string_lossy();
        if text == "--no-catalog" {
            settings.no_catalog = true;
            continue;
        }
        let inline = text.strip_prefix("--cache=").map(str::to_string);
        if text == "--cache" {
            let Some(value) = args.next() else {
                return Err(cache_error());
            };
            settings.cache_secs =
                parse_duration(&value.to_string_lossy()).ok_or_else(cache_error)?;
            continue;
        }
        if let Some(value) = inline {
            settings.cache_secs = parse_duration(&value).ok_or_else(cache_error)?;
            continue;
        }
        rest.push(arg);
    }
    Ok((rest, settings))
}

fn cache_error() -> String {
    "--cache expects a duration like 30m, 6h or 2d (0 disables the disk cache)".into()
}

/// `30s` / `30m` / `6h` / `2d`, or a bare number of seconds. Anything else,
/// including an empty or negative value, is `None` so the caller refuses it
/// rather than silently reading zero.
pub fn parse_duration(text: &str) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() {
        return None;
    }
    let split = text
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(text.len());
    let (number, unit) = text.split_at(split);
    let value: i64 = number.parse().ok()?;
    let multiplier = match unit.trim() {
        "" | "s" => 1,
        "m" => 60,
        "h" => 3_600,
        "d" => 86_400,
        _ => return None,
    };
    value.checked_mul(multiplier).filter(|secs| *secs >= 0)
}

/// The live watch loop is the default, but `-1`/`--once` and `--json` both want
/// one frame printed and an exit.
pub fn wants_watch(args: &cli::Args) -> bool {
    !args.once && !args.json
}

/// Report output format (`--json` / `--csv` / table).
pub fn output_fmt(args: &cli::Args) -> Fmt {
    if args.json {
        Fmt::Json
    } else if args.csv {
        Fmt::Csv
    } else {
        Fmt::Table
    }
}

/// Spend-burst state: a CLI `-b/--bursts` turns it on for the run; otherwise it
/// follows the config flag. The cap is the CLI value, else the config sample
/// count, clamped 5–240.
pub fn burst_config(bursts: Option<usize>, enabled: bool, samples: usize) -> (bool, usize) {
    let on = bursts.is_some() || enabled;
    let cap = if on {
        bursts.or(Some(samples)).unwrap_or(40).clamp(5, 240)
    } else {
        0
    };
    (on, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn argv(items: &[&str]) -> Vec<OsString> {
        items.iter().map(OsString::from).collect()
    }

    #[test]
    fn durations_take_a_unit_and_a_zero_disables() {
        assert_eq!(parse_duration("30s"), Some(30));
        assert_eq!(parse_duration("30m"), Some(1_800));
        assert_eq!(parse_duration("6h"), Some(21_600));
        assert_eq!(parse_duration("2d"), Some(172_800));
        assert_eq!(parse_duration("45"), Some(45));
        assert_eq!(parse_duration("0"), Some(0));
        // Anything else is refused rather than read as a silent zero.
        assert_eq!(parse_duration(""), None);
        assert_eq!(parse_duration("6w"), None);
        assert_eq!(parse_duration("-1h"), None);
        assert_eq!(parse_duration("h"), None);
    }

    #[test]
    fn the_catalog_flags_are_pulled_out_of_argv() {
        let (rest, settings) =
            split_catalog_flags(argv(&["oduse", "--cache", "30m", "--no-catalog", "-1"])).unwrap();
        assert!(settings.no_catalog);
        assert_eq!(settings.cache_secs, 1_800);
        let rest: Vec<String> = rest.iter().map(|a| a.to_string_lossy().into()).collect();
        assert_eq!(rest, vec!["oduse", "-1"]);
        // The inline form parses too, and the default TTL is 6 h.
        let (_, settings) = split_catalog_flags(argv(&["--cache=2h"])).unwrap();
        assert_eq!(settings.cache_secs, 7_200);
        assert!(!settings.no_catalog);
        let (_, defaults) = split_catalog_flags(argv(&["-1"])).unwrap();
        assert_eq!(defaults, crate::oduse::catalogue::Settings::default());
        // A mistyped value is a refusal, not a silent zero.
        assert!(split_catalog_flags(argv(&["--cache", "soon"])).is_err());
        assert!(split_catalog_flags(argv(&["--cache"])).is_err());
    }
}
