export function createStreamingItemsParser() {
  let buffer = "";
  let scanIndex = 0;
  let arrayStarted = false;
  let objectStart = -1;
  let objectDepth = 0;
  let inString = false;
  let escaped = false;

  return {
    push(delta) {
      if (typeof delta !== "string" || !delta) return [];
      buffer += delta;

      if (!arrayStarted) {
        const match = buffer.match(/"items"\s*:\s*\[/);
        if (!match) return [];
        arrayStarted = true;
        scanIndex = match.index + match[0].length;
      }

      const completed = [];
      for (; scanIndex < buffer.length; scanIndex++) {
        const char = buffer[scanIndex];
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (char === "\\") {
            escaped = true;
          } else if (char === '"') {
            inString = false;
          }
          continue;
        }

        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{") {
          if (objectDepth === 0) objectStart = scanIndex;
          objectDepth++;
          continue;
        }
        if (char !== "}" || objectDepth === 0) continue;

        objectDepth--;
        if (objectDepth !== 0 || objectStart < 0) continue;
        const candidate = buffer.slice(objectStart, scanIndex + 1);
        objectStart = -1;
        try {
          const item = JSON.parse(candidate);
          if (item && typeof item === "object" && !Array.isArray(item)) completed.push(item);
        } catch {
          // Only complete objects are emitted. The final parser still validates the full response.
        }
      }
      return completed;
    }
  };
}

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
          // The final response parser validates the complete array.
        }
      }
      return completed;
    }
  };
}
