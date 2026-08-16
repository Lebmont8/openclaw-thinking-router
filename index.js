import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { appendAudit } from "./audit.js";
import { classifyRoute } from "./classifier.js";
import { configurePolicies, getAgentPolicy, normalizeRoute, parseManualRoute } from "./policy.js";
import { applySessionRoute, readSessionEntry, resolveAgentId } from "./session-route.js";
import {
  loadRouterState,
  saveRouterState,
  setAutoDecision,
  setAutoMode,
  setManualRoute,
} from "./state.js";

const PLUGIN_ID = "thinking-router";
const PLUGIN_NAME = "Thinking Router";
const ROUTE_COMMAND_RE = /^\/route(?:\s|$)/i;
const THINK_COMMAND_RE = /^\/(?:t|think|thinking)(?::|\s|$)/i;
const THINK_COMMAND_ONLY_RE =
  /^\/(?:t|think|thinking)(?::|\s)+(off|minimal|low|medium|high|xhigh|max|ultra|default|inherit|clear|reset|unpin)\s*$/i;
const CONFIG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    enabledAgents: { type: "array", items: { type: "string" }, default: ["main"] },
    lowCostAgents: { type: "array", items: { type: "string" }, default: [] },
    baseModel: { type: "string", default: "gpt-5.6-sol" },
    baseEffort: { type: "string", default: "high" },
    autoMax: { type: "boolean", default: true },
    autoUltra: { type: "boolean", default: true },
  },
};
let pluginApi;
let state;

async function ensureState() {
  if (!state) state = await loadRouterState();
  return state;
}

function messageMetadata(event, ctx) {
  return {
    ...(event.metadata || {}),
    replyToId: ctx.replyToId,
    replyToIdFull: ctx.replyToIdFull,
    isReply: Boolean(ctx.replyToId || ctx.replyToIdFull),
  };
}

async function routeInbound(api, event, ctx) {
  const sessionKey = ctx.sessionKey || event.sessionKey || "";
  const agentId = resolveAgentId(sessionKey, ctx.agentId);
  const policy = getAgentPolicy(agentId);
  const input = String(event.content || "").trim();
  if (!policy || !sessionKey || !input || ROUTE_COMMAND_RE.test(input)) return;

  const routerState = await ensureState();
  let sessionState = routerState.sessions[sessionKey];
  const currentEntry = readSessionEntry(api, { agentId, sessionKey });

  if (THINK_COMMAND_RE.test(input)) {
    const match = THINK_COMMAND_ONLY_RE.exec(input);
    if (!match) return;
    const requested = match[1].toLowerCase();
    if (["default", "inherit", "clear", "reset", "unpin"].includes(requested)) {
      setAutoMode(routerState, sessionKey);
      await saveRouterState(routerState);
      await applySessionRoute(api, {
        agentId, sessionKey, route: policy.base, source: "auto", defaultModel: policy.base.model,
      });
      return;
    }
    const route = normalizeRoute({
      model: currentEntry.modelOverride || policy.base.model,
      level: requested,
    }, policy.base);
    setManualRoute(routerState, sessionKey, route);
    await saveRouterState(routerState);
    await applySessionRoute(api, { agentId, sessionKey, route, source: "user" });
    return;
  }

  if (sessionState?.mode !== "manual" && currentEntry.modelOverrideSource === "user") {
    const externalRoute = normalizeRoute({
      model: currentEntry.modelOverride || policy.base.model,
      level: currentEntry.thinkingLevel || policy.base.level,
    }, policy.base);
    sessionState = setManualRoute(routerState, sessionKey, externalRoute);
    await saveRouterState(routerState);
  }

  if (
    sessionState?.mode !== "manual" &&
    !sessionState?.activeRunId &&
    currentEntry.thinkingLevel &&
    currentEntry.thinkingLevel !== policy.base.level
  ) {
    const externalRoute = normalizeRoute({
      model: currentEntry.modelOverride || policy.base.model,
      level: currentEntry.thinkingLevel,
    }, policy.base);
    sessionState = setManualRoute(routerState, sessionKey, externalRoute);
    await saveRouterState(routerState);
  }

  if (sessionState?.mode === "manual") {
    const route = normalizeRoute(sessionState.manualRoute, policy.base);
    await applySessionRoute(api, { agentId, sessionKey, route, source: "user" });
    await appendAudit({
      agentId,
      sessionKey,
      mode: "manual",
      source: "manual",
      requestedModel: route.model,
      requestedEffort: route.requestedLevel || route.level,
      effectiveModel: route.model,
      effectiveEffort: route.level,
      reasonCodes: ["manual_override_active"],
      downgradeReason: route.downgradeReason,
      runId: ctx.runId,
    });
    return;
  }

  const decision = normalizeRoute(classifyRoute({
    text: input,
    metadata: messageMetadata(event, ctx),
    policy,
    previousDecision: sessionState?.lastDecision || null,
  }), policy.base);
    await applySessionRoute(api, {
      agentId, sessionKey, route: decision, source: "auto", defaultModel: policy.base.model,
    });
  setAutoDecision(routerState, sessionKey, decision, ctx.runId);
  await saveRouterState(routerState);
  await appendAudit({
    agentId,
    sessionKey,
    mode: "auto",
    source: decision.source,
    requestedModel: decision.model,
    requestedEffort: decision.requestedLevel || decision.level,
    effectiveModel: decision.model,
    effectiveEffort: decision.level,
    reasonCodes: decision.reasonCodes,
    downgradeReason: decision.downgradeReason,
    runId: ctx.runId,
  });
}

async function resetAfterRun(api, event, ctx) {
  const sessionKey = ctx.sessionKey || "";
  const agentId = resolveAgentId(sessionKey, ctx.agentId);
  const policy = getAgentPolicy(agentId);
  if (!policy || !sessionKey) return;
  const routerState = await ensureState();
  const sessionState = routerState.sessions[sessionKey];
  if (sessionState?.mode === "manual") return;
  await applySessionRoute(api, {
    agentId, sessionKey, route: policy.base, source: "auto", defaultModel: policy.base.model,
  });
  if (sessionState) {
    sessionState.activeRunId = null;
    sessionState.lastCompletedAt = Date.now();
    sessionState.lastRunSuccess = Boolean(event.success);
    sessionState.updatedAt = Date.now();
    await saveRouterState(routerState);
  }
}

async function observeEffectiveRoute(event, ctx) {
  if (event.kind !== "final" || !event.usageState) return;
  const sessionKey = event.sessionKey || ctx.sessionKey || "";
  const agentId = event.usageState.agentId || resolveAgentId(sessionKey, ctx.agentId);
  const policy = getAgentPolicy(agentId);
  if (!policy || !sessionKey) return;
  const routerState = await ensureState();
  const sessionState = routerState.sessions[sessionKey];
  const decision = sessionState?.mode === "manual" ? sessionState.manualRoute : sessionState?.lastDecision;
  if (!decision) return;
  const runId = event.runId || ctx.runId || null;
  if (runId && sessionState.lastLoggedRunId === runId) return;
  sessionState.lastLoggedRunId = runId;
  await saveRouterState(routerState);
  await appendAudit({
    agentId,
    sessionKey,
    mode: sessionState.mode,
    source: "runtime_effective",
    requestedModel: decision.model,
    requestedEffort: decision.requestedLevel || decision.level,
    effectiveModel: event.usageState.resolvedRef || event.usageState.model,
    effectiveEffort: event.usageState.reasoningEffort,
    reasonCodes: decision.reasonCodes,
    fallbackUsed: event.usageState.fallbackUsed,
    downgradeReason: event.usageState.fallbackUsed ? "runtime_fallback" : decision.downgradeReason,
    runId,
  });
  if (
    event.usageState.fallbackUsed &&
    typeof event.payload?.text === "string" &&
    !event.payload.text.startsWith("⚠️ Сработала fallback-модель")
  ) {
    const effective = event.usageState.resolvedRef || event.usageState.model || "неизвестная модель";
    return {
      payload: {
        ...event.payload,
        text: `⚠️ Сработала fallback-модель: ${effective} вместо ${decision.model}.\n\n${event.payload.text}`,
      },
    };
  }
}

function commandHelp() {
  return [
    "Маршрутизация моделей:",
    "/route status",
    "/route auto",
    "/route high | max | ultra",
    "/route sol high|max|ultra",
    "/route terra medium",
    "/route luna low",
  ].join("\n");
}

async function handleRouteCommand(ctx) {
  const args = String(ctx.args || "").trim().toLowerCase();
  const sessionKey = ctx.sessionKey || "";
  const agentId = resolveAgentId(sessionKey, ctx.agentId);
  const policy = getAgentPolicy(agentId);
  if (!policy || !sessionKey) return { text: "Для этой сессии маршрутизация недоступна." };
  const routerState = await ensureState();

  if (!args || args === "help") return { text: commandHelp() };
  if (args === "status") {
    const sessionState = routerState.sessions[sessionKey] || { mode: "auto" };
    const entry = readSessionEntry(pluginApi, { agentId, sessionKey });
    const route = sessionState.mode === "manual" ? sessionState.manualRoute : sessionState.lastDecision || policy.base;
    return {
      text: [
        `Агент: ${agentId}`,
        `Режим: ${sessionState.mode}`,
        `Политика: ${policy.base.model} + ${policy.base.level}`,
        `Текущий route: ${route.model} + ${route.level}`,
        `Session: ${entry.modelOverride || policy.base.model} + ${entry.thinkingLevel || policy.base.level}`,
      ].join("\n"),
    };
  }
  if (args === "auto") {
    setAutoMode(routerState, sessionKey);
    await saveRouterState(routerState);
    await applySessionRoute(pluginApi, {
      agentId, sessionKey, route: policy.base, source: "auto", defaultModel: policy.base.model,
    });
    await appendAudit({
      agentId, sessionKey, mode: "auto", source: "manual_clear",
      requestedModel: policy.base.model, requestedEffort: policy.base.level,
      effectiveModel: policy.base.model, effectiveEffort: policy.base.level,
      reasonCodes: ["manual_override_cleared"],
    });
    return { text: `Автоматика включена. База: ${policy.base.model} + ${policy.base.level}.` };
  }
  const route = parseManualRoute(args, policy);
  if (!route) return { text: `Недопустимый route: ${args}\n\n${commandHelp()}` };
  setManualRoute(routerState, sessionKey, route);
  await saveRouterState(routerState);
  await applySessionRoute(pluginApi, { agentId, sessionKey, route, source: "user" });
  await appendAudit({
    agentId, sessionKey, mode: "manual", source: "manual",
    requestedModel: route.model, requestedEffort: route.level,
    effectiveModel: route.model, effectiveEffort: route.level,
    reasonCodes: ["manual_override"],
  });
  return { text: `Ручной route включён: ${route.model} + ${route.level}. Для возврата: /route auto` };
}

const ROUTE_COMMAND = {
  name: "route",
  description: "Control automatic model and reasoning routing.",
  acceptsArgs: true,
  requireAuth: true,
  handler: handleRouteCommand,
};

export { classifyRoute } from "./classifier.js";
export { configurePolicies, getAgentPolicy, parseManualRoute } from "./policy.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: PLUGIN_NAME,
  description: "Quality-first GPT-5.6 model and reasoning router with task inheritance.",
  configSchema: CONFIG_SCHEMA,
  register(api) {
    pluginApi = api;
    configurePolicies(api.pluginConfig);
    api.registerCommand(ROUTE_COMMAND);
    // before_dispatch is awaited by the channel dispatcher before it prepares
    // the agent turn. message_received is fire-and-forget in OpenClaw, so using
    // it here could race with session-store loading and apply the effort only
    // to the following turn.
    api.on("before_dispatch", async (event, ctx) => {
      try {
        await routeInbound(api, event, ctx);
      } catch (error) {
        api.logger.warn(`[${PLUGIN_ID}] inbound routing failed: ${error?.message || String(error)}`);
      }
    }, { priority: 100, timeoutMs: 5000 });
    api.on("reply_payload_sending", async (event, ctx) => {
      try {
        return await observeEffectiveRoute(event, ctx);
      } catch (error) {
        api.logger.warn(`[${PLUGIN_ID}] effective route audit failed: ${error?.message || String(error)}`);
      }
    }, { priority: -100, timeoutMs: 3000 });
    api.on("agent_end", async (event, ctx) => {
      try {
        await resetAfterRun(api, event, ctx);
      } catch (error) {
        api.logger.warn(`[${PLUGIN_ID}] route reset failed: ${error?.message || String(error)}`);
      }
    }, { priority: -100, timeoutMs: 5000 });
  },
});
