export function parseJsonOutput(raw) {
  const text = String(raw || "").trim();
  if (!text) throw new Error("Codex returned empty output.");

  try {
    return JSON.parse(text);
  } catch {}

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {}
  }

  for (let start = 0; start < text.length; start++) {
    if (text[start] !== "[" && text[start] !== "{") continue;
    const candidate = readBalancedJson(text, start);
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {}
  }

  const error = new Error("Codex returned non-JSON output.");
  error.code = "INVALID_MODEL_OUTPUT";
  throw error;
}

function readBalancedJson(text, start) {
  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[" || char === "{") {
      stack.push(char);
      continue;
    }
    if (char !== "]" && char !== "}") continue;
    const expected = char === "]" ? "[" : "{";
    if (stack.pop() !== expected) return null;
    if (!stack.length) return text.slice(start, index + 1);
  }
  return null;
}
