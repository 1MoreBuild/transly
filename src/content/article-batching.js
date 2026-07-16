(function initializeArticleBatching(global) {
  function planArticleBatches(items, options = {}) {
    const sourceItems = Array.isArray(items) ? items : [];
    if (!sourceItems.length) return [];

    const maxChars = clampInteger(options.maxChars, 3000, 100000, 28000);
    const maxItems = clampInteger(options.maxItems, 4, 100, 28);
    const totalWeight = sourceItems.reduce((sum, item) => sum + itemWeight(item), 0);
    const desiredCount = Math.min(
      sourceItems.length,
      Math.max(1, Math.ceil(totalWeight / maxChars), Math.ceil(sourceItems.length / maxItems))
    );
    const groups = partitionBalanced(sourceItems, desiredCount, totalWeight);

    return groups.map((batchItems, index) => ({
      items: batchItems,
      batchIndex: index + 1,
      batchCount: groups.length,
      sourceChars: batchItems.reduce((sum, item) => sum + String(item?.text || "").length, 0)
    }));
  }

  function prioritizeArticleItems(items, options = {}) {
    const viewportTop = Number(options.scrollY) || 0;
    const viewportBottom = viewportTop + (Number(options.viewportHeight) || 0);
    return [...(Array.isArray(items) ? items : [])]
      .map((item, documentIndex) => ({
        item,
        documentIndex,
        distance: itemViewportDistance(item, viewportTop, viewportBottom),
        navigationRank: item?.presentation === "navigation-inline" || item?.presentation === "navigation-block" ? 0 : 1
      }))
      .sort((left, right) => (
        left.distance - right.distance
        || left.navigationRank - right.navigationRank
        || left.documentIndex - right.documentIndex
      ))
      .map(({ item }) => item);
  }

  function itemViewportDistance(item, viewportTop, viewportBottom) {
    const rect = item?.element?.getBoundingClientRect?.();
    if (!rect) return Number.POSITIVE_INFINITY;
    const top = rect.top + viewportTop;
    const bottom = rect.bottom + viewportTop;
    if (bottom >= viewportTop && top <= viewportBottom) return 0;
    return top > viewportBottom ? top - viewportBottom : viewportTop - bottom;
  }

  function partitionBalanced(items, count, totalWeight) {
    if (count <= 1) return [items.slice()];
    const groups = [];
    let cursor = 0;
    let remainingWeight = totalWeight;

    for (let groupIndex = 0; groupIndex < count; groupIndex++) {
      const remainingGroups = count - groupIndex;
      if (remainingGroups === 1) {
        groups.push(items.slice(cursor));
        break;
      }

      const targetWeight = remainingWeight / remainingGroups;
      const maxCursor = items.length - (remainingGroups - 1);
      const group = [];
      let groupWeight = 0;
      while (cursor < maxCursor) {
        const item = items[cursor];
        const weight = itemWeight(item);
        if (
          group.length
          && groupWeight < targetWeight
          && Math.abs(targetWeight - groupWeight) <= Math.abs(targetWeight - (groupWeight + weight))
        ) {
          break;
        }
        cursor++;
        group.push(item);
        groupWeight += weight;
        if (groupWeight >= targetWeight) break;
      }
      groups.push(group);
      remainingWeight -= groupWeight;
    }

    return groups;
  }

  function itemWeight(item) {
    return String(item?.text || "").length + String(item?.id || "").length + 64;
  }

  function clampInteger(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  global.TranslyArticleBatching = Object.freeze({ planArticleBatches, prioritizeArticleItems });
})(globalThis);
