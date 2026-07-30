export const LANE_NATIVE_HOST_NAME = "works.earendil.lane";
export const LANE_NATIVE_PROTOCOL_VERSION = 1;

export async function connectLane(chromeApi = globalThis.chrome) {
  if (!chromeApi?.runtime?.sendNativeMessage) {
    throw laneError("LANE_NATIVE_MESSAGING_UNAVAILABLE", "Chrome Native Messaging is unavailable.");
  }
  const response = await new Promise((resolve, reject) => {
    chromeApi.runtime.sendNativeMessage(
      LANE_NATIVE_HOST_NAME,
      { protocolVersion: LANE_NATIVE_PROTOCOL_VERSION, type: "connect" },
      (value) => {
        const runtimeError = chromeApi.runtime.lastError;
        if (runtimeError) {
          reject(laneError(
            "LANE_NOT_AVAILABLE",
            "Lane is not installed or its Chrome integration is not ready."
          ));
          return;
        }
        resolve(value);
      }
    );
  });
  if (response?.protocolVersion !== LANE_NATIVE_PROTOCOL_VERSION) {
    throw laneError("LANE_PROTOCOL_MISMATCH", "Lane returned an unsupported response.");
  }
  if (!response.ok) {
    throw laneError(
      response?.error?.code || "LANE_CONNECTION_FAILED",
      response?.error?.message || "Lane could not connect Transly."
    );
  }
  return normalizeLaneConnection(response.data);
}

export function normalizeLaneConnection(value) {
  const apiUrl = String(value?.apiUrl || "").trim();
  const apiKey = String(value?.apiKey || "").trim();
  const models = [...new Set((Array.isArray(value?.models) ? value.models : [])
    .map((model) => String(model || "").trim())
    .filter(Boolean))];
  const requestedDefault = String(value?.defaultModel || "").trim();
  const model = models.includes(requestedDefault) ? requestedDefault : models[0] || "";
  let url;
  try {
    url = new URL(apiUrl);
  } catch {
    throw laneError("LANE_INVALID_CONNECTION", "Lane returned an invalid API URL.");
  }
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname) ||
    !apiKey ||
    !model
  ) {
    throw laneError(
      "LANE_NOT_READY",
      model
        ? "Lane returned incomplete connection details."
        : "Open Lane and connect an AI provider before using Transly."
    );
  }
  return {
    config: {
      apiUrl,
      apiKey,
      model,
      protocol: value?.protocol === "chat-completions" ? "chat-completions" : "responses"
    },
    models
  };
}

function laneError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
