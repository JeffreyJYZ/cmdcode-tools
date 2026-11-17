// The daemon's wallet line: the one figure the app itself reports.
//
// It prints beside the windows rather than among them because it is a balance,
// not a meter — OpenDesign exposes no per-window usage API. A missing wallet is
// one dim line with the reason (`daemon not running`, an expired control key),
// never an error and never a zero.
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
            format!("wallet: {}\n", ink.cyan_on(bits.join(" · ")))
        }
        None => match &report.wallet_error {
            Some(why) => format!("{}wallet: {why}{}\n", ink.dim, ink.reset),
            None => String::new(),
        },
    }
}
