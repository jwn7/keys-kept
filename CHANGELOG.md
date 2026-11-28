# Changelog

This repository holds two separately versioned things:

- **App** (`apps/web`, `packages/core`): the Keys Kept app. Not released yet.
- **`keys-kept`** (`packages/env`): the npm package with the CLI and the MCP server, plus the Claude Code plugin in `plugins/keys-kept` that runs it.

Versions follow [Semantic Versioning](https://semver.org). Before 1.0, a minor bump (0.x.0) may contain breaking changes; they are listed under **Breaking**. Release steps are in [docs/RELEASING.md](docs/RELEASING.md).

## App

### Unreleased
- Project-first structure: the first screen lists projects; the warnings view opens from a banner (plan 14).
- Note-taking features removed to focus on the key ledger: new notes, daily note, templates, calendar and card views, tasks, review. Existing note items stay readable and editable in their project (plan 14-3).
- Connect tab: link a project to a code folder, keep `.env.<env>.age` files up to date, `.vault.yml`, AI on/off, recent AI use (plan 15).
- Review fixes: text contrast 4.5:1 in both themes, larger touch targets, view switch as a segmented control, error states.
- First screen on a new device: "Create a new vault" or "Open an existing vault" (Google Drive, sync folder, backup file), instead of going straight to password setup. If the connected storage is empty, the app says so and offers to create a vault there.
- The app is named Keys Kept (seal K, icons, page title).
- Repository moved to the `keys-kept` organization: https://github.com/keys-kept/keys-kept, web demo at https://keys-kept.github.io/keys-kept/ (its own origin, no longer shared with other Pages sites).
- License changed from MIT to AGPL-3.0-only (code published before 2026-11-26 stays available under MIT).

### 0.0.1 (2026-11-07 to 2026-11-25, unreleased development)
Encryption core, sync (Drive, folder, Supabase Pro), age backups, key ledger (recognition, environments, compare, incident mode), team sharing by public key, English UI, passkey unlock.

## keys-kept (npm)

### 0.1.1 (2026-11-26)
- The repository moved to `jwn7/keys-kept`. Links and the Claude Code install command are updated: `/plugin install keys-kept@keys-kept` (the marketplace is now named `keys-kept`).

### 0.1.0 (2026-11-26)
- First npm release. Single command `keys-kept run | mcp | check | scan | push`.
- `.vault.yml` (`project`, `ai`, `branches`, `required`); `.vault.json` still read.
- MCP server picks the key file by git branch, refuses when `ai: false`, logs key names (never values) to `.vault/ai-log.jsonl`.
- Empty `VAULT_ENV_PASSPHRASE` counts as unset.
- All CLI and MCP messages are in English; masked output reads `[NAME hidden]`.
- Claude Code plugin `keys-kept` (MCP server + skill) and `server.json` for the MCP registry.
- License: MIT.
