/** The SDK client, for any part of the extension but the background:
 *  its token is the background's key token (`auth.token`), asked for on
 *  each call and exchanged there when it is about to run out. */

import { VocalStack } from '@vocalstack/js-sdk';
import { currentEnv, type Env } from './env';
import { rpc } from './rpc';

let cached: { env: string; vs: VocalStack } | null = null;

export async function client(): Promise<VocalStack> {
  const env = await currentEnv();
  if (cached?.env === env.name) return cached.vs;
  const vs = new VocalStack({ baseUrl: env.api, token: () => rpc('auth.token') });
  cached = { env: env.name, vs };
  return vs;
}

export { currentEnv, type Env };
