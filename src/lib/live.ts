/** Live sessions: what the panel asks the background for, and what it
 *  reports back. The audio itself is captured and streamed by the
 *  offscreen document (entrypoints/offscreen). */

export type LiveMode =
  /** A live transcription, stored (Transcriptions in the dashboard). */
  | 'record'
  /** `record` of a meeting tab (+ the microphone), summarised at the end. */
  | 'meeting'
  /** Captions over the tab's video; a realtime session, nothing stored. */
  | 'captions'
  /** A take in one of the account's broadcasts: listeners follow it. */
  | 'broadcast';

export interface LiveInput {
  /** The tab's own audio (chrome.tabCapture). */
  tab: boolean;
  /** The microphone. */
  mic: boolean;
}

export interface LiveStart {
  mode: LiveMode;
  /** The tab to capture (default: the active one). */
  tabId?: number;
  input: LiveInput;
  /** null = detect. */
  spokenLanguage?: string | null;
  /** Captions: show a translation in this language. */
  translateTo?: string | null;
  name?: string;
  broadcastId?: string;
  /** Take over a broadcast another device is recording. */
  takeover?: boolean;
  /** Record / meeting of a tab: also show the transcript as captions on it. */
  overlay?: boolean;
  /** Speaker labels (`auto`: When Needed). */
  speakerLabels?: 'auto' | 'on' | 'off';
  /** Set by the background from the tab: its meeting service and host. */
  meeting?: MeetingKey;
  host?: string;
}

export type LiveState = 'starting' | 'warming' | 'live' | 'paused' | 'stopping' | 'done' | 'failed';

export interface LiveStatus {
  id: string;
  mode: LiveMode;
  state: LiveState;
  input: LiveInput;
  name: string;
  tabId?: number;
  tabTitle?: string;
  startedAt: number;
  /** Seconds of audio sent. */
  sentS?: number;
  error?: string;
  errorCode?: string;
  transcriptionId?: string;
  broadcastId?: string;
  recordingId?: string;
  translateTo?: string | null;
  /** The spoken language it was started with (null: detected), for Try again. */
  spokenLanguage?: string | null;
  /** The transcript shows as captions on the tab. */
  overlay?: boolean;
  speakerLabels?: 'auto' | 'on' | 'off';
  meeting?: MeetingKey;
  host?: string;
  /** Meeting: the summary, once the recording is done. */
  summary?: string | null;
  /** 0..1 input level, for the meter. */
  level?: number;
}

export interface CaptionStyle {
  size: 's' | 'm' | 'l';
  position: 'bottom' | 'top';
  /** Show the original line above its translation. */
  showOriginal: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { size: 'm', position: 'bottom', showOriginal: true };

export interface DubStart {
  tabId: number;
  /** The page or media address VocalStack transcribes. */
  url: string;
  title?: string;
  /** The language to dub into. */
  lang: string;
  /** A voice id from the catalogue (default: the language's default). */
  voice?: string | null;
}

export type DubState = 'transcribing' | 'translating' | 'voicing' | 'ready' | 'playing' | 'failed';

export interface DubStatus {
  tabId: number;
  state: DubState;
  lang: string;
  title?: string;
  /** What was transcribed (to dub it again in another language). */
  url?: string;
  /** 0..1 while preparing. */
  progress?: number;
  error?: string;
  transcriptionId?: string;
  recordingId?: string;
}

/** Captions on a page's video, from its transcription (background/vcap.ts). */
export interface VcapStart {
  tabId: number;
  /** The page or media address VocalStack transcribes. */
  url: string;
  title?: string;
  /** The reading language; null: as spoken. */
  lang?: string | null;
  /** Started by Settings → Captions on videos. */
  auto?: boolean;
}

export interface VcapStatus {
  tabId: number;
  state: 'transcribing' | 'translating' | 'on' | 'failed';
  lang: string | null;
  url: string;
  title?: string;
  progress?: number;
  error?: string;
  transcriptionId?: string;
  recordingId?: string;
  auto?: boolean;
}

/** Meetings the extension offers to record: the tab's address says so.
 *  `key` names the service's logo (styles/meetings/<key>.svg). */
export type MeetingKey = 'meet' | 'teams' | 'zoom' | 'webex' | 'whereby' | 'gather' | 'discord';
export const MEETING_HOSTS: { re: RegExp; name: string; key: MeetingKey }[] = [
  { re: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i, name: 'Google Meet', key: 'meet' },
  { re: /^https:\/\/teams\.(microsoft|live)\.com\//i, name: 'Microsoft Teams', key: 'teams' },
  { re: /^https:\/\/([\w-]+\.)?zoom\.us\/(wc|j)\//i, name: 'Zoom', key: 'zoom' },
  { re: /^https:\/\/app\.zoom\.us\/wc\//i, name: 'Zoom', key: 'zoom' },
  { re: /^https:\/\/([\w-]+\.)?webex\.com\/(meet|wbxmjs|webappng)/i, name: 'Webex', key: 'webex' },
  { re: /^https:\/\/whereby\.com\/[\w-]+/i, name: 'Whereby', key: 'whereby' },
  { re: /^https:\/\/app\.gather\.town\//i, name: 'Gather', key: 'gather' },
  { re: /^https:\/\/discord\.com\/channels\//i, name: 'Discord', key: 'discord' },
];

/** Settings: captions on every video played (default off; background/vcap.ts). */
export const AUTO_CAPTIONS = 'captions.auto';

/** Settings: offer to record when a tab joins a meeting (default on). */
export const OFFER_KEY = 'meetings.offer';

/** Modes that record (stored in the account); captions do not. */
export const RECORDING_MODES: LiveMode[] = ['record', 'meeting', 'broadcast'];

/** Still running: starting, live, paused or stopping. */
export function isRunning(s: LiveStatus): boolean {
  return !['done', 'failed'].includes(s.state);
}

/** The running session that holds a tab's audio (one capture per tab). */
export function tabHolder(all: LiveStatus[], tabId: number | undefined): LiveStatus | undefined {
  if (tabId === undefined) return undefined;
  return all.find((s) => s.tabId === tabId && s.input.tab && isRunning(s) && s.state !== 'stopping');
}

/** Pages Chrome lets no extension capture. */
export function capturable(url: string | undefined): boolean {
  return !!url && /^(https?|file):/.test(url) && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com|microsoftedge\.microsoft\.com\/addons)/.test(url);
}

export function meetingOf(url: string | undefined): string | null {
  return meetingHost(url)?.name ?? null;
}

export function meetingHost(url: string | undefined): { name: string; key: MeetingKey } | null {
  if (!url) return null;
  return MEETING_HOSTS.find((m) => m.re.test(url)) ?? null;
}
