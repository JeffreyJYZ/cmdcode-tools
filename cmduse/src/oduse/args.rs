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
