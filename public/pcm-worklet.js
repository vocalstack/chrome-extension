// The capture graph's last node (offscreen document): every 128-frame
// block of the mixed, mono, 16 kHz input goes to the main thread, which
// batches it into the socket's chunks. A file, not a blob: an extension
// page's CSP refuses blob: worklets.
class PCMProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-processor', PCMProcessor);
