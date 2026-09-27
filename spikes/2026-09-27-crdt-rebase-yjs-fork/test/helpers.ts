import type { Author } from "../src/seed.js";

export const DOC_ID = "test-doc";

export const AUTHOR: Author = {
  name: "Test Author",
  email: "test@example.com",
};

export const GRANULARITIES = ["word", "char", "block", "yprosemirror"] as const;
