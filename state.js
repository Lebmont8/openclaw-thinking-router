import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const STATE_ROOT = process.env.OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
export const STATE_PATH = process.env.THINKING_ROUTER_STATE_PATH || join(STATE_ROOT, "thinking-router-state.json");

export function emptyState() {
  return { version: 2, sessions: {} };
}

export function migrateState(value) {
  const next = emptyState();
  if (!value || typeof value !== "object" || !value.sessions) return next;
  for (const [sessionKey, session] of Object.entries(value.sessions)) {
    if (!session || typeof session !== "object") continue;
    if (session.mode === "manual") {
      const level = session.manualRoute?.level || session.requested || session.lastLevel || "high";
      next.sessions[sessionKey] = {
        mode: "manual",
        manualRoute: session.manualRoute || { model: "gpt-5.6-sol", level, source: "manual" },
        updatedAt: session.updatedAt || Date.now(),
      };
      continue;
    }
    const lastDecision = session.lastDecision || (session.lastLevel ? {
      model: session.model || "gpt-5.6-sol",
      level: session.lastLevel,
      source: "migrated",
      reasonCodes: session.reason ? [session.reason] : ["legacy_state"],
    } : null);
    next.sessions[sessionKey] = {
      mode: "auto",
      lastDecision,
      updatedAt: session.updatedAt || Date.now(),
    };
  }
  return next;
}

export async function loadRouterState(path = STATE_PATH) {
  try {
    return migrateState(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw error;
  }
}

export async function saveRouterState(state, path = STATE_PATH) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function setAutoDecision(state, sessionKey, decision, runId) {
  const previous = state.sessions[sessionKey] || {};
  state.sessions[sessionKey] = {
    mode: "auto",
    lastDecision: decision,
    activeRunId: runId || null,
    lastLoggedRunId: previous.lastLoggedRunId || null,
    updatedAt: Date.now(),
  };
  return state.sessions[sessionKey];
}

export function setManualRoute(state, sessionKey, route) {
  state.sessions[sessionKey] = {
    mode: "manual",
    manualRoute: { ...route, source: "manual", reasonCodes: ["manual_override"] },
    updatedAt: Date.now(),
  };
  return state.sessions[sessionKey];
}

export function setAutoMode(state, sessionKey) {
  state.sessions[sessionKey] = { mode: "auto", lastDecision: null, updatedAt: Date.now() };
  return state.sessions[sessionKey];
}
