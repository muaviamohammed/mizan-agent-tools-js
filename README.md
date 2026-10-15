# mizan-agent-tools

Typed, dependency-free TypeScript client for MIZAN, a zero-knowledge track-record verifier for
trading strategies and AI agents. Use it so an agent can check a performance claim **before it
trusts, pays, copies or allocates**.

A MIZAN credential is a STARK proof under the open [VTR-1 standard](https://mizan.market/standard-spec)
that a track record was computed as claimed, under committed costs and data, without revealing the
strategy. FAIL verdicts are published alongside passes. A credential is a seal on a past record, not
a forecast.

```ts
import { checkAgent, listProvenAgents, verifyCredential, searchCredentials, listDatasets, mintPreview } from "mizan-agent-tools";

// Primary call: before following, copying, paying or allocating to an agent or wallet that claims returns.
const c = await checkAgent("0xabc123", "pay");
// c.status: PROVEN | REFUSED | NOT_SIGNIFICANT | UNVERIFIED (unproven, which is not the same as false)
// c.matches[], c.summary, c.forward_to_counterparty (only when UNVERIFIED), c.how_to_prove, c.caveat

await listProvenAgents(25, true); // PASS credentials, Bitcoin-confirmed only

const r = await verifyCredential("v12-btc-trend-4h");
// r.verdict: PASS | FAIL | NOT_SIGNIFICANT | SIGNIFICANT | LEDGER_ENTRY | UNVERIFIED
// r.hashMatch: bundle sha256 equals the registry anchor (true/false/null = not checked)
// r.provenance: BACKTEST | FORWARD, r.era, r.dataset, r.disclosedMetrics, r.link, r.caveat

await searchCredentials({ verdict: "PASS", issuer: "MIZAN", limit: 10 });
await listDatasets({ asset: "BTC", interval: "4h" });
await mintPreview({ dataset: "btc_4h", positions: [/* bars-1 values in {-1,0,1} */] });
```

`new MizanClient({ baseUrl, fetch, cacheTtlMs })` gives the same methods on an instance.

## What each call does

| Call | Endpoint | Notes |
|---|---|---|
| `checkAgent(agent, action?)` | `GET /api/agents/check?q=&action=` | `agent` may be a name/alias, credential id, wallet, ERC-8004 id, agent-card URL or sha256. Returns PROVEN / REFUSED / NOT_SIGNIFICANT / UNVERIFIED with matching credentials. |
| `listProvenAgents(limit = 25, realOnly = true)` | `GET /api/agents/proven` | PASS credentials; `realOnly` keeps Bitcoin-confirmed ones. Includes the issuer disclosure. |
| `verifyCredential(id \| {id, sha256})` | `GET /api/registry`, then the proof bundle | Verdict exactly as issued. Missing credential or bundle hash mismatch gives `UNVERIFIED`. Provenance read best-effort from `GET /api/public/registry`. |
| `searchCredentials({query, alias, issuer, verdict, dataset, kind, includeSandbox, limit})` | `GET /api/registry` | Client-side filter of the public registry. |
| `listDatasets({asset, interval, venue, cls, query, limit})` | `GET /api/blackbox-datasets` | Canonical markets a sealed-path credential can be minted on. CSV at `/api/catalog/{key}.csv`. |
| `mintPreview({dataset, positions, ...})` | `POST /x402/preview` | Free, private gate preview, no account, about 10 per IP per day. Positions only. Nothing is published. |

## Limits, stated plainly

- The hash check proves the bundle you downloaded is the one the registry anchored. It does not
  re-run the STARK. For full offline re-verification use the verifier at https://mizan.market/verify/.
- `/api/registry` sends no CORS headers; in a browser, proxy it or use the server side.
- Paid minting is not enabled through this client. See https://mizan.market/skill/.
- Every credential listed so far was minted by MIZAN itself (its own engines and open-testing mints).

## Develop

```bash
npm install
npm run build        # tsup → ESM + CJS + .d.ts
npm test             # unit tests, mocked fetch
npm run test:live    # live verify, checkAgent and listProvenAgents against the real API
```

MIT licensed.
