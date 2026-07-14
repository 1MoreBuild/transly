import { createHash } from "node:crypto";

export function extensionIdFromManifestKey(key) {
  const publicKey = Buffer.from(String(key || "").replace(/\s+/g, ""), "base64");
  if (!publicKey.length) throw new Error("manifest.json is missing a valid key.");
  const digest = createHash("sha256").update(publicKey).digest().subarray(0, 16);
  return [...digest]
    .map((byte) => `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`)
    .join("");
}
