/** One request/answer channel between the extension's parts: the side
 *  panel, the content scripts and the offscreen document ask; the
 *  background answers (`serve`). Every method is typed in `Methods`.
 *
 *  Pushes the other way (live transcript events, recording state) are
 *  `Push` messages, broadcast with `push` and read with `onPush`. */

import type { Account } from './auth';
import type { EnvName } from './env';
import type { FoundMedia } from './media';
import type { LiveStatus, LiveStart, DubStart, DubStatus, CaptionStyle } from './live';

export interface Methods {
  'auth.account': [void, Account | null];
  'auth.connect': [void, Account];
  'auth.key': [{ key: string }, Account];
  'auth.signOut': [void, void];
  'auth.token': [void, string];
  'env.set': [{ name: EnvName }, void];
  /** The media the active tab (all its frames) plays or links to. */
  'page.scan': [{ tabId?: number }, { tabId: number; url: string; title: string; media: FoundMedia[] }];
  /** Start a live session: recording, meeting, captions or a broadcast take. */
  'live.start': [LiveStart, LiveStatus];
  'live.stop': [{ id: string }, void];
  'live.pause': [{ id: string; paused: boolean }, void];
  'live.list': [void, LiveStatus[]];
  'captions.style': [CaptionStyle, void];
  'dub.start': [DubStart, DubStatus];
  'dub.stop': [{ tabId: number }, void];
  'dub.status': [{ tabId: number }, DubStatus | null];
  /** Open the mic permission page (offscreen documents cannot ask). */
  'mic.ask': [void, boolean];
  'panel.open': [{ tabId?: number; view?: string }, void];
}

export type Method = keyof Methods;
export type Args<M extends Method> = Methods[M][0];
export type Answer<M extends Method> = Methods[M][1];

interface Envelope { rpc: Method; args: unknown }
type Reply = { ok: true; value: unknown } | { ok: false; error: string; code?: string };

export class RpcError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

export async function rpc<M extends Method>(method: M, ...args: Args<M> extends void ? [] : [Args<M>]): Promise<Answer<M>> {
  const reply = (await chrome.runtime.sendMessage({ rpc: method, args: args[0] } satisfies Envelope)) as Reply | undefined;
  if (!reply) throw new RpcError(`No answer to ${method}`);
  if (!reply.ok) throw new RpcError(reply.error, reply.code);
  return reply.value as Answer<M>;
}

export type Handler<M extends Method> = (args: Args<M>, sender: chrome.runtime.MessageSender) => Promise<Answer<M>> | Answer<M>;
export type Handlers = { [M in Method]?: Handler<M> };

/** Background only: answer `rpc` calls. */
export function serve(handlers: Handlers) {
  chrome.runtime.onMessage.addListener((msg: Envelope, sender, send: (r: Reply) => void) => {
    if (!msg || typeof msg.rpc !== 'string') return false;
    const h = handlers[msg.rpc] as Handler<Method> | undefined;
    if (!h) return false;
    Promise.resolve()
      .then(() => h(msg.args as never, sender))
      .then((value) => send({ ok: true, value }), (e: unknown) => send({ ok: false, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code }));
    return true;
  });
}

/** Messages nobody answers: state and events, fanned out. */
export type Push =
  | { push: 'live.status'; status: LiveStatus }
  | { push: 'live.event'; id: string; tabId?: number; event: LiveEvent }
  | { push: 'dub.status'; status: DubStatus }
  | { push: 'auth.changed'; account: Account | null };

/** What a live session tells the panel and the captions overlay. */
export type LiveEvent =
  | { type: 'committed'; seq: number; text: string; startS: number; endS: number; speaker?: string | null }
  | { type: 'draft'; text: string }
  | { type: 'translated'; seq: number; lang: string; text: string };

export function push(p: Push): void {
  chrome.runtime.sendMessage(p).catch(() => { /* nobody listening */ });
}

export function onPush(fn: (p: Push) => void): () => void {
  const l = (msg: Push) => { if (msg && typeof (msg as { push?: string }).push === 'string') fn(msg); };
  chrome.runtime.onMessage.addListener(l);
  return () => chrome.runtime.onMessage.removeListener(l);
}
