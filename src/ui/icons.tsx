/** Stroke icons, 24-unit grid, 1.75 stroke: the dashboard's line style. */

import type { SVGProps } from 'react';
import markUrl from '../styles/vocalstack-mark.svg';
import logoMeet from '../styles/meetings/meet.svg';
import logoTeams from '../styles/meetings/teams.svg';
import logoZoom from '../styles/meetings/zoom.svg';
import logoWebex from '../styles/meetings/webex.svg';
import logoWhereby from '../styles/meetings/whereby.svg';
import logoGather from '../styles/meetings/gather.svg';
import logoDiscord from '../styles/meetings/discord.svg';

type P = SVGProps<SVGSVGElement>;
const S = (d: React.ReactNode) => (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>{d}</svg>
);

export const IconPage = S(<><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9h18" /><path d="m10 13 4 2.5-4 2.5z" /></>);
export const IconLive = S(<><circle cx="12" cy="12" r="3" /><path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" /></>);
export const IconBroadcast = S(<><circle cx="12" cy="11" r="2" /><path d="M8.5 14.5a5 5 0 0 1 0-7M15.5 7.5a5 5 0 0 1 0 7M5.6 17.4a9 9 0 0 1 0-12.8M18.4 4.6a9 9 0 0 1 0 12.8M12 13v8" /></>);
export const IconVoice = S(<><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>);
export const IconLibrary = S(<><path d="M4 5h16M4 10h16M4 15h10M4 20h7" /></>);
export const IconSearch = S(<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>);
export const IconMic = IconVoice;
export const IconTab = S(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M3 9h7V5" /></>);
export const IconCaptions = S(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="M10 10.5a2 2 0 1 0 0 3M17 10.5a2 2 0 1 0 0 3" /></>);
export const IconDub = S(<><path d="M4 9v6h3l4 4V5L7 9z" /><path d="M15 9.5a3.5 3.5 0 0 1 0 5M17.8 7a7 7 0 0 1 0 10" /></>);
export const IconMeeting = S(<><rect x="3" y="6" width="13" height="12" rx="2.5" /><path d="m16 10 5-3v10l-5-3" /></>);
export const IconFile = S(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></>);
export const IconUpload = S(<><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" /></>);
export const IconLink = S(<><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>);
export const IconVideo = S(<><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m10 9.5 4.5 2.5-4.5 2.5z" /></>);
export const IconAudio = S(<><path d="M9 18V6l11-2v12" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>);
export const IconGlobe = S(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></>);
export const IconPlay = S(<path d="M7 5v14l12-7z" />);
export const IconPause = S(<><path d="M8 5v14M16 5v14" /></>);
export const IconStop = S(<rect x="6" y="6" width="12" height="12" rx="2" />);
export const IconPlus = S(<path d="M12 5v14M5 12h14" />);
export const IconClose = S(<path d="M6 6l12 12M18 6 6 18" />);
export const IconBack = S(<path d="m15 5-7 7 7 7" />);
export const IconChevron = S(<path d="m9 5 7 7-7 7" />);
export const IconExternal = S(<><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>);
export const IconCopy = S(<><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>);
export const IconCheck = S(<path d="m5 12.5 4.5 4.5L19 7.5" />);
export const IconAlert = S(<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5v.01" /></>);
export const IconInfo = S(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5v.01" /></>);
export const IconSettings = S(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconArchive = S(<><rect x="3" y="4" width="18" height="5" rx="1.5" /><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4" /></>);
export const IconRestore = S(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>);
export const IconTrash = S(<><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></>);
export const IconShare = S(<><circle cx="18" cy="5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="19" r="2.5" /><path d="m8.2 10.8 7.6-4.5M8.2 13.2l7.6 4.5" /></>);
export const IconSparkle = S(<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />);
export const IconUser = S(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
export const IconSignOut = S(<><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" /></>);
export const IconKey = S(<><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 6l3 3M15 8l2 2" /></>);

/** The VocalStack mark (transcribe: app/public/vocalstack-mark.svg). */
export function Mark(p: React.ImgHTMLAttributes<HTMLImageElement>) {
  return <img src={markUrl} alt="" {...p} />;
}

/* ── The panel design's icons (design 3): Heroicons outline, 1.6 stroke ── */

const H = (d: string, sw = 1.6) => (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}><path d={d} /></svg>
);

export const HiGlobe = H('M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418');
export const HiMic = H('M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z');
export const HiUpload = H('M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5');
export const HiBroadcast = H('M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z');
export const HiVoices = H('M13.75 6.75a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0ZM3.6 19.7a6.8 6.8 0 0 1 13.5 0 16.3 16.3 0 0 1-6.75 1.47c-2.43 0-4.73-.53-6.8-1.48ZM17.8 4.6a4.5 4.5 0 0 1 0 5.6M20.5 2.6a7.2 7.2 0 0 1 0 9.6');
export const HiDoc = H('M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z');
export const HiFile = H('M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z');
export const HiVideo = H('m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z');
export const HiAudio = H('m9 9 10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z');
export const HiLang = H('m10.5 21 5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 0 1 6-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 0 1-3.827-5.802');
export const HiNone = H('M18.364 18.364A9 9 0 0 0 5.636 5.636m12.728 12.728A9 9 0 0 1 5.636 5.636m12.728 12.728L5.636 5.636');
export const HiChevronDown = H('m19.5 8.25-7.5 7.5-7.5-7.5', 2.2);
export const HiChevronRight = H('m8.25 4.5 7.5 7.5-7.5 7.5', 2);
export const HiBack = H('M15.75 19.5 8.25 12l7.5-7.5');
export const HiExternal = H('M13.5 6H5.25A2.25 2.25 0 0 0 3 8.25v10.5A2.25 2.25 0 0 0 5.25 21h10.5A2.25 2.25 0 0 0 18 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25', 1.8);
export const HiGear = (p: P) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <path d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
);
export const HiCursor = H('M15.042 21.672 13.684 16.6m0 0-2.51 2.225.569-9.47 5.227 7.917-3.286-.672ZM12 2.25V4.5m5.834.166-1.591 1.591M20.25 10.5H18M7.757 14.743l-1.59 1.59M6 10.5H3.75m4.007-4.243-1.59-1.59', 1.7);
export const HiCheck = H('m4.5 12.75 6 6 9-13.5', 3);
export const HiPause = H('M15.75 5.25v13.5m-7.5-13.5v13.5', 2);
export const HiPlayStroke = H('M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z', 2);
export const HiCloud = H('M12 16.5V9.75m0 0 3 3m-3-3-3 3M6.75 19.5a4.5 4.5 0 0 1-1.41-8.775 5.25 5.25 0 0 1 10.233-2.33 3 3 0 0 1 3.758 3.848A3.752 3.752 0 0 1 18 19.5H6.75Z', 1.5);
/** Floating Captions: a window with lines of text. */
export const HiCaptions = H('M3.75 7.5A2.25 2.25 0 0 1 6 5.25h12a2.25 2.25 0 0 1 2.25 2.25v9A2.25 2.25 0 0 1 18 18.75H6a2.25 2.25 0 0 1-2.25-2.25v-9ZM7.5 12.75h3.75m2.25 0h3.75M7.5 15.75h6m2.25 0h.75');
export const HiX = H('M6 18 18 6M6 6l12 12', 1.8);
export const HiPlus = H('M12 4.5v15m7.5-7.5h-15', 1.8);
export const HiSearch = H('m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z', 1.7);
export const HiKey = H('M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z');
export const HiSpeaker = H('M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z');
/** Filled play triangle (the Voices list's sample button). */
export const HiPlay = (p: P) => <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...p}><path d="M7 4.5v15l12-7.5z" /></svg>;

const MEETING_LOGOS: Record<string, string> = { meet: logoMeet, teams: logoTeams, zoom: logoZoom, webex: logoWebex, whereby: logoWhereby, gather: logoGather, discord: logoDiscord };
/** A meeting service's logo (lib/live.ts MEETING_HOSTS `key`). */
/** YouTube's mark, for a recording of a YouTube tab. */
export const YouTubeLogo = ({ size = 20 }: { size?: number }) => (
  <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" style={{ flex: 'none', display: 'block' }}><rect x="2" y="9" width="44" height="30" rx="9" fill="#FF0000" /><path d="M20 17.5v13l11-6.5z" fill="#fff" /></svg>
);

export function MeetingLogo({ k, size = 16 }: { k: string; size?: number }) {
  const src = MEETING_LOGOS[k];
  return src ? <img src={src} alt="" width={size} height={size} style={{ flex: 'none', display: 'block' }} /> : null;
}
