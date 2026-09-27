// New for this spike (brief 04, src/relay/). Plan section 5: "Author
// identity: stub. A user is `{name, email}` from the auth token `name`
// (email `<name>@users.phraise.test`)."
import type { Author } from '../engine/index.js';

export function identityFor(user: string): Author {
  return { name: user, email: `${user}@users.phraise.test` };
}
