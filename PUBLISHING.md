# Publishing

Three ways out of this repo:

| What | How | Status |
|---|---|---|
| Unpacked builds (Chrome, Edge) | `.github/workflows/build.yml` on every push to main: run artifacts, and the `unpacked` pre-release (every main build) | live |
| Releases | a version tag: `.github/workflows/build.yml` makes that version's release (GitHub's Latest) and moves the `latest` release to it; vocalstack.com serves `latest` | live |
| Chrome Web Store | `.github/workflows/publish-webstore.yml`, run by hand; `scripts/publish-webstore.mjs` | wired, not set up: no listing yet |

## Releasing a version

The version is the manifest's: `<package.json major.minor>.<commits on main>`. Tag the commit with it and push the tag:

```sh
v=$(node -p "require('./package.json').version.split('.').slice(0,2).join('.')").$(git rev-list --count HEAD)
git tag "$v" && git push origin "$v"
```

The tag's build checks the tag matches the build's version, then publishes the release `$v` with both zips, marked Latest, and moves the `latest` release to it. The zips at these links are always the newest version:

- `https://github.com/vocalstack/chrome-extension/releases/download/latest/vocalstack-chrome.zip`
- `https://github.com/vocalstack/chrome-extension/releases/download/latest/vocalstack-edge.zip`

vocalstack.com/downloads/vocalstack-chrome.zip and -edge.zip redirect to these links (vocalstack/transcribe `scripts/website_vercel.sh`), so the website offers a new version as soon as its release is out, with no deploy.

## Unpacked

Every build on main, before it is released:

- `https://github.com/vocalstack/chrome-extension/releases/download/unpacked/vocalstack-chrome.zip`
- `https://github.com/vocalstack/chrome-extension/releases/download/unpacked/vocalstack-edge.zip`

Unzip the file. Open `chrome://extensions` (or `edge://extensions`), turn on Developer mode, choose Load unpacked, and pick the unzipped folder.

Locally, `npm run package` builds the same folders (`output/chrome`, `output/edge`) and the same zips.

The manifest version is `<package.json major.minor>.<commits on main>`, so every build on main is newer than the one before.

## Chrome Web Store: one-time setup

### 1. Keep the extension id

The id is `oaenfiioponhlnnemllhgdmgdmaceilk`. The API trusts it as an Origin (transcribe: `src/domain/auth.rs`, `EXTENSION_ORIGINS`), and it names the sign-in redirect. The store gives a new item an id of its own, unless the item's **first** upload carries the private key:

```sh
VS_WEBSTORE=1 scripts/package.sh              # output/store/chrome, no `key` in the manifest
cp .keys/extension.pem output/store/chrome/key.pem
(cd output/store/chrome && zip -qr ../../first-upload.zip .)
rm output/store/chrome/key.pem
```

Upload `output/first-upload.zip` by hand as a new item in the [developer dashboard](https://chrome.google.com/webstore/devconsole). The item's id must read `oaenfiioponhlnnemllhgdmgdmaceilk`. If it doesn't, delete the item and start again; never ship under another id. Later uploads leave the key out; the workflow does that.

The store build has no `key` field in its manifest because the store refuses one. The unpacked builds keep it, which pins the id outside the store.

### 2. The listing

Fill in the listing:
- description, screenshots and icon;
- the privacy policy link;
- for each permission in `wxt.config.ts`, the reason it is needed. Reviewers ask hardest about `<all_urls>`, `tabCapture`, `scripting` and `webNavigation`.

Pay the one-time developer fee. The **publisher id** is shown in the dashboard's account settings.

### 3. API access

1. In a Google Cloud project, enable the **Chrome Web Store API**.
2. Create an OAuth client and get a refresh token for it. [chrome-webstore-upload-keys](https://github.com/fregante/chrome-webstore-upload-keys) walks through both steps.
3. Set the repository secrets:

```sh
gh secret set CHROME_EXTENSION_ID  -R vocalstack/chrome-extension --body oaenfiioponhlnnemllhgdmgdmaceilk
gh secret set CHROME_PUBLISHER_ID  -R vocalstack/chrome-extension
gh secret set CHROME_CLIENT_ID     -R vocalstack/chrome-extension
gh secret set CHROME_CLIENT_SECRET -R vocalstack/chrome-extension
gh secret set CHROME_REFRESH_TOKEN -R vocalstack/chrome-extension
```

For local runs (`npm run publish:webstore`), the same names can go in `.env.local`, which is git-ignored.

## Chrome Web Store: publishing

Go to Actions → **publish-webstore** → Run workflow. The options:
- Audience: `trustedTesters` (the default) or `default` (everyone).
- Publish: when off (the default), the run uploads a draft only.

Without credentials the run is skipped, and stays green. If the same version is still in review, the run is skipped too.

To publish every build on main once the listing is live, add `push: branches: [main]` to the workflow's `on:`. To pause publishing with no code change, run `gh variable set PUBLISH_EXTENSION --body false`; delete the variable to resume.

## Edge Add-ons

Not wired yet. Until it is, the Edge build loads unpacked as above. The Microsoft Partner Center has its own publish API, for when that store is wanted.
