import { describe, expect, it } from "vitest";
import { MizanClient } from "../src";

const LIVE = process.env.MIZAN_LIVE === "1";
const ID = process.env.MIZAN_LIVE_ID || "v12-btc-trend-4h";

describe.skipIf(!LIVE)("live registry (MIZAN_LIVE=1)", () => {
  const c = new MizanClient();
  it(`verifies ${ID} against the real registry and bundle`, async () => {
    const r = await c.verifyCredential(ID);
    console.log(r.summary);
    expect(r.found).toBe(true);
    expect(r.hashMatch).toBe(true);
  }, 60_000);

  it("checkAgent: zkml12 is REFUSED, an unknown wallet is UNVERIFIED", async () => {
    const a = await c.checkAgent("zkml12", "copy");
    const b = await c.checkAgent("0xabc123", "pay");
    console.log(a.status, a.match, "|", b.status, b.summary);
    expect(a.status).toBe("REFUSED");
    expect(b.status).toBe("UNVERIFIED");
    expect(b.forward_to_counterparty).toBeTruthy();
  }, 60_000);

  it("listProvenAgents returns PASS rows with a disclosure", async () => {
    const r = await c.listProvenAgents(5, true);
    console.log(r.count, r.proven.map((x) => x.id).join(","));
    expect(r.proven.length).toBeGreaterThan(0);
    expect(r.proven.every((x) => x.verdict === "PASS")).toBe(true);
  }, 60_000);
});
