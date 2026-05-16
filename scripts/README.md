# Scripts

Utility scripts used by the repository verification flow.

## verify-state.py

Validates durable planning state for the long-running agent workflow. It checks that `feature_list.json` has a top-level `features` array, required feature fields, unique `Fxxx` IDs, valid status and pass combinations, and non-negative attempt counts. It also checks `SPEC.md` for banned ambiguous wording.

`init.sh` runs this script with:

```bash
python3 scripts/verify-state.py
```

## smoke.js

Runs a lightweight startup smoke check for the Node.js application in test mode.

Run it directly with:

```bash
node scripts/smoke.js
```

Or through npm with either:

```bash
npm run smoke
npm run test:smoke
```

## clear-runtime-history.js

Clears local Bot runtime history after first refusing to run when any task in `runtime_state.json` is `running` or `stopping`.

The script preserves `currentRepo`, `cwd`, and `telegramUpdateOffset`, then clears task metadata, agent session bindings, agent chat mode flags, approval requests, approval allow rules, and `logs/*.log`.

Run it through Make with:

```bash
make clean-history
```

Preview the cleanup without writing files:

```bash
node scripts/clear-runtime-history.js --dry-run
```

## set-telegram-webhook.js

Registers the deployed Telegram webhook URL with Telegram. It requires `TELEGRAM_BOT_TOKEN` and an HTTPS `TELEGRAM_WEBHOOK_URL`.

Run it through npm with:

```bash
npm run webhook:set
```
