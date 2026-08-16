import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyRoute } from "./classifier.js";
import { configurePolicies, getAgentPolicy, parseManualRoute } from "./policy.js";
import { buildSessionPatch } from "./session-route.js";
import { emptyState, migrateState, setAutoDecision, setAutoMode, setManualRoute } from "./state.js";

configurePolicies({ enabledAgents: ["main", "reminder"], lowCostAgents: ["reminder"] });
const main = getAgentPolicy("main");

test("ordinary tasks stay on the configured base route", () => {
  const route = classifyRoute({ text: "add a Telegram button", policy: main });
  assert.equal(route.model, "gpt-5.6-sol");
  assert.equal(route.level, "high");
});

test("hard cohesive cross-system diagnosis selects max", () => {
  const route = classifyRoute({
    text: "Find the root cause of a rare security regression between OAuth, API and database in production.",
    policy: main,
  });
  assert.equal(route.level, "max");
});

test("large decomposable audit selects ultra", () => {
  const route = classifyRoute({
    text: "Run a full audit in parallel across architecture, security, tests and performance.",
    policy: main,
  });
  assert.equal(route.level, "ultra");
});

test("approval and replies inherit the previous route", () => {
  const previousDecision = { model: "gpt-5.6-sol", level: "max", source: "auto", reasonCodes: [] };
  assert.equal(classifyRoute({ text: "делай", policy: main, previousDecision }).source, "inherited");
  assert.equal(classifyRoute({ text: "why?", metadata: { replyToId: "1" }, policy: main, previousDecision }).level, "max");
});

test("low-cost agents remain on Luna low", () => {
  const route = classifyRoute({ text: "full parallel security audit", policy: getAgentPolicy("reminder") });
  assert.equal(route.model, "gpt-5.6-luna");
  assert.equal(route.level, "low");
});

test("unconfigured agents are ignored", () => {
  assert.equal(getAgentPolicy("unknown"), null);
});

test("manual route parsing rejects unsupported Luna ultra", () => {
  assert.equal(parseManualRoute("max", main).level, "max");
  assert.equal(parseManualRoute("terra medium", main).model, "gpt-5.6-terra");
  assert.equal(parseManualRoute("luna ultra", main), null);
});

test("state transitions preserve decisions and manual mode", () => {
  const state = emptyState();
  setAutoDecision(state, "session", { model: "gpt-5.6-sol", level: "max" }, "run");
  assert.equal(state.sessions.session.lastDecision.level, "max");
  setManualRoute(state, "session", { model: "gpt-5.6-sol", level: "ultra" });
  assert.equal(state.sessions.session.mode, "manual");
  setAutoMode(state, "session");
  assert.equal(state.sessions.session.mode, "auto");
});

test("legacy state migrates without message content", () => {
  const state = migrateState({ sessions: { session: { mode: "auto", lastLevel: "high", reason: "legacy" } } });
  assert.equal(state.version, 2);
  assert.equal(state.sessions.session.lastDecision.level, "high");
});

test("automatic default route avoids a redundant model override", () => {
  assert.deepEqual(buildSessionPatch(
    { model: "gpt-5.6-sol", level: "max" }, "auto", "gpt-5.6-sol",
  ), {
    thinkingLevel: "max",
    providerOverride: undefined,
    modelOverride: undefined,
    modelOverrideSource: undefined,
    modelOverrideFallbackOriginProvider: undefined,
    modelOverrideFallbackOriginModel: undefined,
  });
});

test("manual routes preserve model overrides", () => {
  const patch = buildSessionPatch({ model: "gpt-5.6-sol", level: "max" }, "user", "gpt-5.6-sol");
  assert.equal(patch.modelOverride, "gpt-5.6-sol");
  assert.equal(patch.modelOverrideSource, "user");
});
