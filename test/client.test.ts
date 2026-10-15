import { describe, expect, it, vi } from "vitest";
import { MizanClient, classifyVerdict, sha256Hex, MIZAN_CAVEAT } from "../src";

const enc = new TextEncoder();
const BUNDLE = enc.encode("bundle-bytes");

async function fixtures() {
  const full = await sha256Hex(BUNDLE);
  return {
    full,
    registry: {
      registry_root: "root123",
      count: 4,
      credentials: [
        {
          id: "v12-btc-trend-4h",
          alias: "BTC-TREND-4H",
          issuer: "MIZAN",
          dataset: "BTC · 4h OHLC",
          verdict: "PASS",
          kind: "gate",
          era: "guest v12 · 659bdb67…",
          engine_image_id: "659bdb678a3d",
          anchor: { sha256: full },
          credential_hash: full.slice(0, 16),
          disclosed_metrics: { sharpe: 1.34, cagr_pct: 20.7, mdd_pct: 22.26 },
          links: { bundle: "https://mizan.market/verify/files/a.bundle" },
        },
        {
          id: "bb-relative",
          alias: "BOOK DEMO",
          issuer: "MIZAN Studio · self-serve sealed mint",
          dataset: "btc_4h + eth_4h",
          verdict: "PASS",
          kind: "sealed",
          sandbox: true,
          anchor: null,
          credential_hash: full.slice(0, 16),
          links: { bundle: "/api/blackbox-submission/x/bundle" },
        },
        {
          id: "legend-spy-buyhold",
          alias: "SPY buy and hold",
          issuer: "MIZAN",
          dataset: "SPY daily",
          verdict: "FAIL — published anyway",
          kind: "honest_fail",
          anchor: { sha256: "ff".repeat(32) },
          links: { bundle: "https://mizan.market/verify/files/spy.bundle" },
        },
        { id: "dsr10-flagship", issuer: "MIZAN", verdict: "NOT SIGNIFICANT", kind: "dsr", links: {} },
      ],
    },
  };
}

function mockFetch(routes: Record<string, () => Response | Promise<Response>>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response("not found", { status: 404 });
    return routes[key]();
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json" } });

describe("classifyVerdict", () => {
  it("keeps issued verdicts and maps the rest to LEDGER_ENTRY", () => {
    expect(classifyVerdict("PASS ✓ — Sharpe≥1.20")).toBe("PASS");
    expect(classifyVerdict("FAIL · SharpeTooLow")).toBe("FAIL");
    expect(classifyVerdict("NOT SIGNIFICANT")).toBe("NOT_SIGNIFICANT");
    expect(classifyVerdict("SIGNIFICANT · 95%")).toBe("SIGNIFICANT");
    expect(classifyVerdict("LABELS SEALED")).toBe("LEDGER_ENTRY");
    expect(classifyVerdict(undefined)).toBe("LEDGER_ENTRY");
  });
});

describe("verifyCredential", () => {
  it("returns PASS with a full sha256 match, provenance, metrics, link and caveat", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({
      "/api/registry": () => json(registry),
      "/api/public/registry": () => json({ credentials: [{ id: "v12-btc-trend-4h", provenance: "BACKTEST" }] }),
      "/a.bundle": () => new Response(BUNDLE),
    });
    const r = await new MizanClient({ fetch: f }).verifyCredential("v12-btc-trend-4h");
    expect(r.found).toBe(true);
    expect(r.verdict).toBe("PASS");
    expect(r.hashMatch).toBe(true);
    expect(r.hashCheck).toBe("sha256");
    expect(r.provenance).toBe("BACKTEST");
    expect(r.era).toContain("v12");
    expect(r.disclosedMetrics?.sharpe).toBe(1.34);
    expect(r.link).toBe("https://studio.mizan.market/credential/v12-btc-trend-4h");
    expect(r.caveat).toBe(MIZAN_CAVEAT);
    expect(r.caveat).toContain("not a forecast");
    expect(r.summary).toContain("PASS");
  });

  it("resolves relative bundle links and checks the 16-hex prefix when no anchor digest exists", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({
      "/api/registry": () => json(registry),
      "/api/public/registry": () => json({ credentials: [] }),
      "/api/blackbox-submission/x/bundle": () => new Response(BUNDLE),
    });
    const r = await new MizanClient({ fetch: f }).verifyCredential({ id: "bb-relative" });
    expect(r.bundle).toBe("https://studio.mizan.market/api/blackbox-submission/x/bundle");
    expect(r.hashCheck).toBe("prefix");
    expect(r.hashMatch).toBe(true);
    expect(r.sandbox).toBe(true);
  });

  it("downgrades to UNVERIFIED on a hash mismatch", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({
      "/api/registry": () => json(registry),
      "/api/public/registry": () => json({ credentials: [] }),
      "/spy.bundle": () => new Response(BUNDLE),
    });
    const r = await new MizanClient({ fetch: f }).verifyCredential("legend-spy-buyhold");
    expect(r.hashMatch).toBe(false);
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.verdictRaw).toContain("FAIL");
    expect(r.reason).toMatch(/does not match/);
  });

  it("finds a credential by bundle sha256", async () => {
    const { registry, full } = await fixtures();
    const f = mockFetch({
      "/api/registry": () => json(registry),
      "/api/public/registry": () => json({ credentials: [] }),
      "/a.bundle": () => new Response(BUNDLE),
    });
    const r = await new MizanClient({ fetch: f }).verifyCredential({ sha256: full.toUpperCase() });
    expect(r.id).toBe("v12-btc-trend-4h");
  });

  it("returns UNVERIFIED for an unknown id", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({ "/api/registry": () => json(registry) });
    const r = await new MizanClient({ fetch: f }).verifyCredential("nope");
    expect(r.found).toBe(false);
    expect(r.verdict).toBe("UNVERIFIED");
    expect(r.summary).toMatch(/unverified/);
  });

  it("keeps the issued verdict but hashMatch null when the bundle is unreachable or absent", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({
      "/api/registry": () => json(registry),
      "/api/public/registry": () => json({}, 500),
      "/a.bundle": () => new Response("x", { status: 503 }),
    });
    const c = new MizanClient({ fetch: f });
    const r = await c.verifyCredential("v12-btc-trend-4h");
    expect(r.verdict).toBe("PASS");
    expect(r.hashMatch).toBeNull();
    expect(r.provenance).toBeUndefined();
    expect(r.reason).toContain("503");
    const d = await c.verifyCredential("dsr10-flagship");
    expect(d.verdict).toBe("NOT_SIGNIFICANT");
    expect(d.reason).toMatch(/no bundle link/);
  });

  it("skips the bundle when checkBundle=false and throws on empty input", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({ "/api/registry": () => json(registry), "/api/public/registry": () => json({}) });
    const c = new MizanClient({ fetch: f });
    const r = await c.verifyCredential("v12-btc-trend-4h", { checkBundle: false });
    expect(r.hashMatch).toBeNull();
    expect(f.mock.calls.some((x: unknown[]) => String(x[0]).endsWith(".bundle"))).toBe(false);
    await expect(c.verifyCredential("")).rejects.toThrow(/credential id/);
  });

  it("surfaces registry HTTP errors", async () => {
    const f = mockFetch({ "/api/registry": () => json({}, 503) });
    await expect(new MizanClient({ fetch: f }).verifyCredential("x")).rejects.toThrow(/503/);
  });

  it("caches the registry within the TTL", async () => {
    const { registry } = await fixtures();
    const f = mockFetch({ "/api/registry": () => json(registry), "/api/public/registry": () => json({}) });
    const c = new MizanClient({ fetch: f });
    await c.searchCredentials({});
    await c.searchCredentials({ verdict: "FAIL" });
    expect(f.mock.calls.filter((x: unknown[]) => String(x[0]).endsWith("/api/registry")).length).toBe(1);
  });
});

describe("searchCredentials", () => {
  it("filters by verdict, issuer, alias, free text and sandbox", async () => {
    const { registry } = await fixtures();
    const c = new MizanClient({ fetch: mockFetch({ "/api/registry": () => json(registry) }) });
    expect((await c.searchCredentials({ verdict: "PASS" })).total).toBe(2);
    expect((await c.searchCredentials({ verdict: "PASS", includeSandbox: false })).total).toBe(1);
    expect((await c.searchCredentials({ verdict: "not significant" })).credentials[0].id).toBe("dsr10-flagship");
    expect((await c.searchCredentials({ issuer: "studio" })).credentials[0].id).toBe("bb-relative");
    expect((await c.searchCredentials({ alias: "spy" })).credentials[0].verdict).toBe("FAIL");
    expect((await c.searchCredentials({ query: "btc 4h" })).total).toBe(2);
    expect((await c.searchCredentials({ query: "btc trend" })).total).toBe(1);
    const lim = await c.searchCredentials({ limit: 1 });
    expect(lim.returned).toBe(1);
    expect(lim.total).toBe(4);
    expect(lim.credentials[0].link).toMatch(/\/credential\//);
    expect(lim.caveat).toContain("not a forecast");
  });
});

describe("listDatasets", () => {
  it("filters and trims datasets", async () => {
    const f = mockFetch({
      "/api/blackbox-datasets": () =>
        json({
          max_positions: 13000,
          max_book_assets: 8,
          datasets: [
            { key: "btc_4h", label: "BTC · 4h", asset: "BTC", interval: "4h", bars: 12917, ppy: 2190 },
            { key: "eth_1d", label: "ETH · 1d", asset: "ETH", interval: "1d", bars: 2000 },
          ],
        }),
    });
    const r = await new MizanClient({ fetch: f }).listDatasets({ asset: "btc" });
    expect(r.total).toBe(1);
    expect(r.datasets[0].key).toBe("btc_4h");
    expect((r.datasets[0] as unknown as Record<string, unknown>).ppy).toBeUndefined();
    expect(r.maxPositions).toBe(13000);
    expect(r.csv).toContain("{key}.csv");
  });
});

describe("mintPreview", () => {
  it("posts positions only, generates salts, and maps the gate result", async () => {
    let sent: Record<string, unknown> = {};
    const f = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return json({ preview: true, gate_pass: false, sharpe: 0.4, cagr: 0.03, maxdd: 0.3, n_periods: 3 });
    }) as unknown as typeof fetch;
    const r = await new MizanClient({ fetch: f }).mintPreview({ dataset: "btc_4h", positions: [1, 0, -1] });
    expect(Object.keys(sent).sort()).toEqual(
      ["dataset", "leverage_x100", "model_id", "model_salt", "positions", "track_salt"].sort(),
    );
    expect(String(sent.model_salt)).toMatch(/^[0-9a-f]{64}$/);
    expect(r.ok).toBe(true);
    expect(r.gatePass).toBe(false);
    expect(r.nPeriods).toBe(3);
    expect(r.salts.track_salt).toBe(sent.track_salt);
  });

  it("returns rate-limit errors as data and rejects bad positions", async () => {
    const f = vi.fn(async () => json({ error: "preview limit reached for today" }, 429)) as unknown as typeof fetch;
    const c = new MizanClient({ fetch: f });
    const r = await c.mintPreview({ dataset: "btc_4h", positions: [1] });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(r.error).toMatch(/limit/);
    await expect(c.mintPreview({ dataset: "btc_4h", positions: [2] })).rejects.toThrow(/-1, 0, 1/);
  });
});

describe("checkAgent / listProvenAgents", () => {
  it("passes q and action, and keeps the UNVERIFIED forward text", async () => {
    let url = "";
    const f = vi.fn(async (u: RequestInfo | URL) => {
      url = String(u);
      return json({
        query: "0xabc123",
        status: "UNVERIFIED",
        found: false,
        matches: [],
        summary: "No MIZAN credential matches this agent. Its claimed performance is unproven, which is not the same as false.",
        forward_to_counterparty: "I checked your track record with MIZAN...",
        caveat: "A credential is a seal on a past record, not a forecast.",
      });
    }) as unknown as typeof fetch;
    const r = await new MizanClient({ fetch: f }).checkAgent(" 0xabc123 ", "pay");
    expect(url).toBe("https://studio.mizan.market/api/agents/check?q=0xabc123&action=pay");
    expect(r.status).toBe("UNVERIFIED");
    expect(r.summary).toMatch(/not the same as false/);
    expect(r.forward_to_counterparty).toBeTruthy();
    await expect(new MizanClient({ fetch: f }).checkAgent("")).rejects.toThrow(/agent name/);
  });

  it("returns REFUSED partial matches and fills a missing caveat", async () => {
    const f = vi.fn(async () =>
      json({ query: "zkml12", status: "REFUSED", found: true, match: "partial (check the alias)", matches: [{ id: "zkml12-a", verdict: "FAIL" }], summary: "REFUSED" }),
    ) as unknown as typeof fetch;
    const r = await new MizanClient({ fetch: f }).checkAgent("zkml12");
    expect(r.status).toBe("REFUSED");
    expect(r.matches[0].id).toBe("zkml12-a");
    expect(r.caveat).toBe(MIZAN_CAVEAT);
  });

  it("lists proven agents with limit and real_only", async () => {
    let url = "";
    const f = vi.fn(async (u: RequestInfo | URL) => {
      url = String(u);
      return json({ count: 1, proven: [{ id: "v12-btc-trend-4h", verdict: "PASS", bitcoin_confirmed: true }], disclosure: "minted by MIZAN itself", caveat: "c" });
    }) as unknown as typeof fetch;
    const r = await new MizanClient({ fetch: f }).listProvenAgents(5, false);
    expect(url).toBe("https://studio.mizan.market/api/agents/proven?limit=5&real_only=false");
    expect(r.proven[0].id).toBe("v12-btc-trend-4h");
    expect(r.disclosure).toMatch(/MIZAN itself/);
  });

  it("surfaces HTTP errors", async () => {
    const f = vi.fn(async () => json({}, 500)) as unknown as typeof fetch;
    await expect(new MizanClient({ fetch: f }).listProvenAgents()).rejects.toThrow(/500/);
  });
});
