// One `designPlanWindow` from the snapshot. The server supplies the credits and
// the reset instant; the dollar figures are derived through `CREDIT_TO_USD`,
// never substituted for the raw counts.
use super::snapshot::CREDIT_TO_USD;

#[derive(Debug, Clone, PartialEq)]
pub struct Window {
    pub kind: String,
    pub remaining_credits: f64,
    pub limit_credits: f64,
    pub window_start: Option<String>,
    pub resets_at: Option<String>,
}

impl Window {
    pub fn used_credits(&self) -> f64 {
        (self.limit_credits - self.remaining_credits).max(0.0)
    }
    pub fn used_usd(&self) -> f64 {
        self.used_credits() * CREDIT_TO_USD
    }
    pub fn limit_usd(&self) -> f64 {
        self.limit_credits * CREDIT_TO_USD
    }
    pub fn remaining_usd(&self) -> f64 {
        self.remaining_credits * CREDIT_TO_USD
    }
    pub fn left_pct(&self) -> Option<f64> {
        (self.limit_credits > 0.0).then(|| self.remaining_credits / self.limit_credits * 100.0)
    }
    /// `14:21Z` from the server's ISO instant — never from a local clock.
    pub fn reset_label(&self) -> Option<String> {
        let ms = self
            .resets_at
            .as_deref()
            .and_then(cmduse_core::dates::parse_iso_utc)? as i64;
        let sec = ms.div_euclid(1000).rem_euclid(86_400);
        Some(format!("{:02}:{:02}Z", sec / 3600, (sec % 3600) / 60))
    }
    pub fn label(&self) -> &'static str {
        match self.kind.as_str() {
            "5h" => "5-hour",
            "7d" => "Weekly",
            _ => "Window",
        }
    }
}
