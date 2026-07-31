# Chrome Web Store Release

This document is the source of truth for Transly's Chrome Web Store listing and
release setup.

## Identity

- Item name: `Transly`
- Chrome Web Store extension ID: `mdjfkiddlpdgchddcckhcmdjekmmhcgp`
- Price: Free
- Category: Tools
- Primary language: English
- Website: `https://github.com/1MoreBuild/transly`
- Support URL: `https://github.com/1MoreBuild/transly/issues`
- Privacy policy:
  `https://github.com/1MoreBuild/transly/blob/main/PRIVACY.md`

The checked-in manifest key is the public key shown by the Chrome Web Store
Dashboard and produces the production extension ID above for unpacked builds.

## Store Listing

### Summary

Translate web articles in context with an AI model service you choose.

### Description

Transly turns foreign-language web articles into coherent bilingual or
translation-only reading experiences inside Chrome.

Instead of translating isolated fragments, Transly gives the model broader
article context so terminology, tone, and meaning stay consistent across the
document.

Key features:

- Translate complete web articles with document-level context.
- Read the original and translation together, or switch to translation only.
- Preserve links, lists, tables, code, formulas, and the source page's layout.
- Show completed translated passages as model batches return.
- Cache validated translations locally to avoid repeated requests.
- Connect Lane automatically or use another OpenAI-compatible model service.
- Translate supported video subtitles as an early beta.

Transly is free and open source. It does not sell model access. Users connect
their own hosted API, self-hosted gateway, or local model service. Provider
pricing, authentication, availability, and data handling are controlled by the
provider selected by the user.

## Privacy Practices

### Single purpose

Translate webpage article content and supported video subtitles through a model
service selected by the user, then display the translation inside the source
page.

### Permission justifications

`activeTab`

> Identifies the active page when the user clicks Transly so the extension can
> start, clear, or change the display mode of that page's translation.

`scripting`

> Checks the active page and its frames for Transly's article content script so
> commands are sent to the frame that contains the article.

`storage`

> Stores the user's provider configuration, target language, display settings,
> and a bounded local cache of validated translations.

`nativeMessaging`

> Connects to the optional Lane desktop app when installed. Lane returns a
> loopback API endpoint, a client key, and available model names. Transly works
> without Lane when the user configures another compatible API.

`host permissions`

> Reads visible article and supported subtitle content on webpages selected by
> the user and sends translation requests to the user-configured API endpoint.
> Transly supports arbitrary article sites and arbitrary user-selected
> OpenAI-compatible HTTPS providers, so the set of domains cannot be known in
> advance.

### Remote code

Select **No, I am not using remote code**.

Transly executes only JavaScript included in the extension package. Model
responses are data, not executable code.

### Data disclosures

Declare:

- Website content
- Web browsing activity
- Authentication information

Explanation:

> Transly handles webpage text, supported subtitle content, the page URL/title,
> limited page structure metadata, and the API credential configured by the
> user. Translation content is sent directly to the model service selected by
> the user only after the user starts translation. Provider credentials stay in
> Chrome local extension storage. The Transly developers do not receive this
> data. Data is not sold or used for advertising, analytics, profiling, or
> unrelated purposes.

Certify every Limited Use statement that matches the behavior described in
`PRIVACY.md`.

## Distribution

- Visibility: Public
- Pricing: Free
- Regions: All regions unless a provider or legal requirement requires a
  narrower distribution
- Publishing: Staged publish for the first releases

Staged publishing submits the package for review but requires a separate manual
publish action after approval.

## Graphic Assets

Required:

- Store icon: `assets/icons/icon128.png`
- At least one full-bleed screenshot at `1280x800`
- Small promotional image at `440x280`

Prefer three current screenshots:

1. A translated article in bilingual mode.
2. Translation-only mode with the original revealed for one passage.
3. Provider setup showing automatic Lane connection and the model dropdown.

Do not use screenshots that expose API keys, local client keys, browser profile
details, or private webpage content.

## GitHub Actions Setup

The workflow uses Google Workload Identity Federation and the official
`google-github-actions/auth` action. It does not require a long-lived service
account JSON key in GitHub.

Configure repository variables:

- `CWS_PUBLISHER_ID`
- `CWS_EXTENSION_ID`
- `CWS_GCP_PROJECT_ID`
- `CWS_WORKLOAD_IDENTITY_PROVIDER`
- `CWS_SERVICE_ACCOUNT`

One-time Google setup:

1. Enable the Chrome Web Store API in a Google Cloud project.
2. Create one service account for publishing.
3. Add its email under Chrome Web Store Developer Dashboard > Account.
4. Configure a Workload Identity Pool that trusts release workflows from
   `1MoreBuild/transly`.
5. Allow that identity to impersonate the publishing service account.
6. Protect the GitHub environment named `chrome-web-store` with a required
   reviewer.

First-item bootstrap:

1. Run `npm run package`. The generated Chrome Web Store ZIP intentionally
   omits `manifest.key`; the source manifest keeps the Web Store public key so
   unpacked builds use the production extension ID.
2. Upload the generated `dist/transly-<version>.zip` manually as an unpublished
   draft.
3. Copy the Chrome Web Store public key and item ID from the Dashboard.
4. Replace `manifest.json`'s local key with the Web Store public key.
5. Confirm the unpacked extension ID derived from that key equals the Dashboard
   item ID.
6. Add the verified production ID to Lane's explicit Native Messaging
   allowlist and test the packaged Lane app.
7. Set `CWS_EXTENSION_ID` only after those checks pass.
8. Package and upload the rebuilt Transly ZIP as the first review candidate.

Release flow:

1. Bump `manifest.json` and `package.json` to the same version.
2. Push a matching tag such as `v0.1.0`.
3. The workflow tests, packages, and uploads the draft.
4. Manually run **Chrome Web Store Release** with mode `submit`.
5. Approve the protected environment. The workflow submits a staged publish for
   review.
6. Publish manually in the Developer Dashboard after review approval.
