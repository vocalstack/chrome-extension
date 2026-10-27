/** YouTube, in the page's own world, before the player loads: every
 *  append to an audio SourceBuffer is copied to the extension's side of
 *  the frame (content/ahead.ts), so a live session can transcribe the
 *  video's audio before it plays. Only copies: the player's calls go
 *  through as they were. Each buffer is named by a number, and by the
 *  object URL of its MediaSource (the video element's `src`), so the
 *  other side can tell the main player from a preview. */

export default defineContentScript({
  matches: ['*://*.youtube.com/*', '*://*.youtube-nocookie.com/*'],
  allFrames: true,
  runAt: 'document_start',
  world: 'MAIN',
  main() {
    const TAG = 'vocalstack.buffer';
    const post = (m: Record<string, unknown>, transfer: Transferable[] = []) => window.postMessage({ [TAG]: m }, location.origin, transfer);
    const urls = new WeakMap<MediaSource, string>();
    const ids = new WeakMap<SourceBuffer, number>();
    let next = 0;

    const createObjectURL = URL.createObjectURL;
    URL.createObjectURL = function (o: Blob | MediaSource) {
      const url = createObjectURL.call(URL, o);
      if (o instanceof MediaSource) urls.set(o, url);
      return url;
    };

    const addSourceBuffer = MediaSource.prototype.addSourceBuffer;
    MediaSource.prototype.addSourceBuffer = function (type: string) {
      const sb = addSourceBuffer.call(this, type);
      if (/^audio\//i.test(type)) {
        ids.set(sb, ++next);
        post({ sb: next, type, src: urls.get(this) ?? '' });
      }
      return sb;
    };

    const appendBuffer = SourceBuffer.prototype.appendBuffer;
    SourceBuffer.prototype.appendBuffer = function (data: BufferSource) {
      const sb = ids.get(this);
      if (sb) {
        try {
          const view = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
          const copy = view.slice().buffer;
          post({ sb, offset: this.timestampOffset, data: copy }, [copy]);
        } catch { /* never in the player's way */ }
      }
      return appendBuffer.call(this, data);
    };

    const abort = SourceBuffer.prototype.abort;
    SourceBuffer.prototype.abort = function () {
      const sb = ids.get(this);
      if (sb) post({ sb, abort: true });
      return abort.call(this);
    };

    const changeType = SourceBuffer.prototype.changeType;
    if (changeType) {
      SourceBuffer.prototype.changeType = function (type: string) {
        const sb = ids.get(this);
        if (sb) post({ sb, type });
        return changeType.call(this, type);
      };
    }
  },
});
