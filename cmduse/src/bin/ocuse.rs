// ocuse — OpenCode Go/Zen usage, same CLI shape as cmduse.
//
// The CLI body lives in the library (`cmd_usage::ocuse::run`), so this bin and
// its `ocusedev` twin are both thin: same code, different binary name.
fn main() {
    cmd_usage::ocuse::run();
}
