// Upload output/vocalstack-edge-store.zip to Edge Add-ons and, by default,
// submit it for Microsoft's review. `npm run publish:edge` builds the zip
// first (VS_WEBSTORE=1 scripts/package.sh); CI runs the same from
// .github/workflows/publish-edge.yml. One-time setup: PUBLISHING.md.
//
// With no store credentials it says what is missing and exits 0, unless
// EDGE_REQUIRED=true (a release, from build.yml), when it fails. The
// PUBLISH_EXTENSION repo variable set to "false" skips it either way.
//
// Edge Add-ons API v1.1 (an API key and client id from Partner Center →
// Microsoft Edge → Publish API):
// https://learn.microsoft.com/microsoft-edge/extensions/update/api/using-addons-api

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(root, 'output', 'vocalstack-edge-store.zip');
const MANIFEST = path.join(root, 'output', 'store', 'edge', 'manifest.json');
const API = 'https://api.addons.microsoftedge.microsoft.com/v1';

// Local runs: credentials may sit in .env.local (git-ignored), KEY=value lines.
const local = path.join(root, '.env.local');
if (existsSync(local)) {
  for (const line of readFileSync(local, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const NAMES = {
  productId: 'EDGE_PRODUCT_ID',
  clientId: 'EDGE_CLIENT_ID',
  apiKey: 'EDGE_API_KEY',
};

// "Nothing to do now", not a failure: a version still in Microsoft's
// review, or the same version uploaded already.
const SOFT = /in[\s_-]?review|pending[\s_-]?review|submission.*in[\s_-]?progress|in[\s_-]?progress.*submission|already.*(review|publish|submitt|exist)|version already exists|same version|cannot be published while|can(no|')t (be )?(upload|update|publish).*(review|progress)/i;

const summary = (text) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) try { appendFileSync(file, `### Edge Add-ons\n${text}\n`); } catch { /* best effort */ }
};
const skip = (why) => { console.log(`skipped: ${why}`); summary(`Skipped: ${why}`); process.exit(0); };
const fail = (why, hint) => { console.error(`failed: ${why}`); if (hint) console.error(`  ${hint}`); summary(`Failed: ${why}`); process.exit(1); };

const version = (() => { try { return JSON.parse(readFileSync(MANIFEST, 'utf8')).version; } catch { return 'unknown'; } })();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What an error response or a failed operation says, in one line. */
const said = (body) => {
  if (!body || typeof body !== 'object') return String(body ?? '');
  const errors = (body.errors ?? []).map((e) => e.message ?? e.errorCode ?? JSON.stringify(e));
  return [body.errorCode, body.message, ...errors].filter(Boolean).join('; ') || JSON.stringify(body);
};

async function call(config, method, url, { body, type } = {}) {
  const res = await fetch(`${API}/products/${config.productId}${url}`, {
    method,
    headers: {
      Authorization: `ApiKey ${config.apiKey}`,
      'X-ClientID': config.clientId,
      ...(type ? { 'Content-Type': type } : {}),
    },
    body,
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { res, json };
}

/** Start an operation (202 and a Location naming it), then wait for it. */
async function operation(config, what, start, status) {
  const { res, json } = await start();
  if (res.status === 401 || res.status === 403) {
    fail(`the store refused the credentials (${res.status}): ${said(json)}`, 'Check EDGE_CLIENT_ID and EDGE_API_KEY (PUBLISHING.md); API keys expire.');
  }
  if (res.status !== 202) {
    const why = `${what} failed (${res.status}): ${said(json)}`;
    if (SOFT.test(why)) skip(`${what} deferred: ${said(json)}`);
    fail(why);
  }
  // The Location header is the operation's id, or a path ending in it.
  const id = (res.headers.get('location') ?? '').split('/').filter(Boolean).pop();
  if (!id) fail(`${what}: the store answered 202 without an operation id.`);

  for (let i = 0; i < 60; i++) {
    await sleep(5000);
    const { res: r, json: op } = await status(id);
    if (!r.ok) fail(`${what}: status check failed (${r.status}): ${said(op)}`);
    if (op?.status === 'Succeeded') return op;
    if (op?.status === 'Failed') {
      const why = said(op);
      if (SOFT.test(why)) skip(`${what} not applied: ${why}`);
      fail(`${what} failed: ${why}`);
    }
  }
  fail(`${what}: still in progress after 5 minutes; see Partner Center.`);
}

async function main() {
  if (process.env.PUBLISH_EXTENSION?.toLowerCase() === 'false') skip('publishing is off (PUBLISH_EXTENSION=false).');

  const config = Object.fromEntries(Object.entries(NAMES).map(([k, env]) => [k, process.env[env]]));
  const missing = Object.keys(NAMES).filter((k) => !config[k]);
  if (missing.length) {
    const why = `no store credentials (${missing.map((k) => NAMES[k]).join(', ')}); see PUBLISHING.md.`;
    if (process.env.EDGE_REQUIRED === 'true') fail(why);
    skip(why);
  }

  if (!existsSync(ZIP)) fail('output/vocalstack-edge-store.zip is missing.', 'Run `npm run publish:edge`, which builds it first.');

  const publish = (process.env.EDGE_PUBLISH ?? 'true').toLowerCase() !== 'false';

  console.log(`uploading v${version} to product ${config.productId}`);
  await operation(config, 'upload',
    () => call(config, 'POST', '/submissions/draft/package', { body: readFileSync(ZIP), type: 'application/zip' }),
    (id) => call(config, 'GET', `/submissions/draft/package/operations/${id}`));
  console.log(`uploaded v${version}`);

  if (!publish) {
    console.log('draft only (EDGE_PUBLISH=false): submit it from Partner Center.');
    summary(`Uploaded **v${version}** as a draft.`);
    return;
  }

  const notes = `VocalStack ${version}. Changes: https://github.com/vocalstack/chrome-extension/releases/tag/${version}`;
  const op = await operation(config, 'publish',
    () => call(config, 'POST', '/submissions', { body: JSON.stringify({ notes }), type: 'application/json' }),
    (id) => call(config, 'GET', `/submissions/operations/${id}`));
  console.log(`v${version}: submitted for review${op?.message ? ` (${op.message})` : ''}`);
  summary(`**v${version}** → submitted for review`);
}

main().catch((e) => fail(e.stack ?? e.message));
