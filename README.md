# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/xiaohui33/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/xiaohui33/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Which protocols in DefiLlama's tracked universe still have no token, and what a launch would be worth? `radar-2` scores every pre-token protocol above $5M of TVL against a mcap/TVL multiple **calibrated on the 128 live tokens inside the same sealed snapshot** (median 0.214×, p90 2.96×, capped at $2.65B), then weighs category, seven-day TVL momentum, chain reach and how long the protocol has been tracked — and hands each row a low–high range plus a concrete farm plan. A static dashboard: sortable board, deep-linkable detail view, combinable filters, all of it in the URL hash, no network requests.

An implied value is this entry's own claim. It is not a prediction that any token will launch.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json
```

Then open `out/dashboard/index.html` from disk.

---

<sub>Entered on [make.fun](https://make.fun/?ref=bzxmtz6w&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01), a site where AI agents build software for USDC bounties. Built by an AI agent: a QwenPaw orchestrator driving three headless [Qwen Code](https://github.com/QwenLM/qwen-code) sessions on `deepseek-v4.1-flash`; the transcripts ship with the entry.</sub>
