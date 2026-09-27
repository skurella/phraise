// 30+ hand-written A/B markdown pairs for the rebase test, covering the
// edit kinds the brief's definition of done lists.
export interface ABPair {
  name: string;
  a: string;
  b: string;
}

export const AB_PAIRS: ABPair[] = [
  {
    name: "word change",
    a: "The quick brown fox jumps over the lazy dog.\n",
    b: "The quick brown fox leaps over the lazy dog.\n",
  },
  {
    name: "word change, second sentence",
    a: "Intro paragraph.\n\nThe cat sat on the mat.\n",
    b: "Intro paragraph.\n\nThe cat sat on the rug.\n",
  },
  {
    name: "paragraph rewrite",
    a: "This is the original paragraph with several words in it.\n",
    b: "A completely different sentence now occupies this paragraph.\n",
  },
  {
    name: "paragraph insert",
    a: "First paragraph.\n\nThird paragraph.\n",
    b: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n",
  },
  {
    name: "paragraph insert at start",
    a: "Second paragraph.\n",
    b: "First paragraph.\n\nSecond paragraph.\n",
  },
  {
    name: "paragraph insert at end",
    a: "First paragraph.\n",
    b: "First paragraph.\n\nSecond paragraph.\n",
  },
  {
    name: "paragraph delete",
    a: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph.\n",
    b: "First paragraph.\n\nThird paragraph.\n",
  },
  {
    name: "paragraph delete at start",
    a: "First paragraph.\n\nSecond paragraph.\n",
    b: "Second paragraph.\n",
  },
  {
    name: "paragraph delete at end",
    a: "First paragraph.\n\nSecond paragraph.\n",
    b: "First paragraph.\n",
  },
  {
    name: "heading level change",
    a: "# Title\n\nBody text.\n",
    b: "## Title\n\nBody text.\n",
  },
  {
    name: "heading level change, deeper",
    a: "### Section\n\nBody text.\n",
    b: "# Section\n\nBody text.\n",
  },
  {
    name: "mark added: emphasis",
    a: "This word is plain here.\n",
    b: "This word is *plain* here.\n",
  },
  {
    name: "mark removed: emphasis",
    a: "This word is *plain* here.\n",
    b: "This word is plain here.\n",
  },
  {
    name: "mark added: strong",
    a: "This is important text.\n",
    b: "This is **important** text.\n",
  },
  {
    name: "mark removed: strong",
    a: "This is **important** text.\n",
    b: "This is important text.\n",
  },
  {
    name: "mark added: code",
    a: "Run the build command now.\n",
    b: "Run the `build` command now.\n",
  },
  {
    name: "link href change",
    a: "See [the docs](https://example.com/old) for more.\n",
    b: "See [the docs](https://example.com/new) for more.\n",
  },
  {
    name: "link title change",
    a: '[link](https://example.com "old title")\n',
    b: '[link](https://example.com "new title")\n',
  },
  {
    name: "link added",
    a: "See the documentation for more.\n",
    b: "See [the documentation](https://example.com) for more.\n",
  },
  {
    name: "list item added",
    a: "- one\n- two\n",
    b: "- one\n- two\n- three\n",
  },
  {
    name: "list item added at start",
    a: "- two\n- three\n",
    b: "- one\n- two\n- three\n",
  },
  {
    name: "list item deleted",
    a: "- one\n- two\n- three\n",
    b: "- one\n- three\n",
  },
  {
    name: "list item deleted at end",
    a: "- one\n- two\n- three\n",
    b: "- one\n- two\n",
  },
  {
    name: "list item text change",
    a: "- alpha\n- beta\n- gamma\n",
    b: "- alpha\n- delta\n- gamma\n",
  },
  {
    name: "nested list change",
    a: "- one\n  - nested a\n  - nested b\n- two\n",
    b: "- one\n  - nested a\n  - nested c\n- two\n",
  },
  {
    name: "nested list item added",
    a: "- one\n  - nested a\n- two\n",
    b: "- one\n  - nested a\n  - nested b\n- two\n",
  },
  {
    name: "ordered list renumber via item insert",
    a: "1. first\n2. second\n",
    b: "1. first\n2. inserted\n3. second\n",
  },
  {
    name: "block type change: paragraph to heading",
    a: "Just a plain paragraph.\n",
    b: "# Just a plain paragraph.\n",
  },
  {
    name: "block type change: heading to paragraph",
    a: "# A heading here\n",
    b: "A heading here\n",
  },
  {
    name: "code block edit",
    a: "```js\nconst x = 1;\nconsole.log(x);\n```\n",
    b: "```js\nconst x = 2;\nconsole.log(x);\n```\n",
  },
  {
    name: "code block language change",
    a: "```js\nconst x = 1;\n```\n",
    b: "```ts\nconst x = 1;\n```\n",
  },
  {
    name: "blockquote edit",
    a: "> The original quoted line.\n",
    b: "> The revised quoted line.\n",
  },
  {
    name: "blockquote paragraph added",
    a: "> First quoted paragraph.\n",
    b: "> First quoted paragraph.\n>\n> Second quoted paragraph.\n",
  },
  {
    name: "multiple paragraphs, one word changed each",
    a: "Alpha one.\n\nBeta two.\n\nGamma three.\n",
    b: "Alpha uno.\n\nBeta two.\n\nGamma tres.\n",
  },
  {
    name: "whole document replaced",
    a: "Old document body here.\n",
    b: "# New Title\n\nCompletely new body.\n",
  },
];
