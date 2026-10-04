/**
 * Shared styles. Public tokens are read through fallbacks, so a host can set them on any
 * ancestor (such as `:root`) or on the element itself, in light and dark schemes alike.
 */
export const base = `
:host {
  --_accent: var(--uitive-accent, #3e63dd);
  --_surface: var(--uitive-surface, #ffffff);
  --_text: var(--uitive-text, #1c2024);
  --_muted: var(--uitive-muted, #60646c);
  --_border: var(--uitive-border, #dfe1e6);
  --_radius: var(--uitive-radius, 10px);
  --_danger: #c62a2f;
  display: block;
  color: var(--_text);
  font: 13px/1.45 var(--uitive-font, inherit);
}
@media (prefers-color-scheme: dark) {
  :host {
    --_accent: var(--uitive-accent, #9eb1ff);
    --_surface: var(--uitive-surface, #18191b);
    --_text: var(--uitive-text, #edeef0);
    --_muted: var(--uitive-muted, #b0b4ba);
    --_border: var(--uitive-border, #363a3f);
    --_danger: #ff9592;
  }
}
:host([hidden]) { display: none; }
*, *::before, *::after { box-sizing: border-box; }
h2, h3 { margin: 0; font-size: 13px; font-weight: 600; }
h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--_muted); }
p { margin: 0; }
ul { list-style: none; margin: 0; padding: 0; }
button, input, select {
  font: inherit;
  color: inherit;
  background: var(--_surface);
  border: 1px solid var(--_border);
  border-radius: 6px;
}
button { padding: 2px 9px; cursor: pointer; white-space: nowrap; -webkit-user-select: none; user-select: none; }
button:hover { border-color: var(--_muted); }
button:disabled { opacity: 0.55; cursor: default; }
button.primary { background: var(--_accent); border-color: var(--_accent); color: var(--_surface); }
button.quiet { border-color: transparent; background: transparent; color: var(--_muted); }
button.quiet:hover { color: var(--_text); }
button[aria-pressed='true'] { border-color: var(--_accent); color: var(--_accent); }
button.danger[data-armed] { border-color: var(--_danger); color: var(--_danger); }
input, select { padding: 2px 7px; }
:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
.muted, .reason { color: var(--_muted); }
.note { color: var(--_muted); font-style: italic; }
.small { font-size: 12px; }
.chip {
  display: inline-block;
  padding: 0 6px;
  border: 1px solid var(--_border);
  border-radius: 999px;
  color: var(--_muted);
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}
.chip.accent { border-color: var(--_accent); color: var(--_accent); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
`;
