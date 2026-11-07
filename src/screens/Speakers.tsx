/** Speakers: the people the account saved (recognised by their voice, and
 *  read in their cloned voice when they consented), one of them, and
 *  saving a new one. The pieces are in screens/speakers/. */

import { useState } from 'react';
import { SpeakerList } from './speakers/SpeakerList';
import { SpeakerDetail } from './speakers/SpeakerDetail';
import { SpeakerNew } from './speakers/SpeakerNew';

type Where = { at: 'list' } | { at: 'speaker'; id: string } | { at: 'new' };

export function SpeakersScreen() {
  const [where, setWhere] = useState<Where>({ at: 'list' });
  const list = () => setWhere({ at: 'list' });
  if (where.at === 'speaker') return <SpeakerDetail key={where.id} id={where.id} onBack={list} />;
  if (where.at === 'new') return <SpeakerNew onBack={list} onCreated={(s) => setWhere({ at: 'speaker', id: s.id })} />;
  return <SpeakerList onOpen={(s) => setWhere({ at: 'speaker', id: s.id })} onNew={() => setWhere({ at: 'new' })} />;
}
