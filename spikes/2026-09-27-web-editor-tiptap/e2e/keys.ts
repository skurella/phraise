// Line start and line end keys, per platform. Added by the spike 7
// orchestrator after the first WebKit run: on macOS, WebKit (like Safari)
// maps Home and End to scrolling, not caret movement, so tests that pressed
// Home or End never moved the caret there. Cmd+Left and Cmd+Right are the
// macOS line-start and line-end keys in every engine. Elsewhere Home and End
// are.
export const LINE_START = process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home';
export const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';
