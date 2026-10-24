// Upload output/vocalstack-webstore.zip to the Chrome Web Store and, by
// default, publish it. `npm run publish:webstore` builds the zip first
// (VS_WEBSTORE=1 scripts/package.sh); CI runs the same from
// .github/workflows/publish-webstore.yml. One-time setup: PUBLISHING.md.
//
// With no store credentials it says what is missing and exits 0, unless
// WEBSTORE_REQUIRED=true (a release, from build.yml), when it fails. The
// PUBLISH_EXTENSION repo variable set to "false" skips it either way.
//
// Chrome Web Store API v2 (chrome-webstore-upload 6), which needs the
// publisher id as well as the item id.

import { appendFileSync, createReadStream, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chromeWebstoreUpload from 'chrome-webstore-upload';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(root, 'output', 'vocalstack-webstore.zip');
const MANIFEST = path.join(root, 'output', 'store', 'chrome', 'manifest.json');

// Local runs: credentials may sit in .env.local (git-ignored), KEY=value lines.
const local = path.join(root, '.env.local');
if (existsSync(local)) {
  for (const line of readFileSync(local, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*"?(.*?)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const NAMES = {
  extensionId: 'CHROME_EXTENSION_ID',
  publisherId: 'CHROME_PUBLISHER_ID',
  clientId: 'CHROME_CLIENT_ID',
  clientSecret: 'CHROME_CLIENT_SECRET',
  refreshToken: 'CHROME_REFRESH_TOKEN',
};

// "Nothing to do now", not a failure: a version still in Google's review,
// or the same version uploaded already.
const SOFT = /in[\s_-]?review|pending[\s_-]?review|in[\s_-]?progress|already.*(review|publish|submitt|exist)|version already exists|same version|no newer version|cannot be published while/i;

const summary = (text) => {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) try { appendFileSync(file, `### Chrome Web Store\n${text}\n`); } catch { /* best effort */ }
};
const skip = (why) => { console.log(`skipped: ${why}`); summary(`Skipped: ${why}`); process.exit(0); };
const fail = (why, hint) => { console.error(`failed: ${why}`); if (hint) console.error(`  ${hint}`); process.exit(1); };

const version = (() => { try { return JSON.parse(readFileSync(MANIFEST, 'utf8')).version; } catch { return 'unknown'; } })();

async function main() {
  if (process.env.PUBLISH_EXTENSION?.toLowerCase() === 'false') skip('publishing is off (PUBLISH_EXTENSION=false).');

  const config = Object.fromEntries(Object.entries(NAMES).map(([k, env]) => [k, process.env[env]]));
  const missing = ['extensionId', 'publisherId', 'clientId', 'clientSecret', 'refreshToken'].filter((k) => !config[k]);
  if (missing.length) {
    const why = `no store credentials (${missing.map((k) => NAMES[k]).join(', ')}); see PUBLISHING.md.`;
    if (process.env.WEBSTORE_REQUIRED === 'true') { summary(`Failed: ${why}`); fail(why); }
    skip(why);
  }

  if (!existsSync(ZIP)) fail('output/vocalstack-webstore.zip is missing.', 'Run `npm run publish:webstore`, which builds it first.');

  const publish = (process.env.WEBSTORE_PUBLISH ?? 'true').toLowerCase() !== 'false';
  const target = process.env.WEBSTORE_TARGET === 'trustedTesters' ? 'trustedTesters' : 'default';
  const store = chromeWebstoreUpload(config);

  let token;
  try { token = await store.fetchToken(); } catch (e) {
    fail(`the store refused the credentials: ${e.message}`, 'Check CHROME_CLIENT_ID, CHROME_CLIENT_SECRET and CHROME_REFRESH_TOKEN (PUBLISHING.md).');
  }

  console.log(`uploading v${version} to item ${config.extensionId}`);
  let upload;
  try { upload = await store.uploadExisting(createReadStream(ZIP), token, 300); } catch (e) {
    if (SOFT.test(e.message)) skip(`upload deferred: ${e.message}`);
    fail(`upload failed: ${e.message}`);
  }
  if (upload.uploadState !== 'SUCCEEDED') {
    const detail = (upload.itemError ?? []).map((e) => e.error_detail ?? e.errorDetail ?? e.error_code).join('; ') || upload.uploadState;
    if (SOFT.test(detail)) skip(`upload not applied: ${detail}`);
    fail(`upload did not succeed (${upload.uploadState}): ${detail}`);
  }
  console.log(`uploaded v${version}`);

  if (!publish) {
    console.log('draft only (WEBSTORE_PUBLISH=false): publish it from the developer dashboard.');
    summary(`Uploaded **v${version}** as a draft.`);
    return;
  }

  let result;
  try { result = await store.publish(target, token); } catch (e) {
    if (SOFT.test(e.message)) skip(`publish deferred: ${e.message}`);
    fail(`publish failed: ${e.message}`);
  }
  const state = result?.state ?? 'UNKNOWN';
  if (state === 'REJECTED') fail(`v${version} was rejected by the Chrome Web Store.`);
  console.log(`v${version}: ${state}${target === 'trustedTesters' ? ' (trusted testers)' : ''}`);
  summary(`**v${version}** → \`${state}\``);
}

main().catch((e) => fail(e.stack ?? e.message));
