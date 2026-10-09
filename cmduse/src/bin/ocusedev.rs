//! Development twin of `ocuse`: same code, different binary name, so a local
//! build never shadows the installed `ocuse`. Consumers (mpc, the sidebar) can
//! target it with `OCUSE_BIN=ocusedev`.
fn main() {
    cmd_usage::ocuse::run();
}
