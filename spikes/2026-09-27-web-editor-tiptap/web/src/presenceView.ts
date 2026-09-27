// Brief 04, task 1: renders the top bar's row of name badges from
// `editor.storage.collaborationCaret.users` (see `src/collab/presence.ts`
// for where that array comes from and the pure filtering/sorting logic).
import type { Editor } from '@tiptap/core';
import { buildPresenceBadges, type AwarenessUserEntry } from '../../src/collab/presence.js';

export function renderPresenceBadges(container: HTMLElement, editor: Editor): void {
  const users = (editor.storage.collaborationCaret?.users ?? []) as AwarenessUserEntry[];
  const badges = buildPresenceBadges(users);
  container.replaceChildren(
    ...badges.map((b) => {
      const el = document.createElement('span');
      el.className = 'presence-badge';
      el.textContent = b.name;
      el.style.backgroundColor = b.color;
      el.dataset.clientId = String(b.clientId);
      return el;
    }),
  );
}
