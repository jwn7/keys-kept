---
name: keys-kept
description: Use whenever code needs an API key, token, password, connection string, or other environment variable (running a dev server, tests, migrations, deploy scripts, curl to an API). Get keys through the keys-kept MCP tools by name. Never ask the user to paste a secret value into the chat, never write secret values into files, and never print them.
---

# Using keys from the vault (Keys Kept)

The user keeps API keys in an encrypted vault. This project folder has encrypted key files (`.env.<env>.age`) and usually a `.vault.yml` that says which vault project this folder is and which environment each git branch uses. You can use keys **by name**. You never receive their values, and that is intended.

## Tools

- `list_keys` — names of the keys available for the current branch's environment. No values.
- `run_with_keys` — run a command with the chosen keys injected as environment variables. Output that contains a value comes back with the value replaced by `[NAME hidden]`.
- `request_key` — when a needed key is missing, produces the message to show the user. It tells them to add the key in the Vault app, not in the chat.

## Rules

1. Before running anything that needs secrets, call `list_keys` and pick the exact names.
2. Run through `run_with_keys` (for example `npm test`, `npm run dev`, a migration). Pass only the keys the command needs.
3. If a key is missing, call `request_key` and relay its message. Do **not** ask the user to paste the value, and do not suggest creating a plaintext `.env` file.
4. Never write a secret into source files, `.env`, logs, commit messages, or shell history. Reference it by its environment variable name in code (`process.env.STRIPE_SECRET_KEY`).
5. If a tool says AI use is turned off for this project (`ai: false` in `.vault.yml`), stop and tell the user. They can turn it on in the Vault app's connect tab.
6. If the tools report that `VAULT_ENV_PASSPHRASE` or `VAULT_ENV_IDENTITY_FILE` is not set, tell the user to set one of them in the shell that starts Claude Code, then restart it. Do not ask for the passphrase in chat.
7. Masking matches exact values only. Avoid commands that would print, encode (base64), or send a secret somewhere; if a command would do that, explain and ask first.

## Setup (for the user)

- Encrypted key files come from the Vault app: connect the project to this folder (it writes `.env.<env>.age`), or use "암호화해서 내려받기 / Download encrypted".
- Set `VAULT_ENV_PASSPHRASE` (the key file password, not the vault master password) or `VAULT_ENV_IDENTITY_FILE` in your shell.
- Without the plugin: `claude mcp add --transport stdio --env VAULT_ENV_PASSPHRASE=<file password> keys-kept -- npx -y keys-kept mcp`
