import type { PanelIntent } from '../background/panel';
import type { LiveStatus } from '../lib/live';
export function LiveScreen(_: { live: LiveStatus[]; intent: PanelIntent | null; onIntentDone: () => void }) { return null; }
