/** The address of the Dashboard's consent screen for One-click Connect
 *  (lib/auth.ts opens it). No chrome.* calls here. */

export interface ConnectAsk {
  redirectUri: string;
  state: string;
  challenge: string;
  /** The workspace the extension works in now, when one is known: the
   *  consent screen's picker starts on it (a Dashboard that doesn't know
   *  the parameter ignores it). */
  workspaceId?: string | null;
}

export function connectUrl(app: string, ask: ConnectAsk): string {
  const url = new URL('/connect', app);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_name: 'VocalStack extension',
    redirect_uri: ask.redirectUri,
    state: ask.state,
    code_challenge: ask.challenge,
    code_challenge_method: 'S256',
    // The widest the extension asks for; the person chooses on the consent
    // screen (see, change and record; see and change; or see only; only
    // what it creates, the default, or the whole account) and the token
    // says what was granted. Recording needs recordings:publish, which
    // Connect grants to this extension alone.
    scope: 'read write recordings:publish',
    reach: 'account',
    ...(ask.workspaceId ? { workspace: ask.workspaceId } : {}),
  }).toString();
  return url.toString();
}
