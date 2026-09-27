# Unsafe HTML

Paragraph before the unsafe block.

<div>
<img src="x" onerror="window.pwned = true">
<script>window.scriptRan = true;</script>
</div>

Paragraph after the unsafe block.
