//! Development twin of `arkuse`: same code, different binary name, so a local
//! build never shadows the installed `arkuse`. Consumers can target it with
//! `ARKUSE_BIN=arkusedev`.
fn main() {
    cmd_usage::arkuse::run();
}
