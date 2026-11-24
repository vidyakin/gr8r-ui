import { z } from 'zod';
import { isForbiddenHostname, isIpLiteral, isPrivateAddress } from './automations/net';
import { IC_SOURCES } from './integrations-1c';

export const IC_CONFLICT_POLICIES = ['1c_wins', 'erp_wins', 'manual'] as const;
export const IC_SYNC_ENTITY_TYPES = ['organization', 'company', 'product', 'warehouse', 'document'] as const;
export const IC_MESSAGE_NS = 'http://www.1c.ru/SSL/Exchange/Message';
export const IC_EXCHANGE_PLAN = 'СинхронизацияДанныхЧерезУниверсальныйФормат';
export type IcConflictPolicy = typeof IC_CONFLICT_POLICIES[number];
export type IcSyncEntityType = typeof IC_SYNC_ENTITY_TYPES[number];

const nodeName = z.string().trim().min(1).max(100).regex(/^[^\u0000-\u001f\u007f]+$/);
const settings = z.object({
  source: z.enum(IC_SOURCES),
  endpointUrl: z.string().trim().max(2048).url().refine(raw => {
    try {
      const url = new URL(raw);
      const host = url.hostname.replace(/^\[|\]$/g, '');
      return url.protocol === 'https:' && !url.username && !url.password && !/[?#]/.test(raw)
        && !isForbiddenHostname(host) && (!isIpLiteral(host) || !isPrivateAddress(host));
    } catch {
      return false;
    }
  }, 'Use a public HTTPS URL without credentials, query parameters or fragments'),
  nodeName,
  localNodeName: nodeName,
  authType: z.enum(['basic', 'bearer']),
  username: z.string().trim().min(1).max(255).regex(/^[^:\u0000-\u001f\u007f]+$/).nullable().optional(),
  secret: z.string().min(1).max(8192).regex(/^[^\u0000-\u001f\u007f]+$/),
  conflictPolicy: z.enum(IC_CONFLICT_POLICIES),
  intervalMinutes: z.number().int().min(1).max(1440),
  enabled: z.boolean(),
  version: z.enum(['1.15', '1.17']),
}).strict();

export const icChannelCreate = settings.extend({
  localNodeName: settings.shape.localNodeName.default('ERP'),
  conflictPolicy: settings.shape.conflictPolicy.default('1c_wins'),
  intervalMinutes: settings.shape.intervalMinutes.default(60),
  enabled: settings.shape.enabled.default(false),
  version: settings.shape.version.default('1.17'),
}).superRefine((v, ctx) => {
  if (v.nodeName === v.localNodeName) ctx.addIssue({ code: 'custom', path: ['nodeName'], message: 'Node names must differ' });
  if (v.authType === 'basic' && !v.username) ctx.addIssue({ code: 'custom', path: ['username'], message: 'Basic authentication needs a username' });
  if (v.authType === 'bearer' && !/^[A-Za-z0-9._~+/-]+=*$/.test(v.secret)) {
    ctx.addIssue({ code: 'custom', path: ['secret'], message: 'Invalid Bearer token' });
  }
});
export const icChannelPatch = settings.omit({ source: true }).partial();
export type IcChannelCreate = z.output<typeof icChannelCreate>;
export type IcChannelPatch = z.output<typeof icChannelPatch>;

export interface IcMessageNumbers { messageNo: number; receivedNo: number }
export interface IcMessageHeader extends IcMessageNumbers { from: string; to: string }

const validNumber = (value: number, min: number) => Number.isInteger(value) && value >= min && value <= 2_147_483_647;

export function nextIcMessage(lastSent: number, lastReceived: number, to: string, from: string): IcMessageHeader {
  if (!validNumber(lastSent, 0) || !validNumber(lastSent + 1, 1) || !validNumber(lastReceived, 0)) {
    throw new Error('Invalid EnterpriseData message counter');
  }
  return { messageNo: lastSent + 1, receivedNo: lastReceived, from, to };
}

export function receiveIcMessage(header: IcMessageNumbers, lastReceived: number, lastSent: number, acked: number) {
  if (!validNumber(header.messageNo, 1) || !validNumber(header.receivedNo, 0) || header.receivedNo > lastSent) {
    throw new Error('Invalid EnterpriseData acknowledgement');
  }
  return { duplicate: header.messageNo <= lastReceived, ackedSentMessageNo: Math.max(acked, header.receivedNo) };
}

export function resolveIcConflict(policy: IcConflictPolicy, localChange: boolean) {
  if (!localChange || policy === '1c_wins') return 'apply';
  return policy === 'erp_wins' ? 'keep_local' : 'review';
}

export const IC_SYNC_ISSUE_CODES = [
  'transport', 'interrupted', 'http_status', 'invalid_packet', 'secret', 'ack_pending', 'apply_failed',
  'unsupported', 'unmatched', 'invalid_object', 'missing_reference', 'document_total', 'conflict',
] as const;

export interface IcSyncIssue {
  code: typeof IC_SYNC_ISSUE_CODES[number];
  stage: 'push' | 'pull';
  type?: string;
  entityId?: string;
  refUuid?: string;
  name?: string;
  httpStatus?: number;
  policy?: IcConflictPolicy;
  reason?: string;
}
