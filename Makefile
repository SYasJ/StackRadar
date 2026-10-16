# Developer commands. Tools come from uv.lock (`uv sync --locked`); StackRadar itself needs only Python.
.PHONY: help run test coverage lint typecheck check

help:          ## list commands
	@grep -E '^[a-z]+:.*## ' Makefile | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

run:           ## start the dashboard on http://localhost:8765
	python3 stackradar.py --open

test:          ## run the test suite
	uv run --locked pytest

coverage:      ## run the tests with a coverage report
	uv run --locked pytest --cov --cov-report=term --cov-report=xml

lint:          ## lint Python with ruff and check JS syntax
	uv run --locked ruff check .
	for f in static/*.js desktop/*.js desktop/scripts/*.js; do node --check "$$f" || exit 1; done

typecheck:     ## type-check with mypy
	uv run --locked mypy

check: lint typecheck test   ## everything CI runs
