export const YOUTUBE_MATCHES = /** @type {const} */ ([
  "*://youtube.com/*",
  "*://*.youtube.com/*",
  "*://youtube-nocookie.com/*",
  "*://*.youtube-nocookie.com/*"
]);

export const extensionManifest = /** @type {const} */ ({
  name: "Transly",
  description: "Context-aware AI translation for web articles and video subtitles using any OpenAI-compatible API.",
  minimum_chrome_version: "105",
  key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAnPu+lUnfsewNHEqecbaQSBKaah1N2NCiYJGP2w/ElSWyQni4D6NSSO3BVYVfw4rd80kGHwdWRfFdXQ4xrregjE7US20/VOdhuKkspgiOuHrMBvgv9y7EJ7BR7L7eOXcBG1VhTCn0THYZ4auSUwIoTvqX6APQz7MOItILLP0M9Nv2uZia1zyTbVrLA8VtfG933vPVqJqTN1lyd3SK2v5d7i27eDgtMryStLpm9fQbZu1HXxYnaM2Hw68pgELAVV7E9X+3c1SO0w8jnKpkU03r+8u4mbE1kzHFGuQ91r48totTfHj2PBFpHbQpLYnpUI7B+uJYEEZnPHk9stkcbyms+wIDAQAB",
  icons: {
    16: "assets/icons/icon16.png",
    32: "assets/icons/icon32.png",
    48: "assets/icons/icon48.png",
    128: "assets/icons/icon128.png"
  },
  permissions: ["activeTab", "nativeMessaging", "scripting", "storage"],
  host_permissions: ["<all_urls>"],
  action: {
    default_title: "Transly",
    default_icon: {
      16: "assets/icons/icon16.png",
      32: "assets/icons/icon32.png"
    }
  },
  content_scripts: [
    {
      matches: YOUTUBE_MATCHES,
      js: ["src/content/subtitle-bootstrap.js"],
      all_frames: true,
      match_about_blank: true,
      run_at: "document_start"
    },
    {
      matches: ["<all_urls>"],
      js: [
        "src/content/article-audit.js",
        "src/content/article-style.js",
        "src/content/article-text.js",
        "src/content/article-progress.js",
        "src/content/article-batching.js",
        "src/content/article-placement.js",
        "src/content/article-spacing.js",
        "src/content/article.js"
      ],
      css: ["src/content/styles.css"],
      all_frames: true,
      match_about_blank: true,
      run_at: "document_idle"
    },
    {
      matches: YOUTUBE_MATCHES,
      js: ["src/content/subtitle-core.js", "src/content/subtitle-content.js"],
      all_frames: true,
      match_about_blank: true,
      run_at: "document_idle"
    }
  ],
  web_accessible_resources: [
    {
      matches: YOUTUBE_MATCHES,
      resources: ["src/injected/subtitle-hook.js", "assets/icons/transly-player.svg"]
    }
  ]
});
