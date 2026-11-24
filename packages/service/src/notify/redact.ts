// Things that look like secrets, after the formats gitleaks' default rules match: private keys,
// cloud and service tokens, signed web tokens, and `key = value` pairs named like a secret.
const PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----/g,
  /\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
  /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\bxapp-\d-[A-Za-z0-9-]{10,}\b/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g,
  /https:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+/g,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b[rsp]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
  /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bre_[A-Za-z0-9_]{20,}\b/g,
  /\btk_[a-z0-9]{29}\b/g,
  /\bhf_[A-Za-z0-9]{30,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];

// `password: hunter22`, `"api_key": "…"`: the name stays, the value goes.
const NAMED =
  /\b((?:api|access|secret|private|auth)[_-]?(?:key|token)|token|secret|password|passwd|pwd)(["']?\s*[:=]\s*["']?)([^\s"',;]{8,})/gi;

const HIDDEN = "[hidden]";

// Before anything leaves the computer (D-130). `known` are the keys the core itself holds for the
// destination, hidden wherever they appear.
export function redact(text: string, known: readonly string[] = []): string {
  let clean = text;
  for (const key of known) if (key.length >= 8) clean = clean.replaceAll(key, HIDDEN);
  for (const pattern of PATTERNS) clean = clean.replace(pattern, HIDDEN);
  return clean.replace(NAMED, (_, name: string, between: string) => `${name}${between}${HIDDEN}`);
}
