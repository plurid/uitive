/** The part of a path that says the page is in test mode, such as `/test`; '' in live mode. */
export function modePrefix(testMode: string | undefined, pathname: string): string {
  if (!testMode) return '';
  const found = new RegExp(testMode).exec(pathname);
  return found && found.index === 0 ? found[0].replace(/\/$/, '') : '';
}

const trim = (path: string) => path.replace(/\/+$/, '') || '/';

/**
 * Where a link built from a route leads on this page: routes leave the mode out, so a page in
 * test mode keeps its prefix, and a link never switches the person to live data.
 */
export function targetOf(
  href: string,
  testMode: string | undefined,
  location: Pick<Location, 'origin' | 'pathname'>,
) {
  const wanted = new URL(href, location.origin);
  const prefix = modePrefix(testMode, location.pathname);
  const path =
    prefix === '' || modePrefix(testMode, wanted.pathname) !== ''
      ? wanted.pathname
      : `${prefix}${wanted.pathname}`;
  return { path, href: `${path}${wanted.search}${wanted.hash}` };
}

/** The page's own link to exactly this path, on this origin, so its router can follow it. */
export function linkTo(document: Document, path: string): Element | undefined {
  const origin = document.defaultView?.location.origin;
  return [...document.querySelectorAll('a[href]')].find((element) => {
    try {
      const url = new URL(element.getAttribute('href') ?? '', document.baseURI);
      return url.origin === origin && trim(url.pathname) === trim(path);
    } catch {
      return false;
    }
  });
}
