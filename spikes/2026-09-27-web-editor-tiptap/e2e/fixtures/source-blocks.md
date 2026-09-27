---
title: Source Blocks Fixture
author: Phraise
---

# Source Blocks

Paragraph before the HTML block.

<div class="note">
  <p>Raw <strong>HTML</strong> content.</p>
</div>

Paragraph between HTML and math.

$$
E = mc^2
$$

Paragraph between math and the footnote.

Here is a claim with a footnote[^1].

[^1]: The footnote's own definition text.

Paragraph between the footnote and the link reference.

See the [reference link][ref] for details.

[ref]: https://example.com/reference "Reference title"

Paragraph between the link reference and Mermaid.

```mermaid
graph TD
    A[Start] --> B[End]
```

Paragraph after Mermaid.
