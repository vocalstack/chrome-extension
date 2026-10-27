/** Upload (design 3): local audio and video files, picked or dropped
 *  (anywhere on the panel: FileDrop adds them here), and videos sent from
 *  Now (File Upload); Transcribe sends each as its own transcription, in
 *  the header's spoken language with the speaker labels setting, and
 *  TRANSCRIBING lists them as they go, each opening in the Library when
 *  ready. */

import { useRef, useSyncExternalStore } from 'react';
import type { Account } from '../lib/auth';
import { can, whyNot } from '../lib/access';
import { Eyebrow } from '../ui/ds';
import { HiCloud, HiFile, HiPlus, HiVideo, HiX } from '../ui/icons';
import { Note } from '../ui/kit';
import { AccessNote } from '../ui/access';
import { useSpeakerLabels, useSpokenLang } from '../ui/langs';
import { jobPct, jobText, patch, useTracked } from './page/tracker';
import { isMedia, measure, transcribeLinks, uploadFiles, type Link } from './FileDrop';

/** A local file, or a video on the web (from Now). */
type Queued = { id: number; durationS?: number } & ({ file: File; link?: undefined } | { link: Link & { host: string }; file?: undefined });

/* The files waiting for Transcribe: the panel's, so a drop on another
 * tab of the panel lands here too. */
let queue: Queued[] = [];
let rejected: string[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
let n = 0;

/** Add files to Upload's list (not audio or video: said once, left out). */
export function queueFiles(files: Iterable<File>): void {
  const bad: string[] = [];
  for (const f of files) {
    if (!isMedia(f)) { bad.push(f.name); continue; }
    if (queue.some((q) => q.file?.name === f.name && q.file?.size === f.size)) continue;
    const q: Queued = { id: ++n, file: f };
    queue = [...queue, q];
    void measure(f).then((d) => { queue = queue.map((x) => (x.id === q.id ? { ...x, durationS: d } : x)); emit(); });
  }
  rejected = bad;
  emit();
}
/** Add a web video to the list (Now's File Upload). */
export function queueLink(link: Link & { host: string; durationS?: number }): void {
  if (!queue.some((q) => q.link?.url === link.url)) queue = [{ id: ++n, link, durationS: link.durationS }, ...queue];
  emit();
}
const remove = (id: number) => { queue = queue.filter((q) => q.id !== id); emit(); };
const take = () => { const all = queue; queue = []; rejected = []; emit(); return all; };
const snap = () => queue;
const snapBad = () => rejected;
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

const KIND: Record<string, string> = { 'audio/mpeg': 'MP3', 'audio/mp4': 'M4A', 'audio/x-m4a': 'M4A', 'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'video/mp4': 'MP4', 'video/webm': 'WEBM', 'audio/webm': 'WEBM', 'audio/ogg': 'OGG', 'audio/flac': 'FLAC', 'video/quicktime': 'MOV' };
const nameOf = (q: Queued) => q.file?.name ?? q.link!.name;
const metaOf = (q: Queued) => (q.file ? [kindOf(q.file), mb(q.file.size)] : [q.link!.host.toUpperCase()]).concat(q.durationS ? [mmss(q.durationS)] : []).join(' · ');
const kindOf = (f: File) => KIND[f.type] ?? (f.name.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toUpperCase();
const mb = (b: number) => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const mmss = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const hms = (s: number) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function UploadScreen({ account, onSettings, onLibrary }: { account: Account; onSettings: () => void; onLibrary: () => void }) {
  const files = useSyncExternalStore(sub, snap);
  const bad = useSyncExternalStore(sub, snapBad);
  const input = useRef<HTMLInputElement>(null);
  const [lang] = useSpokenLang();
  const [labels] = useSpeakerLabels();
  const mayRecord = can(account, 'record');
  const total = files.reduce((a, f) => a + (f.durationS ?? 0), 0);
  const choose = () => input.current?.click();

  const start = () => {
    if (!files.length || !mayRecord) return;
    const all = take();
    const metas = new Map(all.map((q) => [q.file ?? q.link, metaOf(q)] as const));
    const opts = { settings: { spokenLanguage: lang, speakerLabels: labels }, metaOf: (f: File) => metas.get(f) ?? '' };
    void transcribeLinks(all.flatMap((q) => (q.link ? [{ ...q.link, meta: metaOf(q) }] : [])), opts, 'file');
    void uploadFiles(all.flatMap((q) => (q.file ? [q.file] : [])), opts);
  };

  return (
    <div className="screen screen--fill" data-screen-label="Upload">
      <AccessNote account={account} need="record" onSettings={onSettings} />
      <input ref={input} type="file" accept="audio/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) queueFiles(Array.from(e.target.files)); e.target.value = ''; }} />
      <div className="card2">
        <Eyebrow>AUDIO SOURCE</Eyebrow>
        {!files.length ? (
          <button type="button" className="drop2" onClick={choose}>
            <HiCloud width={22} height={22} />
            <span className="drop2__title">Choose files or drop them here</span>
            <span className="drop2__sub">Long files keep transcribing after you close this panel.</span>
          </button>
        ) : (
          <div className="files">
            <div className="files__head"><span>{files.length} {files.length === 1 ? 'FILE' : 'FILES'}</span>{total > 0 && <span>{hms(total)} TOTAL</span>}</div>
            {files.map((q) => (
              <div key={q.id} className="file">
                {q.link ? <HiVideo width={17} height={17} style={{ color: 'var(--brand)', flex: 'none' }} /> : <HiFile width={17} height={17} style={{ color: 'var(--brand)', flex: 'none' }} />}
                <div className="lrow__main">
                  <div className="file__name" title={nameOf(q)}>{nameOf(q)}</div>
                  <div className="file__meta">{metaOf(q)}</div>
                </div>
                <button type="button" className="file__x" title="Remove" aria-label={`Remove ${nameOf(q)}`} onClick={() => remove(q.id)}><HiX width={14} height={14} /></button>
              </div>
            ))}
            <button type="button" className="cta cta--dashed" style={{ height: 42, borderRadius: 10, fontSize: 13 }} onClick={choose}><HiPlus width={15} height={15} />Add Another File</button>
            <p className="card2__note" style={{ marginTop: 3, fontSize: 11.5, color: 'var(--ink-45)' }}>Each file becomes its own transcript, named after the file.</p>
          </div>
        )}
        {bad.length > 0 && <div style={{ marginTop: 10 }}><Note kind="warn">{bad.length === 1 ? `“${bad[0]}” is not an audio or video file.` : `${bad.length} files are not audio or video.`}</Note></div>}
      </div>
      <Jobs onLibrary={onLibrary} />
      <button type="button" className="cta cta--end" disabled={!files.length || !mayRecord} title={!mayRecord ? whyNot(account, 'record') : undefined} onClick={start}>
        {files.length > 1 ? `Transcribe ${files.length} Files` : 'Transcribe'}
      </button>
    </div>
  );
}

/** TRANSCRIBING: what Upload sent in this panel, with its progress, and
 *  READY · OPEN (the Library) when done. */
function Jobs({ onLibrary }: { onLibrary: () => void }) {
  const jobs = useTracked('file').filter((t) => !t.hidden);
  if (!jobs.length) return null;
  return (
    <div className="card2 jobs">
      <Eyebrow>TRANSCRIBING</Eyebrow>
      {jobs.slice().reverse().map((t) => {
        const done = t.phase === 'done' || t.phase === 'live';
        const bad = t.phase === 'error' || t.phase === 'failed';
        // Uploading is the first fifth of the bar, the transcription the rest.
        const up = t.total ? (t.sent ?? 0) / t.total : 0;
        const job = jobPct(t.job);
        const pct = t.phase === 'uploading' ? Math.round(up * 20) : t.phase === 'working' ? 20 + Math.round((job ?? 0) * 0.8) : t.phase === 'sending' ? 0 : 100;
        return (
          <div key={t.key} className="job">
            <div className="job__row">
              <div className="lrow__main">
                <div className="job__name" title={t.name}>{t.name}</div>
                <div className={`job__meta${bad ? ' job__meta--bad' : ''}`}>{bad ? (t.problem?.text ?? jobText(t.job)) : t.meta || jobText(t.job)}</div>
              </div>
              {done ? <button type="button" className="job__open" onClick={onLibrary}>READY · OPEN</button>
                : bad ? <button type="button" className="file__x" aria-label={`Dismiss ${t.name}`} onClick={() => patch(t.key, { hidden: true })}><HiX width={14} height={14} /></button>
                : <span className="job__pct">{pct}%</span>}
            </div>
            {!done && !bad && <div className="lrow__bar" style={{ marginTop: 0 }}><i style={{ width: `${pct}%` }} /></div>}
          </div>
        );
      })}
    </div>
  );
}
