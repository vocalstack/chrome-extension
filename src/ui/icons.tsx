/** Stroke icons, 24-unit grid, 1.75 stroke: the dashboard's line style. */

import type { SVGProps } from 'react';
import markUrl from '../styles/vocalstack-mark.svg';

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
