export function resolveAgentId(sessionKey, explicitAgentId) {
  return explicitAgentId || /^agent:([^:]+):/.exec(String(sessionKey || ""))?.[1] || "";
}

export function buildSessionPatch(route, source = "auto", defaultModel = route.model) {
  const usesDefaultModel = source === "auto" && route.model === defaultModel;
  return {
    thinkingLevel: route.level,
    providerOverride: undefined,
    modelOverride: usesDefaultModel ? undefined : route.model,
    modelOverrideSource: usesDefaultModel ? undefined : source,
    modelOverrideFallbackOriginProvider: undefined,
    modelOverrideFallbackOriginModel: undefined,
  };
}

export async function applySessionRoute(api, {
  agentId,
  sessionKey,
  route,
  source = "auto",
  defaultModel = route.model,
}) {
  const sessions = api.runtime.agent.session;
  const storePath = sessions.resolveStorePath(undefined, { agentId });
  return await sessions.updateSessionStoreEntry({
    storePath,
    sessionKey,
    update: async () => buildSessionPatch(route, source, defaultModel),
  });
}

export function readSessionEntry(api, { agentId, sessionKey }) {
  const sessions = api.runtime.agent.session;
  const storePath = sessions.resolveStorePath(undefined, { agentId });
  return sessions.loadSessionStore(storePath)[sessionKey] || {};
}
