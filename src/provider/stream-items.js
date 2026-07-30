export function createStreamingStringArrayParser(ids = []) {
  let buffer = "";
  let scanIndex = 0;
  let arrayStarted = false;
  let stringStart = -1;
  let inString = false;
  let escaped = false;
  let emittedCount = 0;

  return {
    push(delta) {
      if (typeof delta !== "string" || !delta) return [];
      buffer += delta;

      if (!arrayStarted) {
        const start = buffer.indexOf("[");
        if (start < 0) return [];
        arrayStarted = true;
        scanIndex = start + 1;
      }

      const completed = [];
      for (; scanIndex < buffer.length; scanIndex++) {
        const char = buffer[scanIndex];
        if (!inString) {
          if (char === '"') {
            inString = true;
            stringStart = scanIndex;
          }
          continue;
        }
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char !== '"') continue;

        inString = false;
        const candidate = buffer.slice(stringStart, scanIndex + 1);
        stringStart = -1;
        try {
          const translation = JSON.parse(candidate);
          const id = ids[emittedCount++];
          if (typeof id === "string") completed.push({ id, translation });
        } catch {
          // The final parser validates the complete response.
        }
      }
      return completed;
    }
  };
}
