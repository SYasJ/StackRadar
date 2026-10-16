# Contributing to StackRadar

Thanks for helping make StackRadar better! Bug reports, ideas, docs fixes and code are all welcome.

> **License note:** StackRadar is source-available under the [PolyForm Noncommercial License 1.0.0](LICENSE).
> By submitting a contribution you agree that it may be distributed under that license and under the
> commercial license described in [COMMERCIAL.md](COMMERCIAL.md).

## Ways to contribute

- **Report a bug.** Use the [bug report form](https://github.com/SYasJ/StackRadar/issues/new?template=bug_report.yml). Include your OS, the StackRadar version (shown in Settings) and the steps to reproduce.
- **Suggest a feature.** Use the [feature request form](https://github.com/SYasJ/StackRadar/issues/new?template=feature_request.yml), or check the [roadmap](ROADMAP.md) first.
- **Improve the docs.** The wiki source lives in [`docs/wiki/`](docs/wiki/Home.md) and is published automatically.
- **Send a pull request.** See below.

Security problems should **not** be reported as public issues. See [SECURITY.md](SECURITY.md).

## Development setup

StackRadar runs on the Python standard library alone, so there is nothing to install to run it:

```bash
git clone https://github.com/SYasJ/StackRadar.git
cd StackRadar
python3 stackradar.py --root ~/Projects --open     # http://localhost:8765
```

For the developer tools (the linter), use [uv](https://docs.astral.sh/uv/). It installs the exact versions pinned in `uv.lock`:

```bash
uv sync --locked          # creates .venv with the pinned dev tools
```

Desktop app (Electron), optional. In development it starts `python3 stackradar.py` as its backend:

```bash
cd desktop && npm ci && npm start
```

Need sample data? `python3 demo/make_demo_workspace.py` builds a fake workspace for screenshots and testing.

## Running the tests

```bash
python3 -m unittest discover -s tests -v      # unit + HTTP security tests, no network needed
```

CI runs the same suite on macOS, Windows and Linux with Python 3.9 and 3.12. Please add or update tests for any behaviour change.

## Code style

- **Python:** must pass the linter, which is configured in `pyproject.toml` (Pyflakes rules plus syntax errors):
  ```bash
  uv run ruff check .          # or: ruff check .
  ```
  - Standard library only. **No runtime dependencies** in `stackradar.py`.
  - Must run on **Python 3.9+**. Avoid newer syntax such as `match` statements or `X | Y` type unions at runtime.
  - Keep the 4-space indentation and the existing naming style. Prefer small, pure helper functions that are easy to test.
- **JavaScript (`static/`, `desktop/`):** vanilla JS, no build step and no frameworks. Start new browser scripts with `"use strict";`. Check syntax with:
  ```bash
  for f in static/*.js desktop/*.js desktop/scripts/*.js; do node --check "$f"; done
  ```
- **Formatting:** `.editorconfig` sets UTF-8, LF line endings, a final newline, 4 spaces for Python and 2 for JS, HTML, CSS, JSON and YAML.
- **Safety rules** (these are what make StackRadar trustworthy, so they're non-negotiable):
  - Never send data off the machine without an explicit user action.
  - Mask secrets everywhere (first 4 and last 2 characters).
  - Destructive actions go to the Trash / Recycle Bin, or require typed confirmation.
  - Run external commands with argument lists, never shell strings.
  - Every API endpoint requires the per-launch token.

## Pull request checklist

1. Fork the repo and branch from `main` (`fix/…`, `feat/…` or `docs/…`).
2. Keep each PR focused on one change. Update the `## [Unreleased]` section of [CHANGELOG.md](CHANGELOG.md).
3. Make sure `ruff check .` and the test suite pass locally.
4. Fill in the PR template, and add screenshots for UI changes.
5. Don't bump the version; maintainers do that at release time (`scripts/bump_version.py`).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By participating you agree to uphold it.
