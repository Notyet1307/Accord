import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { deriveApprovalPublicationId, deriveReceiptBusinessIds, deriveInboxDeliveryId, deriveMagicChatMessageRecordId, parsePendingActionId, parseInboxReceiptId } from "./core/ids.js";
import { MAGICCHAT_APP_WEBSOCKET_CONTRACT, MAGICCHAT_SOURCE_COMMIT, normalizeMagicChatMessageBodyForSend, parseMagicChatChoiceBody, parseCanonicalInstant, parseMagicChatMessageSendPayload, parseMagicChatMessagesListPayload, type NormalizedMagicChatEnvelope, type NormalizedMagicChatMessageCreated, type NormalizedMagicChatChoiceResponseCreated } from "./contracts/magicchat.js";
import type { MagicChatPendingRequest, MagicChatRequestEnvelope, MagicChatProtocolSnapshot } from "./magicchat/adapter.js";

type Row = Record<string, unknown>;
export interface MagicChatApprovalSnapshot {
  readonly challengeId: string; readonly version: 1; readonly state: "REQUEST_PENDING" | "WAIT_FOR_APPROVAL" | "APPROVED" | "REJECTED" | "PUBLICATION_HOLD" | "COMPLETE";
  readonly caseId: string; readonly workflowRunId: string; readonly artifactId: string; readonly artifactRevision: 1; readonly artifactDigest: string;
  readonly expectedActorId: string; readonly conversationId: string; readonly expiresAt: string; readonly requestActionId: string; readonly requestEnvelopeId: string;
  readonly choiceMessageId?: string; readonly choiceMessageSequence?: number;
  readonly decision?: Readonly<{ approvalId: string; decision: "APPROVED" | "REJECTED"; actorId: string; responseId: string; receiptId: string; decidedAt: string }>;
  readonly claim?: Readonly<{ claimId: string; ownerId: "COORDINATOR"; version: 1; expiresAt: string }>;
  readonly freshness?: Readonly<{ actionId: string; requestEnvelopeId: string; claimVersion: 1; state: "PENDING" | "VALID" | "INVALID" | "CONSUMED"; token?: Readonly<Row> }>;
  readonly publication?: Readonly<{ actionId: string; requestEnvelopeId: string; state: "PENDING" | "UNKNOWN" | "CONFIRMED" | "FAILED"; messageId?: string; messageSequence?: number }>;
}
const TTL = 86_400_000;
function canonical(value: unknown): unknown { if (Array.isArray(value)) return value.map(canonical); if (value !== null && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(Reflect.get(value, key))])); return value; }
function json(value: unknown): string { return JSON.stringify(canonical(value)); }
function digest(value: unknown): string { return createHash("sha256").update(json(value), "utf8").digest("hex"); }
function one(db: DatabaseSync, sql: string, ...args: (string | number | null)[]): Row | undefined { return db.prepare(sql).get(...args) as Row | undefined; }
function rows(db: DatabaseSync, sql: string, ...args: (string | number | null)[]): Row[] { return db.prepare(sql).all(...args) as Row[]; }
function text(row: Row, key: string): string { const value = row[key]; if (typeof value !== "string" || value.length === 0) throw new Error(`C3 ${key} missing`); return value; }
function integer(row: Row, key: string): number { const value = row[key]; if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error(`C3 ${key} invalid`); return value; }
function object(value: unknown): Row { if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("C3 expected object"); return value as Row; }
function decoded(row: Row, key: string): Row { return object(JSON.parse(text(row, key))); }
function equal(actual: unknown, expected: unknown, label: string): void { if (json(actual) !== json(expected)) throw new Error(`C3 ${label} identity or bytes conflict`); }
function time(row: Row, key: string): string { return parseCanonicalInstant(row[key], `C3 ${key}`); }
function id(kind: Parameters<typeof deriveApprovalPublicationId>[0], namespace: string, ...parts: string[]): string { return deriveApprovalPublicationId(kind, namespace, parts); }
function authority(db: DatabaseSync, caseId: string): Row {
  const row = one(db, `SELECT a.*,c.source_app_id,c.source_conversation_id,c.status AS case_status,w.state AS workflow_state,w.revision AS workflow_revision,b.revision AS board_revision,r.receipt_id AS source_receipt_id,r.cursor AS source_cursor,r.source_actor_id,r.source_message_sequence FROM artifacts a JOIN cases c ON c.case_id=a.case_id JOIN workflow_runs w ON w.workflow_run_id=a.workflow_run_id AND w.case_id=a.case_id JOIN boards b ON b.board_id=a.board_id AND b.case_id=a.case_id JOIN inbox_receipts r ON r.case_id=c.case_id AND r.source_message_id=c.source_message_id AND r.event_type='message.created' WHERE a.case_id=?`, caseId);
  if (row === undefined) throw new Error("C3 requires the exact durable Writer Artifact authority");
  return row;
}
function binding(a: Row): Row { return { appId: text(a,"source_app_id"), conversationId: text(a,"source_conversation_id"), actorId: text(a,"source_actor_id"), caseId: text(a,"case_id"), workflowRunId: text(a,"workflow_run_id"), artifactId: text(a,"artifact_id"), artifactRevision:1,artifactDigest:text(a,"artifact_digest"),version:1,actionKind:"APPROVAL_REQUEST" }; }
function challenge(db: DatabaseSync, appId: string): Row | undefined { return one(db,"SELECT * FROM approval_challenges WHERE expected_app_id=?",appId); }
function ingressContext(db: DatabaseSync, appId: string): Row | undefined {
  return challenge(db,appId) ?? one(db,"SELECT *,resolved_at AS created_at FROM wait_challenges WHERE expected_app_id=? AND state='RESUMED'",appId);
}
function action(db: DatabaseSync, actionId: string): Row { const found=one(db,`SELECT p.*,r.request_envelope_id,r.rpc_method,r.request_json,r.request_digest,r.confirmation_json,r.confirmed_external_id,r.confirmed_at,r.dispatched_at,r.case_id AS rpc_case_id,r.workflow_run_id AS rpc_workflow_run_id,r.receipt_id AS rpc_receipt_id,r.created_at AS rpc_created_at,r.schema_version AS rpc_schema_version FROM pending_side_effects p JOIN magicchat_rpc_actions r ON r.action_id=p.action_id WHERE p.action_id=?`,actionId); if(found===undefined) throw new Error("C3 action missing"); return found; }
function audit(db: DatabaseSync, ch: Row, kind: string, key: string, details: Row, at: string, receipt: string | null = null): void {
  const correlation=id("corr","case",text(ch,"case_id")); const eventKind=`C3:${kind}`; const auditId=id("audit",kind,key);
  db.prepare(`INSERT INTO audit_events(audit_event_id,schema_version,correlation_id,event_kind,case_id,board_id,workflow_run_id,receipt_id,details_json,recorded_at) VALUES(?,'accord.audit-event/v1',?,?,?,?,?,?,?,?)`).run(auditId,correlation,`${eventKind}:${key}`,text(ch,"case_id"),text(ch,"board_id"),text(ch,"workflow_run_id"),receipt,json(details),at);
}
function intent(db: DatabaseSync, ch: Row, kind: string, request: MagicChatRequestEnvelope, at: string, receipt: string | null): string {
  const actionId=id("action",kind,request.id); const bytes=json(request); const hash=digest(request);
  db.prepare(`INSERT INTO pending_side_effects(action_id,schema_version,case_id,workflow_run_id,receipt_id,action_kind,idempotency_key,payload_digest,state,created_at) VALUES(?,'accord.pending-side-effect/v1',?,?,?,?,?,?,'PENDING',?)`).run(actionId,text(ch,"case_id"),text(ch,"workflow_run_id"),receipt,kind,request.id,hash,at);
  db.prepare(`INSERT INTO magicchat_rpc_actions(action_id,schema_version,case_id,workflow_run_id,receipt_id,request_envelope_id,rpc_method,request_json,request_digest,created_at) VALUES(?,'accord.magicchat-rpc-action/v1',?,?,?,?,?,?,?,?)`).run(actionId,text(ch,"case_id"),text(ch,"workflow_run_id"),receipt,request.id,request.method,bytes,hash,at);
  audit(db,ch,`${kind}_INTENT`,actionId,{actionId,request,requestDigest:hash},at,receipt); return actionId;
}
function approvalRequest(ch: Row): MagicChatRequestEnvelope {
  return {v:1,id:id("request","approval",text(ch,"binding_digest")),kind:"request",method:"message.send",payload:{target:{type:"conversation",conversation_id:text(ch,"expected_conversation_id")},message:{type:"choice",content_type:"text",content:`Approve Artifact ${text(ch,"artifact_id")} revision 1 (${text(ch,"artifact_digest")}) for Case ${text(ch,"case_id")}, Run ${text(ch,"workflow_run_id")}. Expires ${time(ch,"expires_at")}.`,selection:"single",options:[{id:"approve",label:"Approve"},{id:"reject",label:"Reject"}]}}};
}
/** Called only inside the winning Writer transaction or the sealed legacy upgrade transaction. */
export function ensureApprovalRequest(db: DatabaseSync, caseId: string, now: string, origin: "WRITER_WINNER" | "LEGACY_RECOVERY"): void {
  const at=parseCanonicalInstant(now,"C3 request time"); const a=authority(db,caseId); const bind=binding(a); const hash=digest(bind); const challengeId=id("challenge","approval",hash);
  if(one(db,"SELECT challenge_id FROM approval_challenges WHERE case_id=?",caseId)!==undefined) throw new Error("C3 approval request already exists");
  if(a["workflow_state"]!=="WAIT_FOR_APPROVAL" || a["case_status"]!=="OPEN" || integer(a,"board_revision")!==integer(a,"created_board_revision")) throw new Error("C3 Writer approval boundary is stale");
  const expiry=new Date(Date.parse(at)+TTL).toISOString(); const ch:Row={challenge_id:challengeId,case_id:caseId,board_id:a["board_id"],workflow_run_id:a["workflow_run_id"],binding_digest:hash,expected_conversation_id:a["source_conversation_id"],artifact_id:a["artifact_id"],artifact_digest:a["artifact_digest"],expires_at:expiry};
  const request=approvalRequest(ch); const actionId=intent(db,ch,"APPROVAL_REQUEST",request,at,text(a,"source_receipt_id"));
  db.prepare(`INSERT INTO approval_challenges(challenge_id,schema_version,case_id,board_id,workflow_run_id,artifact_id,artifact_revision,artifact_digest,challenge_version,expected_app_id,expected_conversation_id,expected_actor_id,expected_board_revision,expected_workflow_revision,source_receipt_id,source_cursor,source_message_sequence,approval_action_id,binding_json,binding_digest,options_json,expires_at,state,created_at) VALUES(?,'accord.approval-challenge/v1',?,?,?,?,1,?,1,?,?,?,?,?,?,?,?,?,?,?,'["approve","reject"]',?,'REQUEST_PENDING',?)`).run(challengeId,caseId,text(a,"board_id"),text(a,"workflow_run_id"),text(a,"artifact_id"),text(a,"artifact_digest"),text(a,"source_app_id"),text(a,"source_conversation_id"),text(a,"source_actor_id"),integer(a,"board_revision"),integer(a,"workflow_revision"),text(a,"source_receipt_id"),integer(a,"source_cursor"),integer(a,"source_message_sequence"),actionId,json(bind),hash,expiry,at);
  audit(db,ch,origin==="WRITER_WINNER"?"APPROVAL_REQUEST_CREATED":"APPROVAL_REQUEST_RECOVERED",challengeId,{challengeId,binding:bind,origin,sourceResultId:text(a,"source_result_id"),artifactCreatedAt:time(a,"created_at"),expiresAt:expiry},at);
}

export function inspectApprovalPublication(db: DatabaseSync, caseId: string): MagicChatApprovalSnapshot | undefined {
  const ch=one(db,"SELECT * FROM approval_challenges WHERE case_id=?",caseId); if(ch===undefined)return undefined;
  const request=action(db,text(ch,"approval_action_id")); const decision=one(db,"SELECT * FROM approvals WHERE challenge_id=?",text(ch,"challenge_id")); const claim=one(db,"SELECT * FROM response_claims WHERE case_id=?",caseId); const freshness=one(db,"SELECT * FROM publication_freshness WHERE case_id=?",caseId); const publication=one(db,"SELECT action_id FROM pending_side_effects WHERE case_id=? AND action_kind='PUBLICATION'",caseId); const pub=publication===undefined?undefined:action(db,text(publication,"action_id")); const msg=pub===undefined?undefined:one(db,"SELECT * FROM magicchat_messages WHERE action_id=?",text(pub,"action_id"));
  return Object.freeze({challengeId:text(ch,"challenge_id"),version:1,state:text(ch,"state") as MagicChatApprovalSnapshot["state"],caseId,workflowRunId:text(ch,"workflow_run_id"),artifactId:text(ch,"artifact_id"),artifactRevision:1,artifactDigest:text(ch,"artifact_digest"),expectedActorId:text(ch,"expected_actor_id"),conversationId:text(ch,"expected_conversation_id"),expiresAt:time(ch,"expires_at"),requestActionId:text(ch,"approval_action_id"),requestEnvelopeId:text(request,"request_envelope_id"),...(ch["choice_message_id"]===null?{}:{choiceMessageId:text(ch,"choice_message_id"),choiceMessageSequence:integer(ch,"choice_message_sequence")}),...(decision===undefined?{}:{decision:Object.freeze({approvalId:text(decision,"approval_id"),decision:text(decision,"state") as "APPROVED"|"REJECTED",actorId:text(decision,"expected_actor_id"),responseId:text(decision,"response_id"),receiptId:text(decision,"receipt_id"),decidedAt:time(decision,"decided_at")})}),...(claim===undefined?{}:{claim:Object.freeze({claimId:text(claim,"response_claim_id"),ownerId:"COORDINATOR" as const,version:1 as const,expiresAt:time(claim,"expires_at")})}),...(freshness===undefined?{}:{freshness:Object.freeze({actionId:text(freshness,"read_action_id"),requestEnvelopeId:text(action(db,text(freshness,"read_action_id")),"request_envelope_id"),claimVersion:1 as const,state:text(freshness,"state") as "PENDING"|"VALID"|"INVALID"|"CONSUMED",...(freshness["token_json"]===null?{}:{token:Object.freeze(decoded(freshness,"token_json"))})})}),...(pub===undefined?{}:{publication:Object.freeze({actionId:text(pub,"action_id"),requestEnvelopeId:text(pub,"request_envelope_id"),state:text(pub,"state") as "PENDING"|"UNKNOWN"|"CONFIRMED"|"FAILED",...(msg===undefined?{}:{messageId:text(msg,"message_id"),messageSequence:integer(msg,"message_sequence")})})})});
}

function observedSequence(db: DatabaseSync, ch: Row): number {
  const row=one(db,"SELECT max(source_message_sequence) AS newest FROM inbox_receipts WHERE app_id=? AND source_conversation_id=? AND event_type='message.created'",text(ch,"expected_app_id"),text(ch,"expected_conversation_id"));
  return row?.["newest"] === null || row===undefined ? 0 : integer(row,"newest");
}
function currentBinding(db: DatabaseSync, ch: Row, workflowState: string, workflowRevision: number, now: string): boolean {
  const a=authority(db,text(ch,"case_id"));
  return json(binding(a))===text(ch,"binding_json") && a["board_id"]===ch["board_id"] && a["board_revision"]===ch["expected_board_revision"] && a["workflow_state"]===workflowState && a["workflow_revision"]===workflowRevision && a["case_status"]==="OPEN" && now>=time(ch,"created_at") && now<=time(ch,"expires_at");
}
function stable(db: DatabaseSync, ch: Row, receiptId: string, phase: string, at: string): void {
  const receipt=one(db,"SELECT * FROM inbox_receipts WHERE receipt_id=?",receiptId); if(receipt===undefined)throw new Error("C3 stable receipt missing");
  const state=one(db,"SELECT * FROM magicchat_inbox_states WHERE receipt_id=?",receiptId); if(state===undefined)throw new Error("C3 stable inbox state missing");
  if(state["ack_state"]!=="NONE")return;
  if(one(db,"SELECT receipt_id FROM magicchat_inbox_states WHERE app_id=? AND cursor<? AND ack_state<>'ACK_CONFIRMED'",text(receipt,"app_id"),integer(receipt,"cursor"))!==undefined)throw new Error("C3 cumulative ACK blocked by lower cursor");
  const request:MagicChatRequestEnvelope={v:1,id:id("request","ACK",receiptId),kind:"request",method:"events.ack",payload:{cursor:integer(receipt,"cursor")}};
  const actionId=intent(db,ch,"ACK",request,at,receiptId);
  db.prepare("UPDATE magicchat_inbox_states SET business_outcome=?,business_stable=1,stable_at=?,ack_state='ACK_INTENT',ack_action_id=? WHERE receipt_id=? AND ack_state='NONE'").run(phase,at,actionId,receiptId);
}
function hold(db: DatabaseSync, ch: Row, reason: string, at: string): void {
  if(ch["state"]==="COMPLETE" || ch["state"]==="REJECTED" || ch["state"]==="PUBLICATION_HOLD")return;
  const a=authority(db,text(ch,"case_id"));
  if(db.prepare("UPDATE workflow_runs SET state='PUBLICATION_HOLD',revision=revision+1 WHERE workflow_run_id=? AND revision=?").run(text(ch,"workflow_run_id"),integer(a,"workflow_revision")).changes!==1)throw new Error("C3 hold lost Workflow CAS");
  db.prepare("UPDATE approval_challenges SET state='PUBLICATION_HOLD' WHERE challenge_id=?").run(text(ch,"challenge_id"));
  db.prepare("UPDATE response_claims SET state='HELD' WHERE case_id=? AND state='CLAIMED'").run(text(ch,"case_id"));
  db.prepare("UPDATE publication_freshness SET state='INVALID',invalidated_at=? WHERE case_id=? AND state IN ('PENDING','VALID')").run(at,text(ch,"case_id"));
  audit(db,ch,"PUBLICATION_HOLD",text(ch,"challenge_id"),{reason,previousWorkflowState:a["workflow_state"],previousWorkflowRevision:a["workflow_revision"]},at);
  // Unknown publication is not a stable completed transition, even on hold.
  const unknown=one(db,"SELECT action_id FROM pending_side_effects WHERE case_id=? AND action_kind='PUBLICATION' AND state='UNKNOWN'",text(ch,"case_id"));
  if(unknown===undefined && typeof ch["resolved_by_receipt_id"]==="string")stable(db,ch,ch["resolved_by_receipt_id"],"PUBLICATION_HOLD",at);
}
function acquireClaimAndRead(db: DatabaseSync, ch: Row, approvalId: string, receiptId: string, at: string): void {
  const claimId=id("response_claim","FINAL_RESPONSE",text(ch,"case_id")); const workflowRevision=integer(ch,"expected_workflow_revision")+1;
  if(db.prepare("UPDATE workflow_runs SET state='FRESHNESS_CHECK',revision=revision+1 WHERE workflow_run_id=? AND state='WAIT_FOR_APPROVAL' AND revision=?").run(text(ch,"workflow_run_id"),integer(ch,"expected_workflow_revision")).changes!==1)throw new Error("C3 approval lost Workflow CAS");
  db.prepare(`INSERT INTO response_claims(response_claim_id,schema_version,case_id,workflow_run_id,approval_id,publication_slot,claim_version,board_revision,workflow_revision,freshness_token_digest,state,created_at,artifact_id,artifact_revision,artifact_digest,owner_id,expires_at) VALUES(?,'accord.response-claim/v1',?,?,?,'FINAL_RESPONSE',1,?,?,NULL,'CLAIMED',?,?,1,?,'COORDINATOR',?)`).run(claimId,text(ch,"case_id"),text(ch,"workflow_run_id"),approvalId,integer(ch,"expected_board_revision"),workflowRevision,at,text(ch,"artifact_id"),text(ch,"artifact_digest"),time(ch,"expires_at"));
  audit(db,ch,"CLAIM_ACQUIRED",claimId,{claimId,ownerId:"COORDINATOR",claimVersion:1,approvalId,boardRevision:integer(ch,"expected_board_revision"),workflowRevision,expiresAt:time(ch,"expires_at")},at,receiptId);
  const observedCursor=integer(one(db,"SELECT max(cursor) AS cursor FROM inbox_receipts WHERE app_id=?",text(ch,"expected_app_id")) ?? {},"cursor");
  const snapshot={...decoded(ch,"binding_json"),approvalId,claimId,claimVersion:1,boardId:text(ch,"board_id"),boardRevision:integer(ch,"expected_board_revision"),workflowRevision,observedCursor,sourceMessageSequence:observedSequence(db,ch),triggerMessageId:text(ch,"choice_message_id"),triggerMessageSequence:integer(ch,"choice_message_sequence"),expiresAt:time(ch,"expires_at"),beforeOrEqualSequence:Number.MAX_SAFE_INTEGER,limit:100};
  const hash=digest(snapshot); const freshnessId=id("freshness","snapshot",hash);
  const request:MagicChatRequestEnvelope={v:1,id:id("request","FRESHNESS_READ",hash),kind:"request",method:"conversation.messages.list",payload:{conversation_id:text(ch,"expected_conversation_id"),before_or_equal_seq:Number.MAX_SAFE_INTEGER,limit:100}};
  const actionId=intent(db,ch,"FRESHNESS_READ",request,at,receiptId);
  db.prepare(`INSERT INTO publication_freshness(freshness_id,schema_version,case_id,workflow_run_id,board_id,artifact_id,artifact_revision,artifact_digest,approval_id,response_claim_id,claim_version,app_id,conversation_id,source_message_sequence,trigger_message_id,trigger_message_sequence,board_revision,workflow_revision,read_action_id,snapshot_json,snapshot_digest,state,expires_at,created_at) VALUES(?,'accord.publication-freshness/v1',?,?,?,?,1,?,?,?,1,?,?,?,?,?,?,?,?,?,?,'PENDING',?,?)`).run(freshnessId,text(ch,"case_id"),text(ch,"workflow_run_id"),text(ch,"board_id"),text(ch,"artifact_id"),text(ch,"artifact_digest"),approvalId,claimId,text(ch,"expected_app_id"),text(ch,"expected_conversation_id"),snapshot.sourceMessageSequence,snapshot.triggerMessageId,snapshot.triggerMessageSequence,snapshot.boardRevision,workflowRevision,actionId,json(snapshot),hash,time(ch,"expires_at"),at);
  db.prepare("UPDATE magicchat_inbox_states SET business_outcome='FRESHNESS_PENDING' WHERE receipt_id=?").run(receiptId);
}
function receiptPayload(event: NormalizedMagicChatMessageCreated | NormalizedMagicChatChoiceResponseCreated): Row {
  const {envelopeEventId: ignored,...payload}=event; void ignored; return payload;
}
function recordDelivery(db: DatabaseSync, ch: Row, receiptId: string, envelopeId: string, at: string): void {
  const deliveryId=deriveInboxDeliveryId({receiptId:parseInboxReceiptId(receiptId),envelopeEventId:envelopeId});
  const prior=one(db,"SELECT * FROM inbox_deliveries WHERE delivery_id=? OR envelope_event_id=?",deliveryId,envelopeId);
  if(prior!==undefined){if(prior["delivery_id"]!==deliveryId || prior["receipt_id"]!==receiptId)throw new Error("C3 delivery identity conflict"); return;}
  db.prepare("INSERT INTO inbox_deliveries(delivery_id,schema_version,receipt_id,case_id,envelope_event_id,received_at) VALUES(?,'accord.inbox-delivery/v1',?,?,?,?)").run(deliveryId,receiptId,text(ch,"case_id"),envelopeId,at);
  audit(db,ch,"DELIVERY",deliveryId,{deliveryId,receiptId,envelopeEventId:envelopeId},at,receiptId);
}
/** Reliable events retain their actual event and response identity. No synthetic message is manufactured. */
export function processApprovalEvent(db: DatabaseSync, appId: string, event: NormalizedMagicChatMessageCreated | NormalizedMagicChatChoiceResponseCreated, at: string): Readonly<{cursor:number;outcome:"CREATED"|"REPLAYED"}> | undefined {
  const ch=event.kind==="CHOICE_RESPONSE_CREATED"?challenge(db,appId):ingressContext(db,appId); if(ch===undefined)return undefined;
  const payload=receiptPayload(event); const hash=digest(payload); const ids=deriveReceiptBusinessIds({appId,cursor:event.cursor,payloadDigest:hash});
  const prior=one(db,"SELECT r.*,s.event_payload_json FROM inbox_receipts r JOIN magicchat_inbox_states s ON s.receipt_id=r.receipt_id WHERE r.app_id=? AND r.cursor=?",appId,event.cursor);
  if(prior?.["event_payload_json"]===null)return undefined;
  const wallTime=new Date().toISOString();if(wallTime>at)at=wallTime;
  if(prior!==undefined){equal(prior["event_payload_json"],json(payload),"reliable cursor replay"); if(at<time(prior,"received_at"))throw new Error("C3 replay precedes first receipt");recordDelivery(db,ch,ids.receiptId,event.envelopeEventId,at);if(prior["processing_status"]==="RECEIVED" && one(db,"SELECT cursor FROM magicchat_inbox_states WHERE app_id=? AND cursor<? AND ack_state<>'ACK_CONFIRMED'",appId,event.cursor)===undefined){db.prepare("UPDATE inbox_receipts SET processing_status='PROCESSED' WHERE receipt_id=? AND processing_status='RECEIVED'").run(ids.receiptId);if(event.kind==="CHOICE_RESPONSE_CREATED")consumeApprovalChoice(db,ch,event,ids.receiptId,at);else stable(db,ch,ids.receiptId,"OBSERVED_INPUT",at);}return {cursor:event.cursor,outcome:"REPLAYED"};}
  if(one(db,"SELECT cursor FROM magicchat_inbox_states WHERE app_id=? AND cursor>?",appId,event.cursor)!==undefined)throw new Error("C3 unseen lower cursor after higher cursor");
  const blocked=one(db,"SELECT cursor FROM magicchat_inbox_states WHERE app_id=? AND cursor<? AND ack_state<>'ACK_CONFIRMED'",appId,event.cursor)!==undefined;
  const isChoice=event.kind==="CHOICE_RESPONSE_CREATED"; const createdAt=isChoice?event.responseCreatedAt:event.messageCreatedAt;
  if(at<createdAt || at<event.messageCreatedAt || at<time(ch,"created_at"))throw new Error("C3 event chronology invalid");
  db.prepare(`INSERT INTO inbox_receipts(receipt_id,schema_version,app_id,cursor,envelope_event_id,event_type,payload_digest,source_conversation_id,source_message_id,source_message_sequence,source_actor_id,case_id,board_id,workflow_run_id,processing_status,received_at,source_response_id) VALUES(?,'accord.inbox-receipt/v1',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ids.receiptId,appId,event.cursor,event.envelopeEventId,isChoice?"choice.response_created":"message.created",hash,event.conversationId,event.messageId,event.messageSequence,event.actorId,text(ch,"case_id"),text(ch,"board_id"),text(ch,"workflow_run_id"),blocked?"RECEIVED":"PROCESSED",at,isChoice?event.responseId:null);
  db.prepare(`INSERT INTO magicchat_inbox_states(receipt_id,schema_version,app_id,cursor,case_id,board_id,workflow_run_id,correlation_id,event_role,normalized_body,reply_to_message_id,message_created_at,business_outcome,business_stable,ack_state,created_at,event_payload_json) VALUES(?,'accord.magicchat-inbox-state/v1',?,?,?,?,?,?,?,NULL,?,?,?,0,'NONE',?,?)`).run(ids.receiptId,appId,event.cursor,text(ch,"case_id"),text(ch,"board_id"),text(ch,"workflow_run_id"),ids.auditCorrelationId,isChoice?"APPROVAL_RESPONSE":"OBSERVED_INPUT",isChoice?null:event.replyToMessageId??null,event.messageCreatedAt,isChoice?(blocked?"APPROVAL_PENDING":"INVALID_CHOICE"):"OBSERVED_INPUT",at,json(payload));
  recordDelivery(db,ch,ids.receiptId,event.envelopeEventId,at);
  if(!isChoice){audit(db,ch,"OBSERVED_INPUT",ids.receiptId,{payload,payloadDigest:hash},at,ids.receiptId);if(!blocked)stable(db,ch,ids.receiptId,"OBSERVED_INPUT",at);return {cursor:event.cursor,outcome:"CREATED"};}
  if(blocked){audit(db,ch,"CHOICE_QUEUED",ids.receiptId,{payload,payloadDigest:hash},at,ids.receiptId);return {cursor:event.cursor,outcome:"CREATED"};}
  consumeApprovalChoice(db,ch,event,ids.receiptId,at);
  return {cursor:event.cursor,outcome:"CREATED"};
}

function consumeApprovalChoice(db: DatabaseSync, ch: Row, event: NormalizedMagicChatChoiceResponseCreated, receiptId: string, at: string): void {
  const ids={receiptId};const payload=receiptPayload(event);const hash=digest(payload);
  const request=approvalRequest(ch); const requestBody=object(request.payload)["message"];
  const requestAction=action(db,text(ch,"approval_action_id"));
  const cardCreatedAt=requestAction["confirmation_json"]===null?undefined:parseMagicChatMessageSendPayload(decoded(requestAction,"confirmation_json")).message.created_at;
  const valid=ch["state"]==="WAIT_FOR_APPROVAL" && event.actorId===ch["expected_actor_id"] && event.conversationId===ch["expected_conversation_id"] && event.messageId===ch["choice_message_id"] && event.messageSequence===ch["choice_message_sequence"] && event.optionIds.length===1 && (event.optionIds[0]==="approve" || event.optionIds[0]==="reject") && json(event.choiceBody)===json(requestBody) && event.messageCreatedAt===cardCreatedAt && event.responseCreatedAt>=event.messageCreatedAt && at>=time(ch,"ready_at") && currentBinding(db,ch,"WAIT_FOR_APPROVAL",integer(ch,"expected_workflow_revision"),at) && one(db,"SELECT approval_id FROM approvals WHERE response_id=?",event.responseId)===undefined;
  if(!valid){audit(db,ch,"INVALID_CHOICE",ids.receiptId,{payload,payloadDigest:hash},at,ids.receiptId);stable(db,ch,ids.receiptId,"INVALID_CHOICE",at);return;}
  const decision=event.optionIds[0]==="approve"?"APPROVED":"REJECTED";
  const h3={challengeId:text(ch,"challenge_id"),...decoded(ch,"binding_json"),decision,actorId:event.actorId,responseId:event.responseId,receiptId:ids.receiptId,requestActionId:text(ch,"approval_action_id"),choiceMessageId:event.messageId,decidedAt:at};
  const approvalId=id("approval","H3",digest(h3));
  db.prepare(`INSERT INTO approvals(approval_id,schema_version,case_id,workflow_run_id,artifact_revision,artifact_digest,expected_actor_id,choice_message_id,state,created_at,artifact_id,challenge_id,response_id,receipt_id,request_action_id,decision_digest,decision_json,decided_at) VALUES(?,'accord.approval/v1',?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(approvalId,text(ch,"case_id"),text(ch,"workflow_run_id"),text(ch,"artifact_digest"),event.actorId,event.messageId,decision,at,text(ch,"artifact_id"),text(ch,"challenge_id"),event.responseId,ids.receiptId,text(ch,"approval_action_id"),digest(h3),json(h3),at);
  db.prepare("UPDATE approval_challenges SET state=?,resolved_by_receipt_id=?,resolved_at=? WHERE challenge_id=? AND state='WAIT_FOR_APPROVAL'").run(decision,ids.receiptId,at,text(ch,"challenge_id"));
  audit(db,ch,"DECISION",approvalId,{approvalId,h3},at,ids.receiptId);
  if(decision==="REJECTED"){if(db.prepare("UPDATE workflow_runs SET state='REJECTED',revision=revision+1 WHERE workflow_run_id=? AND state='WAIT_FOR_APPROVAL' AND revision=?").run(text(ch,"workflow_run_id"),integer(ch,"expected_workflow_revision")).changes!==1)throw new Error("C3 rejection CAS failed");db.prepare("UPDATE cases SET status='REJECTED' WHERE case_id=? AND status='OPEN'").run(text(ch,"case_id"));stable(db,ch,ids.receiptId,"REJECTED",at);}
  else acquireClaimAndRead(db,ch,approvalId,ids.receiptId,at);
}

function publicationRequest(db: DatabaseSync, ch: Row): MagicChatRequestEnvelope {
  const a=authority(db,text(ch,"case_id"));
  return {v:1,id:id("request","PUBLICATION",text(ch,"case_id"),text(ch,"artifact_id"),"1",text(ch,"artifact_digest")),kind:"request",method:"message.send",payload:{target:{type:"conversation",conversation_id:text(ch,"expected_conversation_id")},message:{type:"markdown",content:text(a,"content_markdown")}}};
}
function readRequest(ch: Row, f: Row): MagicChatRequestEnvelope {
  return {v:1,id:id("request","FRESHNESS_READ",text(f,"snapshot_digest")),kind:"request",method:"conversation.messages.list",payload:{conversation_id:text(ch,"expected_conversation_id"),before_or_equal_seq:Number.MAX_SAFE_INTEGER,limit:100}};
}
function validateActionBytes(db: DatabaseSync, ch: Row, act: Row): MagicChatRequestEnvelope {
  const kind=text(act,"action_kind"); let expected:MagicChatRequestEnvelope;
  if(kind==="APPROVAL_REQUEST")expected=approvalRequest(ch);
  else if(kind==="PUBLICATION")expected=publicationRequest(db,ch);
  else if(kind==="FRESHNESS_READ"){const f=one(db,"SELECT * FROM publication_freshness WHERE read_action_id=?",text(act,"action_id"));if(f===undefined)throw new Error("C3 read action orphaned");expected=readRequest(ch,f);}
  else if(kind==="ACK"){const r=one(db,"SELECT cursor FROM inbox_receipts WHERE receipt_id=?",text(act,"receipt_id"));if(r===undefined)throw new Error("C3 ACK orphaned");expected={v:1,id:id("request","ACK",text(act,"receipt_id")),kind:"request",method:"events.ack",payload:{cursor:integer(r,"cursor")}};}
  else throw new Error("C3 action kind unsupported");
  if(text(act,"request_json")!==json(expected) || act["request_digest"]!==digest(expected) || act["payload_digest"]!==digest(expected) || act["request_envelope_id"]!==expected.id || act["idempotency_key"]!==expected.id || act["rpc_method"]!==expected.method || act["action_id"]!==id("action",kind,expected.id) || act["case_id"]!==ch["case_id"] || act["workflow_run_id"]!==ch["workflow_run_id"] || act["rpc_case_id"]!==act["case_id"] || act["rpc_workflow_run_id"]!==act["workflow_run_id"] || act["rpc_receipt_id"]!==act["receipt_id"] || act["rpc_created_at"]!==act["created_at"] || act["schema_version"]!=="accord.pending-side-effect/v1" || act["rpc_schema_version"]!=="accord.magicchat-rpc-action/v1")throw new Error("C3 persisted request identity or bytes conflict");
  return expected;
}
function freshnessGate(db: DatabaseSync, ch: Row, f: Row, at: string): boolean {
  const claim=one(db,"SELECT * FROM response_claims WHERE response_claim_id=?",text(f,"response_claim_id"));
  const approval=one(db,"SELECT * FROM approvals WHERE approval_id=?",text(f,"approval_id"));
  if(claim===undefined || approval===undefined)return false;
  const token=f["token_json"]===null?undefined:decoded(f,"token_json");
  const h3=decoded(approval,"decision_json");const snapshot=decoded(f,"snapshot_json");const read=action(db,text(f,"read_action_id"));
  if(approval["approval_id"]!==id("approval","H3",digest(h3)) || h3["challengeId"]!==ch["challenge_id"] || h3["artifactId"]!==ch["artifact_id"] || h3["artifactDigest"]!==ch["artifact_digest"] || h3["decision"]!=="APPROVED" || h3["actorId"]!==ch["expected_actor_id"] || h3["receiptId"]!==ch["resolved_by_receipt_id"] || h3["requestActionId"]!==ch["approval_action_id"] || h3["responseId"]!==approval["response_id"] || f["snapshot_digest"]!==digest(snapshot) || snapshot["claimId"]!==claim["response_claim_id"] || snapshot["claimVersion"]!==claim["claim_version"] || snapshot["artifactDigest"]!==ch["artifact_digest"] || snapshot["boardRevision"]!==ch["expected_board_revision"] || snapshot["workflowRevision"]!==f["workflow_revision"] || read["state"]!=="CONFIRMED" || token?.["confirmationDigest"]!==digest(decoded(read,"confirmation_json")))return false;
  return ch["state"]==="APPROVED" && f["state"]==="VALID" && token!==undefined && f["token_digest"]===digest(token) && token["snapshotDigest"]===f["snapshot_digest"] && token["claimId"]===claim["response_claim_id"] && token["claimVersion"]===claim["claim_version"] && claim["state"]==="CLAIMED" && claim["owner_id"]==="COORDINATOR" && claim["claim_version"]===1 && claim["artifact_id"]===ch["artifact_id"] && claim["artifact_revision"]===1 && claim["artifact_digest"]===ch["artifact_digest"] && claim["approval_id"]===approval["approval_id"] && claim["freshness_token_digest"]===f["token_digest"] && approval["state"]==="APPROVED" && approval["challenge_id"]===ch["challenge_id"] && approval["artifact_digest"]===ch["artifact_digest"] && approval["decision_digest"]===digest(decoded(approval,"decision_json")) && at<=time(claim,"expires_at") && at>=time(f,"confirmed_at") && currentBinding(db,ch,"PUBLISH",integer(f,"workflow_revision")+1,at) && observedSequence(db,ch)<=integer(f,"trigger_message_sequence") && observedSequence(db,ch)===integer(f,"source_message_sequence");
}
function confirmStoredAction(db: DatabaseSync, ch: Row, act: Row, payload: unknown, externalId: string | null, at: string): void {
  db.prepare("UPDATE magicchat_rpc_actions SET confirmation_json=?,confirmed_external_id=?,confirmed_at=? WHERE action_id=? AND confirmation_json IS NULL").run(json(payload),externalId,at,text(act,"action_id"));
  db.prepare("UPDATE pending_side_effects SET state='CONFIRMED' WHERE action_id=?").run(text(act,"action_id"));
  audit(db,ch,`${text(act,"action_kind")}_CONFIRMED`,text(act,"action_id"),{actionId:text(act,"action_id"),confirmation:payload},at,typeof act["receipt_id"]==="string"?act["receipt_id"]:null);
}
/** Correlated confirmations alone establish an external outcome. */
export function processApprovalResponse(db: DatabaseSync, appId: string, envelope: Extract<NormalizedMagicChatEnvelope,{kind:"RESPONSE"}>, at: string): number | undefined {
  const ch=ingressContext(db,appId); if(ch===undefined)return undefined;
  const r=one(db,"SELECT p.action_id FROM pending_side_effects p JOIN magicchat_rpc_actions r ON r.action_id=p.action_id LEFT JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.case_id=? AND r.request_envelope_id=? AND (p.action_kind IN ('APPROVAL_REQUEST','FRESHNESS_READ','PUBLICATION') OR s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT'))",text(ch,"case_id"),envelope.requestEnvelopeId);
  if(r===undefined)return undefined; const act=action(db,text(r,"action_id")); const request=validateActionBytes(db,ch,act);
  if(!envelope.ok)throw new Error(`C3 RPC ${request.id} failed: ${envelope.error.code}`);
  if(at<time(act,"created_at"))throw new Error("C3 RPC confirmation precedes intent");
  const cursorRow=one(db,"SELECT cursor FROM inbox_receipts WHERE receipt_id=?",text(act,"receipt_id")); if(cursorRow===undefined)throw new Error("C3 RPC receipt missing"); const cursor=integer(cursorRow,"cursor");
  const kind=text(act,"action_kind");
  const payload=kind==="ACK"?object(envelope.payload):kind==="FRESHNESS_READ"?parseMagicChatMessagesListPayload(envelope.payload):parseMagicChatMessageSendPayload(envelope.payload);
  if(act["confirmation_json"]!==null){equal(json(payload),act["confirmation_json"],"confirmation replay");if(at<time(act,"confirmed_at"))throw new Error("C3 replay chronology invalid");return cursor;}
  if(kind==="ACK"){equal(payload,{cursor},"ACK confirmation");const s=one(db,"SELECT * FROM magicchat_inbox_states WHERE receipt_id=?",text(act,"receipt_id"));if(s?.["ack_state"]!=="ACK_INTENT" || s["business_stable"]!==1)throw new Error("C3 premature ACK confirmation");confirmStoredAction(db,ch,act,payload,null,at);db.prepare("UPDATE magicchat_inbox_states SET ack_state='ACK_CONFIRMED',ack_confirmed_at=? WHERE receipt_id=?").run(at,text(act,"receipt_id"));return cursor;}
  if(kind==="FRESHNESS_READ"){
    const f=one(db,"SELECT * FROM publication_freshness WHERE read_action_id=?",text(act,"action_id"));if(f===undefined)throw new Error("C3 freshness missing");
    const history=parseMagicChatMessagesListPayload(payload);const newest=history.messages.at(-1); let previous=0;const messageIds=new Set<string>();
    let valid=history.limit===100 && history.messages.length<=100;
    for(const message of history.messages){if(message.seq<=previous || message.seq>Number.MAX_SAFE_INTEGER || messageIds.has(message.id) || message.created_at>at)valid=false; previous=message.seq;messageIds.add(message.id);}
    valid=valid && newest!==undefined && newest.id===ch["choice_message_id"] && newest.seq===ch["choice_message_sequence"] && newest.sender.id===appId && newest.sender.type==="app" && json(newest.body)===json(object(approvalRequest(ch).payload)["message"]) && currentBinding(db,ch,"FRESHNESS_CHECK",integer(f,"workflow_revision"),at) && observedSequence(db,ch)===integer(f,"source_message_sequence") && observedSequence(db,ch)<=integer(f,"trigger_message_sequence");
    const claim=one(db,"SELECT * FROM response_claims WHERE response_claim_id=?",text(f,"response_claim_id"));
    valid=valid && claim!==undefined && claim["claim_version"]===f["claim_version"] && claim["claim_version"]===1 && claim["owner_id"]==="COORDINATOR" && claim["state"]==="CLAIMED" && claim["approval_id"]===f["approval_id"] && claim["artifact_id"]===ch["artifact_id"] && claim["artifact_digest"]===ch["artifact_digest"] && claim["expires_at"]===f["expires_at"] && at<=time(claim,"expires_at") && at<=time(f,"expires_at");
    confirmStoredAction(db,ch,act,payload,null,at);
    if(!valid){hold(db,ch,"FRESHNESS_MISMATCH",at);db.prepare("UPDATE publication_freshness SET confirmed_at=? WHERE freshness_id=?").run(at,text(f,"freshness_id"));return cursor;}
    const token={snapshotDigest:text(f,"snapshot_digest"),claimId:text(f,"response_claim_id"),claimVersion:integer(f,"claim_version"),triggerMessageId:text(f,"trigger_message_id"),triggerMessageSequence:integer(f,"trigger_message_sequence"),readActionId:text(f,"read_action_id"),confirmationDigest:digest(payload),confirmedAt:at};
    db.prepare("UPDATE publication_freshness SET state='VALID',token_json=?,token_digest=?,confirmed_at=? WHERE freshness_id=? AND state='PENDING'").run(json(token),digest(token),at,text(f,"freshness_id"));
    db.prepare("UPDATE response_claims SET freshness_token_digest=? WHERE response_claim_id=? AND state='CLAIMED'").run(digest(token),text(f,"response_claim_id"));
    if(db.prepare("UPDATE workflow_runs SET state='PUBLISH',revision=revision+1 WHERE workflow_run_id=? AND state='FRESHNESS_CHECK' AND revision=?").run(text(ch,"workflow_run_id"),integer(f,"workflow_revision")).changes!==1)throw new Error("C3 freshness Workflow CAS failed");
    intent(db,ch,"PUBLICATION",publicationRequest(db,ch),at,text(act,"receipt_id"));
    db.prepare("UPDATE magicchat_inbox_states SET business_outcome='PUBLICATION_PENDING' WHERE receipt_id=?").run(text(act,"receipt_id"));return cursor;
  }
  const sent=parseMagicChatMessageSendPayload(payload);
  if(request.method!=="message.send")throw new Error("C3 confirmation method mismatch");
  const expectedBody=normalizeMagicChatMessageBodyForSend(request.payload.message);
  if(sent.conversation.id!==ch["expected_conversation_id"] || sent.message.sender.id!==appId || sent.message.sender.type!=="app" || json(sent.message.body)!==json(expectedBody) || sent.message.created_at>at || sent.message.created_at<time(act,"created_at") || sent.message.seq<=integer(ch,"source_message_sequence"))throw new Error("C3 message confirmation binding mismatch");
  if(kind==="PUBLICATION" && (act["dispatched_at"]===null || act["state"]!=="UNKNOWN" || sent.message.created_at<time(act,"dispatched_at") || at<time(act,"dispatched_at")))throw new Error("C3 publication confirmation precedes its first authorized dispatch");
  if(kind==="APPROVAL_REQUEST" && ch["state"]!=="REQUEST_PENDING")throw new Error("C3 approval request state conflict");
  confirmStoredAction(db,ch,act,payload,sent.message.id,at);
  const messageRecordId=deriveMagicChatMessageRecordId({actionId:parsePendingActionId(text(act,"action_id")),messageId:sent.message.id});
  db.prepare(`INSERT INTO magicchat_messages(message_record_id,schema_version,case_id,workflow_run_id,receipt_id,action_id,challenge_id,approval_challenge_id,purpose,conversation_id,message_id,message_sequence,confirmed_at) VALUES(?,'accord.magicchat-message/v1',?,?,?,?,NULL,?,?,?,?,?,?)`).run(messageRecordId,text(ch,"case_id"),text(ch,"workflow_run_id"),text(act,"receipt_id"),text(act,"action_id"),text(ch,"challenge_id"),kind,text(ch,"expected_conversation_id"),sent.message.id,sent.message.seq,at);
  if(kind==="APPROVAL_REQUEST"){db.prepare("UPDATE approval_challenges SET state='WAIT_FOR_APPROVAL',choice_message_id=?,choice_message_sequence=?,ready_at=? WHERE challenge_id=? AND state='REQUEST_PENDING'").run(sent.message.id,sent.message.seq,at,text(ch,"challenge_id"));return cursor;}
  if(sent.message.seq<=integer(ch,"choice_message_sequence"))throw new Error("C3 final message must follow approval card");
  db.prepare("UPDATE approval_challenges SET state='COMPLETE' WHERE challenge_id=?").run(text(ch,"challenge_id"));
  db.prepare("UPDATE response_claims SET state='CONFIRMED' WHERE case_id=?").run(text(ch,"case_id"));
  db.prepare("UPDATE publication_freshness SET state='CONSUMED',consumed_at=?,invalidated_at=NULL WHERE case_id=?").run(at,text(ch,"case_id"));
  db.prepare("UPDATE workflow_runs SET state='COMPLETE',revision=revision+1 WHERE workflow_run_id=? AND state IN ('PUBLISH','PUBLICATION_HOLD')").run(text(ch,"workflow_run_id"));
  db.prepare("UPDATE cases SET status='COMPLETE' WHERE case_id=? AND status='OPEN'").run(text(ch,"case_id"));
  stable(db,ch,text(act,"receipt_id"),"COMPLETE",at);return cursor;
}

/** Descriptions are not send authorization. The authority caller commits this gate immediately before the synchronous callback. */
export function authorizeApprovalDispatch(db: DatabaseSync, appId: string, requestId: string, at: string): Readonly<{handled:boolean;request?:MagicChatRequestEnvelope}> {
  // The public timestamp can advance a synthetic clock, never rewind the real transport gate.
  const wallTime=new Date().toISOString();if(wallTime>at)at=wallTime;
  const ch=ingressContext(db,appId);if(ch===undefined)return {handled:false};
  const r=one(db,"SELECT p.action_id FROM pending_side_effects p JOIN magicchat_rpc_actions r ON r.action_id=p.action_id LEFT JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.case_id=? AND r.request_envelope_id=? AND (p.action_kind IN ('APPROVAL_REQUEST','FRESHNESS_READ','PUBLICATION') OR s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT'))",text(ch,"case_id"),requestId);if(r===undefined)return {handled:false};
  const act=action(db,text(r,"action_id")); const request=validateActionBytes(db,ch,act);
  if(act["state"]==="CONFIRMED" || act["state"]==="FAILED")return {handled:true};
  if(at<time(act,"created_at"))throw new Error("C3 dispatch precedes intent");
  if(act["action_kind"]==="PUBLICATION"){
    if(request.method!=="message.send")throw new Error("C3 publication method invalid");
    try { normalizeMagicChatMessageBodyForSend(request.payload.message); } catch { hold(db,ch,"FINAL_LOCAL_FRESHNESS_MISMATCH",at);return {handled:true}; }
    const f=one(db,"SELECT * FROM publication_freshness WHERE case_id=?",text(ch,"case_id"));
    if(f===undefined || !freshnessGate(db,ch,f,at)){hold(db,ch,"FINAL_LOCAL_FRESHNESS_MISMATCH",at);return {handled:true};}
    if(db.prepare("UPDATE workflow_runs SET revision=revision WHERE workflow_run_id=? AND state='PUBLISH' AND revision=?").run(text(ch,"workflow_run_id"),integer(f,"workflow_revision")+1).changes!==1)throw new Error("C3 final local Workflow CAS failed");
    if(act["dispatched_at"]===null){db.prepare("UPDATE magicchat_rpc_actions SET dispatched_at=? WHERE action_id=? AND dispatched_at IS NULL").run(at,text(act,"action_id"));audit(db,ch,"PUBLICATION_DISPATCHED",text(act,"action_id"),{actionId:text(act,"action_id"),tokenDigest:text(f,"token_digest"),workflowRevision:integer(f,"workflow_revision")+1,observedSequence:observedSequence(db,ch)},at,text(act,"receipt_id"));}
    db.prepare("UPDATE pending_side_effects SET state='UNKNOWN' WHERE action_id=? AND state IN ('PENDING','UNKNOWN')").run(text(act,"action_id"));
  } else if(act["action_kind"]==="APPROVAL_REQUEST" || act["action_kind"]==="FRESHNESS_READ"){
    if(ch["state"]==="PUBLICATION_HOLD" || at>time(ch,"expires_at")){hold(db,ch,"EXPIRED_DISPATCH",at);return {handled:true};}
  } else {
    const s=one(db,"SELECT * FROM magicchat_inbox_states WHERE receipt_id=?",text(act,"receipt_id"));
    if(s?.["ack_state"]!=="ACK_INTENT" || s["business_stable"]!==1)throw new Error("C3 ACK dispatch without stable business");
    if(one(db,"SELECT cursor FROM magicchat_inbox_states WHERE app_id=? AND cursor<? AND ack_state<>'ACK_CONFIRMED'",appId,integer(s,"cursor"))!==undefined)throw new Error("C3 cumulative ACK dispatch blocked");
  }
  return {handled:true,request};
}

export function holdInvalidApprovalDispatch(db: DatabaseSync, appId: string, requestId: string, at: string): boolean {
  const ch=challenge(db,appId);if(ch===undefined)return false;
  const p=one(db,"SELECT p.state FROM pending_side_effects p JOIN magicchat_rpc_actions r ON r.action_id=p.action_id WHERE p.case_id=? AND p.action_kind='PUBLICATION' AND r.request_envelope_id=?",text(ch,"case_id"),requestId);
  if(p===undefined)return false;
  if(p["state"]!=="CONFIRMED")hold(db,ch,"FINAL_LOCAL_FRESHNESS_MISMATCH",at);
  return true;
}

/** Rejected delivery evidence survives the rolled-back decision transaction. */
export function recordRejectedApprovalEvent(db: DatabaseSync, appId: string, event: NormalizedMagicChatChoiceResponseCreated, at: string, reason: string): void {
  const ch=challenge(db,appId);if(ch===undefined)return;
  if(at<time(ch,"created_at"))return;
  const key=event.envelopeEventId;const auditId=id("audit","CHOICE_REFUSED",key);const details={envelopeEventId:key,payload:receiptPayload(event),payloadDigest:digest(receiptPayload(event)),reason};
  const prior=one(db,"SELECT details_json FROM audit_events WHERE audit_event_id=?",auditId);
  if(prior!==undefined){equal(prior["details_json"],json(details),"rejected delivery");return;}
  audit(db,ch,"CHOICE_REFUSED",key,details,at);
}

export function projectApprovalProtocol(db: DatabaseSync, base: MagicChatProtocolSnapshot, cursor: number): MagicChatProtocolSnapshot | undefined {
  const r=one(db,"SELECT * FROM magicchat_inbox_states WHERE app_id=? AND cursor=?",base.appId,cursor);if(r===undefined)return undefined;
  const projection=inspectApprovalPublication(db,base.caseId);
  const isC3=r["event_role"]==="APPROVAL_RESPONSE" || r["event_role"]==="OBSERVED_INPUT";
  let phase:MagicChatProtocolSnapshot["phase"]=isC3?text(r,"business_outcome") as MagicChatProtocolSnapshot["phase"]:base.phase;
  if(!isC3 && projection!==undefined){phase=projection.state==="REQUEST_PENDING"?"APPROVAL_PENDING":projection.state==="APPROVED"?(projection.publication===undefined?"FRESHNESS_PENDING":"PUBLICATION_PENDING"):projection.state;}
  const w=one(db,"SELECT state,revision FROM workflow_runs WHERE workflow_run_id=?",base.workflowRunId);const b=one(db,"SELECT revision FROM boards WHERE board_id=?",base.boardId);
  if(w===undefined || b===undefined)throw new Error("C3 projection authority missing");
  return Object.freeze({...base,cursor,receiptId:parseInboxReceiptId(r["receipt_id"]),phase,ackState:text(r,"ack_state") as MagicChatProtocolSnapshot["ackState"],workflowState:text(w,"state") as MagicChatProtocolSnapshot["workflowState"],workflowRevision:integer(w,"revision"),boardRevision:integer(b,"revision"),...(projection===undefined?{}:{approval:projection})});
}
export function pendingApprovalRequests(db: DatabaseSync, appId: string): readonly MagicChatPendingRequest[] {
  const ch=ingressContext(db,appId);if(ch===undefined)return [];
  const candidates=rows(db,`SELECT p.action_id,r.cursor FROM pending_side_effects p JOIN inbox_receipts r ON r.receipt_id=p.receipt_id LEFT JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.case_id=? AND p.state IN ('PENDING','UNKNOWN') AND (p.action_kind IN ('APPROVAL_REQUEST','FRESHNESS_READ','PUBLICATION') OR s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT')) ORDER BY r.cursor,p.created_at,p.action_id`,text(ch,"case_id"));
  return Object.freeze(candidates.flatMap((r)=>{const act=action(db,text(r,"action_id"));if(ch["state"]==="PUBLICATION_HOLD" && act["action_kind"]!=="ACK")return [];const request=validateActionBytes(db,ch,act);return [Object.freeze({cursor:integer(r,"cursor"),request})];}));
}
/** The immutable migration snapshot is the only permission to materialize an old H2 request. */
export function recoverLegacyApprovalRequests(db: DatabaseSync): void {
  const provenance=one(db,"SELECT snapshot_json FROM approval_legacy_provenance WHERE provenance_id='approval_legacy_provenance_v1'");
  if(provenance===undefined)throw new Error("C3 legacy provenance missing");
  const snapshots:unknown=JSON.parse(text(provenance,"snapshot_json"));if(!Array.isArray(snapshots))throw new Error("C3 legacy provenance invalid");
  const migration=one(db,"SELECT applied_at FROM accord_schema_migrations WHERE version=11");if(migration===undefined)throw new Error("C3 recovery migration missing");const at=time(migration,"applied_at");
  for(const value of snapshots){const legacy=object(value);const a=one(db,"SELECT * FROM artifacts WHERE artifact_id=? AND artifact_revision=1",text(legacy,"artifactId"));if(a===undefined)throw new Error("C3 legacy Artifact missing");equal(legacy,{artifactId:text(a,"artifact_id"),artifactRevision:1,artifactDigest:text(a,"artifact_digest"),sourceResultId:text(a,"source_result_id"),createdAt:time(a,"created_at")},"legacy Artifact provenance");if(one(db,"SELECT challenge_id FROM approval_challenges WHERE case_id=?",text(a,"case_id"))===undefined)ensureApprovalRequest(db,text(a,"case_id"),at,"LEGACY_RECOVERY");}
}

/** Reconstruct every C3 fact from its owner, not from a count or a caller projection. */
export function validateApprovalPublication(db: DatabaseSync): void {
  const seenAudits=new Set<string>();const seenActions=new Set<string>();const seenMessages=new Set<string>();const seenApprovals=new Set<string>();const seenClaims=new Set<string>();const seenFreshness=new Set<string>();
  const provenance=one(db,"SELECT * FROM approval_legacy_provenance WHERE provenance_id='approval_legacy_provenance_v1'");if(provenance===undefined || provenance["migration_id"]!=="011_r003_approval_publication" || rows(db,"SELECT provenance_id FROM approval_legacy_provenance").length!==1)throw new Error("C3 migration provenance invalid");
  const legacyValues:unknown=JSON.parse(text(provenance,"snapshot_json"));if(!Array.isArray(legacyValues))throw new Error("C3 migration provenance malformed");
  const legacy=new Map<string,Row>();let previousArtifact="";
  for(const value of legacyValues){const item=object(value);const artifactId=text(item,"artifactId");if(artifactId<=previousArtifact)throw new Error("C3 provenance order invalid");previousArtifact=artifactId;const a=one(db,"SELECT * FROM artifacts WHERE artifact_id=? AND artifact_revision=1",artifactId);if(a===undefined)throw new Error("C3 provenance orphan");equal(item,{artifactId,artifactRevision:1,artifactDigest:text(a,"artifact_digest"),sourceResultId:text(a,"source_result_id"),createdAt:time(a,"created_at")},"legacy provenance");legacy.set(artifactId,item);}
  const migration=one(db,"SELECT applied_at FROM accord_schema_migrations WHERE version=11");if(migration===undefined)throw new Error("C3 migration missing");
  const checkAudit=(ch:Row,kind:string,key:string,details:Row,at:string,receipt:string|null=null):void=>{
    const auditId=id("audit",kind,key); const row=one(db,"SELECT * FROM audit_events WHERE audit_event_id=?",auditId);
    if(row===undefined || row["schema_version"]!=="accord.audit-event/v1" || row["correlation_id"]!==id("corr","case",text(ch,"case_id")) || row["event_kind"]!==`C3:${kind}:${key}` || row["case_id"]!==ch["case_id"] || row["board_id"]!==ch["board_id"] || row["workflow_run_id"]!==ch["workflow_run_id"] || row["receipt_id"]!==receipt || row["recorded_at"]!==at || row["details_json"]!==json(details))throw new Error(`C3 ${kind} audit missing or corrupt`);
    seenAudits.add(auditId);
  };
  for(const refused of rows(db,"SELECT * FROM audit_events WHERE event_kind LIKE 'C3:CHOICE_REFUSED:%'")){
    const ch=one(db,"SELECT * FROM approval_challenges WHERE case_id=?",text(refused,"case_id"));if(ch===undefined)throw new Error("C3 rejected delivery audit orphan");
    const details=decoded(refused,"details_json");const payload=object(details["payload"]);const eventId=text(details,"envelopeEventId");
    if(Object.keys(details).length!==4 || details["payloadDigest"]!==digest(payload) || payload["kind"]!=="CHOICE_RESPONSE_CREATED" || payload["contractVersion"]!==MAGICCHAT_APP_WEBSOCKET_CONTRACT || payload["sourceCommit"]!==MAGICCHAT_SOURCE_COMMIT || text(details,"reason").length>4096 || !Number.isSafeInteger(payload["cursor"]) || time(refused,"recorded_at")<time(ch,"created_at"))throw new Error("C3 rejected choice audit corrupt");
    time(payload,"responseCreatedAt");time(payload,"messageCreatedAt");
    checkAudit(ch,"CHOICE_REFUSED",eventId,details,time(refused,"recorded_at"));
  }
  for(const a0 of rows(db,"SELECT case_id FROM artifacts ORDER BY artifact_id")){
    const a=authority(db,text(a0,"case_id"));const ch=one(db,"SELECT * FROM approval_challenges WHERE case_id=?",text(a,"case_id"));if(ch===undefined)throw new Error("C3 required Writer approval request missing");
    const bind=binding(a);const bindDigest=digest(bind);const challengeId=id("challenge","approval",bindDigest);const expiry=new Date(Date.parse(time(ch,"created_at"))+TTL).toISOString();
    const invocation=one(db,"SELECT workflow_revision FROM runtime_invocations WHERE invocation_id=?",text(a,"source_invocation_id"));if(invocation===undefined)throw new Error("C3 Writer invocation missing");
    if(ch["schema_version"]!=="accord.approval-challenge/v1" || ch["challenge_id"]!==challengeId || ch["binding_json"]!==json(bind) || ch["binding_digest"]!==bindDigest || ch["artifact_id"]!==a["artifact_id"] || ch["artifact_revision"]!==1 || ch["artifact_digest"]!==a["artifact_digest"] || ch["case_id"]!==a["case_id"] || ch["board_id"]!==a["board_id"] || ch["workflow_run_id"]!==a["workflow_run_id"] || ch["challenge_version"]!==1 || ch["expected_app_id"]!==a["source_app_id"] || ch["expected_conversation_id"]!==a["source_conversation_id"] || ch["expected_actor_id"]!==a["source_actor_id"] || ch["expected_board_revision"]!==a["created_board_revision"] || ch["expected_workflow_revision"]!==integer(invocation,"workflow_revision")+1 || ch["source_receipt_id"]!==a["source_receipt_id"] || ch["source_cursor"]!==a["source_cursor"] || ch["source_message_sequence"]!==a["source_message_sequence"] || ch["options_json"]!=='["approve","reject"]' || ch["expires_at"]!==expiry)throw new Error("C3 challenge authority binding corrupt");
    const origin=legacy.has(text(a,"artifact_id"))?"LEGACY_RECOVERY":"WRITER_WINNER";const createdAt=origin==="LEGACY_RECOVERY"?time(migration,"applied_at"):time(a,"created_at");if(ch["created_at"]!==createdAt || createdAt<time(a,"created_at"))throw new Error("C3 request provenance chronology invalid");
    checkAudit(ch,origin==="WRITER_WINNER"?"APPROVAL_REQUEST_CREATED":"APPROVAL_REQUEST_RECOVERED",challengeId,{challengeId,binding:bind,origin,sourceResultId:text(a,"source_result_id"),artifactCreatedAt:time(a,"created_at"),expiresAt:expiry},createdAt);
    const decision=one(db,"SELECT * FROM approvals WHERE challenge_id=?",challengeId);const claim=one(db,"SELECT * FROM response_claims WHERE case_id=?",text(ch,"case_id"));const f=one(db,"SELECT * FROM publication_freshness WHERE case_id=?",text(ch,"case_id"));
    if(decision===undefined){if(ch["resolved_at"]!==null || ch["resolved_by_receipt_id"]!==null || !["REQUEST_PENDING","WAIT_FOR_APPROVAL","PUBLICATION_HOLD"].includes(text(ch,"state")) || claim!==undefined || f!==undefined)throw new Error("C3 undecided challenge contains publication authority");}
    else {
      const receipt=one(db,"SELECT r.*,s.event_payload_json FROM inbox_receipts r JOIN magicchat_inbox_states s ON s.receipt_id=r.receipt_id WHERE r.receipt_id=?",text(decision,"receipt_id"));if(receipt===undefined)throw new Error("C3 decision receipt missing");const event=decoded(receipt,"event_payload_json");
      const decidedAt=time(decision,"decided_at");const state=text(decision,"state");const h3={challengeId,...bind,decision:state,actorId:text(ch,"expected_actor_id"),responseId:text(event,"responseId"),receiptId:text(receipt,"receipt_id"),requestActionId:text(ch,"approval_action_id"),choiceMessageId:text(ch,"choice_message_id"),decidedAt};
      const approvalId=id("approval","H3",digest(h3));
      const cardCreatedAt=parseMagicChatMessageSendPayload(decoded(action(db,text(ch,"approval_action_id")),"confirmation_json")).message.created_at;
      if(decision["schema_version"]!=="accord.approval/v1" || decision["approval_id"]!==approvalId || decision["decision_json"]!==json(h3) || decision["decision_digest"]!==digest(h3) || decision["artifact_id"]!==ch["artifact_id"] || decision["artifact_revision"]!==1 || decision["artifact_digest"]!==ch["artifact_digest"] || decision["case_id"]!==ch["case_id"] || decision["workflow_run_id"]!==ch["workflow_run_id"] || decision["request_action_id"]!==ch["approval_action_id"] || decision["expected_actor_id"]!==ch["expected_actor_id"] || decision["choice_message_id"]!==ch["choice_message_id"] || decision["response_id"]!==event["responseId"] || decision["created_at"]!==decidedAt || time(receipt,"received_at")>decidedAt || ch["resolved_at"]!==decidedAt || ch["resolved_by_receipt_id"]!==decision["receipt_id"] || event["kind"]!=="CHOICE_RESPONSE_CREATED" || event["actorId"]!==ch["expected_actor_id"] || event["conversationId"]!==ch["expected_conversation_id"] || event["messageId"]!==ch["choice_message_id"] || event["messageSequence"]!==ch["choice_message_sequence"] || json(event["optionIds"])!==json([state==="APPROVED"?"approve":"reject"]) || json(event["choiceBody"])!==json(object(approvalRequest(ch).payload)["message"]) || time(event,"messageCreatedAt")!==cardCreatedAt || time(event,"responseCreatedAt")<cardCreatedAt || decidedAt>expiry || decidedAt<time(ch,"ready_at") || !["APPROVED","REJECTED"].includes(state))throw new Error("C3 immutable H3 decision corrupt");
      for(const lower of rows(db,"SELECT * FROM magicchat_inbox_states WHERE app_id=? AND cursor<?",text(ch,"expected_app_id"),integer(receipt,"cursor")))if(lower["ack_state"]!=="ACK_CONFIRMED" || time(lower,"ack_confirmed_at")>decidedAt)throw new Error("C3 H3 overtook incomplete lower cursor");
      seenApprovals.add(approvalId);checkAudit(ch,"DECISION",approvalId,{approvalId,h3},decidedAt,text(decision,"receipt_id"));
      if(state==="REJECTED"){if(ch["state"]!=="REJECTED" || a["workflow_state"]!=="REJECTED" || a["case_status"]!=="REJECTED" || claim!==undefined || f!==undefined)throw new Error("C3 rejection contains publication authority");}
      else {
        if(claim===undefined || f===undefined)throw new Error("C3 approved decision missing claim/read");const claimId=id("response_claim","FINAL_RESPONSE",text(ch,"case_id"));const wfRevision=integer(ch,"expected_workflow_revision")+1;
        if(claim["response_claim_id"]!==claimId || claim["schema_version"]!=="accord.response-claim/v1" || claim["case_id"]!==ch["case_id"] || claim["workflow_run_id"]!==ch["workflow_run_id"] || claim["approval_id"]!==approvalId || claim["publication_slot"]!=="FINAL_RESPONSE" || claim["claim_version"]!==1 || claim["owner_id"]!=="COORDINATOR" || claim["artifact_id"]!==ch["artifact_id"] || claim["artifact_revision"]!==1 || claim["artifact_digest"]!==ch["artifact_digest"] || claim["board_revision"]!==ch["expected_board_revision"] || claim["workflow_revision"]!==wfRevision || claim["created_at"]!==decidedAt || claim["expires_at"]!==expiry)throw new Error("C3 claim identity/binding corrupt");
        seenClaims.add(claimId);checkAudit(ch,"CLAIM_ACQUIRED",claimId,{claimId,ownerId:"COORDINATOR",claimVersion:1,approvalId,boardRevision:integer(ch,"expected_board_revision"),workflowRevision:wfRevision,expiresAt:expiry},decidedAt,text(decision,"receipt_id"));
        const observedCursor=integer(decoded(f,"snapshot_json"),"observedCursor");
        if(observedCursor<integer(receipt,"cursor") || one(db,"SELECT receipt_id FROM inbox_receipts WHERE app_id=? AND cursor=? AND received_at<=?",text(ch,"expected_app_id"),observedCursor,decidedAt)===undefined)throw new Error("C3 freshness observed cursor invalid");
        const newestAtClaim=one(db,"SELECT max(source_message_sequence) AS newest FROM inbox_receipts WHERE app_id=? AND source_conversation_id=? AND event_type='message.created' AND cursor<=?",text(ch,"expected_app_id"),text(ch,"expected_conversation_id"),observedCursor);
        const sourceSequence=newestAtClaim?.["newest"]===null || newestAtClaim===undefined?0:integer(newestAtClaim,"newest");
        const snapshot={...bind,approvalId,claimId,claimVersion:1,boardId:text(ch,"board_id"),boardRevision:integer(ch,"expected_board_revision"),workflowRevision:wfRevision,observedCursor,sourceMessageSequence:sourceSequence,triggerMessageId:text(ch,"choice_message_id"),triggerMessageSequence:integer(ch,"choice_message_sequence"),expiresAt:expiry,beforeOrEqualSequence:Number.MAX_SAFE_INTEGER,limit:100};
        const snapshotHash=digest(snapshot);const freshnessId=id("freshness","snapshot",snapshotHash);
        if(f["freshness_id"]!==freshnessId || f["schema_version"]!=="accord.publication-freshness/v1" || f["case_id"]!==ch["case_id"] || f["workflow_run_id"]!==ch["workflow_run_id"] || f["board_id"]!==ch["board_id"] || f["artifact_id"]!==ch["artifact_id"] || f["artifact_revision"]!==1 || f["artifact_digest"]!==ch["artifact_digest"] || f["approval_id"]!==approvalId || f["response_claim_id"]!==claimId || f["claim_version"]!==1 || f["app_id"]!==ch["expected_app_id"] || f["conversation_id"]!==ch["expected_conversation_id"] || f["source_message_sequence"]!==sourceSequence || f["trigger_message_id"]!==ch["choice_message_id"] || f["trigger_message_sequence"]!==ch["choice_message_sequence"] || f["board_revision"]!==ch["expected_board_revision"] || f["workflow_revision"]!==wfRevision || f["snapshot_json"]!==json(snapshot) || f["snapshot_digest"]!==snapshotHash || f["created_at"]!==decidedAt || f["expires_at"]!==expiry)throw new Error("C3 freshness snapshot identity/binding corrupt");
        seenFreshness.add(freshnessId);
        const read=action(db,text(f,"read_action_id"));if(read["created_at"]!==decidedAt || read["receipt_id"]!==decision["receipt_id"])throw new Error("C3 read chronology/correlation corrupt");
        if(f["confirmed_at"]!==read["confirmed_at"])throw new Error("C3 freshness confirmation chronology corrupt");
        if(f["token_json"]!==null){const token={snapshotDigest:snapshotHash,claimId,claimVersion:1,triggerMessageId:text(ch,"choice_message_id"),triggerMessageSequence:integer(ch,"choice_message_sequence"),readActionId:text(f,"read_action_id"),confirmationDigest:digest(decoded(read,"confirmation_json")),confirmedAt:time(f,"confirmed_at")};if(f["token_json"]!==json(token) || f["token_digest"]!==digest(token) || claim["freshness_token_digest"]!==digest(token))throw new Error("C3 freshness token corrupt");const history=parseMagicChatMessagesListPayload(decoded(read,"confirmation_json"));const newest=history.messages.at(-1);if(newest===undefined || newest.id!==ch["choice_message_id"] || newest.seq!==ch["choice_message_sequence"] || newest.sender.id!==ch["expected_app_id"] || json(newest.body)!==json(object(approvalRequest(ch).payload)["message"]) || time(f,"confirmed_at")>expiry)throw new Error("C3 token not backed by exact freshness confirmation");}
        else if(f["token_digest"]!==null || claim["freshness_token_digest"]!==null || (f["state"]!=="PENDING" && f["state"]!=="INVALID"))throw new Error("C3 premature freshness token");
      }
    }
    for(const p of rows(db,`SELECT p.action_id FROM pending_side_effects p LEFT JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.case_id=? AND (p.action_kind IN ('APPROVAL_REQUEST','FRESHNESS_READ','PUBLICATION') OR s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT'))`,text(ch,"case_id"))){
      const act=action(db,text(p,"action_id"));const request=validateActionBytes(db,ch,act);const actionId=text(act,"action_id");const kind=text(act,"action_kind");const at=time(act,"created_at");const receiptId=text(act,"receipt_id");seenActions.add(actionId);
      checkAudit(ch,`${kind}_INTENT`,actionId,{actionId,request,requestDigest:digest(request)},at,receiptId);
      if(kind==="APPROVAL_REQUEST" && (actionId!==ch["approval_action_id"] || at!==createdAt || receiptId!==ch["source_receipt_id"]))throw new Error("C3 approval intent chronology corrupt");
      if(kind==="PUBLICATION" && (decision?.["state"]!=="APPROVED" || f===undefined || f["token_json"]===null || at!==f["confirmed_at"] || receiptId!==decision["receipt_id"]))throw new Error("C3 publication without fresh decision");
      if(act["confirmation_json"]===null){if(act["state"]==="CONFIRMED" || act["confirmed_at"]!==null || act["confirmed_external_id"]!==null)throw new Error("C3 fabricated action confirmation");}
      else {
        if(act["state"]!=="CONFIRMED" || time(act,"confirmed_at")<at)throw new Error("C3 action confirmation chronology invalid");
        const payload=decoded(act,"confirmation_json");const confirmedAt=time(act,"confirmed_at");checkAudit(ch,`${kind}_CONFIRMED`,actionId,{actionId,confirmation:payload},confirmedAt,receiptId);
        if(kind==="ACK"){const receipt=one(db,"SELECT * FROM magicchat_inbox_states WHERE receipt_id=?",receiptId);if(receipt===undefined || receipt["ack_state"]!=="ACK_CONFIRMED" || receipt["ack_confirmed_at"]!==confirmedAt)throw new Error("C3 ACK confirmation state invalid");equal(payload,{cursor:integer(receipt,"cursor")},"ACK");}
        else if(kind==="FRESHNESS_READ"){const history=parseMagicChatMessagesListPayload(payload);let previous=0;const ids=new Set<string>();let valid=history.limit===100 && history.messages.length<=100;for(const message of history.messages){if(message.seq<=previous || ids.has(message.id) || message.created_at>confirmedAt)valid=false;previous=message.seq;ids.add(message.id);}if((!valid && f?.["state"]!=="INVALID") || act["confirmed_external_id"]!==null)throw new Error("C3 read ordering/identity invalid");}
        else {
          const sent=parseMagicChatMessageSendPayload(payload);if(request.method!=="message.send")throw new Error("C3 message method invalid");const body=normalizeMagicChatMessageBodyForSend(request.payload.message);
          if(sent.conversation.id!==ch["expected_conversation_id"] || sent.message.sender.id!==ch["expected_app_id"] || sent.message.sender.type!=="app" || json(sent.message.body)!==json(body) || sent.message.created_at>confirmedAt || sent.message.created_at<at || act["confirmed_external_id"]!==sent.message.id)throw new Error("C3 confirmed external message binding invalid");
          if(kind==="PUBLICATION" && (act["dispatched_at"]===null || sent.message.created_at<time(act,"dispatched_at") || confirmedAt<time(act,"dispatched_at")))throw new Error("C3 publication source or confirmation precedes first authorized dispatch");
          const msg=one(db,"SELECT * FROM magicchat_messages WHERE action_id=?",actionId);const msgId=deriveMagicChatMessageRecordId({actionId:parsePendingActionId(actionId),messageId:sent.message.id});
          if(msg===undefined || msg["message_record_id"]!==msgId || msg["schema_version"]!=="accord.magicchat-message/v1" || msg["case_id"]!==ch["case_id"] || msg["workflow_run_id"]!==ch["workflow_run_id"] || msg["receipt_id"]!==receiptId || msg["challenge_id"]!==null || msg["approval_challenge_id"]!==challengeId || msg["purpose"]!==kind || msg["conversation_id"]!==ch["expected_conversation_id"] || msg["message_id"]!==sent.message.id || msg["message_sequence"]!==sent.message.seq || msg["confirmed_at"]!==confirmedAt)throw new Error("C3 external message graph corrupt");seenMessages.add(msgId);
          if(kind==="APPROVAL_REQUEST" && (ch["choice_message_id"]!==sent.message.id || ch["choice_message_sequence"]!==sent.message.seq || ch["ready_at"]!==confirmedAt || ch["state"]==="REQUEST_PENDING"))throw new Error("C3 card confirmation corrupt");
          if(kind==="PUBLICATION" && (ch["state"]!=="COMPLETE" || claim?.["state"]!=="CONFIRMED" || f?.["state"]!=="CONSUMED" || f["consumed_at"]!==confirmedAt || a["workflow_state"]!=="COMPLETE" || a["case_status"]!=="COMPLETE"))throw new Error("C3 completion authority corrupt");
        }
      }
      if(act["dispatched_at"]!==null){if(kind!=="PUBLICATION" || f===undefined || time(act,"dispatched_at")<at || time(act,"dispatched_at")>expiry || !["UNKNOWN","CONFIRMED"].includes(text(act,"state")))throw new Error("C3 dispatch chronology/state corrupt");checkAudit(ch,"PUBLICATION_DISPATCHED",actionId,{actionId,tokenDigest:text(f,"token_digest"),workflowRevision:integer(f,"workflow_revision")+1,observedSequence:integer(f,"source_message_sequence")},time(act,"dispatched_at"),receiptId);}
      else if(kind==="PUBLICATION" && act["state"]!=="PENDING")throw new Error("C3 unissued publication state corrupt");
    }
    if(ch["choice_message_id"]===null){if(ch["choice_message_sequence"]!==null || ch["ready_at"]!==null || !["REQUEST_PENDING","PUBLICATION_HOLD"].includes(text(ch,"state")))throw new Error("C3 premature card state");}
    if(ch["state"]==="PUBLICATION_HOLD"){
      const auditId=id("audit","PUBLICATION_HOLD",challengeId);const h=one(db,"SELECT * FROM audit_events WHERE audit_event_id=?",auditId);if(h===undefined)throw new Error("C3 hold audit missing");const details=decoded(h,"details_json");
      if(!["FRESHNESS_MISMATCH","FINAL_LOCAL_FRESHNESS_MISMATCH","EXPIRED_DISPATCH","NEW_LOCAL_INPUT"].includes(text(details,"reason")) || typeof details["previousWorkflowState"]!=="string" || !Number.isSafeInteger(details["previousWorkflowRevision"]) || a["workflow_state"]!=="PUBLICATION_HOLD" || a["case_status"]!=="OPEN" || integer(a,"workflow_revision")!==integer(details,"previousWorkflowRevision")+1 || (claim!==undefined && claim["state"]!=="HELD") || (f!==undefined && (f["state"]!=="INVALID" || f["invalidated_at"]!==h["recorded_at"])))throw new Error("C3 hold authority corrupt");
      checkAudit(ch,"PUBLICATION_HOLD",challengeId,details,time(h,"recorded_at"));
    }else if(one(db,"SELECT audit_event_id FROM audit_events WHERE audit_event_id=?",id("audit","PUBLICATION_HOLD",challengeId))!==undefined){
      const h=one(db,"SELECT * FROM audit_events WHERE audit_event_id=?",id("audit","PUBLICATION_HOLD",challengeId));if(h===undefined || ch["state"]!=="COMPLETE")throw new Error("C3 obsolete hold state corrupt");checkAudit(ch,"PUBLICATION_HOLD",challengeId,decoded(h,"details_json"),time(h,"recorded_at"));
    }else if(ch["state"]==="REQUEST_PENDING" || ch["state"]==="WAIT_FOR_APPROVAL"){if(a["workflow_state"]!=="WAIT_FOR_APPROVAL" || a["workflow_revision"]!==ch["expected_workflow_revision"] || a["board_revision"]!==ch["expected_board_revision"] || a["case_status"]!=="OPEN")throw new Error("C3 pending authority corrupt");}
    else if(ch["state"]==="APPROVED"){if(claim?.["state"]!=="CLAIMED" || f===undefined || a["workflow_state"]!==(f["state"]==="PENDING"?"FRESHNESS_CHECK":"PUBLISH") || a["workflow_revision"]!==integer(f,"workflow_revision")+(f["state"]==="PENDING"?0:1) || a["board_revision"]!==ch["expected_board_revision"] || a["case_status"]!=="OPEN")throw new Error("C3 approved authority state corrupt");}
    validateC3Receipts(db,ch,checkAudit);
  }
  for(const c of rows(db,"SELECT DISTINCT s.case_id,s.app_id FROM magicchat_inbox_states s WHERE s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT') AND NOT EXISTS(SELECT 1 FROM artifacts a WHERE a.case_id=s.case_id)")){
    const ch=ingressContext(db,text(c,"app_id"));if(ch===undefined || ch["case_id"]!==c["case_id"])throw new Error("C3 observed receipt orphaned from resumed Case");
    validateC3Receipts(db,ch,checkAudit);
    for(const p of rows(db,"SELECT p.action_id FROM pending_side_effects p JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.case_id=? AND s.event_role='OBSERVED_INPUT'",text(c,"case_id"))){
      const act=action(db,text(p,"action_id"));const request=validateActionBytes(db,ch,act);const actionId=text(act,"action_id");const receiptId=text(act,"receipt_id");
      if(act["action_kind"]!=="ACK" || act["dispatched_at"]!==null)throw new Error("C3 pre-Artifact publication action invalid");seenActions.add(actionId);
      checkAudit(ch,"ACK_INTENT",actionId,{actionId,request,requestDigest:digest(request)},time(act,"created_at"),receiptId);
      if(act["confirmation_json"]!==null){const payload=decoded(act,"confirmation_json");if(request.method!=="events.ack")throw new Error("C3 ACK method invalid");equal(payload,request.payload,"ACK confirmation");if(act["state"]!=="CONFIRMED" || time(act,"confirmed_at")<time(act,"created_at") || act["confirmed_external_id"]!==null)throw new Error("C3 observed ACK confirmation invalid");checkAudit(ch,"ACK_CONFIRMED",actionId,{actionId,confirmation:payload},time(act,"confirmed_at"),receiptId);}
      else if(act["state"]!=="PENDING" || act["confirmed_at"]!==null || act["confirmed_external_id"]!==null)throw new Error("C3 observed ACK state invalid");
    }
  }
  if(rows(db,"SELECT * FROM approval_challenges").length!==rows(db,"SELECT * FROM artifacts").length)throw new Error("C3 orphaned challenge");
  for(const [table,key,seen,where] of [["approvals","approval_id",seenApprovals,"1"],["response_claims","response_claim_id",seenClaims,"1"],["publication_freshness","freshness_id",seenFreshness,"1"],["magicchat_messages","message_record_id",seenMessages,"purpose<>'CLARIFICATION'"]] as const)for(const r of rows(db,`SELECT ${key} FROM ${table} WHERE ${where}`))if(!seen.has(text(r,key)))throw new Error(`C3 orphaned ${table}`);
  for(const r of rows(db,"SELECT p.action_id FROM pending_side_effects p LEFT JOIN magicchat_inbox_states s ON s.receipt_id=p.receipt_id WHERE p.action_kind IN ('APPROVAL_REQUEST','FRESHNESS_READ','PUBLICATION') OR s.event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT')"))if(!seenActions.has(text(r,"action_id")))throw new Error("C3 orphaned pending action");
  for(const r of rows(db,"SELECT audit_event_id FROM audit_events WHERE event_kind LIKE 'C3:%'"))if(!seenAudits.has(text(r,"audit_event_id")))throw new Error("C3 orphaned audit");
}

function validateC3Receipts(db: DatabaseSync, ch: Row, checkAudit: (ch:Row,kind:string,key:string,details:Row,at:string,receipt?:string|null)=>void): void {
  for(const r of rows(db,"SELECT * FROM inbox_receipts WHERE case_id=? AND receipt_id IN (SELECT receipt_id FROM magicchat_inbox_states WHERE event_role IN ('APPROVAL_RESPONSE','OBSERVED_INPUT')) ORDER BY cursor",text(ch,"case_id"))){
    const receiptId=text(r,"receipt_id");const s=one(db,"SELECT * FROM magicchat_inbox_states WHERE receipt_id=?",receiptId);if(s===undefined)throw new Error("C3 receipt state missing");
    const payload=decoded(s,"event_payload_json");const isChoice=s["event_role"]==="APPROVAL_RESPONSE";const hash=digest(payload);const ids=deriveReceiptBusinessIds({appId:text(r,"app_id"),cursor:integer(r,"cursor"),payloadDigest:hash});const receivedAt=time(r,"received_at");
    const keys=["actorId","contractVersion","conversationId","cursor","kind","messageCreatedAt","messageId","messageSequence","sourceCommit",...(isChoice?["choiceBody","optionIds","responseCreatedAt","responseId"]:["body",...(payload["replyToMessageId"]===undefined?[]:["replyToMessageId"])])];equal(Object.keys(payload).sort(),keys.sort(),"receipt normalized fields");
    for(const key of ["actorId","conversationId","messageId",...(isChoice?["responseId"]:[])]){const value=text(payload,key);if(value.length>160 || /[\p{White_Space}\p{Cc}]/u.test(value))throw new Error("C3 source identity invalid");}
    if(integer(payload,"messageSequence")<1 || payload["contractVersion"]!==MAGICCHAT_APP_WEBSOCKET_CONTRACT || payload["sourceCommit"]!==MAGICCHAT_SOURCE_COMMIT || payload["kind"]!==(isChoice?"CHOICE_RESPONSE_CREATED":"MESSAGE_CREATED") || payload["cursor"]!==r["cursor"] || payload["conversationId"]!==r["source_conversation_id"] || payload["messageId"]!==r["source_message_id"] || payload["messageSequence"]!==r["source_message_sequence"] || payload["actorId"]!==r["source_actor_id"] || r["event_type"]!==(isChoice?"choice.response_created":"message.created") || r["source_response_id"]!==(isChoice?payload["responseId"]:null) || r["payload_digest"]!==hash || r["receipt_id"]!==ids.receiptId || r["schema_version"]!=="accord.inbox-receipt/v1" || r["board_id"]!==ch["board_id"] || r["workflow_run_id"]!==ch["workflow_run_id"] || r["app_id"]!==ch["expected_app_id"] || s["schema_version"]!=="accord.magicchat-inbox-state/v1" || s["app_id"]!==r["app_id"] || s["cursor"]!==r["cursor"] || s["case_id"]!==r["case_id"] || s["board_id"]!==r["board_id"] || s["workflow_run_id"]!==r["workflow_run_id"] || s["correlation_id"]!==ids.auditCorrelationId || s["created_at"]!==receivedAt || s["message_created_at"]!==payload["messageCreatedAt"] || s["event_payload_json"]!==json(payload) || s["normalized_body"]!==null || s["reply_to_message_id"]!==(isChoice?null:payload["replyToMessageId"]??null) || time(payload,"messageCreatedAt")>receivedAt)throw new Error("C3 reliable receipt identity/binding corrupt");
    if(isChoice){parseMagicChatChoiceBody(payload["choiceBody"]);if(!Array.isArray(payload["optionIds"]) || payload["optionIds"].length<1 || payload["optionIds"].some((v)=>typeof v!=="string" || v.length>64) || time(payload,"responseCreatedAt")>receivedAt || time(payload,"responseCreatedAt")<time(payload,"messageCreatedAt"))throw new Error("C3 choice payload invalid");}
    else if(typeof payload["body"]!=="string" || payload["body"].length===0 || payload["body"].length>4096)throw new Error("C3 observed input body invalid");
    const phase=text(s,"business_outcome");const approval=one(db,"SELECT * FROM approvals WHERE receipt_id=?",receiptId);
    const queued=one(db,"SELECT * FROM audit_events WHERE audit_event_id=?",id("audit","CHOICE_QUEUED",receiptId));
    if(isChoice && queued!==undefined)checkAudit(ch,"CHOICE_QUEUED",receiptId,{payload,payloadDigest:hash},receivedAt,receiptId);
    if(isChoice && r["processing_status"]==="RECEIVED" && queued===undefined)throw new Error("C3 queued choice lacks admission audit");
    if(isChoice && approval===undefined){if(r["processing_status"]==="RECEIVED"){if(phase!=="APPROVAL_PENDING")throw new Error("C3 queued choice state corrupt");}else {if(phase!=="INVALID_CHOICE")throw new Error("C3 choice without decision state");checkAudit(ch,"INVALID_CHOICE",receiptId,{payload,payloadDigest:hash},time(s,"stable_at"),receiptId);}}
    else if(!isChoice){if(phase!=="OBSERVED_INPUT")throw new Error("C3 observation outcome invalid");checkAudit(ch,"OBSERVED_INPUT",receiptId,{payload,payloadDigest:hash},receivedAt,receiptId);}
    else if(approval!==undefined){
      const expected=approval["state"]==="REJECTED"?"REJECTED":ch["state"]==="COMPLETE"?"COMPLETE":ch["state"]==="PUBLICATION_HOLD"?(s["business_stable"]===1?"PUBLICATION_HOLD":"PUBLICATION_PENDING"):one(db,"SELECT action_id FROM pending_side_effects WHERE case_id=? AND action_kind='PUBLICATION'",text(ch,"case_id"))===undefined?"FRESHNESS_PENDING":"PUBLICATION_PENDING";
      if(phase!==expected)throw new Error("C3 decision receipt outcome corrupt");
    }
    const deliveries=rows(db,"SELECT * FROM inbox_deliveries WHERE receipt_id=? ORDER BY received_at,delivery_id",receiptId);let first=0;
    for(const d of deliveries){const deliveryId=deriveInboxDeliveryId({receiptId:parseInboxReceiptId(receiptId),envelopeEventId:text(d,"envelope_event_id")});if(d["delivery_id"]!==deliveryId || d["schema_version"]!=="accord.inbox-delivery/v1" || d["case_id"]!==ch["case_id"] || time(d,"received_at")<receivedAt)throw new Error("C3 delivery identity/chronology invalid");if(d["envelope_event_id"]===r["envelope_event_id"] && d["received_at"]===receivedAt)first++;checkAudit(ch,"DELIVERY",deliveryId,{deliveryId,receiptId,envelopeEventId:text(d,"envelope_event_id")},time(d,"received_at"),receiptId);}
    if(first!==1)throw new Error("C3 first-delivery provenance missing");
    if(s["business_stable"]===0){
      if(s["ack_state"]!=="NONE" || s["ack_action_id"]!==null || s["ack_confirmed_at"]!==null || s["stable_at"]!==null)throw new Error("C3 incomplete receipt contains ACK");
      if(!isChoice && r["processing_status"]!=="RECEIVED")throw new Error("C3 pending observation falsely processed");
      if(isChoice && (r["processing_status"]==="RECEIVED"?(approval!==undefined || phase!=="APPROVAL_PENDING"):(approval?.["state"]!=="APPROVED" || r["processing_status"]!=="PROCESSED")))throw new Error("C3 pending choice authority corrupt");
    }else {
      if(r["processing_status"]!=="PROCESSED" || s["ack_state"]==="NONE" || time(s,"stable_at")<receivedAt)throw new Error("C3 stable receipt missing processing/ACK authority");
      for(const lower of rows(db,"SELECT * FROM magicchat_inbox_states WHERE app_id=? AND cursor<?",text(r,"app_id"),integer(r,"cursor")))if(lower["ack_state"]!=="ACK_CONFIRMED" || time(lower,"ack_confirmed_at")>time(s,"stable_at"))throw new Error("C3 cumulative ACK overtook incomplete lower cursor");
      const ack=action(db,text(s,"ack_action_id"));if(ack["action_kind"]!=="ACK" || ack["receipt_id"]!==receiptId || ack["created_at"]!==s["stable_at"] || (s["ack_state"]==="ACK_CONFIRMED"?(ack["state"]!=="CONFIRMED" || ack["confirmed_at"]!==s["ack_confirmed_at"]):(ack["state"]!=="PENDING" || ack["confirmation_json"]!==null)))throw new Error("C3 ACK relation corrupt");
      if(isChoice && approval?.["state"]==="APPROVED"){
        const publication=one(db,"SELECT * FROM pending_side_effects WHERE case_id=? AND action_kind='PUBLICATION'",text(ch,"case_id"));
        if(phase==="COMPLETE" && publication?.["state"]!=="CONFIRMED")throw new Error("C3 completed receipt lacks confirmed publication");
        if(phase==="PUBLICATION_HOLD" && publication?.["state"]==="UNKNOWN")throw new Error("C3 unknown publication falsely stabilized");
      }
    }
  }
}
