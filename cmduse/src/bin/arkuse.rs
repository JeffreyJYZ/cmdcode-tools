// arkuse — Volcengine ARK Agent Plan usage, same CLI shape as cmduse and ocuse.
//
// The CLI body lives in the library (`cmd_usage::arkuse::run`), so this bin and
// its `arkusedev` twin are both thin: same code, different binary name.
fn main() {
    cmd_usage::arkuse::run();
}
