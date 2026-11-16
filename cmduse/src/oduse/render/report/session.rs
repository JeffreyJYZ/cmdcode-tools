// `oduse session`: spend per conversation, newest first. The conversation is the
// app's session unit; its project supplies the display name.
use crate::oduse::db::Row;
use crate::oduse::od::Catalog;
use crate::report_render::Fmt;
use cmduse_core::money;

use super::super::ink::Ink;
use super::{truncate, Bucket};

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
                    "{},{},{},{},{:.2},{:.2}\n",
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
            let mut out = format!(
                "{}project                          last        credits   req{}\n",
                ink.bold, ink.reset
            );
            for (id, (project, b, last)) in sessions.iter().take(limit) {
                let name: &str = if project.is_empty() {
                    id
                } else {
                    project.as_str()
                };
                out.push_str(&format!(
                    "{:<32} {:<11} {} {:>6}\n",
                    truncate(name, 32),
                    ink.dim_on(format!(
                        "{:<11}",
                        super::super::date_of(last.div_euclid(86_400_000))
                    )),
                    ink.cyan_on(format!("{:>9}", money(b.credits))),
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
