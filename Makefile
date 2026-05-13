.PHONY: help start-local start-polling start-webhook init verify build test test-unit test-harness test-contract test-smoke smoke state pycheck orch orch-dry-run orch-eval-all clean

ROUNDS ?= 1
FEATURE ?= all
PYTHONPYCACHEPREFIX ?= /private/tmp/agent-remote-tg-pycache
ENV_FILE ?= .env.local

help:
	@echo "Available targets:"
	@echo "  make start-local      Start local Telegram polling service using .env.local"
	@echo "  make start-polling    Alias for start-local"
	@echo "  make start-webhook    Start webhook HTTP service using .env.local"
	@echo "  make init             Run the full project verification entrypoint"
	@echo "  make verify           Alias for init"
	@echo "  make build            Run JavaScript syntax checks"
	@echo "  make test             Run unit, harness, contract, and smoke tests"
	@echo "  make test-unit        Run unit tests"
	@echo "  make test-harness     Run harness tests"
	@echo "  make test-contract    Run contract tests"
	@echo "  make test-smoke       Run smoke test"
	@echo "  make state            Validate feature_list.json and SPEC.md wording"
	@echo "  make pycheck          Compile Python scripts"
	@echo "  make orch ROUNDS=1    Run orchestrator rounds"
	@echo "  make orch-dry-run     Preview orchestrator actions"
	@echo "  make orch-eval-all    Run evaluator-only mode for all features"

start-local:
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo "$(ENV_FILE) is missing. Create it with TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, and REPO_WHITELIST_JSON."; \
		exit 1; \
	fi
	set -a; . "$(ENV_FILE)"; set +a; npm run start:polling

start-polling: start-local

start-webhook:
	@if [ ! -f "$(ENV_FILE)" ]; then \
		echo "$(ENV_FILE) is missing. Create it with TELEGRAM_BOT_TOKEN, ALLOWED_CHAT_IDS, REPO_WHITELIST_JSON, and PORT."; \
		exit 1; \
	fi
	set -a; . "$(ENV_FILE)"; set +a; npm start

init:
	PYTHONPYCACHEPREFIX=$(PYTHONPYCACHEPREFIX) ./init.sh

verify: init

build:
	npm run build

test: test-unit test-harness test-contract test-smoke

test-unit:
	npm run test:unit

test-harness:
	npm run test:harness

test-contract:
	npm run test:contract

test-smoke:
	npm run test:smoke

smoke: test-smoke

state:
	python3 scripts/verify-state.py

pycheck:
	PYTHONPYCACHEPREFIX=$(PYTHONPYCACHEPREFIX) python3 -m py_compile orchestrator.py scripts/verify-state.py

orch:
	python3 orchestrator.py --max-rounds $(ROUNDS)

orch-dry-run:
	python3 orchestrator.py --dry-run

orch-eval-all:
	python3 orchestrator.py --eval-only all

clean:
	rm -rf __pycache__ scripts/__pycache__
