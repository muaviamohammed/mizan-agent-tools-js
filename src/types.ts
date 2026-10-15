/** Normalised verdict. PASS / FAIL / NOT_SIGNIFICANT / SIGNIFICANT are reported exactly as issued;
 * LEDGER_ENTRY is a sealed statistic with no pass/fail gate; UNVERIFIED means the credential is
 * missing from the registry or its bundle does not hash to the registry anchor. */
export type Verdict = "PASS" | "FAIL" | "NOT_SIGNIFICANT" | "SIGNIFICANT" | "LEDGER_ENTRY" | "UNVERIFIED";

/** A credential entry as served by GET /api/registry (only the fields this client reads). */
export interface RegistryCredential {
  id: string;
  alias?: string;
  issuer?: string;
  dataset?: string;
  minted_utc?: string;
  verdict?: string;
  kind?: string | null;
  era?: string | null;
  engine_era?: string | null;
  engine_image_id?: string | null;
  engine_status?: string | null;
  real_verified?: boolean;
  sandbox?: boolean;
  credential_hash?: string;
  anchor?: { sha256?: string; ots_state?: string; tsa_time_utc?: string } | null;
  disclosed_metrics?: Record<string, number | null> | null;
  links?: Record<string, string | undefined> | null;
  verify_command?: string;
  registry_leaf?: string;
  registry_root?: string;
  trials_n?: number | null;
}

export interface Registry {
  credentials: RegistryCredential[];
  count?: number;
  registry_root?: string;
}

/** Entry from the CORS-enabled public registry (GET /api/public/registry). */
export interface PublicRegistryCredential {
  id: string;
  verdict_class?: string;
  provenance?: string;
  page?: string;
  badge?: string;
}

export interface VerifyOptions {
  /** Download the proof bundle and check its sha256 against the registry anchor (default true). */
  checkBundle?: boolean;
}

export interface VerifyResult {
  found: boolean;
  id?: string;
  alias?: string;
  issuer?: string;
  /** Normalised verdict; see {@link Verdict}. */
  verdict: Verdict;
  /** The verdict string exactly as the registry issued it. */
  verdictRaw?: string;
  /** BACKTEST: the returns of the committed positions are proven, not that they were chosen in advance.
   * FORWARD: positions were committed before the market moved. Undefined if the public registry was unreachable. */
  provenance?: string;
  kind?: string | null;
  era?: string | null;
  engineImageId?: string | null;
  engineStatus?: string | null;
  dataset?: string;
  mintedUtc?: string;
  /** Metrics the holder chose to disclose. Absent metrics were not disclosed, not zero. */
  disclosedMetrics?: Record<string, number | null>;
  /** true = bundle bytes hash to the registry anchor; false = mismatch (verdict downgraded to UNVERIFIED);
   * null = not checked or bundle not fetchable. */
  hashMatch: boolean | null;
  /** "sha256" when compared to the full anchor digest, "prefix" when only the 16-hex credential hash was published. */
  hashCheck?: "sha256" | "prefix" | "none";
  bundleSha256?: string;
  registrySha256?: string;
  registryRoot?: string;
  /** True when the registry marks this as a sandbox (open-testing) mint. */
  sandbox?: boolean;
  bundle?: string;
  link?: string;
  verifyPage: string;
  reason?: string;
  /** One-line plain-English summary for an LLM to relay. */
  summary: string;
  caveat: string;
}

export interface SearchQuery {
  /** Free text matched against id, alias, dataset and issuer (case-insensitive). */
  query?: string;
  alias?: string;
  issuer?: string;
  /** Normalised verdict to filter on (e.g. "PASS", "FAIL"). */
  verdict?: Verdict | string;
  dataset?: string;
  kind?: string;
  /** Include sandbox (open-testing) mints. Default true. */
  includeSandbox?: boolean;
  /** Max results (default 20, max 200). */
  limit?: number;
}

export interface CredentialSummary {
  id: string;
  alias?: string;
  issuer?: string;
  verdict: Verdict;
  verdictRaw?: string;
  kind?: string | null;
  era?: string | null;
  dataset?: string;
  mintedUtc?: string;
  sandbox?: boolean;
  disclosedMetrics?: Record<string, number | null>;
  link: string;
}

export interface SearchResult {
  total: number;
  returned: number;
  registryRoot?: string;
  credentials: CredentialSummary[];
  caveat: string;
}

export interface Dataset {
  key: string;
  label?: string;
  bars?: number;
  asset?: string;
  cls?: string;
  interval?: string;
  venue?: string;
  first?: string;
  last?: string;
  sha256?: string;
  root?: string;
  align_group?: string;
}

export interface DatasetQuery {
  query?: string;
  asset?: string;
  interval?: string;
  venue?: string;
  cls?: string;
  /** Max results (default 50, max 1000). */
  limit?: number;
}

export interface DatasetsResult {
  total: number;
  returned: number;
  maxPositions?: number;
  maxBookAssets?: number;
  datasets: Dataset[];
  csv: string;
}

/** Body for the free sealed-path preview. Positions only: never send a model, weights, code or prompt. */
export interface MintPreviewBody {
  dataset: string;
  /** Exactly bars-1 integers in {-1, 0, 1}, one per bar-move. */
  positions: number[];
  /** Private label for the sealed model (not disclosed). Default "preview". */
  model_id?: string;
  /** 64 hex chars. Generated if omitted; keep it private to extend a record later. */
  model_salt?: string;
  track_salt?: string;
  leverage_x100?: number;
}

export interface MintPreviewResult {
  ok: boolean;
  status: number;
  gatePass?: boolean;
  sharpe?: number | null;
  cagr?: number | null;
  maxdd?: number | null;
  nPeriods?: number;
  error?: string;
  detail?: unknown;
  salts: { model_salt: string; track_salt: string };
  note: string;
}

export interface MizanClientOptions {
  /** Studio base URL. Default https://studio.mizan.market */
  baseUrl?: string;
  /** Custom fetch (tests, proxies). Default globalThis.fetch. */
  fetch?: typeof fetch;
  /** User-Agent header sent where the runtime allows it. */
  userAgent?: string;
  /** Registry cache lifetime in ms (default 60000; 0 disables). */
  cacheTtlMs?: number;
}

/** Row shape returned by /api/agents/check (matches) and /api/agents/proven (proven). */
export interface AgentMatch {
  id: string;
  alias?: string;
  verdict?: string;
  verdict_raw?: string;
  kind?: string | null;
  issuer?: string;
  dataset?: string;
  minted_utc?: string;
  bitcoin_confirmed?: boolean;
  engine_era?: string | null;
  page?: string;
  verify?: string;
}

/** PROVEN = a PASS credential matches; REFUSED = a matching record was submitted and refused by the gate;
 * NOT_SIGNIFICANT = matched but not statistically significant; UNVERIFIED = no credential (unproven, not false). */
export type AgentStatus = "PROVEN" | "REFUSED" | "NOT_SIGNIFICANT" | "UNVERIFIED";

export interface CheckAgentResult {
  query: string;
  status: AgentStatus | string;
  found: boolean;
  /** e.g. "exact" or "partial (check the alias)". */
  match?: string;
  matches: AgentMatch[];
  count?: number;
  summary: string;
  next?: string;
  advice?: string;
  /** Only when UNVERIFIED: a message the agent may forward to the counterparty. */
  forward_to_counterparty?: string;
  how_to_prove?: Record<string, string>;
  caveat: string;
}

export interface ProvenAgentsResult {
  count: number;
  proven: AgentMatch[];
  filter?: string;
  disclosure?: string;
  caveat: string;
}
