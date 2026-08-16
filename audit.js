import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_ROOT = process.env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
export const AUDIT_PATH = process.env.THINKING_ROUTER_AUDIT_PATH || join(STATE_ROOT, "logs", "thinking-router.jsonl");
const MAX_LOG_BYTES = 512 * 1024;

function hashSessionKey(sessionKey) {
  return createHash("sha256").update(String(sessionKey || "")).digest("hex").slice(0, 16);
}

export async function appendAudit(record, path = AUDIT_PATH) {
  await mkdir(dirname(path), { recursive: true });
  try {
    const current = await readFile(path);
    if (current.byteLength >= MAX_LOG_BYTES) await rename(path, `${path}.1`).catch(() => {});
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  const safe = {
    timestamp: new Date().toISOString(),
    agentId: record.agentId,
    sessionKeyHash: hashSessionKey(record.sessionKey),
    mode: record.mode,
    source: record.source,
    requestedModel: record.requestedModel,
    requestedEffort: record.requestedEffort,
    effectiveModel: record.effectiveModel,
    effectiveEffort: record.effectiveEffort,
    reasonCodes: Array.isArray(record.reasonCodes) ? record.reasonCodes.slice(0, 12) : [],
    fallbackUsed: Boolean(record.fallbackUsed),
    downgradeReason: record.downgradeReason || null,
    runIdHash: record.runId ? createHash("sha256").update(record.runId).digest("hex").slice(0, 12) : null,
  };
  await appendFile(path, `${JSON.stringify(safe)}\n`, { mode: 0o600 });
}
