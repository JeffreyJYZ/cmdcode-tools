// ANSI styles: cmduse's palette, or empty strings when colour is off, so a piped
// run never leaks SGR escapes.
use super::DEFAULT_BAR_WIDTH;

pub struct Ink {
    pub colour: bool,
    /// Gauge width for the window bars (config / `--bar-width`).
    pub bar_width: usize,
    pub bold: &'static str,
    pub dim: &'static str,
    pub reset: &'static str,
    pub cyan: &'static str,
    pub green: &'static str,
    pub yellow: &'static str,
    pub red: &'static str,
}

impl Ink {
    pub fn new(colour: bool) -> Self {
        if colour {
            Self {
                colour,
                bar_width: DEFAULT_BAR_WIDTH,
                bold: crate::render::BOLD,
                dim: crate::render::DIM,
                reset: crate::render::RESET,
                cyan: crate::render::CYAN,
                green: crate::render::GREEN,
                yellow: crate::render::YELLOW,
                red: crate::render::RED,
            }
        } else {
            Self {
                colour,
                bar_width: DEFAULT_BAR_WIDTH,
                bold: "",
                dim: "",
                reset: "",
                cyan: "",
                green: "",
                yellow: "",
                red: "",
            }
        }
    }

    /// Override the gauge width (config / `--bar-width`); chains after `new`.
    pub fn width(mut self, width: usize) -> Self {
        self.bar_width = width;
        self
    }

    /// Colour a value without disturbing the caller's column padding: pad the
    /// text first, then wrap it.
    pub fn cyan_on(&self, text: String) -> String {
        format!("{}{text}{}", self.cyan, self.reset)
    }

    pub fn dim_on(&self, text: String) -> String {
        format!("{}{text}{}", self.dim, self.reset)
    }

    pub fn bold_on(&self, text: String) -> String {
        format!("{}{text}{}", self.bold, self.reset)
    }

    /// Severity for a used/cap percentage — cmduse's thresholds.
    pub fn for_pct(&self, pct_used: f64) -> &'static str {
        if !self.colour {
            ""
        } else if pct_used >= 90.0 {
            self.red
        } else if pct_used >= 70.0 {
            self.yellow
        } else {
            self.green
        }
    }

    /// The share plus cmduse's gauge, on a colour frame's window row.
    pub fn bar_label(&self, pct_used: f64, label: &str) -> String {
        if !self.colour {
            return String::new();
        }
        format!(
            "{}{label:>5}%{} {}",
            self.for_pct(pct_used),
            self.reset,
            crate::render::gauge(pct_used, 100.0, self.bar_width),
        )
    }
}
