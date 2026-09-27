#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const handwrittenDir = 'corpus/handwritten';
fs.mkdirSync(handwrittenDir, { recursive: true });

// crlf.md - CRLF line endings
fs.writeFileSync(path.join(handwrittenDir, 'crlf.md'),
  '# CRLF Line Endings\r\n\r\nThis document uses CRLF throughout for testing line ending handling.\r\n\r\n- First bullet point\r\n- Second item\r\n- Third item\r\n\r\n```\r\nfunction test() {\r\n  return true;\r\n}\r\n```\r\n\r\nTesting paragraph with normal sentences.');

// no-trailing-newline.md - no final newline
fs.writeFileSync(path.join(handwrittenDir, 'no-trailing-newline.md'),
  '# No Trailing Newline\n\nThis file ends without a newline.\n\nParagraph here with text.');

// trailing-blank-lines.md - three trailing newlines
fs.writeFileSync(path.join(handwrittenDir, 'trailing-blank-lines.md'),
  '# Three Trailing Newlines\n\nThis paragraph has text to describe the document.\n\n\n\n');

// tabs.md - tab indented code and list items
fs.writeFileSync(path.join(handwrittenDir, 'tabs.md'),
  '# Tabs\n\nThis demonstrates tab indentation.\n\n\t\tindented code block\n\t\twith tabs\n\n- Item with tab indent\n\t- Nested item\n\t\t- Double nested\n\nInline tabs look like this:\tembedded in text.\n');

// nested-mixed-markers.md - mixed list markers
fs.writeFileSync(path.join(handwrittenDir, 'nested-mixed-markers.md'),
  '# Nested Mixed List Markers\n\nThis tests various list marker combinations.\n\n- First level dash\n  * Second level star\n    + Third level plus\n      1. First ordered\n         1) Alternative paren\n\nNormal paragraph continues the document.\n');

// hard-breaks.md - hard line breaks
fs.writeFileSync(path.join(handwrittenDir, 'hard-breaks.md'),
  '# Hard Line Breaks\n\nLine break with two spaces  \nNext line after spaces.\n\nLine break with backslash\\\nNext line after backslash.\n\nRegular paragraph with normal sentence structure and multiple words.\n');

// front-matter-yaml.md - YAML frontmatter
fs.writeFileSync(path.join(handwrittenDir, 'front-matter-yaml.md'),
  '---\ntitle: YAML Front Matter\nauthor: Test\nlicense: MIT\n---\n\n# Content After YAML\n\nThis document has YAML frontmatter that should be preserved.\n\nParagraph text continues here.\n');

// front-matter-toml.md - TOML frontmatter
fs.writeFileSync(path.join(handwrittenDir, 'front-matter-toml.md'),
  '+++\ntitle = "TOML Front Matter"\nauthor = "Test"\n+++\n\n# Content After TOML\n\nThis document has TOML frontmatter with plus signs.\n\nRegular paragraph content here.\n');

// raw-html.md - HTML blocks
fs.writeFileSync(path.join(handwrittenDir, 'raw-html.md'),
  '# Raw HTML\n\n<div>\nThis is an HTML block that should be preserved.\n</div>\n\n<details>\n<summary>Click to expand</summary>\nHidden content here.\n</details>\n\n<!-- HTML comment that spans\nmultiple lines -->\n\n<kbd>Ctrl</kbd> and <br> inline HTML elements.\n\nRegular paragraph with normal sentence.\n');

// mdx-like.md - MDX-like content
fs.writeFileSync(path.join(handwrittenDir, 'mdx-like.md'),
  'import Button from \'./button\';\n\n# Interactive Content\n\n<Tabs>\n  <TabItem value="javascript">\n\n    JavaScript example here.\n\n  </TabItem>\n  <TabItem value="python">\n\n    Python example here.\n\n  </TabItem>\n</Tabs>\n\nexport const meta = { title: \'Page\' };\n\nRegular markdown paragraph.\n');

// math.md - LaTeX math
fs.writeFileSync(path.join(handwrittenDir, 'math.md'),
  '# Mathematics\n\nThe quadratic formula is:\n\n$$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$$\n\nInline math like $E = mc^2$ appears in text.\n\nNormal paragraph explaining the formulas.\n');

// footnotes.md - Footnotes
fs.writeFileSync(path.join(handwrittenDir, 'footnotes.md'),
  '# Footnotes\n\nThis is a reference[^1] with a footnote and another[^note].\n\n[^1]: First footnote definition.\n\n[^note]: This is a multi-paragraph footnote.\n\n    It continues here with more text.\n    And even more content.\n\nNormal paragraph of text.\n');

// reference-links.md - Reference links
fs.writeFileSync(path.join(handwrittenDir, 'reference-links.md'),
  '# Reference Links\n\nFull reference [link text][ref1] in the document.\n\nCollapsed reference [like this][] and shortcut [reference] links.\n\nImage reference: ![alt text][image1]\n\n[ref1]: https://example.com "Example"\n[like this]: https://example.com\n[reference]: https://example.com\n[image1]: https://example.com/image.png "Image"\n\nParagraph content here.\n');

// mermaid.md - Mermaid diagrams
fs.writeFileSync(path.join(handwrittenDir, 'mermaid.md'),
  '# Mermaid Diagrams\n\nFirst diagram with backticks:\n\n```mermaid\ngraph TD\n    A[Start]\n    B[End]\n    A --> B\n```\n\nSecond diagram with tildes:\n\n~~~mermaid\ngraph LR\n    X[X]\n    Y[Y]\n    X --> Y\n~~~\n\nNormal paragraph with text.\n');

// tables.md - GFM tables
fs.writeFileSync(path.join(handwrittenDir, 'tables.md'),
  '# Tables\n\n| Left | Center | Right |\n|:-----|:------:|-------:|\n| data | `code` | value |\n| text | more\\|data | 123 |\n\nParagraph describing the table above with multiple words and sentences.\n');

// task-lists.md - Task lists
fs.writeFileSync(path.join(handwrittenDir, 'task-lists.md'),
  '# Task Lists\n\n- [x] Completed task\n- [ ] Incomplete task\n  - [x] Nested completed\n  - [ ] Nested incomplete\n- [x] Another completed one\n\nParagraph with regular content.\n');

// setext-headings.md - Setext headings
fs.writeFileSync(path.join(handwrittenDir, 'setext-headings.md'),
  'Top Level Heading\n===\n\nSecond Level\n---\n\nThis is a paragraph with content describing the document structure using setext-style headings instead of ATX.\n\n### ATX heading mixed in\n\nMore paragraph text here.\n');

// style-star-bullets.md - Specific style with stars
fs.writeFileSync(path.join(handwrittenDir, 'style-star-bullets.md'),
  '# Star Style\n\n* First bullet\n* Second item\n* Third item\n\nThis has _emphasis_ and __strong__ text.\n\n~~~\nCode fence with tildes\n~~~\n\nUpper Heading\n=============\n\nAnother paragraph with meaningful content.\n');

// style-plus-bullets.md - Specific style with plus signs
fs.writeFileSync(path.join(handwrittenDir, 'style-plus-bullets.md'),
  '# Plus Style\n\n+ First bullet\n+ Second item\n+ Third item\n\nThis has *emphasis* and **strong** text.\n\n````\nCode fence with four backticks\n````\n\n## Title ##\n\nMore paragraph text here.\n');

// style-dash-underscore.md - Specific style with dashes
fs.writeFileSync(path.join(handwrittenDir, 'style-dash-underscore.md'),
  '# Dash Underscore Style\n\n- First bullet\n- Second item\n- Third item\n\nThis has _emphasis_ and **strong** text.\n\n# Top Heading\n\n***\n\nParagraph with regular content and multiple sentences.\n');

// blockquotes.md - Blockquotes
fs.writeFileSync(path.join(handwrittenDir, 'blockquotes.md'),
  '# Blockquotes\n\n> First level quote with text\n> continuing on next line\n>> Nested second level\n>> More content\n\n> Quote with list\n> - Item one\n> - Item two\n\nParagraph after quotes with continuation.\n');

// indented-code.md - Indented code blocks
fs.writeFileSync(path.join(handwrittenDir, 'indented-code.md'),
  '# Indented Code\n\n    This is an indented code block\n    with multiple lines of text\n    and preserved spacing\n\n```js title="example.js"\nconst x = 42;\n```\n\nNormal paragraph content here.\n');

// autolinks.md - Autolinks
fs.writeFileSync(path.join(handwrittenDir, 'autolinks.md'),
  '# Autolinks\n\nURL autolink: <https://example.com>\n\nBare URL: https://example.com\n\nWWW autolink: www.example.com\n\nEmail: <user@example.com>\n\nRegular paragraph with text.\n');

// entities-escapes.md - Entities and escapes
fs.writeFileSync(path.join(handwrittenDir, 'entities-escapes.md'),
  '# Entities and Escapes\n\nNamed entity: &amp; &copy;\n\nNumeric entity: &#123; &#8482;\n\nEscaped: \\*not emphasis\\* and \\_underscore\\_\n\nRegular paragraph with meaningful content and sentences.\n');

// long-paragraphs.md - Long wrapped paragraphs
fs.writeFileSync(path.join(handwrittenDir, 'long-paragraphs.md'),
  '# Long Paragraphs\n\nThis is a paragraph with text wrapped at eighty columns per line so the\nwrapping pattern is visible and can be tested during round trip conversion.\nMore text continues here to demonstrate multiple wrapped lines.\n\nThis paragraph has one sentence.\nOn each line.\nSeparately for testing.\n\nFinal paragraph.\n');

// emphasis-mix.md - Mixed emphasis
fs.writeFileSync(path.join(handwrittenDir, 'emphasis-mix.md'),
  '# Emphasis Mix\n\nThis is ***bold italic*** and **bold _italic_** combinations.\n\nStrikethrough like ~~this~~ in text.\n\nIntraword emphasis in snake_case_words and camelCaseText.\n\nRegular paragraph explaining emphasis patterns.\n');

// ordered-lists.md - Ordered lists
fs.writeFileSync(path.join(handwrittenDir, 'ordered-lists.md'),
  '# Ordered Lists\n\n3. Start at three\n4. Continue numbering\n5. Standard ordering\n\n1) Using paren delimiter\n2) Another item\n3) And more\n\n1. All use one\n1. All use one\n1. All use one\n\nLoose list:\n\n1. First item\n\n2. Second item\n\nNormal paragraph text.\n');

// html-comments.md - HTML comments
fs.writeFileSync(path.join(handwrittenDir, 'html-comments.md'),
  '# HTML Comments\n\n<!-- prettier-ignore -->\n\n<!-- This is a multi-line\nHTML comment that spans\nmultiple lines -->\n\nContent between comments.\n\n<!-- Another comment -->\n\nParagraph with regular text.\n');

console.log('Created 26 hand-written edge case files');
