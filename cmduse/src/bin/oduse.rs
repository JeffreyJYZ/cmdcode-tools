// oduse — OpenDesign usage, same CLI shape as cmduse, ocuse and arkuse.
//
// The CLI body lives in the library (`cmd_usage::oduse::run`), so this bin and
// its `odusedev` twin are both thin: same code, different binary name.
fn main() {
    cmd_usage::oduse::run();
}
