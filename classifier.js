const APPROVAL_RE = /^(?:делай|делаем|приступай|вноси|исправляй|реализуй|запускай|продолжай|окей,?\s*делай|да,?\s*делай)[.! ]*$/i;
const CONTINUATION_RE = /^(?:продолж(?:ай|и)|доделай|исправь это|поправь это|добавь туда|добавь сюда|и ещё|а ещё|тогда|теперь|по этой задаче|насч[её]т этого|что дальше|почему так)(?:\s|$)/i;

const SIGNALS = [
  ["architecture", 2, /архитектур|system design|проектирован.*систем|компромисс.*архитектур/i],
  ["security", 2, /\bsecurity\b|security[- ]?review|безопасност|уязвим|threat model|секрет|oauth|авторизац/i],
  ["migration", 2, /сложн.*миграц|миграц.*(?:откат|совместим|данн)|rollback|план отката/i],
  ["ambiguous_debug", 2, /первопричин|неоднознач|несколько гипотез|редк.*баг|race condition|deadlock|утечк|регресси|без очевидн.*причин/i],
  ["high_risk", 2, /продакш|production|боев.*систем|платеж|необратим|потер.*данн|критич.*код/i],
  ["full_review", 2, /полный аудит|глубок.*ревью|ревью.*репозитор|аудит.*проект|full audit|deep review|repository review/i],
];

const SYSTEM_TERMS = [
  /\bapi\b/i,
  /\bбд\b|database|postgres|mysql|sqlite/i,
  /очеред|queue|kafka|rabbit/i,
  /gateway|шлюз/i,
  /telegram|discord|канал/i,
  /docker|container|контейнер/i,
  /инфраструктур|infra|kubernetes|nginx/i,
  /cache|кеш|redis/i,
  /oauth|auth|авторизац/i,
];

const BRANCH_TERMS = [
  /архитектур/i,
  /безопасност|security/i,
  /тест/i,
  /производительност|performance/i,
  /данн|database|бд/i,
  /инфраструктур|infra/i,
  /план отката|rollback/i,
  /документац/i,
];

const PARALLEL_RE = /\bparallel\b|параллел|независим.*(?:ветк|направлен|подзадач)|раздели.*(?:ветк|направлен|подзадач)|несколько независим/i;

function countPresent(text, expressions) {
  return expressions.reduce((count, expression) => count + (expression.test(text) ? 1 : 0), 0);
}

export function isApproval(text) {
  return APPROVAL_RE.test(String(text || "").trim());
}

export function isContinuation(text, metadata = {}) {
  if (metadata.replyToId || metadata.replyToIdFull || metadata.isReply) return true;
  return CONTINUATION_RE.test(String(text || "").trim());
}

export function scoreComplexity(text) {
  const input = String(text || "");
  const reasonCodes = [];
  let score = 0;
  for (const [code, weight, expression] of SIGNALS) {
    if (!expression.test(input)) continue;
    score += weight;
    reasonCodes.push(code);
  }
  const systemCount = countPresent(input, SYSTEM_TERMS);
  if (systemCount >= 2) {
    score += 2;
    reasonCodes.push("cross_system");
  }
  const branchCount = countPresent(input, BRANCH_TERMS);
  const decomposable = PARALLEL_RE.test(input) || branchCount >= 3;
  if (decomposable) reasonCodes.push("decomposable");
  return { score, reasonCodes, systemCount, branchCount, decomposable };
}

export function classifyRoute({ text, metadata = {}, policy, previousDecision = null }) {
  if (!policy) return null;
  const input = String(text || "").trim();
  if ((isApproval(input) || isContinuation(input, metadata)) && previousDecision) {
    return {
      ...previousDecision,
      source: "inherited",
      reasonCodes: [isApproval(input) ? "approval_inherited" : "continuation_inherited"],
    };
  }

  const complexity = scoreComplexity(input);
  if (policy.autoUltra && complexity.score >= 4 && complexity.decomposable) {
    return {
      model: policy.base.model,
      level: "ultra",
      source: "auto",
      reasonCodes: complexity.reasonCodes,
      score: complexity.score,
    };
  }
  if (policy.autoMax && complexity.score >= 4 && complexity.reasonCodes.filter((code) => code !== "decomposable").length >= 2) {
    return {
      model: policy.base.model,
      level: "max",
      source: "auto",
      reasonCodes: complexity.reasonCodes,
      score: complexity.score,
    };
  }
  return {
    ...policy.base,
    source: "base",
    reasonCodes: complexity.score > 0 ? ["below_escalation_threshold", ...complexity.reasonCodes] : ["agent_default"],
    score: complexity.score,
  };
}
