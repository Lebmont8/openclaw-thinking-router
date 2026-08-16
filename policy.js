export const MODELS = Object.freeze({
  luna: "gpt-5.6-luna",
  terra: "gpt-5.6-terra",
  sol: "gpt-5.6-sol",
});

export const MODEL_EFFORTS = Object.freeze({
  [MODELS.luna]: new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]),
  [MODELS.terra]: new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
  [MODELS.sol]: new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]),
});

let policyConfig = {
  enabledAgents: new Set(["main"]),
  lowCostAgents: new Set([]),
  baseModel: MODELS.sol,
  baseEffort: "high",
  autoMax: true,
  autoUltra: true,
};

export function configurePolicies(raw = {}) {
  const enabledAgents = Array.isArray(raw?.enabledAgents) && raw.enabledAgents.length > 0
    ? raw.enabledAgents.map(String)
    : ["main"];
  const lowCostAgents = Array.isArray(raw?.lowCostAgents) ? raw.lowCostAgents.map(String) : [];
  policyConfig = {
    enabledAgents: new Set(enabledAgents),
    lowCostAgents: new Set(lowCostAgents),
    baseModel: String(raw?.baseModel || MODELS.sol),
    baseEffort: String(raw?.baseEffort || "high"),
    autoMax: raw?.autoMax !== false,
    autoUltra: raw?.autoUltra !== false,
  };
  return policyConfig;
}

export function getAgentPolicy(agentId) {
  if (!policyConfig.enabledAgents.has(agentId)) return null;
  if (policyConfig.lowCostAgents.has(agentId)) {
    return {
      agentId,
      base: { model: MODELS.luna, level: "low" },
      autoMax: false,
      autoUltra: false,
    };
  }
  return {
    agentId,
    base: { model: policyConfig.baseModel, level: policyConfig.baseEffort },
    autoMax: policyConfig.autoMax,
    autoUltra: policyConfig.autoUltra,
  };
}

export function normalizeRoute(route, fallback) {
  const model = route?.model || fallback.model;
  const requestedLevel = route?.level || fallback.level;
  const supported = MODEL_EFFORTS[model] || MODEL_EFFORTS[fallback.model];
  let level = requestedLevel;
  let downgradeReason = null;
  if (!supported.has(level)) {
    level = supported.has("max") ? "max" : supported.has("xhigh") ? "xhigh" : fallback.level;
    downgradeReason = "unsupported_effort";
  }
  return { ...route, model, level, requestedLevel, downgradeReason };
}

export function parseManualRoute(args, policy) {
  const tokens = String(args || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && ["high", "max", "ultra"].includes(tokens[0])) {
    return normalizeRoute({ model: policy.base.model, level: tokens[0] }, policy.base);
  }
  if (tokens.length === 1 && ["off", "minimal", "low", "medium", "xhigh"].includes(tokens[0])) {
    return normalizeRoute({ model: policy.base.model, level: tokens[0] }, policy.base);
  }
  if (tokens.length === 2 && Object.hasOwn(MODELS, tokens[0])) {
    const route = normalizeRoute({ model: MODELS[tokens[0]], level: tokens[1] }, policy.base);
    if (route.requestedLevel !== route.level) return null;
    return route;
  }
  return null;
}
