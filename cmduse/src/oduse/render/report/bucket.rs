// `oduse daily` / `oduse hourly`: spend per bucket, oldest first.
use crate::oduse::db::Row;
use crate::oduse::od::Catalog;
use crate::report_render::Fmt;
use cmduse_core::{compact, money};

use super::super::ink::Ink;
use super::{totals_json, Bucket};

/// `lookback_ms` is the read window and `size_ms` the bucket width (which also
/// names the first CSV/JSON column: `day` for a ≥24h bucket, else `hour`).
/// `Json` is `{scope, source, total, days|hours}`; `Csv` the same rows flattened;
/// neither is ever coloured. `rows` caps the `Table` form only, newest buckets
/// kept, and prints a `… N more` tail when it trimmed.
#[allow(clippy::too_many_arguments)]
pub fn bucket_text(
    rows: &[Row],
    catalog: &Catalog,
    now_ms: i64,
    lookback_ms: i64,
    size_ms: i64,
    tz_secs: i64,
    colour: bool,
    fmt: Fmt,
    cap: usize,
) -> String {
    // Buckets are cut in the display timezone: shift, bucket, then label.
    let shift = tz_secs * 1000;
    let mut buckets: std::collections::BTreeMap<i64, Bucket> = Default::default();
    for row in rows {
        buckets
            .entry((row.at_ms + shift).div_euclid(size_ms))
            .or_default()
            .add(row, catalog);
    }
    let start = (now_ms + shift - lookback_ms).div_euclid(size_ms);
    let daily = size_ms >= 86_400_000;
    let label = if daily { "day" } else { "hour" };
    let stamp = |bucket: i64| {
        if daily {
            super::super::date_of(bucket)
        } else {
            format!(
                "{} {:02}h",
                super::super::date_of(bucket.div_euclid(24)),
                bucket.rem_euclid(24)
            )
        }
    };
    let window: Vec<(i64, Bucket)> = buckets
        .range(start..)
        .map(|(bucket, b)| (*bucket, *b))
        .collect();

    match fmt {
        Fmt::Json => {
            let mut keyed = serde_json::Map::new();
            let mut total = Bucket::default();
            for (bucket, b) in &window {
                keyed.insert(stamp(*bucket), b.json());
                total.merge(b);
            }
            let key = if daily { "days" } else { "hours" };
            serde_json::json!({
                "scope": "local",
                "source": "open-design",
                "total": totals_json(
                    total.cost,
                    total.credits,
                    total.requests,
                    total.input,
                    total.output,
                ),
                key: keyed,
            })
            .to_string()
        }
        Fmt::Csv => {
            let head = if daily { "day" } else { "hour" };
            let mut out = format!("{head},requests,tokens_in,tokens_out,credits,cost_usd\n");
            let mut total = Bucket::default();
            for (bucket, b) in &window {
                out.push_str(&format!(
                    "{},{},{},{},{:.6},{:.2}\n",
                    crate::report_render::csv_field(&stamp(*bucket)),
                    b.requests,
                    b.input,
                    b.output,
                    b.credits,
                    b.cost,
                ));
                total.merge(b);
            }
            out.push_str(&format!(
                "total,{},{},{},{:.6},{:.2}\n",
                total.requests, total.input, total.output, total.credits, total.cost,
            ));
            out
        }
        Fmt::Table => {
            let ink = Ink::new(colour);
            let mut out = format!(
                "{}{label:<12} credits    requests   tokens{}\n",
                ink.bold, ink.reset
            );
            let shown = window.len().min(cap);
            for (bucket, b) in window.iter().skip(window.len() - shown) {
                out.push_str(&format!(
                    "{:<12} {} {} {}\n",
                    stamp(*bucket),
                    ink.cyan_on(format!("{:>9}", money(b.credits))),
                    ink.cyan_on(format!("{:>12}", compact(b.requests))),
                    ink.cyan_on(format!("{:>9}", compact(b.input + b.output))),
                ));
            }
            if out.lines().count() == 1 {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on("(no OpenDesign turns in the window)".into())
                ));
            }
            if window.len() > shown {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on(format!("… {} more", window.len() - shown))
                ));
            }
            out
        }
    }
}
