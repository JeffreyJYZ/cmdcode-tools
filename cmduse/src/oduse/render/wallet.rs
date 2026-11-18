// The wallet line: the one figure an account or the app itself reports.
//
// It prints beside the windows rather than among them because it is a balance,
// not a meter — OpenDesign exposes no per-window usage API. A missing wallet is
// one dim line with the reason (a dead cookie, `daemon not running`, an expired
// control key), never an error and never a zero. The source is stated whenever a
// number exists: two routes can supply one, and they are not interchangeable.
use crate::oduse::window::Report;
use cmduse_core::money;

use super::ink::Ink;

pub fn wallet_line(ink: &Ink, report: &Report) -> String {
    match &report.wallet {
        Some(wallet) => {
            let mut bits = vec![money(wallet.balance_usd)];
            if let Some(profile) = &wallet.profile {
                bits.push(profile.clone());
            }
            if let Some(user) = &wallet.user {
                bits.push(user.clone());
            }
            if wallet.stale {
                bits.push("cached".into());
            }
            let mut suffix = String::new();
            if let Some(source) = report.wallet_source {
                suffix.push_str(&format!(" ({})", source.as_str()));
            }
            if let Some(expiry) = &wallet.expires_at {
                // The stamp is ISO-8601; the date is the actionable half on a
                // one-line dashboard. `--json` carries the full value.
                let day = expiry.get(..10).unwrap_or(expiry);
                suffix.push_str(&format!(" · expires {day}"));
            }
            format!("wallet: {}{suffix}\n", ink.cyan_on(bits.join(" · ")))
        }
        None => match &report.wallet_error {
            Some(why) => format!("{}wallet: {why}{}\n", ink.dim, ink.reset),
            None => String::new(),
        },
    }
}
