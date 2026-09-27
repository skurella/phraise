// Shared convergence checks for gate D/D2: identical ProseMirror JSON and
// identical `review` state across replicas. Ported to Yjs14: the review
// map is a Y.Node attr bag (getAttrs()), not a Y.Map.toJSON().
import type { Replica } from "../replica.js";
import { REVIEW_MAP } from "../integrate.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export interface ConvergenceCheck {
  pmConverged: boolean;
  reviewConverged: boolean;
  reviewJSON: string;
}

export function checkConvergence(server: Replica, alice: Replica, bob: Replica): ConvergenceCheck {
  const pmServer = server.docToPM().toJSON();
  const pmAlice = alice.docToPM().toJSON();
  const pmBob = bob.docToPM().toJSON();
  const pmJSONs = [pmServer, pmAlice, pmBob].map(canonicalJSON);
  const pmConverged = pmJSONs.every((j) => j === pmJSONs[0]);

  const reviewJSONs = [server, alice, bob].map((r) => canonicalJSON((r.doc.get(REVIEW_MAP) as any).getAttrs()));
  const reviewConverged = reviewJSONs.every((j) => j === reviewJSONs[0]);

  return { pmConverged, reviewConverged, reviewJSON: reviewJSONs[0] };
}
