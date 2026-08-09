import assert from "node:assert/strict";
import test from "node:test";

await import("./subtitle-core.js");
const core = globalThis.TranslySubtitleCore;

test("parses YouTube json3 captions and strips ambient-only cues", () => {
  const cues = core.parseSubtitle(JSON.stringify({
    events: [
      { tStartMs: 1000, dDurationMs: 1800, segs: [{ utf8: "First caption" }] },
      { tStartMs: 3000, dDurationMs: 1000, segs: [{ utf8: "[Music]" }] },
      { tStartMs: 4200, dDurationMs: 1600, segs: [{ utf8: "Second\ncaption" }] }
    ]
  }), "https://www.youtube.com/api/timedtext?lang=en&fmt=json3");

  assert.deepEqual(cues.map(({ start, end, text }) => ({ start, end, text })), [
    { start: 1, end: 2.8, text: "First caption" },
    { start: 4.2, end: 5.8, text: "Second caption" }
  ]);
});

test("parses XML timedtext and WebVTT captions", () => {
  const xml = core.parseSubtitle(
    '<transcript><text start="0.5" dur="2">Hello &amp; welcome</text></transcript>',
    "https://youtube.com/api/timedtext?lang=en"
  );
  assert.equal(xml[0].text, "Hello & welcome");
  assert.equal(xml[0].start, 0.5);
  assert.equal(xml[0].end, 2.5);

  const vtt = core.parseSubtitle(`WEBVTT

00:00:01.000 --> 00:00:03.000 align:center
<v Speaker>First caption</v>

00:03.200 --> 00:00:05.000
Second caption`, "https://cdn.example/captions.vtt");
  assert.deepEqual(vtt.map((cue) => cue.text), ["First caption", "Second caption"]);
});

test("groups timed cues into complete utterances before translation", () => {
  const cues = core.normalizeCues([
    { start: 0, end: 2, text: "Welcome to the second annual Code with Claude conference," },
    { start: 2.05, end: 4, text: "where builders share what they learned." },
    { start: 4.1, end: 5.5, text: "This is the next sentence." },
    { start: 8, end: 9, text: "A new thought after a pause" }
  ]);

  const groups = core.groupCuesByMeaning(cues);
  assert.deepEqual(groups.map((group) => group.cues.map((cue) => cue.text)), [
    [
      "Welcome to the second annual Code with Claude conference,",
      "where builders share what they learned."
    ],
    ["This is the next sentence."],
    ["A new thought after a pause"]
  ]);
});

test("prioritizes whole semantic groups without changing cue order or splitting a group", () => {
  const cues = core.normalizeCues([
    { start: 0, end: 1, text: "First clause," },
    { start: 1.05, end: 2, text: "then its ending." },
    { start: 5, end: 6, text: "Nearby clause," },
    { start: 6.05, end: 7, text: "and nearby ending." }
  ]);
  const groups = core.groupCuesByMeaning(cues);
  const prioritized = core.prioritizeCueGroups(groups, 5.5);
  const batches = core.chunkCueGroups(prioritized, { maxChars: 400, maxItems: 3 });

  assert.equal(batches.length, 2);
  assert.deepEqual(batches[0].map((cue) => cue.text), ["Nearby clause,", "and nearby ending."]);
  assert.deepEqual(batches[0].map((cue) => cue.subtitleGroup), [1, 1]);
  assert.deepEqual(batches[1].map((cue) => cue.text), ["First clause,", "then its ending."]);
});

test("translates the current minute first and leaves distant cues for later batches", () => {
  const cues = core.normalizeCues([
    { start: 0, end: 2, text: "First sentence." },
    { start: 20, end: 22, text: "Current sentence." },
    { start: 30, end: 32, text: "Next sentence." },
    { start: 40, end: 42, text: "Later sentence." },
    { start: 100, end: 102, text: "Distant sentence." }
  ]);
  const groups = core.groupCuesByMeaning(cues);
  const batches = core.chunkCueGroupsForPlayback(groups, 21, {
    maxChars: 400,
    maxItems: 2,
    primaryBehindSeconds: 60,
    primaryAheadSeconds: 60,
    primaryMaxChars: 6000,
    primaryMaxItems: 40
  });

  assert.deepEqual(batches[0].map((cue) => cue.text), [
    "Current sentence.",
    "Next sentence.",
    "First sentence.",
    "Later sentence."
  ]);
  assert.deepEqual(
    batches.slice(1).flat().map((cue) => cue.text),
    ["Distant sentence."]
  );
});

test("selects a bounded playhead window and falls back to the nearest group", () => {
  const cues = core.normalizeCues([
    { start: 0, end: 2, text: "Opening sentence." },
    { start: 90, end: 92, text: "Previous sentence." },
    { start: 120, end: 122, text: "Current sentence." },
    { start: 210, end: 212, text: "Upcoming sentence." },
    { start: 420, end: 422, text: "Distant sentence." }
  ]);
  const groups = core.groupCuesByMeaning(cues);

  const nearby = core.selectCueGroupsForPlayback(groups, 120, {
    behindSeconds: 30,
    aheadSeconds: 120
  });
  assert.deepEqual(nearby.map((group) => group.cues[0].text), [
    "Current sentence.",
    "Previous sentence.",
    "Upcoming sentence."
  ]);

  const nearest = core.selectCueGroupsForPlayback(groups, 700, {
    behindSeconds: 10,
    aheadSeconds: 10
  });
  assert.deepEqual(nearest.map((group) => group.cues[0].text), ["Distant sentence."]);
});

test("infers CJK subtitle scripts conservatively when language metadata is missing", () => {
  assert.equal(core.inferSubtitleLanguage("这段视频已经有中文字幕，因此不需要再次翻译。"), "zh");
  assert.equal(core.inferSubtitleLanguage("この動画には日本語の字幕があります。"), "ja");
  assert.equal(core.inferSubtitleLanguage("이 동영상에는 한국어 자막이 있습니다."), "ko");
  assert.equal(core.inferSubtitleLanguage("This video already has English captions."), "");
});
