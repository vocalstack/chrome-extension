/** Local files: drop audio or video anywhere on the panel and it joins
 *  Upload's list (screens/Upload.tsx); Transcribe sends each as a
 *  transcription of the whole file. Upload progress shows in a small
 *  stack of toasts. */

import { useEffect, useRef, useState } from 'react';
import type { Transcription } from '@vocalstack/contract';
import { VocalStackError } from '@vocalstack/js-sdk';
import { currentEnv } from '../lib/env';
import { client } from '../lib/client';
import type { Account } from '../lib/auth';
import { can, whyNot } from '../lib/access';
import { rpc, RpcError } from '../lib/rpc';
import { IconBtn, openApp } from '../ui/kit';
import { IconAlert, IconCheck, IconClose, IconExternal, IconUpload } from '../ui/icons';
import { problemOf } from './page/errors';
import { created, jobPct, jobText, patch, track, useTracked, type Tracked } from './page/tracker';
import { txPath } from '../background/page/paths';
import { queueFiles } from './Upload';

const MEDIA_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm|mp4|m4v|mov|mkv|avi|wma|amr|3gp)$/i;
export const isMedia = (f: File) => f.type.startsWith('audio/') || f.type.startsWith('video/') || MEDIA_EXT.test(f.name);

/** Seconds, read by the browser; undefined when it can't tell. */
export function measure(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const el = document.createElement(file.type.startsWith('video/') ? 'video' : 'audio');
    const url = URL.createObjectURL(file);
    const done = (v?: number) => { clearTimeout(t); URL.revokeObjectURL(url); el.removeAttribute('src'); resolve(v); };
    const t = setTimeout(() => done(), 5000);
    el.preload = 'metadata';
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) && el.duration > 0 ? el.duration : undefined);
    el.onerror = () => done();
    el.src = url;
  });
}

/** `POST /v1/transcriptions` with the file, by XHR for its progress (as
 *  the dashboard does: transcribe app/src/lib/tx.ts `uploadTx`). */
async function send(file: File, options: object, onProgress: (sent: number, total: number) => void): Promise<Transcription> {
  const [env, token] = await Promise.all([currentEnv(), rpc('auth.token')]);
  const fd = new FormData();
  fd.append('options', JSON.stringify(options));
  fd.append('file', file, file.name);
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', `${env.api}/v1/transcriptions`);
    x.setRequestHeader('authorization', `Bearer ${token}`);
    x.upload.addEventListener('progress', (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); });
    x.addEventListener('load', () => {
      let body: { error?: { code?: string; message?: string }; code?: string; message?: string } | null = null;
      try { body = JSON.parse(x.responseText); } catch { /* not JSON */ }
      if (x.status >= 200 && x.status < 300 && body) resolve(body as unknown as Transcription);
      else {
        // Worded by its code like any API answer (lib/errors.ts).
        const code = (body?.error?.code ?? body?.code ?? (x.status === 413 ? 'payload_too_large' : 'internal')) as ConstructorParameters<typeof VocalStackError>[0];
        reject(new VocalStackError(code, body?.error?.message ?? body?.message ?? '', { status: x.status }));
      }
    });
    // A file over the upload limit is cut off mid-body: it reads as a network error.
    x.addEventListener('error', () => reject(new RpcError('The upload didn’t reach VocalStack. Check the connection, or the file may be over the upload limit.')));
    x.send(fd);
  });
}

/** What every file of one Transcribe is sent with. */
export interface UploadOptions { settings?: { spokenLanguage?: string | null; speakerLabels?: 'auto' | 'on' | 'off' } }

async function uploadOne(file: File, opts: UploadOptions): Promise<void> {
  const name = file.name.replace(/\.[^.]+$/, '').slice(0, 120) || 'Upload';
  if (!isMedia(file)) {
    track({ origin: 'file', name: file.name, phase: 'error', problem: { text: 'Not an audio or video file.' } });
    return;
  }
  const key = track({ origin: 'file', name, phase: 'uploading', sent: 0, total: file.size });
  try {
    const durationS = await measure(file);
    const t = await send(file, { name, crop: false, durationS, ...opts }, (sent, total) => patch(key, { sent, total }));
    created(key, t);
  } catch (e) {
    patch(key, { phase: 'error', problem: problemOf(e) });
  }
}

/** Transcribe local files, one upload after another. */
export async function uploadFiles(files: Iterable<File>, opts: UploadOptions = {}): Promise<void> {
  for (const f of files) await uploadOne(f, opts);
}

/** A web address to transcribe: a file or video page the server fetches,
 *  or a live stream it records as it plays. */
export interface Link { url: string; name: string; live?: boolean }

/** Send links to transcribe, each tracked like an upload. */
export async function transcribeLinks(links: Link[], opts: UploadOptions = {}): Promise<void> {
  const vs = await client();
  await Promise.all(links.map(async (l) => {
    const key = track({ origin: 'page', name: l.name, url: l.url, phase: 'sending' });
    try {
      if (l.live) {
        // A live stream: a live transcription the server pulls, started at
        // once (the dashboard's New live transcription does the same).
        const t = await vs.transcriptions.createLive({ name: l.name, source: { kind: 'stream', url: l.url } });
        patch(key, { transcription: t });
        await vs.transcriptions.startRecording(t.id);
        patch(key, { phase: 'live' });
      } else created(key, await vs.transcriptions.createFromUrl(l.url, { name: l.name, crop: false, settings: opts.settings }));
    } catch (e) {
      patch(key, { phase: 'error', problem: problemOf(e) });
    }
  }));
}

function Toast({ t, onSettings }: { t: Tracked; onSettings: () => void }) {
  const close = <IconBtn label="Close" onClick={() => patch(t.key, { hidden: true })}><IconClose /></IconBtn>;
  const open = t.transcription && <button type="button" className="toast__link" onClick={() => openApp(txPath(t.transcription!))}>Open<IconExternal /></button>;
  let line: React.ReactNode;
  let pct: number | null = null;
  let icon: React.ReactNode = <span className="spin" />;
  if (t.phase === 'uploading') {
    pct = t.total ? Math.round(((t.sent ?? 0) / t.total) * 100) : 0;
    line = `Uploading · ${pct}%`;
  } else if (t.phase === 'working') {
    line = jobText(t.job);
    pct = jobPct(t.job);
  } else if (t.phase === 'done') {
    icon = <IconCheck className="toast__ok" />;
    line = t.job?.state === 'cropping' ? jobText(t.job) : 'Transcribed';
  } else {
    icon = <IconAlert className="toast__bad" />;
    line = t.problem?.text ?? jobText(t.job);
  }
  const bad = t.phase === 'error' || t.phase === 'failed';
  return (
    <div className={`toast${bad ? ' toast--bad' : ''}`} role={bad ? 'alert' : 'status'}>
      {icon}
      <div className="toast__main">
        <div className="toast__title">{t.name}</div>
        <div className="toast__sub">{line}{t.problem?.billing && <> <button type="button" className="toast__link" onClick={() => openApp('/billing')}>Billing</button></>}{t.problem?.access && <> <button type="button" className="toast__link" onClick={onSettings}>Settings</button></>}</div>
        {pct !== null && <div className="progress"><i style={{ width: `${pct}%` }} /></div>}
      </div>
      {open}
      {close}
    </div>
  );
}

export function FileDrop({ account, onSettings, onDropped }: { account: Account; onSettings: () => void; onDropped: () => void }) {
  const [over, setOver] = useState(false);
  const [all, setAll] = useState(false);
  const toasts = useTracked('file').filter((t) => !t.hidden);
  const accountRef = useRef(account);
  accountRef.current = account;
  const droppedRef = useRef(onDropped);
  droppedRef.current = onDropped;

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const enter = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; setOver(true); };
    const overL = (e: DragEvent) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; };
    const leave = (e: DragEvent) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) setOver(false); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer!.files);
      // A sign-in that may not transcribe: say so once, upload nothing.
      if (!can(accountRef.current, 'record')) {
        track({ origin: 'file', name: files.length === 1 ? files[0]!.name : `${files.length} files`, phase: 'error', problem: { text: whyNot(accountRef.current, 'record'), access: true } });
        return;
      }
      queueFiles(files);
      droppedRef.current();
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', overL);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', overL);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return (
    <>
      {over && <div className="drop"><IconUpload />Drop audio or video to add it to Upload</div>}
      {toasts.length > 0 && (
        <div className={`toasts${all ? ' toasts--all' : ''}`} aria-live="polite">
          {/* The newest four; the rest behind one button, not dropped unseen. */}
          {toasts.length > 4 && !all && <button type="button" className="toasts__more" onClick={() => setAll(true)}>{toasts.length - 4} more {toasts.length - 4 === 1 ? 'upload' : 'uploads'}</button>}
          {(all ? toasts : toasts.slice(-4)).map((t) => <Toast key={t.key} t={t} onSettings={onSettings} />)}
          {all && toasts.length > 4 && <button type="button" className="toasts__more" onClick={() => setAll(false)}>Show fewer</button>}
        </div>
      )}
    </>
  );
}
