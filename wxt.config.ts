import { fileURLToPath } from 'node:url';
import { defineConfig } from 'wxt';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The public half of .keys/extension.pem: it fixes the extension's ID
// (oaenfiioponhlnnemllhgdmgdmaceilk), which the API trusts as an Origin
// (transcribe: src/domain/auth.rs, EXTENSION_ORIGINS) and which names the
// sign-in redirect (https://<id>.chromiumapp.org/). Never change it.
const KEY = 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6JfceS4w36TjFU6pBfwh8VyySD2lJfZ1E3y3y6L6CA2eBLYxOlB9bTTd+OjMx8FbVdLfbbDNYRS+o2oCof7wjhUWJSl5Z0H5QMcWyAPA9nCyXHqrNnGYHvwa/u7ILU7dsDRRc5MN8+jg4cg1XoDTLx3zS1t5nDh5Miqq1a+2IyoF9UfloJjdmXc5OKxsUrRDwahonHaVuHUn57epBRlksQESG+TOBmwrP9GSEcdqxA2gw7Yy1Q+89CdbFE822/05fA50qjpwHYg+0p6OQTYqL32IIKL0evv3H25f3toT8qdLk7EeKFu91AdfGnASulzH8lVpFqrIbfjT2ljrbSXpiwIDAQAB';

// VS_WEBSTORE=1 builds for the Chrome Web Store (scripts/publish-webstore.mjs,
// PUBLISHING.md) into output/store/chrome: the store refuses a manifest with
// `key`; the store item keeps the same id because its first upload carried
// the private key (key.pem). VS_VERSION (CI: <package major.minor>.<commits
// on main>) is the manifest version, which the store needs to grow.
const STORE = process.env.VS_WEBSTORE === '1';

export default defineConfig({
  srcDir: 'src',
  // Load unpacked from output/chrome or output/edge.
  outDir: STORE ? 'output/store' : 'output',
  outDirTemplate: '{{browser}}',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'VocalStack',
    ...(process.env.VS_VERSION ? { version: process.env.VS_VERSION } : {}),
    description: 'Transcribe what a page plays, caption and dub any video, record tabs and meetings, run broadcasts and train voices.',
    ...(STORE ? {} : { key: KEY }),
    minimum_chrome_version: '116',
    permissions: ['storage', 'identity', 'sidePanel', 'tabCapture', 'offscreen', 'contextMenus', 'activeTab', 'scripting', 'tabs', 'notifications', 'webNavigation'],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'VocalStack' },
    side_panel: { default_path: 'sidepanel.html' },
    omnibox: { keyword: 'vs' },
    commands: {
      'record-tab': { suggested_key: { default: 'Alt+Shift+R' }, description: 'Record this tab' },
      'captions': { suggested_key: { default: 'Alt+Shift+C' }, description: 'Captions: show this tab’s recording on the page' },
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        // The SDK straight from its source (the js-sdk submodule): one
        // client for every call, typed from the generated contract.
        '@vocalstack/sdk': at('./sdk/src/index.ts'),
        '@vocalstack/contract': at('./sdk/contract/src/index.ts'),
        // The SDK imports 'ws' only under Node; a browser has WebSocket.
        ws: at('./src/lib/ws-shim.ts'),
      },
    },
  }),
});
