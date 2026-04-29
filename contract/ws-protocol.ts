/**
 * DNDAR WebSocket Protocol  —  dndar/1
 *
 * Source of truth: DNDAR/contract/ws-protocol.ts  (iOS publisher owns the schema)
 * Mirror copy:     draw-sphere/contract/ws-protocol.ts  (must stay identical)
 *
 * Direction:  iOS app  →  FoundryVTT module  (unidirectional, fire-and-forget)
 * Transport:  WebSocket, UTF-8 JSON text frames
 *
 * ── Coordinate system ────────────────────────────────────────────────────────
 *   x, y  — normalised [0.0, 1.0]:  0,0 = top-left of TV screen
 *   rotation — radians, clockwise from east (→), range [−π, π]
 *
 * ── Message lifecycle ────────────────────────────────────────────────────────
 *   marker_update  sent every frame (~10 fps) while a marker is on the table.
 *                  Module must create the template on first receipt and update
 *                  position on subsequent ones.
 *   marker_lost    sent once immediately when a marker leaves the table.
 *                  Module must delete the corresponding template with no delay.
 */

// ── Protocol version ─────────────────────────────────────────────────────────

export const PROTOCOL = "dndar/1" as const;

// ── Spell templates ───────────────────────────────────────────────────────────

export interface CircleTemplate {
  kind: "circle";
  sizeFt: number;       // radius in feet (e.g. 20 for Fireball)
}

export interface ConeTemplate {
  kind: "cone";
  sizeFt: number;       // length in feet
  angleDeg: number;     // opening angle in degrees; D&D 5e default: 60
}

export interface RayTemplate {
  kind: "ray";
  sizeFt: number;       // length in feet
  widthFt: number;      // width in feet; D&D 5e default: 5
}

export interface RectTemplate {
  kind: "rect";
  sizeFt: number;       // length of the longer side in feet
  widthFt: number;      // width in feet (equal to sizeFt for a square)
}

export interface RulerBeginTemplate {
  kind: "ruler_begin";
  pairedMarkerId: number;  // arucoId of the ruler_end marker
}

export interface RulerEndTemplate {
  kind: "ruler_end";
  pairedMarkerId: number;  // arucoId of the ruler_begin marker
}

export type SpellTemplate =
  | CircleTemplate
  | ConeTemplate
  | RayTemplate
  | RectTemplate
  | RulerBeginTemplate
  | RulerEndTemplate;

// ── Messages ──────────────────────────────────────────────────────────────────

export interface MarkerUpdate {
  protocol: typeof PROTOCOL;
  type: "marker_update";
  markerId: number;     // ArUco ID; 0–3 reserved for table corners, 4+ are tokens
  x: number;           // [0.0, 1.0]
  y: number;           // [0.0, 1.0]
  rotation: number;    // radians
  template: SpellTemplate;
}

export interface MarkerLost {
  protocol: typeof PROTOCOL;
  type: "marker_lost";
  markerId: number;
}

export type WSMessage = MarkerUpdate | MarkerLost;

// ── Runtime validator ─────────────────────────────────────────────────────────
// Use in the module to reject malformed or future-version messages.

export function parseWSMessage(raw: string): WSMessage | null {
  let msg: unknown;
  try { msg = JSON.parse(raw); } catch { return null; }

  if (typeof msg !== "object" || msg === null) return null;
  const m = msg as Record<string, unknown>;

  if (m.protocol !== PROTOCOL) return null;
  if (typeof m.markerId !== "number") return null;

  if (m.type === "marker_lost") {
    return m as unknown as MarkerLost;
  }

  if (m.type === "marker_update") {
    if (typeof m.x !== "number" || typeof m.y !== "number") return null;
    if (typeof m.rotation !== "number") return null;
    const t = m.template as Record<string, unknown> | undefined;
    if (!t || typeof t.kind !== "string") return null;
    return m as unknown as MarkerUpdate;
  }

  return null;
}

// ── Changelog ─────────────────────────────────────────────────────────────────
// v1  2026-04-29  initial: marker_update + marker_lost, all 6 template kinds
