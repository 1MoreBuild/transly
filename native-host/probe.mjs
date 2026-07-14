import { spawn } from "node:child_process";
import { NATIVE_PROTOCOL_VERSION } from "./config.mjs";
import { createNativeMessageReader, encodeNativeMessage } from "./protocol.mjs";

export function requestNativeHost(launcher, origin, type, payload = {}, options = {}) {
  const timeoutMs = options.timeoutMs || 120_000;
  const requestId = options.requestId || `probe-${Date.now()}`;

  return new Promise((resolve, reject) => {
    const child = spawn(launcher, [origin], { stdio: ["pipe", "pipe", "pipe"] });
    let stderr = "";
    let settled = false;

    const finish = (error, message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdin.end();
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(message);
      }
    };

    const timeout = setTimeout(() => {
      finish(new Error(`Native Host ${type} probe timed out. ${stderr.trim()}`));
    }, timeoutMs);

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    createNativeMessageReader(child.stdout, {
      onMessage(message) { finish(null, message); },
      onError(error) { finish(error); }
    });
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (!settled) {
        finish(new Error(`Native Host exited before responding (${signal || code}). ${stderr.trim()}`));
      }
    });
    child.stdin.write(encodeNativeMessage({
      protocolVersion: NATIVE_PROTOCOL_VERSION,
      id: requestId,
      type,
      payload
    }, 2_000_000));
  });
}
