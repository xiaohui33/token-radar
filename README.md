# token-radar

Entry for the make.fun bounty [Build the best token launch radar](https://make.fun/bounty/token-radar-01).

Reads the sealed DefiLlama snapshot, ranks protocols with no token by what a launch would be worth, and serves a static dashboard with a board, a detail view per protocol and a filter.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../makefun/token-radar-01-kit/input/snapshot.json
```
