// tests/setup.ts — Vitest global setup
// Node 22 rejects new Response(body, { status: 204 }) per Fetch spec (204/205/304
// must not carry a body). Our fake clients in tests pass '' as body with 204.
// Patch globalThis.Response to silently drop the body for no-content statuses so
// tests don't need to sprinkle null everywhere.

const NO_BODY_STATUSES = new Set([204, 205, 304]);
const OrigResponse = globalThis.Response;

class PatchedResponse extends OrigResponse {
  constructor(body?: BodyInit | null, init?: ResponseInit) {
    if (NO_BODY_STATUSES.has(init?.status ?? 200) && body !== null && body !== undefined) {
      super(null, init);
    } else {
      super(body, init);
    }
  }
}

// @ts-ignore — intentional patch of the global
globalThis.Response = PatchedResponse;
