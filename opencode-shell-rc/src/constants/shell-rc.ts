/** Stable plugin id; also the shell-rc state directory name. */
export const SHELL_RC_ID = "opencode-shell-rc";

/**
 * Emitted by the capture command before `alias -L` / `typeset -f`, so everything
 * the rc prints while starting up (spaceship's version warning, an oh-my-zsh
 * notice) can be dropped: `zsh -ic` runs the rc *first*, so its chatter lands on
 * stdout ahead of our output. Without the slice, a themed rc that prints one
 * coloured line writes that line into `state.zsh`, and every non-interactive
 * shell then dies on it (`state.zsh:2: bad pattern: ^[[1m…`).
 */
export const CAPTURE_MARKER = "__opencode_shell_rc_capture__";

/** Bumped whenever the capture changes shape; a stale sidecar revokes the state. */
export const STATE_VERSION = 2;

/** Real rc files a nested interactive/login shell would look for under ZDOTDIR. */
export const LINKED = [".zshrc", ".zprofile", ".zlogin"] as const;

/**
 * The global instruction file the alias index is written into, and the markers
 * that fence it. Everything outside the pair belongs to the user.
 */
export const AGENTS_FILE = "AGENTS.md";
export const ALIAS_BLOCK_BEGIN = "<!-- shell-rc-aliases-begin -->";
export const ALIAS_BLOCK_END = "<!-- shell-rc-aliases-end -->";
