# Security & privacy

StackRadar reads sensitive things (your code, `.env` files, shell history, agent logs), so it is built to keep them on your machine.

## Nothing leaves your computer
- No telemetry, analytics, accounts or cloud.
- Network access happens **only when you click**: outdated-package checks / updates (your package manager talks to its registry) and "check for StackRadar updates" (GitHub API). The desktop app's auto-updater also contacts GitHub Releases.

## The local server is locked down
| Protection | What it stops |
|---|---|
| Binds to **127.0.0.1** by default | other machines on your Wi-Fi reaching the API (v1 listened on 0.0.0.0) |
| **Per-launch API token** in the page, required on every `/api/*` call | websites you visit sending forged requests (CSRF) to delete/kill/update |
| **Host header must be localhost** | DNS-rebinding attacks |
| Static file serving confined to `static/` | path traversal |
| Delete / move / rename **only under your home folder** | accidental damage to system folders |
| Kill / stop **only processes inside scanned projects** (or started by StackRadar) | killing system services |
| Updates use **argument lists + validated package names** | command injection |

Running `--host 0.0.0.0` prints a warning. The token is still required, but anyone who can load the page can obtain it.

## Network Guard
- The guard proxy listens on **127.0.0.1** only, on a random port, and serves only runs StackRadar started (each run gets its own identity).
- HTTPS traffic is **never decrypted**. StackRadar does not install certificates. Only plain-HTTP requests are inspected.
- OS firewall changes happen **only when you click 🧱 Block** and confirm a dialog that shows the exact command. Your OS then asks for admin rights.

## Secrets
- Detected keys are **masked** everywhere (first 4 / last 2 characters). The full value is never sent to the browser.
- Shell-history lines and agent cron prompts are redacted before display.
- MCP server **names** are shown. Their env vars / API keys are never read into the UI.
- If a key was in a repo with a remote, treat it as leaked and rotate it.

## Deletion
- Default **Move to Trash** (macOS `~/.Trash`, Linux XDG Trash with `.trashinfo` so you can restore, Windows **Recycle Bin**).
- Permanent delete needs the folder's exact name typed.

## Reporting a vulnerability
Open a private security advisory on the GitHub repository rather than a public issue.
