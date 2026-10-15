import type {
  CheckAgentResult,
  CredentialSummary,
  ProvenAgentsResult,
  Dataset,
  DatasetQuery,
  DatasetsResult,
  MintPreviewBody,
  MintPreviewResult,
  MizanClientOptions,
  PublicRegistryCredential,
  Registry,
  RegistryCredential,
  SearchQuery,
  SearchResult,
  Verdict,
  VerifyOptions,
  VerifyResult,
} from "./types";

export const MIZAN_STUDIO_URL = "https://studio.mizan.market";
export const MIZAN_VERIFY_PAGE = "https://mizan.market/verify/";
export const MIZAN_SKILL_URL = "https://mizan.market/skill/";
export const MIZAN_CAVEAT =
  "A MIZAN credential is a seal on a past record, not a forecast. It proves the record was computed as claimed under committed costs and data; it does not predict future returns.";

const VERSION = "0.1.0";

/** Classify a raw registry verdict string. PASS / FAIL / NOT SIGNIFICANT / SIGNIFICANT are kept as issued. */
export function classifyVerdict(verdict: string | undefined | null): Verdict {
  const v = (verdict || "").trim().toUpperCase();
  for (const k of ["PASS", "NOT SIGNIFICANT", "SIGNIFICANT", "FAIL"] as const) {
    if (v.startsWith(k)) return k.replace(" ", "_") as Verdict;
  }
  return "LEDGER_ENTRY";
}

/** Lower-case hex SHA-256 via WebCrypto (Node >= 20, browsers, Deno, Bun). */
export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 32 random bytes as 64 hex chars. */
export function newSalt(): string {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

function summarise(r: VerifyResult): string {
  if (!r.found) return `No credential '${r.id ?? "?"}' in the public MIZAN registry: treat the record as unverified.`;
  if (r.hashMatch === false)
    return `Credential ${r.id} is listed, but its proof bundle does not hash to the registry anchor: treat as UNVERIFIED.`;
  const who = r.issuer ? ` issued by ${r.issuer}` : "";
  const prov = r.provenance ? ` Provenance: ${r.provenance}.` : "";
  const hash =
    r.hashMatch === true
      ? ` Bundle hash matches the registry (${r.hashCheck}).`
      : " Bundle hash not checked.";
  return `Credential ${r.id}${who}: verdict ${r.verdict} (as issued: "${r.verdictRaw ?? ""}").${prov}${hash}`;
}

export class MizanClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;
  private readonly ttl: number;
  private cache?: { at: number; reg: Registry };

  constructor(opts: MizanClientOptions = {}) {
    this.baseUrl = (opts.baseUrl || MIZAN_STUDIO_URL).replace(/\/+$/, "");
    const f = opts.fetch || globalThis.fetch;
    if (!f) throw new Error("mizan-agent-tools: no fetch available (Node >= 20 or pass options.fetch)");
    this.fetchImpl = f.bind(globalThis);
    this.headers = { "User-Agent": opts.userAgent || `mizan-agent-tools/${VERSION} (+${MIZAN_SKILL_URL})` };
    this.ttl = opts.cacheTtlMs ?? 60_000;
  }

  /** Resolve a registry link (absolute or studio-relative) to an absolute URL. */
  resolve(url: string | undefined | null): string | undefined {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url;
    return `${this.baseUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  credentialLink(id: string): string {
    return `${this.baseUrl}/credential/${encodeURIComponent(id)}`;
  }

  private async getJson<T>(path: string): Promise<T> {
    const res = await this.fetchImpl(this.resolve(path)!, { headers: this.headers });
    if (!res.ok) throw new Error(`MIZAN ${path}: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Full registry (GET /api/registry), cached for cacheTtlMs. */
  async getRegistry(force = false): Promise<Registry> {
    if (!force && this.cache && this.ttl > 0 && Date.now() - this.cache.at < this.ttl) return this.cache.reg;
    const reg = await this.getJson<Registry>("/api/registry");
    if (!Array.isArray(reg?.credentials)) throw new Error("MIZAN registry: unexpected response shape");
    this.cache = { at: Date.now(), reg };
    return reg;
  }

  private async publicEntry(id: string): Promise<PublicRegistryCredential | undefined> {
    try {
      const pub = await this.getJson<{ credentials?: PublicRegistryCredential[] }>("/api/public/registry");
      return (pub.credentials || []).find((c) => c.id === id);
    } catch {
      return undefined; // best effort: provenance is extra context, not a verification input
    }
  }

  private summary(c: RegistryCredential): CredentialSummary {
    return {
      id: c.id,
      alias: c.alias,
      issuer: c.issuer,
      verdict: classifyVerdict(c.verdict),
      verdictRaw: c.verdict,
      kind: c.kind ?? null,
      era: c.era ?? c.engine_era ?? null,
      dataset: c.dataset,
      mintedUtc: c.minted_utc,
      sandbox: c.sandbox === true ? true : undefined,
      disclosedMetrics: c.disclosed_metrics || undefined,
      link: this.credentialLink(c.id),
    };
  }

  /**
   * Verify a credential: registry lookup by id (or bundle sha256), then download the proof bundle and
   * check its sha256 against the registry anchor. The verdict is reported exactly as issued; a missing
   * credential or a hash mismatch yields UNVERIFIED. This does not re-run the STARK: for that, use the
   * offline verifier at https://mizan.market/verify/.
   */
  async verifyCredential(
    idOrQuery: string | { id?: string | null; sha256?: string | null },
    opts: VerifyOptions = {},
  ): Promise<VerifyResult> {
    const q = typeof idOrQuery === "string" ? { id: idOrQuery } : idOrQuery || {};
    const id = (q.id || "").trim();
    const sha = (q.sha256 || "").trim().toLowerCase();
    if (!id && !sha) throw new Error("verifyCredential: pass a credential id or a bundle sha256");
    const reg = await this.getRegistry();
    const c = reg.credentials.find(
      (x) => (id && x.id === id) || (sha && (x.anchor?.sha256 || "").toLowerCase() === sha),
    );
    if (!c) {
      const out: VerifyResult = {
        found: false,
        id: id || undefined,
        verdict: "UNVERIFIED",
        hashMatch: null,
        hashCheck: "none",
        registryRoot: reg.registry_root,
        verifyPage: MIZAN_VERIFY_PAGE,
        reason: "no such credential in the public MIZAN registry",
        summary: "",
        caveat: MIZAN_CAVEAT,
      };
      out.summary = summarise(out);
      return out;
    }
    const pub = await this.publicEntry(c.id);
    const out: VerifyResult = {
      found: true,
      id: c.id,
      alias: c.alias,
      issuer: c.issuer,
      verdict: classifyVerdict(c.verdict),
      verdictRaw: c.verdict,
      provenance: pub?.provenance,
      kind: c.kind ?? null,
      era: c.era ?? c.engine_era ?? null,
      engineImageId: c.engine_image_id ?? null,
      engineStatus: c.engine_status ?? null,
      dataset: c.dataset,
      mintedUtc: c.minted_utc,
      disclosedMetrics: c.disclosed_metrics || undefined,
      hashMatch: null,
      hashCheck: "none",
      registrySha256: c.anchor?.sha256 || undefined,
      registryRoot: reg.registry_root,
      sandbox: c.sandbox === true ? true : undefined,
      bundle: this.resolve(c.links?.bundle),
      link: this.credentialLink(c.id),
      verifyPage: MIZAN_VERIFY_PAGE,
      summary: "",
      caveat: MIZAN_CAVEAT,
    };
    const expectFull = (c.anchor?.sha256 || "").toLowerCase();
    const expectPrefix = (c.credential_hash || "").toLowerCase();
    if (opts.checkBundle === false) {
      out.reason = "bundle hash check skipped by caller";
    } else if (!out.bundle) {
      out.reason = "registry publishes no bundle link";
    } else if (!expectFull && !expectPrefix) {
      out.reason = "registry publishes no anchor hash for this credential";
    } else {
      try {
        const b = await this.fetchImpl(out.bundle, { headers: this.headers });
        if (!b.ok) {
          out.reason = `bundle not fetchable: HTTP ${b.status}`;
        } else {
          const hex = await sha256Hex(await b.arrayBuffer());
          out.bundleSha256 = hex;
          out.hashCheck = expectFull ? "sha256" : "prefix";
          out.hashMatch = expectFull ? hex === expectFull : hex.startsWith(expectPrefix);
          if (!out.hashMatch) {
            out.verdict = "UNVERIFIED";
            out.reason = "bundle sha256 does not match the registry anchor";
          }
        }
      } catch (e) {
        out.reason = `bundle not fetchable: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    out.summary = summarise(out);
    return out;
  }

  /** Search the public registry by free text, alias, issuer, verdict, dataset or kind. */
  async searchCredentials(q: SearchQuery = {}): Promise<SearchResult> {
    const reg = await this.getRegistry();
    const has = (hay: string | undefined | null, needle?: string) =>
      !needle || (hay || "").toLowerCase().includes(needle.trim().toLowerCase());
    const wantVerdict = q.verdict ? q.verdict.trim().toUpperCase().replace(/\s+/g, "_") : undefined;
    const hits = reg.credentials.filter((c) => {
      if (q.includeSandbox === false && c.sandbox === true) return false;
      if (wantVerdict && classifyVerdict(c.verdict) !== wantVerdict) return false;
      if (!has(c.alias, q.alias) || !has(c.issuer, q.issuer) || !has(c.dataset, q.dataset)) return false;
      if (q.kind && (c.kind || "").toLowerCase() !== q.kind.trim().toLowerCase()) return false;
      if (q.query) {
        const blob = [c.id, c.alias, c.dataset, c.issuer, c.verdict].join(" ").toLowerCase();
        if (!q.query.toLowerCase().split(/\s+/).filter(Boolean).every((t) => blob.includes(t))) return false;
      }
      return true;
    });
    const limit = Math.min(Math.max(q.limit ?? 20, 1), 200);
    const credentials = hits.slice(0, limit).map((c) => this.summary(c));
    return { total: hits.length, returned: credentials.length, registryRoot: reg.registry_root, credentials, caveat: MIZAN_CAVEAT };
  }

  /** Canonical public markets a sealed-path credential can be minted on (GET /api/blackbox-datasets). */
  async listDatasets(q: DatasetQuery = {}): Promise<DatasetsResult> {
    const d = await this.getJson<{ datasets: Dataset[]; max_positions?: number; max_book_assets?: number }>(
      "/api/blackbox-datasets",
    );
    const eq = (a: string | undefined, b?: string) => !b || (a || "").toLowerCase() === b.trim().toLowerCase();
    const all = (d.datasets || []).filter(
      (x) =>
        eq(x.asset, q.asset) &&
        eq(x.interval, q.interval) &&
        eq(x.venue, q.venue) &&
        eq(x.cls, q.cls) &&
        (!q.query || `${x.key} ${x.label} ${x.asset}`.toLowerCase().includes(q.query.trim().toLowerCase())),
    );
    const keep = ["key", "label", "bars", "asset", "cls", "interval", "venue", "first", "last", "sha256", "root", "align_group"] as const;
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 1000);
    const datasets = all.slice(0, limit).map((x) => {
      const o: Record<string, unknown> = {};
      for (const k of keep) if (x[k] !== undefined) o[k] = x[k];
      return o as unknown as Dataset;
    });
    return {
      total: all.length,
      returned: datasets.length,
      maxPositions: d.max_positions,
      maxBookAssets: d.max_book_assets,
      datasets,
      csv: `${this.baseUrl}/api/catalog/{key}.csv`,
    };
  }

  /**
   * One-call counterparty check: call BEFORE following, copying, paying or allocating to an agent or
   * wallet that claims returns. `agent` may be a name/alias, credential id, wallet address, ERC-8004 id,
   * agent-card URL or bundle sha256; `action` describes what you are about to do (e.g. "copy", "pay").
   * UNVERIFIED means unproven, which is not the same as false.
   */
  async checkAgent(agent: string, action?: string): Promise<CheckAgentResult> {
    const q = (agent || "").trim();
    if (!q) throw new Error("checkAgent: pass an agent name, id, wallet, ERC-8004 id, agent-card URL or sha256");
    const qs = new URLSearchParams({ q });
    if (action && action.trim()) qs.set("action", action.trim());
    const r = await this.getJson<CheckAgentResult>(`/api/agents/check?${qs.toString()}`);
    return { ...r, matches: r.matches || [], caveat: r.caveat || MIZAN_CAVEAT };
  }

  /** Credentials with a PASS verdict (by default only Bitcoin-confirmed ones: realOnly=true). */
  async listProvenAgents(limit = 25, realOnly = true): Promise<ProvenAgentsResult> {
    const n = Math.min(Math.max(Math.floor(limit) || 25, 1), 200);
    const r = await this.getJson<ProvenAgentsResult>(`/api/agents/proven?limit=${n}&real_only=${realOnly ? "true" : "false"}`);
    return { ...r, proven: r.proven || [], caveat: r.caveat || MIZAN_CAVEAT };
  }

  /**
   * Free, private gate preview on the sealed path (POST /x402/preview; no account, about 10 per IP per day).
   * Sends positions only. Nothing is published and no credential is created.
   */
  async mintPreview(body: MintPreviewBody): Promise<MintPreviewResult> {
    if (!body || !body.dataset || !Array.isArray(body.positions)) {
      throw new Error("mintPreview: dataset and positions are required");
    }
    if (body.positions.some((p) => p !== -1 && p !== 0 && p !== 1)) {
      throw new Error("mintPreview: positions must be integers in {-1, 0, 1}");
    }
    const salts = { model_salt: body.model_salt || newSalt(), track_salt: body.track_salt || newSalt() };
    const payload = {
      dataset: body.dataset,
      positions: body.positions,
      model_id: body.model_id || "preview",
      leverage_x100: body.leverage_x100 ?? 100,
      ...salts,
    };
    const note =
      "Private preview of the in-circuit gate. Nothing is published and no credential exists until a mint. Keep the salts private.";
    const res = await this.fetchImpl(`${this.baseUrl}/x402/preview`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    let j: Record<string, unknown> = {};
    try {
      j = (await res.json()) as Record<string, unknown>;
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      return { ok: false, status: res.status, error: String(j.error ?? `HTTP ${res.status}`), detail: j.detail, salts, note };
    }
    return {
      ok: true,
      status: res.status,
      gatePass: Boolean(j.gate_pass),
      sharpe: (j.sharpe as number | null) ?? null,
      cagr: (j.cagr as number | null) ?? null,
      maxdd: (j.maxdd as number | null) ?? null,
      nPeriods: j.n_periods as number | undefined,
      salts,
      note,
    };
  }
}

let _default: MizanClient | undefined;
const def = () => (_default ??= new MizanClient());

export const verifyCredential = (idOrQuery: Parameters<MizanClient["verifyCredential"]>[0], opts?: VerifyOptions) =>
  def().verifyCredential(idOrQuery, opts);
export const checkAgent = (agent: string, action?: string) => def().checkAgent(agent, action);
export const listProvenAgents = (limit?: number, realOnly?: boolean) => def().listProvenAgents(limit, realOnly);
export const searchCredentials = (q?: SearchQuery) => def().searchCredentials(q);
export const listDatasets = (q?: DatasetQuery) => def().listDatasets(q);
export const mintPreview = (body: MintPreviewBody) => def().mintPreview(body);
