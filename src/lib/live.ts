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
  /** 0..1 while preparing. */
  progress?: number;
  error?: string;
  transcriptionId?: string;
  recordingId?: string;
}

/** Meetings the extension offers to record: the tab's address says so. */
export const MEETING_HOSTS: { re: RegExp; name: string }[] = [
  { re: /^https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i, name: 'Google Meet' },
  { re: /^https:\/\/teams\.(microsoft|live)\.com\//i, name: 'Microsoft Teams' },
  { re: /^https:\/\/([\w-]+\.)?zoom\.us\/(wc|j)\//i, name: 'Zoom' },
  { re: /^https:\/\/app\.zoom\.us\/wc\//i, name: 'Zoom' },
  { re: /^https:\/\/([\w-]+\.)?webex\.com\/(meet|wbxmjs|webappng)/i, name: 'Webex' },
  { re: /^https:\/\/whereby\.com\/[\w-]+/i, name: 'Whereby' },
  { re: /^https:\/\/app\.gather\.town\//i, name: 'Gather' },
  { re: /^https:\/\/discord\.com\/channels\//i, name: 'Discord' },
];

/** Settings: offer to record when a tab joins a meeting (default on). */
export const OFFER_KEY = 'meetings.offer';

export function meetingOf(url: string | undefined): string | null {
  if (!url) return null;
  return MEETING_HOSTS.find((m) => m.re.test(url))?.name ?? null;
}
