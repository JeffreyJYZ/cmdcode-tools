/** Stable plugin id; also the shell-rc state directory name. */
export const SHELL_RC_ID = "opencode-shell-rc";

/** Real rc files a nested interactive/login shell would look for under ZDOTDIR. */
export const LINKED = [".zshrc", ".zprofile", ".zlogin"] as const;
