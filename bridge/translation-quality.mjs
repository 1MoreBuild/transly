const PLACEHOLDER_RE = /\[\[TRANSLY_PH_\d+]]/g;

export function summarizePlaceholderIntegrity(sourceItems = [], translatedItems = []) {
  const translatedById = new Map(translatedItems.map((item) => [item?.id, String(item?.translation || "")]));
  const affectedItemIds = [];
  let expectedTokenCount = 0;
  let actualTokenCount = 0;
  let missingTokenCount = 0;
  let extraTokenCount = 0;

  for (const sourceItem of sourceItems) {
    const expected = tokenCounts(sourceItem?.text);
    const actual = tokenCounts(translatedById.get(sourceItem?.id));
    const tokens = new Set([...expected.keys(), ...actual.keys()]);
    let affected = false;

    for (const token of tokens) {
      const expectedCount = expected.get(token) || 0;
      const actualCount = actual.get(token) || 0;
      expectedTokenCount += expectedCount;
      actualTokenCount += actualCount;
      if (expectedCount > actualCount) {
        missingTokenCount += expectedCount - actualCount;
        affected = true;
      }
      if (actualCount > expectedCount) {
        extraTokenCount += actualCount - expectedCount;
        affected = true;
      }
    }

    if (affected && sourceItem?.id) affectedItemIds.push(sourceItem.id);
  }

  return {
    expectedTokenCount,
    actualTokenCount,
    missingTokenCount,
    extraTokenCount,
    affectedItemCount: affectedItemIds.length,
    affectedItemIds
  };
}

export function assertPlaceholderIntegrity(summary) {
  if (!summary?.missingTokenCount && !summary?.extraTokenCount) return;
  const error = new Error(
    `Translation placeholder mismatch in ${summary.affectedItemCount || 0} item(s): `
    + `${summary.missingTokenCount || 0} missing, ${summary.extraTokenCount || 0} extra.`
  );
  error.code = "TRANSLATION_PLACEHOLDER_MISMATCH";
  throw error;
}

function tokenCounts(value) {
  const counts = new Map();
  for (const token of String(value || "").match(PLACEHOLDER_RE) || []) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return counts;
}
