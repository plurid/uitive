/** Who is signed in. */
export interface Session {
  /** The person's ID. */
  user: string;
}

/** Sessions by their cookie's value: a stand-in for the application's own session store. */
export const sessions = new Map<string, Session>();

/**
 * The person a request is signed in as, or undefined: the application's own check, the same one
 * its API makes. This stand-in looks the session cookie up in `sessions`; a cookie's presence
 * alone proves nothing.
 */
export async function getSession(request: Request): Promise<Session | undefined> {
  const id = /(?:^|;\s*)session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
  return id === undefined ? undefined : sessions.get(id);
}
