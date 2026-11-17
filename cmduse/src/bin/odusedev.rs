//! Development twin of `oduse`: same code, different binary name, so a local
//! build never shadows the installed `oduse`. Consumers can target it with
//! `ODUSE_BIN=odusedev`.
fn main() {
    cmd_usage::oduse::run();
}
