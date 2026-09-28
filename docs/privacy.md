# Privacy and local data

LitOpenCode runs inside OpenCode and stores workflow state on the local filesystem.
Local storage does not make the whole workflow offline: package operations, update
checks, public-source retrieval, and the host's configured model and tools can use
the network. This page describes this repository's implementation; OpenCode,
providers, npm, and other tools have their own behavior and policies.

## Stored on your machine

| Location | Contents and purpose |
| --- | --- |
| Project `.litopencode/config.json` and `state.json` | Project configuration and runtime state. |
| Project `.litopencode/litgoal/lit-loop/` | Goals, criteria, checkpoints, session identifiers, evidence references, a brief, ledger events, and bounded lifecycle state used to resume work. Evidence files can contain commands, output, or project material. |
| Project `.litopencode/knowledge/` | Locally captured knowledge claims and review state. Legacy skill-learning files from earlier releases are left untouched and are no longer read. |
| Project `.litopencode/logs/litopencode.log` | The logger's JSON-lines destination for timestamps, levels, and messages when explicitly enabled. The current server creates the logger with logging disabled by default. |
| OpenCode config root | Plugin registration, `litopencode.json` routes and choices, and installed command/skill files. The default is `~/.config/opencode`; `XDG_CONFIG_HOME` or a CLI `--root` changes the applicable root. |
| Home `~/.litopencode/` | Update cache, locks, transaction journal and receipt, and retained recovery backups after an unsuccessful automatic update. Backups can contain OpenCode configuration and installed command/skill content. |

These records may reveal paths, task descriptions, snippets, model selections, or
other private project context. Some schemas and operations bound their size or
history, but there is no single automatic deletion period for all local state.
The logger does not itself redact its message argument. Do not treat any log,
ledger, backup, or diagnostic output as safe to publish without inspection.

## Network boundaries

**Packages and updates.** npm installation downloads packages and dependencies.
The update checker requests the package's latest-version metadata from
`registry.npmjs.org`, using a LitOpenCode update-check user agent. The metadata
request code does not attach prompts, source files, or ledger contents. The
registry still receives normal request information, including the requesting IP
address. Automatic update can stage a newer package, run its installer and doctor,
and write local recovery records. Its npm child uses a sanitized environment and
an isolated npm configuration. This is separate from npm commands you run yourself.

Use `--no-auto-update` for install/doctor operations or set
`LITOPENCODE_NO_AUTO_UPDATE=1` for plugin startup and management commands. To also
disable the advisory update-notifier path, set `LITOPENCODE_NO_UPDATE_CHECK=1` or
`NO_UPDATE_NOTIFIER=1`; those variables also disable automatic updates. CI presence
disables both paths. These controls do not disable network access by OpenCode,
providers, npm commands, or explicitly invoked retrieval tools.

**Public-source retrieval.** The public-fetch tool performs HTTP(S) GET requests
to the supplied destination and accepted redirects, with the
`litopencode-lit-fetch` user agent. Destination/DNS checks, redirect checks, and
response limits protect the retrieval boundary. The transport does not forward
browser cookies or provider credentials. A destination can still see the requested
path and query string and normal network metadata. Never put secrets in a URL:
redacting a returned result cannot retract a request already sent to its server.
Retrieved text and source addresses can become part of tool output and host context.

**OpenCode and providers.** Agent prompts, user requests, selected files, and tool
results are processed through the OpenCode host and configured provider. LitOpenCode
does not establish their retention or training policy. Review the provider and
host settings before supplying sensitive material. The installer's model menu
reads the host's local model catalog when available; this is distinct from a live
provider request or a guarantee of account access. Additional host tools and
user-authorized commands can introduce other destinations.

## Sharing, retention, and removal

Share a minimal reproduction with synthetic data. Review diagnostic JSON, stack
traces, evidence files, screenshots, URLs, and config fragments for credentials,
private paths, and identifying project details. Removing a secret from a later
message does not remove copies already sent to a host, provider, or public issue.

Stop active work before archiving or deleting its local state. Retain the ledgers
you need for resumption and recovery backups until an update is resolved. Removing
the plugin registration does not erase project ledgers, home update state, npm
caches, host sessions, or provider-side records. Review and remove only your own
unneeded files; preserve edited command/skill files and unrelated configuration.
See the [removal reference](reference.md#remove) and [security reporting](../SECURITY.md).

## Implementation references

In a source checkout, the relevant implementations are `src/state.ts`,
`src/logger.ts`, `src/server.ts`, `src/ledger.ts`, `src/knowledge.ts`,
`src/cli/update-notifier.ts`, `src/cli/auto-update.ts`,
`src/cli/model-catalog.ts`, and `src/lit-fetch*.ts`. Source files are excluded from
the npm payload; package users receive the compiled runtime. These boundaries
should be reviewed whenever storage, update, or retrieval behavior changes.
