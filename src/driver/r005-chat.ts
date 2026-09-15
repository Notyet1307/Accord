import { cqaSha256, type CqaCandidate, type CqaRequest } from "../contracts/cqa-query.js";
import { normalizeMagicChatMessageBodyForSend, type MagicChatChoiceBody, type MagicChatMessageBody } from "../contracts/magicchat.js";

export interface CqaChatConfiguration {
  schemaVersion: "accord.r005-chat/v1";
  authorizationId: string;
  authorizationRevision: string;
  expiresAt: number;
  magicChat: {
    transportVersion: "accord.magicchat-websocket-transport/v2";
    endpoint: string;
    credentialRef: string;
    credentialRevision: string;
  };
}
type Field = "question" | "topic" | "asOfDate" | "jurisdiction" | "industry";
export interface CqaChatDraft {
  caseId: string; fields: Partial<Pick<CqaRequest, Field>>;
  messageId: string; messageSequence: number; pending: boolean; stopped: boolean;
}
export interface CqaChatSend {
  id: string; caseId: string; revision: number;
  kind: "feedback" | "candidate" | "choice" | "formal";
  body: MagicChatMessageBody; state: "ready" | "unknown" | "sent" | "suppressed";
  operationId?: string; artifactId?: string;
  messageId?: string; messageSequence?: number; messageCreatedAt?: string;
}
export interface CqaChatArtifact {
  id: string; revision: number; digest: string; text: string; operationId: string;
  caseId: string; contextRevision: number; contextDigest: string;
  actorId: string; conversationId: string; createdAt: number; expiresAt: number;
  choiceSendId: string; choiceBody: MagicChatChoiceBody;
  state: "pending" | "accepted" | "rejected" | "expired" | "invalidated";
}
export interface CqaChatState {
  configuration: CqaChatConfiguration;
  cursor: number; acknowledgedCursor: number; ackRequests: number[];
  receipts: { cursor: number; eventId: string; digest: string }[];
  messages: { id: string; sequence: number; body: string; digest: string; caseId: string; contextRevision: number; contextDigest: string }[];
  draft?: CqaChatDraft;
  sends: CqaChatSend[];
  artifacts: CqaChatArtifact[];
  decisions: { responseId: string; digest: string; actorId: string; conversationId: string;
    messageId: string; optionId: string; at: number; artifactId?: string;
    outcome: "accepted" | "rejected" | "invalid" | "expired" }[];
}
export function cqaChatId(kind: string, ...identity: (string | number)[]): string {
  return `${kind}-${cqaSha256(JSON.stringify(identity))}`;
}
export const CQA_NARROW_SCOPE = "范围过大，需要缩小问题；无法完整显示全部主张、来源与局限，因此不会生成正式产物。";
const fields: readonly Field[] = ["question", "topic", "asOfDate", "jurisdiction", "industry"];
const labels: Record<string, Field> = { question: "question", 问题: "question", topic: "topic", 主题: "topic",
  asOfDate: "asOfDate", 日期: "asOfDate", jurisdiction: "jurisdiction", 地区: "jurisdiction", industry: "industry", 行业: "industry" };
const prompts: Record<Field, string> = {
  question: "请提供查询问题（2–8000 UTF-8 字节），原文将用于查询。",
  topic: "请确认主题：回复 mlps 或 等保。目前只支持合成等保测试资料。",
  asOfDate: "请明确查询日期，格式 YYYY-MM-DD，例如 2026-09-11；不会替您猜测日期。",
  jurisdiction: "请确认适用地区：回复 CN 或 中国。",
  industry: "请明确行业（1–80 UTF-8 字节），例如 software；不会替您猜测行业。",
};
export function cqaMissingField(draft: CqaChatDraft): Field | undefined {
  return fields.find(field => draft.fields[field] === undefined);
}
export function cqaFieldPrompt(draft: CqaChatDraft): string | undefined {
  const missing = cqaMissingField(draft);
  return missing === undefined ? undefined : `${prompts[missing]}\n可逐项回答，也可逐行使用 问题:/主题:/日期:/地区:/行业: 明确补充或修改。/status 查看状态；/stop 停止；/new 开始新事项。`;
}
function assignField(draft: CqaChatDraft, field: Field, raw: string): boolean {
  const value = raw.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
  delete draft.fields[field];
  if (!raw.isWellFormed()) return false;
  switch (field) {
    case "question":
      if (Buffer.byteLength(raw) > 8000 || Buffer.byteLength(value) < 2) return false;
      draft.fields.question = raw; return true;
    case "topic":
      if (value !== "mlps" && value !== "等保") return false;
      draft.fields.topic = "mlps"; return true;
    case "jurisdiction":
      if (value !== "CN" && value !== "中国") return false;
      draft.fields.jurisdiction = "CN"; return true;
    case "asOfDate": {
      const date = new Date(`${value}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
      draft.fields.asOfDate = value; return true;
    }
    case "industry":
      if (!value || Buffer.byteLength(value) > 80) return false;
      draft.fields.industry = value; return true;
  }
}
/** Only explicit labels or the prompted next field are interpreted; ordinary questions keep every byte. */
export function collectCqaFields(draft: CqaChatDraft, body: string): string | undefined {
  const lines = body.split(/\r?\n/u).filter(line => line.trim() !== "");
  const labeled = lines.map(line => /^\s*(question|问题|topic|主题|asOfDate|日期|jurisdiction|地区|industry|行业)\s*[:：](.*)$/u.exec(line));
  if (labeled.some(match => match !== null)) {
    const seen = new Set<Field>(); let invalid = false;
    for (const match of labeled) {
      if (!match) { invalid = true; continue; }
      const field = labels[match[1]!]!;
      if (seen.has(field)) { delete draft.fields[field]; invalid = true; continue; }
      seen.add(field); if (!assignField(draft, field, match[2]!)) invalid = true;
    }
    if (invalid) {
      // Mixed/unrecognized lines must not submit a silently partial interpretation.
      draft.pending = false;
      return `字段格式或范围无效；请逐行明确提供 问题:/主题:mlps/日期:YYYY-MM-DD/地区:CN/行业:。\n${cqaFieldPrompt(draft) ?? "请重新明确本次问题或修改字段。"}`;
    }
  } else {
    const field = cqaMissingField(draft) ?? "question";
    if (!assignField(draft, field, body)) return `输入无效。${cqaFieldPrompt(draft)}`;
  }
  return cqaFieldPrompt(draft);
}
/** No quote field is rendered: complete claims keep all their versioned source references. */
export function renderCqaCandidate(candidate: CqaCandidate, request: CqaRequest): string | undefined {
  const result = candidate.result;
  const sources = new Map(result.citations.map(citation => [citation.id, citation]));
  const content = ["【候选答复 · synthetic 合成测试资料 · 非法律/认证结论】",
    `状态：${result.status}；主题：${request.topic}；日期：${request.asOfDate}；地区：${request.jurisdiction}；行业：${request.industry}`,
    ...result.claims.map((claim, index) => `${index + 1}. ${claim.text}\n${claim.evidenceIds.map(id => {
      const source = sources.get(id)!;
      return `依据 [${source.id}] ${source.title}；文档 ${source.documentId}；版本 ${source.version}；定位 ${source.locator}；${source.uri}`;
    }).join("\n")}`),
    `缺项/待复核原因：${result.reasonCodes.length ? result.reasonCodes.join("；") : "生产者未列出；不代表检索完整或法规适用已获确认。"}`,
    `警告：${result.warnings.length ? result.warnings.join("；") : "无额外警告；不代表无风险。"}`,
    "局限：仅限冻结的合成测试资料；需要人工复核（humanReviewRequired=true），语义蕴含未验证（entailmentVerified=false）。人工接受以独立的精确确认记录为准，不代表来源或语义已获验证。",
    "如需接受精确产物并交付本私聊，请发送 /export 或 导出，再使用确认卡选择；自由文本同意不会批准。",
  ].join("\n");
  if (Buffer.byteLength(content) > 4096) return undefined;
  try { return normalizeMagicChatMessageBodyForSend({ type: "text", content }).content; }
  catch { return undefined; }
}
