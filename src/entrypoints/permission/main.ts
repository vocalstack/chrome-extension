/** The microphone permission tab (background/live.ts `askMic`): asking
 *  here grants the microphone to the whole extension, offscreen document
 *  and side panel included. */

const msg = document.getElementById('msg')!;

navigator.mediaDevices.getUserMedia({ audio: true }).then(
  (stream) => {
    stream.getTracks().forEach((t) => t.stop());
    msg.className = 'ok';
    msg.textContent = 'Done. You can close this tab.';
    void chrome.runtime.sendMessage({ micGranted: true });
    setTimeout(() => window.close(), 900);
  },
  (e: DOMException) => {
    msg.className = 'bad';
    msg.textContent = e.name === 'NotFoundError'
      ? 'No microphone was found. Connect one and try again.'
      : 'The microphone is blocked for VocalStack. Click the icon at the left of the address bar, allow the microphone, then reload this page.';
    void chrome.runtime.sendMessage({ micGranted: false });
  },
);
