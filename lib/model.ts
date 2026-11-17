// The token radar's model: one sealed snapshot in, one ranked board out.
//
// Selection is uniform over the whole snapshot, not a watchlist plus a tail. A protocol is a subject
// when its record shows no token (mcap_usd, gecko_id and symbol all null) and it is not a derivative
// product of something that already trades: a wrapped or staked asset, a liquid-staking receipt, a
// bridge voucher, an exchange's own reserves, or a versioned pool of another protocol. The watchlist is
// a floor for coverage, never the selection rule: every pre-token protocol above it and the whole
// below-floor tail are scored by the same function.
//
// Implied value is a claim the page states, not a price. It follows only the snapshot's own figures:
// TVL, seven-day TVL momentum, category, chain reach, and the time DefiLlama has tracked the protocol
// with no token on record. The first pass below keeps the starter's flat base multiple while the
// selection is rebuilt; the next pass replaces the score with the calibrated model.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_weight: number;
  chain_cap: number;
  band_low: number;
  band_high: number;
  band_high_max: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.205,
  growth_weight: 0.4,
  growth_floor: -40,
  growth_cap: 80,
  maturity_floor: 0.82,
  maturity_range: 0.48,
  maturity_days: 1825,
  unknown_age_days: 365,
  chain_weight: 0.055,
  chain_cap: 0.22,
  band_low: 0.55,
  band_high: 1.9,
  band_high_max: 2.2,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, and what it costs in money and time. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The model's arithmetic for one row: what the page recomputes to check board.json. */
export interface RowModel {
  market_ratio: number;
  category_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  chain_multiplier: number;
  maturity_multiplier: number;
  age_days: number | null;
  value_cap_usd: number;
}

/** What the snapshot's live tokens say about one category's market-cap-to-TVL multiple. */
export interface CategoryStat {
  /** How many live tokens in this category the snapshot carries a market cap for. */
  n: number;
  /** Their median mcap/TVL, or null when the category has no live sample. */
  observed_ratio: number | null;
  /** The category's prior multiple before the snapshot's own sample is blended in. */
  prior_multiple: number;
  /** The multiple the model uses: the prior shrunk toward the category's own live median. */
  multiple: number;
}

/** The snapshot-wide calibration: what live tokens in this same snapshot say a token is worth per TVL. */
export interface Calibration {
  /** Median market cap / TVL across the snapshot's live-token protocols. */
  market_ratio: number;
  sample_size: number;
  ratio_p25: number;
  ratio_p75: number;
  ratio_p90: number;
  /** The largest live market cap in the snapshot: no implied value is allowed above it. */
  max_live_mcap: number;
  max_live_slug: string;
  /** A stand-in age for a protocol whose listed_at is null: the snapshot's median known age. */
  unknown_age_days: number;
  categories: Record<string, CategoryStat>;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: RowModel;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with its farm plan generated in the model. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: RowModel;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the page shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model and its calibration. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * How much of a live token's value each category keeps per dollar of TVL, relative to the snapshot's
 * median. These are priors, not names: where the snapshot carries a live sample in the category, the
 * sample's own median is blended in below, so the data moves the multiple.
 */
const CATEGORY_PRIOR: Record<string, number> = {
  Chain: 1.7,
  Dexs: 1.6,
  Lending: 1.35,
  Derivatives: 1.25,
  Bridge: 1.25,
  'Canonical Bridge': 1.2,
  'Cross Chain Bridge': 1.2,
  'Prediction Market': 1.2,
  'Basis Trading': 1.2,
  'Staking Pool': 1.2,
  Restaking: 1.2,
  CDP: 1.15,
  RWA: 1.15,
  'Liquid Staking': 1.1,
  'Liquid Restaking': 1.1,
  'Uncollateralized Lending': 1.05,
  Yield: 1.0,
  'Yield Aggregator': 1.0,
  CeDeFi: 0.95,
  'Risk Curators': 0.95,
  'Onchain Capital Allocator': 0.9,
  Insurance: 0.9,
  Payments: 0.9,
  'Governance Incentives': 0.75,
  'Leveraged Farming': 0.5,
  Wallets: 0.45,
  CEX: 0.45,
};

/** The prior a category with no named row gets: an ordinary protocol, exactly at the market median. */
const DEFAULT_CATEGORY_PRIOR = 1.0;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/** The q-quantile of a sorted, non-empty array, interpolating between its neighbours. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * Calibrate the model against the same snapshot it scores. The market ratio is the median market cap
 * per dollar of TVL among the protocols that already trade; the category multiple is that category's
 * own live median, shrunk toward its prior when the sample is thin. A snapshot with no live market cap
 * falls back to `model.base_multiple`, so the function never divides by zero.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter((p) => !isPreToken(p));
  const ratios = live
    .filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0)
    .map((p) => (p.mcap_usd as number) / p.tvl_usd)
    .sort((a, b) => a - b);
  const marketRatio = ratios.length > 0 ? round6(quantile(ratios, 0.5)) : model.base_multiple;

  let maxLive = live[0];
  for (const p of live) if ((p.mcap_usd ?? 0) > (maxLive?.mcap_usd ?? 0)) maxLive = p;

  const pre = snapshot.protocols.filter(isPreToken);
  const ages = pre
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const unknownAge = ages.length > 0 ? Math.round(quantile(ages, 0.5)) : model.unknown_age_days;

  const categories: Record<string, CategoryStat> = {};
  for (const p of pre) {
    const key = p.category ?? 'Uncategorised';
    if (categories[key] !== undefined) continue;
    const sample = live
      .filter((t) => (t.category ?? 'Uncategorised') === key && (t.mcap_usd ?? 0) > 0 && t.tvl_usd > 0)
      .map((t) => (t.mcap_usd as number) / t.tvl_usd)
      .sort((a, b) => a - b);
    const observed = sample.length > 0 ? round6(quantile(sample, 0.5)) : null;
    const prior = CATEGORY_PRIOR[key] ?? DEFAULT_CATEGORY_PRIOR;
    const weight = sample.length / (sample.length + 6);
    const observedMultiple = observed === null || marketRatio <= 0 ? prior : observed / marketRatio;
    const multiple =
      sample.length === 0
        ? prior
        : prior * (1 - weight) + Math.min(2.2, Math.max(0.4, observedMultiple)) * weight;
    categories[key] = {
      n: sample.length,
      observed_ratio: observed,
      prior_multiple: prior,
      multiple: round4(multiple),
    };
  }

  return {
    market_ratio: marketRatio,
    sample_size: ratios.length,
    ratio_p25: round6(quantile(ratios, 0.25)),
    ratio_p75: round6(quantile(ratios, 0.75)),
    ratio_p90: round6(quantile(ratios, 0.9)),
    max_live_mcap: maxLive?.mcap_usd ?? 0,
    max_live_slug: maxLive?.slug ?? '',
    unknown_age_days: unknownAge,
    categories,
  };
}

/** One protocol's value arithmetic: the point, the band around it, and each multiplier that made it. */
export interface ImpliedValue {
  point: number;
  low: number;
  high: number;
  ratio: number;
  categoryMult: number;
  growthPct: number;
  growthMult: number;
  chainMult: number;
  maturityMult: number;
  age: number | null;
  cap: number;
}

/**
 * One protocol's implied value under `model`, calibrated against the live tokens in `calibration`.
 *
 *   ratio      the category's live mcap/TVL multiple, from the snapshot's own trading protocols
 *   growth     1 + clamp(change_7d, -40, 80) / 100 x growth_weight
 *   chains     1 + min(chain_cap, chain_weight x log2(chains))
 *   maturity   floor + min(age_days, maturity_days) / maturity_days x range
 *   point      tvl_usd x ratio x growth x chains x maturity
 *   band       point x band_low .. point x band_high, widened when growth or age is missing
 *
 * The high end is capped by two facts in the same snapshot: no row may imply more than the largest
 * live token, and none may imply more than the 90th-percentile live mcap/TVL multiple of its own TVL.
 */
export function impliedValue(protocol: SnapshotProtocol, asOf: string, model: ModelConstants, calibration: Calibration): ImpliedValue {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const chainCount = Math.max(1, protocol.chains.length);
  const chainMult = 1 + Math.min(model.chain_cap, model.chain_weight * Math.log2(chainCount));
  const ageForModel = age ?? calibration.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const stat = calibration.categories[protocol.category ?? 'Uncategorised'];
  const ratio = (stat?.multiple ?? 1) * calibration.market_ratio;

  const cap = Math.min(calibration.max_live_mcap, protocol.tvl_usd * calibration.ratio_p90);
  const raw = protocol.tvl_usd * ratio * growthMult * chainMult * maturityMult;
  const gap = (protocol.change_7d === null ? 0.1 : 0) + (age === null ? 0.08 : 0);
  const lowFactor = Math.max(0.3, model.band_low - gap);
  const highFactor = Math.min(model.band_high_max, model.band_high + gap);

  const point = Math.max(1, Math.min(cap, Math.round(raw)));
  const high = Math.max(point, Math.min(cap, Math.round(raw * highFactor)));
  const low = Math.max(1, Math.min(point, Math.round(raw * lowFactor)));

  return {
    point,
    low,
    high,
    ratio: round6(ratio),
    categoryMult: stat?.multiple ?? 1,
    growthPct,
    growthMult: round4(growthMult),
    chainMult: round4(chainMult),
    maturityMult: round4(maturityMult),
    age,
    cap,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that is a wrapped, staked, restaked or liquid-staking product of an asset that trades. */
const PRODUCT_NAME = /\b(wrapped|staked|staking|restaked|restaking|liquid|lsts?|lrt|wbtc)\b/i;

/** The same markers in a slug, word-bounded by hyphens so `unit` is not read as `st`. */
const PRODUCT_SLUG = /(^|[-_])(wrapped|staked|staking|restaked|restaking|liquid|lsts?|lrt|wbtc|st)([-_]|$)/i;

/** An exchange's own name at the front of a protocol: its reserves are not a launch of its own. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** Categories that are derivative products or venues, not protocols whose token is still to come. */
const PRODUCT_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether `slug` is a trading protocol's slug continued by a product marker (`solvbtc` ->
 * `solvbtc-lsts`). The longer slug names the product; the shorter one is the protocol that trades.
 */
function isTickerProduct(slug: string, liveSymbols: string[], tradingSlugs: string[]): boolean {
  const s = slug.toLowerCase();
  for (const t of tradingSlugs) {
    if (t === s || !s.startsWith(`${t}-`)) continue;
    const tail = s.slice(t.length);
    if (/(^|[-_])(st|sol|btc|lst|lrt|liquid|wrapped|staked)([-_]|$)/i.test(tail)) return true;
  }
  for (const sym of liveSymbols) {
    if (sym.length < 3 || !s.startsWith(sym)) continue;
    const tail = s.slice(sym.length);
    if (/^(?:[0-9]+|x|v\d*)$/.test(tail)) return true;
  }
  return false;
}

/**
 * Whether a protocol is a derivative product of something that already trades: a wrapped or staked
 * asset, a liquid-staking receipt, a bridge voucher or an exchange's reserves. No protocol is excluded
 * for being small, new or obscure; only for being someone else's token in another wrapper.
 */
export function isDerivativeProduct(p: SnapshotProtocol, tradingSlugs: string[], liveSymbols: string[]): boolean {
  if (PRODUCT_NAME.test(p.name)) return true;
  if (PRODUCT_SLUG.test(p.slug)) return true;
  if (EXCHANGE_PREFIX.test(p.name)) return true;
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return true;
  return isTickerProduct(p.slug, liveSymbols, tradingSlugs);
}

/** Whether a protocol is a subject the radar may rank: no token recorded, and not a product of one. */
export function isRankable(p: SnapshotProtocol, tradingSlugs: string[], liveSymbols: string[]): boolean {
  return isPreToken(p) && !VERSIONED.test(p.name) && !isDerivativeProduct(p, tradingSlugs, liveSymbols);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n. Every pre-token protocol the
 * derivative filter keeps is scored, above and below the watchlist floor; the watchlist is only a
 * coverage floor, so a watchlist slug the filter somehow rejects is still carried.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL, calibration: Calibration = calibrate(snapshot, model)): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const trading = snapshot.protocols.filter((p) => !isPreToken(p));
  const tradingSlugs = trading.map((p) => p.slug);
  const liveSymbols = [...new Set(trading.map((p) => (p.symbol ?? '').toLowerCase()).filter((s) => s.length >= 3))].sort();

  const chosen = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (isRankable(p, tradingSlugs, liveSymbols)) chosen.set(p.slug, p);
  }
  // Coverage is the gate's row: a watchlist slug is carried even if a future snapshot's name makes
  // the derivative filter disagree. In this snapshot every watchlist slug already passes.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, model, calibration) }));
  scored.sort(
    (a, b) =>
      b.v.point - a.v.point ||
      b.v.high - a.v.high ||
      b.p.tvl_usd - a.p.tvl_usd ||
      (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.point,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    model: {
      market_ratio: calibration.market_ratio,
      category_multiple: round4(s.v.categoryMult),
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      chain_multiplier: round4(s.v.chainMult),
      maturity_multiplier: round4(s.v.maturityMult),
      age_days: s.v.age,
      value_cap_usd: s.v.cap,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain to repeat the position on, or null when DefiLlama counts only one. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** A chain-aware gas estimate, because "about $5" is wrong on Solana and wrong on Ethereum. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'about $6 of gas per action';
  if (c === 'solana') return 'under $0.10 of gas per action';
  if (/(base|arbitrum|optimism|linea|scroll|zksync|polygon|blast|mantle|unichain)/.test(c)) return 'under $1 of gas per action';
  return 'about $2 of gas per action';
}

/** A short dollar figure for prose: $2.75B, $104.6M, $850K. */
function fmtShortUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(n >= 100_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

/** How long the protocol has been tracked with no token, in prose. */
function ageLabel(age: number | null): string {
  if (age === null) return 'an unrecorded age';
  if (age >= 730) return `${(age / 365).toFixed(1)} years`;
  if (age >= 365) return 'about a year';
  return `${age} days`;
}

/** The seven-day TVL move in prose. */
function trendLabel(change: number | null): string {
  if (change === null) return 'no reported 7-day change';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(1)}%`;
}

/** The one position that puts real activity on a protocol of this category. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow about 40% of it in the protocol's own stablecoin and keep both positions open; the borrow is what makes this a market rather than a deposit.`;
  }
  if (c.includes('curator')) {
    return `Deposit $${capital} of USDC into the ${name}-curated USDC vault with the longest track record on ${chain}; the curator, not you, chooses the lending market underneath it.`;
  }
  if (c.includes('allocator')) {
    return `Allocate $${capital} of USDC to ${name}'s flagship USDC strategy on ${chain} and keep the share token; read the strategy's cap and lockup before you sign.`;
  }
  if (c.includes('aggregator')) {
    return `Deposit $${capital} of USDC through ${name} on ${chain} into its highest-TVL USDC vault and leave the receipt token in the same wallet.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-yield USDC vault on ${chain}, keep the receipt token in the wallet, and read the vault's fee and lockup first.`;
  }
  if (c.includes('dex')) {
    return `Provide $${capital} of USDC paired with ${chain}'s native asset in ${name}'s deepest USDC pool on ${chain}, and keep the LP receipt in the wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position; keep the notional under 20% of the margin.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} of USDC on ${name} on ${chain} and take one position in a market you can price yourself; leave the rest as dry powder for a second market.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${name}'s basis strategy on ${chain} and hold the receipt; read the funding and counterparty terms before you deposit.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of ${chain}'s native asset through ${name} and keep the liquid receipt in the wallet rather than selling it.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then swap or deposit the bridged funds once inside the same app so the volume is recorded.`;
  }
  if (c.includes('rwa')) {
    return `Buy $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it; check the issuer's redemption terms and transfer restrictions first.`;
  }
  if (c.includes('stable')) {
    return `Mint $${capital} of ${name}'s stable asset on ${chain} against the accepted collateral and hold it; check the redemption path back to the underlying.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} for a position you already hold, and keep the policy token in the farm wallet.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${name} on ${chain} and use it in the chain's largest DEX and lending market; the chain's own activity is what a launch would read.`;
  }
  if (c.includes('governance')) {
    return `Lock $${capital} of the protocol's governance asset or its LP on ${name} on ${chain} and vote in one live proposal; the gauge is the product here.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} of USDC through ${name} on ${chain} and keep the receipt; payment volume, not balance, is the metric a launch would read.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit $${capital} of USDC into ${name}'s on-chain vault on ${chain} and keep the receipt; check who custodies the off-chain leg before you sign.`;
  }
  if (c.includes('farm')) {
    return `Stake $${capital} of the pool's LP in ${name}'s farm on ${chain} and keep the staked receipt in the wallet.`;
  }
  if (c.includes('liquidity manager')) {
    return `Deposit $${capital} of USDC into a ${name}-managed LP position on ${chain} and keep the position NFT; check the manager's fee and rebalance rule.`;
  }
  return `Deposit $${capital} of USDC into ${name}'s main market on ${chain} and keep the receipt in the farm wallet.`;
}

/** A second, distinct action: a second chain when there is one, else the category's second venue. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow against the deposit on ${chain} and supply the borrowed stable into ${name}'s second market; two sides of the market count for more than one deposit.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Stake the LP receipt in ${name}'s farm if it has one, or add a second range around the current price so the position stays active.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('aggregator')) {
    return `Split the position across two ${name} vaults with different managers, so one manager's bad quarter does not end the activity.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Use the ${name} liquid receipt as collateral in a lending market on ${chain}, if one accepts it, rather than leaving it idle.`;
  }
  if (c.includes('bridge')) {
    return `Bridge a second time on a different route and swap the bridged funds once, so ${name} sees volume in two directions.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Open a second ${name} position on the other side for a week, then close both; the round trip is the activity, not the exposure.`;
  }
  if (c.includes('prediction')) {
    return `Take a second position in a different market on ${name} and let one resolve before the snapshot date.`;
  }
  if (c.includes('chain')) {
    return `Use two apps on ${name}: one swap on the largest DEX and one deposit in a lending market, both from the same wallet.`;
  }
  return `Do the same $${capital} action in a second ${name} venue on ${chain}, so the wallet shows more than one market's activity.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. Every step is derived
 * from the protocol's own record: its chain, category, TVL, seven-day move, age and chain reach. The
 * plan names the venue, the deposit, the cadence, the signals and what to watch at a token event, and
 * it costs the position out in dollars and days. No sentence is shared verbatim between two rows.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const secondChain = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const trend = trendLabel(p.change_7d);
  const floor = fmtShortUsd(p.tvl_usd * 0.8);
  const chains = p.chains.length;
  const chainWord = chains === 1 ? 'chain' : 'chains';

  const second = secondChain === null
    ? secondActionFor(p, capital, chain)
    : `Repeat the same $${capital} position on ${secondChain}, using the same wallet: ${p.name} counts TVL on ${chains} ${chainWord}, and a launch that rewards reach usually snapshots more than one.`;

  return [
    {
      text: `Set up a wallet that holds only the funds you will farm ${p.name} with, bridge or buy $${capital + 20} of USDC on ${chain}, and keep the seed phrase offline; never farm from a wallet that holds your savings.`,
      cost: 'about $5 in bridge and gas fees',
      time: '15 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital plus ${gasNote(chain)}`,
      time: '15 minutes to open',
    },
    {
      text: second,
      cost: secondChain === null ? 'no new capital, only gas' : `$${capital} more to fund it, or $${Math.round(capital / 2)} to test it`,
      time: secondChain === null ? '10 minutes' : '20 minutes plus bridge time',
    },
    {
      text: `Hold at least ${hold} days and make one small action every 7-10 days; ${p.name} has been listed ${ageLabel(age)} with no token on record, so a snapshot can land in any quarter.`,
      cost: 'about $2 of gas a week',
      time: `${hold} days`,
    },
    {
      text: `Track ${p.name}'s public TVL: ${fmtShortUsd(p.tvl_usd)} today, ${trend} over 7 days, across ${chains} ${chainWord}; keep farming while it stays above ${floor} and the token record stays empty.`,
      cost: 'nothing, it is public data',
      time: '5 minutes a week',
    },
    {
      text: `At TGE, compare ${p.name}'s launch FDV with this board's implied value and range, check the claim page on ${p.name}'s official site and X account for the snapshot date and any lockup, and never pay a fee or sign a permit to claim.`,
      cost: `no fee; a claim costs only gas on ${chain}`,
      time: '30 minutes on the day',
    },
    {
      text: `Exit in order: withdraw from ${p.name}, repay any borrow, then bridge back; log the wallet, dates, tx hashes and the entry TVL so the position can be repeated or unwound.`,
      cost: 'about $5-10 of exit gas',
      time: '20 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the model. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    model: row.model,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const board = buildBoard(snapshot, model, calibration);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    calibration,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, size, ranks, order, one shared value, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate takes`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4000 the gate takes`;
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}