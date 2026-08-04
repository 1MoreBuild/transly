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

test("merges dynamic cues, prioritizes playback vicinity, and finds the active cue", () => {
  const first = core.normalizeCues([{ start: 0, end: 2, text: "One" }]);
  const merged = core.mergeCues(first, [
    { start: 0, end: 2, text: "One" },
    { start: 3, end: 5, text: "Two" }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(core.activeCueAt(merged, 3.5)?.text, "Two");
  assert.equal(core.prioritizeCues(merged, 3.5)[0].text, "Two");
});

test("chunks captions by both text size and cue count", () => {
  const cues = core.normalizeCues(Array.from({ length: 9 }, (_, index) => ({
    start: index,
    end: index + 0.8,
    text: `Caption ${index} ${"x".repeat(200)}`
  })));
  const chunks = core.chunkCues(cues, { maxChars: 1000, maxItems: 4 });
  assert.equal(chunks.length, 3);
  assert.ok(chunks.every((chunk) => chunk.length <= 4));
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
