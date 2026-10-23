# VocalStack for Chrome and Edge

The VocalStack browser extension (Manifest V3). Private: load it unpacked; it is not in any store.

Read more about the [VocalStack transcription extension for Chrome and Edge](https://vocalstack.com/chrome-transcription-extension/) on the [VocalStack website](https://vocalstack.com/).

What it does, from the side panel (toolbar icon):

- **This page** — finds the audio and video a page plays or links to (every frame, embedded players, media links), checks which ones VocalStack can fetch, and transcribes them. Live captions and dubbing for the page's video. Drop or pick a local file to upload it.
- **Live** — record this tab, the microphone or both into a live transcription; record a meeting (Meet, Teams, Zoom and others on the web) with a summary at the end; live captions over the tab's video, translated if you like.
- **Broadcasts** — create and manage broadcasts, share links, go live from the microphone.
- **Voices** — train a voice from the microphone, a file or a speaker in a transcription; preview, rename, recolour.
- **Library** — search every transcript; recent transcriptions.

Also: right-click "Transcribe this link / video / page", `vs <words>` in the address bar to search transcripts, Alt+Shift+R to record the tab, Alt+Shift+C for captions.

## Run it

```sh
git submodule update --init      # sdk/ = github.com/vocalstack/js-sdk
npm install
npm run build                    # Chrome: output/chrome
npm run build:edge               # Edge:   output/edge
npm run dev                      # Chrome with reload on save
```

Or download a build: see PUBLISHING.md (fixed links to the latest main build; Chrome Web Store setup).

Load it: `chrome://extensions` (or `edge://extensions`) → Developer mode → Load unpacked → the `output/chrome` folder (Edge: `output/edge`).

Settings → Environment switches between production, e2e and this computer (`localhost:8080` / `:5176`; for a scratch API on another port, run `chrome.storage.local.set({ localApi: 'http://localhost:8090' })` in the service worker console).

## How it is put together

| Part | Where | Does |
|---|---|---|
| Service worker | `src/entrypoints/background.ts`, `src/background/*` | sign-in, the RPC router (`src/lib/rpc.ts`), tab capture ids, context menus, omnibox, meetings, dub orchestration |
| Side panel | `src/entrypoints/sidepanel`, `src/ui`, `src/screens` | the UI (React) |
| Offscreen document | `src/entrypoints/offscreen`, `src/offscreen/*` | captures tab + microphone audio (16 kHz mono, `public/pcm-worklet.js`) and streams it; plays dubs |
| Content script | `src/entrypoints/content.ts`, `src/content/*` | media scan, captions overlay, dub clock |
| Permission page | `src/entrypoints/permission` | asks for the microphone once for the whole extension |

All API calls go through the TypeScript SDK (`sdk/`, aliased as `@vocalstack/js-sdk`).

### Sign-in

- **Sign in with VocalStack** is One-click Connect (transcribe: `docs/connect.md`): OAuth 2.0 code + PKCE where the token is an API key. `chrome.identity.launchWebAuthFlow` opens the dashboard's `/connect` screen; it redirects to `https://<extension id>.chromiumapp.org/connect`, which the browser hands to the extension; the extension redeems the code at `POST /v1/connect/token`.
- **Use an API key**: paste one from Developers → API keys.

Either way the key stays in `chrome.storage.local`. It is never sent to `/v1`, which refuses keys from browsers. The extension exchanges it at `POST /docs/key-exchange` for 15-minute key tokens. The API trusts the extension's Origin for those two calls only (transcribe: `src/domain/auth.rs`, `EXTENSION_ORIGINS`).

### The extension id

`key` in `wxt.config.ts` fixes the id at `oaenfiioponhlnnemllhgdmgdmaceilk`, for unpacked loads in Chrome and Edge alike. The API and the dashboard's consent screen know that id. The private key (`.keys/extension.pem`, git-ignored) is needed only to pack a `.crx`. Keep a copy somewhere safe. If it is lost, a new key means a new id, and then the API and the dashboard must be told the new one.

## Checks

```sh
npm run check     # wxt prepare + tsc
npm run build
```
