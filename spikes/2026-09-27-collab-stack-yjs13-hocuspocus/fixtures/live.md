
# Live editing fixture

A [![ci](badge.svg)](https://ci.example) status badge opens the document, and
a [see the logo ![logo](logo.png) here](https://example.com/about) link mixes
text and an image in the same link.

Some inline HTML: <kbd>Ctrl</kbd> and <br> elements, plus a footnote
reference[^1] to check that footnotes survive.

Line one with a hard break  
Line two after the break.

[^1]: The footnote definition, on its own line.

<div>
An HTML block that should round-trip untouched.
</div>

- First level item
  * Second level item
    + Third level item

| Left | Center | Right |
|:-----|:------:|-------:|
| data | `code` | value |

```js
const answer = 42;
```

An unlinked image ![standalone](icon.png) that gate B will add a link mark to.

A closing paragraph with normal sentence structure.
