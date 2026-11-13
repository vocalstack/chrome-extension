/** Saved speakers: people VocalStack recognises by their voice's
 *  fingerprint, and their clone when they consented to one (transcribe:
 *  /v1/speakers, `vs.speakers`). The screens use them flat. */

import type { Speaker } from '@vocalstack/contract';
import { client } from './client';

/** A saved speaker, flat: the person, and their clone's state. */
export interface SavedSpeaker {
  id: string;
  name: string;
  color: string | null;
  gender: string | null;
  createdAt: string;
  /** A sample uploaded from the dashboard, not named and consented to yet. */
  draft: boolean;
  /** Kept with one transcription only (`library` false): not in the list. */
  library: boolean;
  /** Their cloned voice; false: only their fingerprint is saved. */
  cloned: boolean;
  /** Their clone's state ('training', 'ready', 'failed'); 'none' without one. */
  state: string;
  progress: number;
  error: string | null;
  sampleS: number;
  speechS: number | null;
  enabled: boolean;
  uses: number;
}

function flat(x: Speaker): SavedSpeaker {
  const c = x.voice ?? null;
  return {
    id: x.id,
    name: x.name ?? '',
    color: x.color ?? null,
    gender: x.gender ?? null,
    createdAt: x.createdAt,
    draft: !!x.draft,
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

export async function listSpeakers(): Promise<SavedSpeaker[]> {
  return (await (await client()).speakers.list()).map(flat);
}

export async function getSpeaker(id: string): Promise<SavedSpeaker> {
  return flat(await (await client()).speakers.get(id));
}

export async function updateSpeaker(id: string, patch: { name?: string; color?: string; enabled?: boolean; consent?: boolean; draft?: boolean; gender?: string }): Promise<SavedSpeaker> {
  return flat(await (await client()).speakers.update(id, patch));
}

export async function deleteSpeaker(id: string): Promise<void> {
  await (await client()).speakers.delete(id);
}

/** A saved speaker from a recorded sample. `consent`: their permission to
 *  clone their voice; without it they are recognised by their fingerprint
 *  only, and cloned once it is given (`updateSpeaker` consent). */
export async function createSpeaker(req: { name: string; sample: Blob; fileName: string; gender?: string; consent: boolean }): Promise<SavedSpeaker> {
  return flat(await (await client()).speakers.create({ name: req.name, sample: req.sample, fileName: req.fileName, gender: req.gender, consent: req.consent }));
}

/** A saved speaker from one person in a finished transcription
 *  (`consent` as for `createSpeaker`). */
export async function createFromAppearance(req: { transcriptionId: string; appearance: number; name: string; consent: boolean }): Promise<SavedSpeaker> {
  return flat(await (await client()).speakers.createFromAppearance(req));
}

/** Their clone speaking the engine's fixed line in `lang`: 202 while it renders. */
export async function speakerPreview(id: string, lang: string): Promise<Response> {
  return (await client()).speakers.voicePreview(id, { lang });
}

/** The audio they were saved from. */
export async function speakerSample(id: string): Promise<Response> {
  return (await client()).speakers.sample(id);
}
