// Cap-set prose shared by the dashboard's heading and window rows. Split from
// `dash` because it is one subject and that file had reached the line cap.
use crate::oduse::caps::CapPick;
use crate::oduse::od::Plan;
use cmduse_core::money;

use super::ink::Ink;

/// `Flash caps; Eco would be $220.00` — which set the row used, and the figure
/// the plan's own set would have given **for this same window**. `None` when the
/// row used the plan's set, because there is then nothing to disambiguate.
pub fn cap_note(pick: &CapPick, looser_cap: Option<f64>) -> Option<String> {
    let looser = pick.looser.as_ref()?;
    let figure = looser_cap.map(money)?;
    Some(format!(
        "{} caps; {} would be {}",
        pick.chosen.label, looser.label, figure
    ))
}

/// The heading's caps sentence: the plan's own published caps, plus every
/// override where one exists, so a reader knows the rows below may differ.
pub fn caps_heading(ink: &Ink, plan: &Plan) -> String {
    let mut caps = vec![format!("{}/month", money(plan.monthly_usd))];
    if let Some(week) = plan.weekly_usd {
        caps.push(format!("{}/week", money(week)));
    }
    if let Some(five) = plan.five_hour_usd {
        caps.push(format!("{}/5h", money(five)));
    }
    caps.push(format!("{} concurrent", plan.concurrency));
    if plan.cap_overrides.is_empty() {
        return ink.dim_on(caps.join(" · "));
    }
    let each: Vec<String> = plan
        .cap_overrides
        .iter()
        .map(|set| format!("{} {}/mo", set.label, money(set.monthly_usd)))
        .collect();
    format!(
        "{} (per model: {}; {} {}/mo)",
        ink.dim_on(caps.join(" · ")),
        ink.dim_on(each.join(", ")),
        ink.dim_on(
            plan.default_cap_label
                .as_deref()
                .unwrap_or(&plan.label)
                .to_string()
        ),
        ink.dim_on(money(plan.monthly_usd))
    )
}
