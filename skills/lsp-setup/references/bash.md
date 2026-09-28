# Shell — `bash-language-server`

- **Server command:** `bash-language-server start`
- **Extensions:** `.sh` `.bash` `.zsh` `.ksh`
- **Requires:** Node and npm

## Install

```bash
npm install -g bash-language-server
command -v bash-language-server
```

Install `shellcheck` alongside it — the server surfaces ShellCheck's findings, and without it the
diagnostics are mostly empty:

```bash
brew install shellcheck    # or: apt install shellcheck
```

## Troubleshooting

- **No diagnostics at all:** ShellCheck is missing. That is the usual cause, and it is worth checking
  before concluding the file is clean.
- **Zsh-specific syntax reports false errors.** ShellCheck targets POSIX sh and Bash; genuine zsh
  constructs are not fully supported. Do not "fix" working zsh to satisfy it.

## Honest fallback while unserved

`shellcheck script.sh` directly, plus `bash -n` for syntax.

