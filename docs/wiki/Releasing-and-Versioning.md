# Releasing & versioning

StackRadar follows **Semantic Versioning**. `VERSION` is the single source of truth. The engine reads it, the
UI shows it, and the desktop build copies it into `desktop/package.json`.

## Cut a release

```bash
python3 scripts/bump_version.py minor        # or patch | major | 2.3.0
#  → updates VERSION, desktop/package.json, adds a CHANGELOG.md stub
$EDITOR CHANGELOG.md                         # describe the release
git commit -am "StackRadar 2.2.0"
git push                                     # a VERSION change on main starts the release
```

A push to `main` that changes `VERSION` releases that version if it isn't released yet. The workflow creates the
`vX.Y.Z` tag itself when it publishes. Pushing a tag `vX.Y.Z` by hand works too.

The release runs **`.github/workflows/stackradar-release.yml`**:

1. **test**: unit + HTTP tests.
2. **draft**: checks the tag matches `VERSION`, writes the release notes with `scripts/release_notes.py`
   (the version's changelog section + a download table + the [unsigned install guide](Installing-Unsigned-Builds.md))
   and creates a **draft** GitHub Release.
3. **build**, three in parallel, each uploading into that draft:
   - **macOS** (universal2 Python from python.org → one engine for Intel + Apple silicon) → `.dmg` + `.zip` for arm64 and x64, ad-hoc signed
   - **Windows** → NSIS installer `.exe` + portable `.exe`
   - **Linux** → `.AppImage` + `.deb`
4. **publish**, only if all three builds passed: adds `SHA256SUMS.txt` and publishes the draft as **Latest**. From
   that moment installed apps see the update (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`).

If a build fails, nothing is published and the release stays a draft. For a flaky failure, open the run and click
**Re-run failed jobs**. For a real fix, push it to `main` together with a change to `VERSION` or the release workflow;
the next run reuses the draft.

Preview the notes locally with `python3 scripts/release_notes.py -o /tmp/notes.md`.

## Version numbers

**MAJOR.MINOR.PATCH** ([SemVer](https://semver.org/)): patch = fixes, minor = features, major = breaking changes.
The version shows up in the window title, **Help → About StackRadar**, Settings / Updates in the UI,
`python3 stackradar.py --version`, the file names (`StackRadar-2.1.0-…`) and the release title. What's planned for
each version is in the [roadmap](Roadmap.md).

You can also run the workflow manually (**Actions → StackRadar Release → Run workflow**) to get the installers as build
artifacts without publishing.

`stackradar-ci.yml` runs the test suite on macOS, Windows and Linux (Python 3.9 and 3.12) for every push / PR touching `stackradar/`.

## Code signing

Builds are unsigned unless you add these repository secrets:

| Secret | For |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | the signing certificate (`.p12` base64 / URL) and its password: Apple Developer ID (macOS) or Authenticode (Windows) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |

Without them, macOS builds are ad-hoc signed and Windows builds are unsigned. They work fine, but users confirm the
first launch (**Open Anyway** on macOS, **Run anyway** on Windows) and macOS updates are a one-click manual download
instead of a silent install. Users get step-by-step help in the release notes and on
[Installing unsigned builds](Installing-Unsigned-Builds.md).

### Getting signed later

| OS | What you need | Cost (2026) | Then |
|---|---|---|---|
| macOS | [Apple Developer Program](https://developer.apple.com/programs/) membership → *Developer ID Application* certificate exported as `.p12` | 99 USD / year | add `CSC_LINK` (base64 of the `.p12`), `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`; set `"notarize": true` under `build.mac` |
| Windows | [Azure Trusted Signing](https://learn.microsoft.com/azure/trusted-signing/) (cheapest, needs a verified identity) or an OV / EV code-signing certificate | ~10 USD / month, or 200–400 USD / year | Trusted Signing: add `azureSignOptions` under `build.win` + `AZURE_*` secrets. Certificate: `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` |

Add secrets in **Settings → Secrets and variables → Actions**, never in the code. Signing is on the [roadmap](Roadmap.md) for 2.2.
