/** The offscreen document: the extension's audio. It captures tabs and
 *  the microphone and streams them to VocalStack (offscreen/capture.ts),
 *  and plays dubs in time with the page's video (offscreen/dub.ts).
 *  The background creates it on first need and talks to it with `OffCmd`. */

import { isOffCmd, type OffAnswer, type OffCmd } from '../../lib/offscreen';
import { forgetLive, listLive, liveHistory, pauseLive, setLive, startLive, stopLive } from '../../offscreen/capture';
import { dubLoad, dubStop, dubSync } from '../../offscreen/dub';

async function handle(cmd: OffCmd): Promise<OffAnswer> {
  switch (cmd.off) {
    case 'live.start': return { ok: true, value: await startLive(cmd) };
    case 'live.stop': await stopLive(cmd.id); return { ok: true };
    case 'live.pause': await pauseLive(cmd.id, cmd.paused); return { ok: true };
    case 'live.list': return { ok: true, statuses: listLive() };
    case 'live.history': return { ok: true, value: liveHistory(cmd.id) };
    case 'live.set': await setLive(cmd.id, cmd); return { ok: true };
    case 'live.forget': forgetLive(cmd.id); return { ok: true };
    case 'dub.load': await dubLoad(cmd); return { ok: true };
    case 'dub.sync': dubSync(cmd); return { ok: true };
    case 'dub.stop': dubStop(cmd.tabId); return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, send: (a: OffAnswer) => void) => {
  if (!isOffCmd(msg)) return false;
  handle(msg).then(send, (e: unknown) => send({ ok: false, error: e instanceof Error ? e.message : String(e), code: (e as { code?: string })?.code }));
  return true;
});
