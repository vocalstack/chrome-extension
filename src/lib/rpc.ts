/** One request/answer channel between the extension's parts: the side
 *  panel, the content scripts and the offscreen document ask; the
 *  background answers (`serve`). Every method is typed in `Methods`.
 *
 *  Pushes the other way (live transcript events, recording state) are
 *  `Push` messages, broadcast with `push` and read with `onPush`. */

import type { Account } from './auth';
import type { EnvName } from './env';
import type { FoundMedia } from './media';
import type { LiveStatus, LiveStart, DubStart, DubStatus, CaptionStyle, VcapStart, VcapStatus } from './live';
import { failure, type Failure } from './errors';
import { report } from './sentry';

export interface Methods {
  'auth.account': [void, Account | null];
  'auth.connect': [void, Account];
  'auth.key': [{ key: string }, Account];
  'auth.signOut': [void, void];
  'auth.token': [void, string];
  /** Exchange the key again now: the account's scopes as the API sees them. */
  'auth.refresh': [void, Account | null];
  'env.set': [{ name: EnvName }, void];
  /** The media the active tab (all its frames) plays or links to. */
  'page.scan': [{ tabId?: number }, { tabId: number; url: string; title: string; media: FoundMedia[] }];
  /** Start a live session: recording, meeting, captions or a broadcast take. */
  'live.start': [LiveStart, LiveStatus];
  'live.stop': [{ id: string }, void];
  'live.pause': [{ id: string; paused: boolean }, void];
  'live.list': [void, LiveStatus[]];
  /** Drop a finished or failed session from the list. */
  'live.forget': [{ id: string }, void];
  /** Show (or hide) a running session's transcript as captions on its tab. */
  'live.overlay': [{ id: string; on: boolean }, void];
  /** A running session's spoken language (null: detect) or speaker labels,
   *  from the next words on (the floating captions' menus). */
  'live.settings': [{ id: string; spokenLanguage?: string | null; speakerLabels?: 'auto' | 'on' | 'off' }, void];
  /** The languages a live session can be spoken in, for the floating
   *  captions' menu (a content script cannot call the API). */
  'live.langs': [void, { code: string; flag?: string; name: string; native?: string }[]];
  /** Translate a running session into another language (null: stop translating). */
  'live.translate': [{ id: string; lang: string | null }, void];
  /** Whether the person invoked the extension on this tab (clicked its icon,
   *  a shortcut, a menu), which Chrome requires before a tab is captured. */
  'tab.invoked': [{ tabId: number }, boolean];
  /** The toolbar icon's "!" badge on a tab, while the panel asks for the click. */
  'tab.badge': [{ tabId: number; on: boolean }, void];
  /** The transcript so far of a running session (for a panel opened late). */
  'live.history': [{ id: string }, LiveEvent[]];
  'captions.style': [CaptionStyle, void];
  'vcap.start': [VcapStart, VcapStatus];
  'vcap.stop': [{ tabId: number }, void];
  'vcap.status': [{ tabId: number }, VcapStatus | null];
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
type Reply = { ok: true; value: unknown } | Failure;

/** The extension's own error, worded for a person (lib/errors.ts). Across
 *  a reply it carries the API's code, status and request id as well. */
export class RpcError extends Error {
  constructor(message: string, readonly code?: string, readonly status?: number, readonly requestId?: string) {
    super(message);
    this.name = 'RpcError';
  }
}

/** A reply's failure, thrown again on the asking side. */
export const rpcError = (f: Failure) => new RpcError(f.error, f.code, f.status, f.requestId);

export async function rpc<M extends Method>(method: M, ...args: Args<M> extends void ? [] : [Args<M>]): Promise<Answer<M>> {
  const reply = (await chrome.runtime.sendMessage({ rpc: method, args: args[0] } satisfies Envelope)) as Reply | undefined;
  if (!reply) throw new RpcError('VocalStack didn’t answer. Try again.');
  if (!reply.ok) throw rpcError(reply);
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
      .then((value) => send({ ok: true, value }), (e: unknown) => { report(e, `rpc ${msg.rpc}`); send(failure(e)); });
    return true;
  });
}

/** Messages nobody answers: state and events, fanned out. */
export type Push =
  | { push: 'live.status'; status: LiveStatus }
  /** A session was dismissed: it leaves the list. */
  | { push: 'live.gone'; id: string }
  | { push: 'live.event'; id: string; tabId?: number; event: LiveEvent }
  /** The input level (0..1), a few times a second while capturing. */
  | { push: 'live.level'; id: string; level: number }
  | { push: 'dub.status'; status: DubStatus }
  | { push: 'vcap.status'; status: VcapStatus }
  | { push: 'vcap.gone'; tabId: number }
  | { push: 'auth.changed'; account: Account | null };

/** What a live session tells the panel and the captions overlay. */
export type LiveEvent =
  | { type: 'committed'; seq: number; text: string; startS: number; endS: number; speaker?: string | null; lang?: string | null }
  /** A speaker's name: typed by a person (`person`), or recognised from a
   *  voice the account holds (`voice`). An empty `name` takes it back. A
   *  typed name outranks a recognised one, as the server ranks them. */
  | { type: 'speaker'; speaker: string; name: string; by: 'person' | 'voice' }
  | { type: 'draft'; text: string }
  /** A translation: of one line (`seq`), or of a whole sentence (`seqs`,
   *  `sentenceId`), which is how live sessions translate. */
  | { type: 'translated'; seq: number; seqs?: number[]; sentenceId?: number; lang: string; text: string }
  /** The draft's translation, when the session translates. */
  | { type: 'draftTranslated'; lang: string; text: string };

export function push(p: Push): void {
  chrome.runtime.sendMessage(p).catch(() => { /* nobody listening */ });
}

export function onPush(fn: (p: Push) => void): () => void {
  const l = (msg: Push) => { if (msg && typeof (msg as { push?: string }).push === 'string') fn(msg); };
  chrome.runtime.onMessage.addListener(l);
  return () => chrome.runtime.onMessage.removeListener(l);
}
