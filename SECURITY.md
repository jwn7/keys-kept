# Security

Vault keeps API keys and other secrets, so security reports are welcome and taken seriously.

**This project has not had an external security review.** Use it for keys you can rotate, keep a backup, and read the limits below before trusting it with anything critical.

## Reporting a vulnerability
Please do not open a public issue for a security problem.

Use GitHub's private reporting instead: on this repository, open the **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what an attacker gains.

What to expect: an acknowledgement, a fix or a documented decision, and credit in the release notes if you want it. This is a small volunteer project, so there is no bounty and no guaranteed response time.

## What the design is meant to protect
- Secrets are encrypted on the device (Argon2id for the password, XChaCha20-Poly1305 for items, via libsodium). The sync backend (your Google Drive, a folder, or Supabase) only ever receives ciphertext.
- Item sizes are padded, and a device refuses to accept an older version of an item than the one it already holds.
- The production web build ships a Content Security Policy that blocks external scripts and connections to hosts other than the app itself and the configured backend.
- Files shared with teammates are standard age files sealed to recipients' public keys.

## Known limits
- A compromised device that is unlocked can read everything. So can a malicious browser extension with page access.
- The web app is delivered by a server. Whoever controls that server can change the code you run. Self-host it or use a packaged build if that matters to you.
- A weak master password can be guessed offline by anyone who obtains the ciphertext.
- Metadata is visible to the backend: number of items, modification times, padded sizes, device ids.
- A server can withhold new changes without detection. It cannot roll a device back silently.
- Shared files are snapshots. There is no revocation: when a teammate leaves, rotate the keys they received.
- The Node helpers (`packages/env`) inject values into a child process. That process can do anything with them. Output redaction matches exact strings only.

Details, including which attacks each defence was built for, are in [`docs/SECURITY.md`](docs/SECURITY.md) (Korean).
