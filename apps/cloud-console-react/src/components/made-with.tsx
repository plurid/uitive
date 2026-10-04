// Where the demo links back to, when a site serves it: uitive.dev builds it with
// VITE_UITIVE_SITE=/. Unset, as in development and the README's screenshots, there's no link.
const site = import.meta.env.VITE_UITIVE_SITE as string | undefined;

/** The way back to the site the demo came from, at the foot of the sidebar. */
export function MadeWith() {
  if (!site) return null;
  return (
    // demo.css keeps links from dragging in Chrome and Safari; Firefox needs the attribute.
    <a className="made-with" href={site} draggable={false}>
      <svg className="made-with-mark" viewBox="0 0 96 96" width="18" height="18" aria-hidden="true">
        <path d="M10 4H22A6 6 0 0 1 28 10V62A6 6 0 0 0 34 68H88A4 4 0 0 1 92 72A20 20 0 0 1 72 92H24A20 20 0 0 1 4 72V10A6 6 0 0 1 10 4Z" />
        <rect x="68" y="36" width="24" height="24" rx="6" />
        <rect className="made-with-dot" x="68" y="4" width="24" height="24" rx="6" />
      </svg>
      <span>
        Made with <strong>Uitive</strong>
      </span>
    </a>
  );
}
