# Releasing & versioning

StackRadar follows **Semantic Versioning**. `VERSION` is the single source of truth. The engine reads it, the
UI shows it, and the desktop build copies it into `desktop/package.json`.

## Cut a release

```bash
cd stackradar
python3 scripts/bump_version.py minor        # or patch | major | 2.3.0
#  → updates VERSION, desktop/package.json, adds a CHANGELOG.md stub
$EDITOR CHANGELOG.md                         # describe the release
git commit -am "StackRadar 2.1.0"
git tag v2.1.0
git push --follow-tags
```

Pushing a `v*` tag runs **`.github/workflows/stackradar-release.yml`**:

1. Unit + HTTP tests.
2. Three parallel builds:
   - **macOS** (universal2 Python from python.org → one engine for Intel + Apple silicon) → `.dmg` + `.zip` for arm64 and x64
   - **Windows** → NSIS installer `.exe` + portable `.exe`
   - **Linux** → `.AppImage` + `.deb`
3. electron-builder uploads the files and the `latest*.yml` update feeds to a GitHub Release, which the installed apps then auto-update from.

You can also run the workflow manually (**Actions → StackRadar Release → Run workflow**) to get the installers as build
artifacts without publishing.

`stackradar-ci.yml` runs the test suite on macOS, Windows and Linux (Python 3.9 and 3.12) for every push / PR touching `stackradar/`.

## Code signing

Builds are unsigned unless you add these repository secrets:

| Secret | For |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | the signing certificate (`.p12` base64 / URL) and its password: Apple Developer ID (macOS) or Authenticode (Windows) |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |

Without them, macOS builds are ad-hoc signed (right-click → Open on first launch, no silent auto-install) and Windows shows SmartScreen.
