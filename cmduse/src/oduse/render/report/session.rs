// `oduse session`: spend per conversation, newest first. The conversation is the
// app's session unit; its project supplies the display name.
use crate::oduse::db::Row;
use crate::oduse::od::Catalog;
use crate::report_render::Fmt;
use cmduse_core::money;

use super::super::ink::Ink;
use super::{truncate, Bucket};

/// Column widths, shared by the session table's header and its rows.
/// `CREDITS_W` matches the `money` figures (`$1234.56` is 8 wide, 9 leaves room
/// for five digits); `DATE_W` is `YYYY-MM-DD`.
const NAME_W: usize = 32;
const DATE_W: usize = 11;
const CREDITS_W: usize = 9;
const REQ_W: usize = 6;

/// `--rows` caps the table only: the machine formats always carry every session.
pub fn session_text(
    rows: &[Row],
    catalog: &Catalog,
    limit: usize,
    colour: bool,
    fmt: Fmt,
) -> String {
    let mut by_session: std::collections::BTreeMap<&str, (String, Bucket, i64)> =
        Default::default();
    for row in rows {
        let entry = by_session
            .entry(row.session.as_str())
            .or_insert_with(|| (row.project.clone(), Bucket::default(), 0));
        entry.1.add(row, catalog);
        entry.2 = entry.2.max(row.at_ms);
    }
    let mut sessions: Vec<_> = by_session.into_iter().collect();
    sessions.sort_by_key(|(_, (_, _, last))| std::cmp::Reverse(*last));

    match fmt {
        Fmt::Json => {
            let mut keyed = serde_json::Map::new();
            for (id, (project, b, last)) in &sessions {
                let mut body = b.json();
                body["lastMs"] = serde_json::json!(*last);
                body["project"] = serde_json::json!(project);
                keyed.insert((*id).to_string(), body);
            }
            serde_json::json!({
                "scope": "local",
                "source": "open-design",
                "sessions": keyed.clone(),
                // The family spelling: both keys carry the same rows so a
                // consumer reads either.
                "projects": keyed,
            })
            .to_string()
        }
        Fmt::Csv => {
            let mut out = String::from("session,requests,tokens_in,tokens_out,credits,cost_usd\n");
            for (id, (_, b, _)) in &sessions {
                out.push_str(&format!(
                    "{},{},{},{},{:.6},{:.2}\n",
                    crate::report_render::csv_field(id),
                    b.requests,
                    b.input,
                    b.output,
                    b.credits,
                    b.cost,
                ));
            }
            out
        }
        Fmt::Table => {
            let ink = Ink::new(colour);
            // One set of widths for the header and every row: a literal header
            // drifted four columns off the data it labels.
            let mut out = format!(
                "{}{:<NAME_W$} {:<DATE_W$} {:>CREDITS_W$} {:>REQ_W$}{}\n",
                ink.bold, "project", "last", "credits", "req", ink.reset
            );
            for (id, (project, b, last)) in sessions.iter().take(limit) {
                let name: &str = if project.is_empty() {
                    id
                } else {
                    project.as_str()
                };
                out.push_str(&format!(
                    "{:<NAME_W$} {:<DATE_W$} {:>CREDITS_W$} {:>REQ_W$}\n",
                    truncate(name, NAME_W),
                    ink.dim_on(format!(
                        "{:<DATE_W$}",
                        super::super::date_of(last.div_euclid(86_400_000))
                    )),
                    ink.cyan_on(format!("{:>CREDITS_W$}", money(b.credits))),
                    b.requests,
                ));
            }
            if sessions.len() > limit {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on(format!("… {} more", sessions.len() - limit))
                ));
            }
            if out.lines().count() == 1 {
                out.push_str(&format!(
                    "{}\n",
                    ink.dim_on("(no sessions in the window)".into())
                ));
            }
            out
        }
    }
}
