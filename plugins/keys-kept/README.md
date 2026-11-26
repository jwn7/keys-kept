# keys-kept plugin for Claude Code

Lets Claude Code use API keys from your encrypted vault **by name only**. Claude never sees the values and never asks you to paste them.

```
/plugin marketplace add jwn7/vault-notes
/plugin install keys-kept@vault-notes
```

Then set the key file password in the shell that starts Claude Code (`VAULT_ENV_PASSPHRASE`, or `VAULT_ENV_IDENTITY_FILE` for files a teammate sealed to your public key) and restart.

Includes:
- MCP server `keys-kept` (runs `npx -y keys-kept mcp`): `list_keys`, `run_with_keys`, `request_key`. No tool returns a value.
- Skill `keys-kept`: tells Claude to use those tools, never request secrets in chat, and never write them to files.

Limits: a command you allow can still send a value elsewhere; masking matches exact strings only. See the repository's `SECURITY.md`.
