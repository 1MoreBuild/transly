# Transly Privacy Policy

Effective date: July 30, 2026

Transly is an open-source Chrome extension that translates webpages and video
subtitles through a model service selected by the user. Transly does not operate
a translation service and does not require a Transly account.

## Data Transly Handles

Transly may handle the following data to provide translation:

- text and subtitle content from the webpage the user chooses to translate;
- the page title, URL, and limited page structure or layout metadata used to
  identify missing or broken translations;
- the target language and translation display preferences;
- the configured model service URL, model name, and API key;
- translated text returned by the configured model service.

Page content can contain personal or sensitive information. Users should only
translate content they are permitted to send to their selected model service.

## How Data Is Used

Transly uses this data only to:

- extract and translate user-requested webpage or subtitle content;
- preserve links, lists, tables, code, formulas, and page layout;
- check the translated page for visible content that needs repair;
- connect to and authenticate with the model service selected by the user;
- cache validated translations locally to avoid repeated model requests.

Transly does not use this data for advertising, profiling, analytics, or sale.

## Data Sharing

When the user starts a translation, Transly sends the necessary content directly
from the browser to the model service configured by the user. That service may be
a hosted API, a self-hosted gateway, or a local service such as Lane. The selected
service receives the translation request and is governed by its own terms and
privacy policy.

The Transly developers do not receive webpage content, API keys, translations,
or browsing history through the extension.

Transly does not share user data with unrelated third parties. It transfers data
to the configured model service only because that transfer is necessary to
provide translation.

## Storage And Retention

- Provider settings and API keys are stored in `chrome.storage.local`.
- Translation results are cached in the browser for up to 30 days, with a
  bounded cache size.
- Display and translation preferences may be stored through Chrome extension
  storage and may follow the user's Chrome synchronization settings.
- Transly does not operate a remote database for extension user data.

Users can delete stored data by clearing the extension's data or uninstalling
Transly. Changing provider settings replaces the stored provider configuration.

## Security

Remote model services must use HTTPS. Plain HTTP is allowed only for loopback
addresses such as `127.0.0.1` and `localhost`. API keys are available only to
trusted extension contexts and are not exposed to webpage scripts.

Transly does not download or execute remote code. Model responses are treated as
data and are validated before being inserted into a webpage.

## Limited Use

Transly's use and transfer of data obtained through Chrome APIs is limited to
providing and improving its user-facing translation functionality. Transly does
not use or transfer that data for personalized advertising, credit decisions, or
other unrelated purposes, and does not permit humans to read it except when the
user explicitly provides specific information for support or when required by
law.

## Changes

Material changes to this policy will be published in this repository and reflected
in the Chrome Web Store listing before the related extension update is released.

## Contact

Questions and privacy requests can be submitted through
[GitHub Issues](https://github.com/1MoreBuild/transly/issues).
