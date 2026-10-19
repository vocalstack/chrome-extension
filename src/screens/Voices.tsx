/** Voices: the account's cloned voices, one voice, and making a new one.
 *  The pieces are in screens/voices/. */

import { useState } from 'react';
import { VoiceList } from './voices/VoiceList';
import { VoiceDetail } from './voices/VoiceDetail';
import { VoiceNew } from './voices/VoiceNew';

type Where = { at: 'list' } | { at: 'voice'; id: string } | { at: 'new' };

export function VoicesScreen() {
  const [where, setWhere] = useState<Where>({ at: 'list' });
  const list = () => setWhere({ at: 'list' });
  if (where.at === 'voice') return <VoiceDetail key={where.id} id={where.id} onBack={list} />;
  if (where.at === 'new') return <VoiceNew onBack={list} onCreated={(v) => setWhere({ at: 'voice', id: v.id })} />;
  return <VoiceList onOpen={(v) => setWhere({ at: 'voice', id: v.id })} onNew={() => setWhere({ at: 'new' })} />;
}
