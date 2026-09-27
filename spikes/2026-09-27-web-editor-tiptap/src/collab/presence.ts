// Brief 04, task 1: presence. `@tiptap/extension-collaboration-caret`
// already turns `provider.awareness.states` into
// `editor.storage.collaborationCaret.users`, an array of
// `{clientId, ...user}` (see its `awarenessStatesToArray`, confirmed by
// reading `node_modules/@tiptap/extension-collaboration-caret/dist/*.js`
// before relying on it), refreshed on the provider's own awareness `update`
// event. This module is the pure, schema-free, DOM-free logic around that
// data: a deterministic colour per user name, and turning the raw awareness
// array into the badge row's data, both unit-tested headless.
//
// `colorForName` moved here unchanged from brief 01's `web/src/main.ts` (it
// was already schema-free and pure; briefs 01-03 just had no `src/`-level
// home for it yet, and the brief asks unit tests for it now).

/**
 * Deterministic hex colour string from a name, so the same user always
 * gets the same cursor/badge colour. Returns `#rrggbb`, NOT `hsl(...)`: a
 * real bug found while testing gate D (not guessed -- see the builder
 * log) is that `@tiptap/extension-collaboration-caret`'s own
 * `sanitizeUserColor` helper runs `isValidColor` (`/^#[0-9a-fA-F]{6}$/`)
 * on every user's colour BEFORE calling our `render`/`selectionRender`
 * callbacks, silently replacing anything that doesn't match --
 * including a perfectly valid CSS `hsl(...)` string -- with `transparent`.
 * The hue computation is unchanged; only the final HSL->RGB->hex
 * conversion is new.
 */
export function colorForName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 65, 45);
}

/** Standard HSL -> RGB -> `#rrggbb` conversion (h in [0,360), s/l in [0,100]). */
function hslToHex(h: number, s: number, l: number): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sNorm * Math.min(lNorm, 1 - lNorm);
  const f = (n: number) => lNorm - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toHex = (x: number) =>
    Math.round(255 * x)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** Shape of one entry in `editor.storage.collaborationCaret.users`. */
export interface AwarenessUserEntry {
  clientId: number;
  name?: string;
  color?: string;
  [key: string]: unknown;
}

export interface PresenceBadge {
  clientId: number;
  name: string;
  color: string;
}

/**
 * Turn the raw awareness-derived user array into the top bar's badge list:
 * drop any connection that hasn't set a `user` field yet (a client between
 * connecting and CollaborationCaret's `setLocalStateField('user', ...)`
 * call), fill in a colour from the name when the entry didn't carry one of
 * its own, and sort by name then clientId so the row's order is stable
 * (does not reshuffle on every awareness update just because a Map iterated
 * in a different order) and testable.
 */
export function buildPresenceBadges(users: readonly AwarenessUserEntry[]): PresenceBadge[] {
  const badges: PresenceBadge[] = [];
  for (const u of users) {
    if (!u.name) continue;
    badges.push({ clientId: u.clientId, name: u.name, color: u.color || colorForName(u.name) });
  }
  badges.sort((a, b) => a.name.localeCompare(b.name) || a.clientId - b.clientId);
  return badges;
}
