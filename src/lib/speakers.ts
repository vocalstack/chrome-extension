/** Saved speakers: people VocalStack recognises by their voice's
 *  fingerprint, and their clone when they consented to one (transcribe:
 *  /v1/speakers). Until 2026-11 the API called them voices (/v1/voices),
 *  one row for the person and their clone both.
 *
 *  The SDK this builds with knows only the old routes, and an installed
 *  copy must keep working on either side of the server's cut, so each call
 *  asks the new route first and the old one on a 404, and reads either
 *  shape. Once the SDK has `vs.speakers`, this becomes calls to it. */

import { VocalStackError, type Voice } from '@vocalstack/js-sdk';
import { currentEnv } from './env';
import { rpc } from './rpc';

/** A saved speaker, flat: the person, and their clone's state. */
export interface SavedSpeaker {
  id: string;
  name: string;
  color: string | null;
  gender: string | null;
  createdAt: string;
  /** A sample uploaded from the dashboard, not named and consented to yet. */
  draft: boolean;
  /** Made by VocalStack from a transcription, waiting on consent; or kept
   *  with one transcription only (`library` false). Not in the list. */
  auto: boolean;
  library: boolean;
  /** Their cloned voice; false: only their fingerprint is saved. */
  cloned: boolean;
  state: Voice['state'] | 'none';
  progress: number;
  error: string | null;
  sampleS: number;
  speechS: number | null;
  enabled: boolean;
  uses: number;
}

type Clone = Pick<Voice, 'state' | 'progress' | 'error' | 'sampleS' | 'speechS' | 'enabled' | 'uses'>;
type Wire = Partial<Voice> & { id: string; voice?: Clone | null; auto?: boolean; library?: boolean };

/** Either shape as a `SavedSpeaker`: a speaker has its clone under `voice`;
 *  an old voice was the clone itself. */
function flat(x: Wire): SavedSpeaker {
  const c: Partial<Clone> | null = 'voice' in x ? x.voice ?? null : x;
  return {
    id: x.id,
    name: x.name ?? '',
    color: x.color ?? null,
    gender: x.gender ?? null,
    createdAt: x.createdAt ?? new Date(0).toISOString(),
    draft: !!x.draft,
    auto: !!x.auto,
    library: x.library !== false,
    cloned: !!c,
    state: c?.state ?? 'none',
    progress: c?.progress ?? 0,
    error: c?.error ?? null,
    sampleS: c?.sampleS ?? 0,
    speechS: c?.speechS ?? null,
    enabled: c?.enabled ?? false,
    uses: c?.uses ?? 0,
  };
}

type Init = { method?: string; query?: Record<string, string | undefined>; json?: unknown; form?: FormData };

async function once(path: string, init: Init): Promise<Response> {
  const env = await currentEnv();
  const token = await rpc('auth.token');
  const q = new URLSearchParams(Object.entries(init.query ?? {}).filter((e): e is [string, string] => e[1] !== undefined)).toString();
  return fetch(`${env.api}${path}${q ? `?${q}` : ''}`, {
    method: init.method ?? 'GET',
    headers: { accept: 'application/json, */*', authorization: `Bearer ${token}`, ...(init.json !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
    credentials: 'omit',
  });
}

/** The new route, else (a 404: a server from before the cut) the old one.
 *  An answer that isn't ok is thrown as the API's error. */
async function call(path: string, old: string, init: Init = {}, oldInit: Init = init): Promise<Response> {
  let r = await once(path, init);
  if (r.status === 404) r = await once(old, oldInit);
  if (r.ok) return r;
  const b = (await r.json().catch(() => null)) as { code?: string; message?: string } | null;
  throw new VocalStackError(b?.code ?? 'internal', b?.message ?? `unexpected error (status ${r.status})`, { status: r.status });
}

const seg = encodeURIComponent;
const json = async <T>(r: Promise<Response>) => (await r).json() as Promise<T>;

export async function listSpeakers(): Promise<SavedSpeaker[]> {
  const b = await json<{ speakers?: Wire[]; voices?: Wire[] }>(call('/v1/speakers', '/v1/voices'));
  return (b.speakers ?? b.voices ?? []).map(flat);
}

export async function getSpeaker(id: string): Promise<SavedSpeaker> {
  return flat(await json<Wire>(call(`/v1/speakers/${seg(id)}`, `/v1/voices/${seg(id)}`)));
}

export async function updateSpeaker(id: string, patch: { name?: string; color?: string; enabled?: boolean; consent?: boolean; draft?: boolean; gender?: string }): Promise<SavedSpeaker> {
  return flat(await json<Wire>(call(`/v1/speakers/${seg(id)}`, `/v1/voices/${seg(id)}`, { method: 'PATCH', json: patch })));
}

export async function deleteSpeaker(id: string): Promise<void> {
  await call(`/v1/speakers/${seg(id)}`, `/v1/voices/${seg(id)}`, { method: 'DELETE' });
}

/** A saved speaker from a recorded sample. `consent`: their permission to
 *  clone their voice; without it they are recognised by their fingerprint
 *  only (a server before the cut keeps them as a draft instead). */
export async function createSpeaker(req: { name: string; sample: Blob; fileName: string; gender?: string; consent: boolean }): Promise<SavedSpeaker> {
  const form = (old: boolean) => {
    const f = new FormData();
    f.append('meta', JSON.stringify({ consent: req.consent, name: req.name, gender: req.gender, ...(old && !req.consent ? { draft: true } : {}) }));
    f.append('sample', req.sample, req.fileName);
    return f;
  };
  // A FormData is read once per request: one each.
  return flat(await json<Wire>(call('/v1/speakers', '/v1/voices', { method: 'POST', form: form(false) }, { method: 'POST', form: form(true) })));
}

/** A saved speaker from one person in a finished transcription
 *  (`consent` as for `createSpeaker`). */
export async function createFromAppearance(req: { transcriptionId: string; recordingId: string; appearance: number; name: string; consent: boolean }): Promise<SavedSpeaker> {
  return flat(await json<Wire>(call(
    '/v1/speakers/from-appearance', '/v1/voices/from-speaker',
    { method: 'POST', json: { transcriptionId: req.transcriptionId, appearance: req.appearance, name: req.name, consent: req.consent } },
    { method: 'POST', json: { recordingId: req.recordingId, speaker: req.appearance, name: req.name, consent: req.consent } },
  )));
}

/** Their clone speaking the engine's fixed line in `lang`: 202 while it renders. */
export function speakerPreview(id: string, lang: string): Promise<Response> {
  return call(`/v1/speakers/${seg(id)}/preview`, `/v1/voices/${seg(id)}/preview`, { query: { lang } });
}

/** The audio they were saved from. */
export function speakerSample(id: string): Promise<Response> {
  return call(`/v1/speakers/${seg(id)}/sample`, `/v1/voices/${seg(id)}/sample`);
}
