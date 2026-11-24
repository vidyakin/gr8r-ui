import { describe, expect, test } from 'bun:test';
import { icChannelCreate, icChannelPatch, nextIcMessage, receiveIcMessage, resolveIcConflict } from '../src/integrations-1c-sync';
import { generateEnterpriseData, type EnterpriseDataInput } from '../src/enterprise-data';
import { parseEnterpriseDataXml } from '../src/enterprise-data-parse';

const empty: EnterpriseDataInput = {
  organizations: [], companies: [], contracts: [], warehouses: [], products: [], bankAccounts: [], documents: [],
};
const dates = { dateFrom: '2026-11-01', dateTo: '2026-11-25' };
const orgId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const documentId = '33333333-3333-4333-8333-333333333333';
const header = nextIcMessage(6, 3, 'БП', 'ERP & Co');

const channel = {
  source: 'buh3', endpointUrl: 'https://exchange.example.com/hs/sync', nodeName: 'БП',
  authType: 'basic', username: 'integration', secret: 'password',
};

describe('1C HTTP exchange', () => {
  test('numbers outbound XML and parses the cumulative acknowledgement', () => {
    const { xml } = generateEnterpriseData(empty, dates, { header });
    expect(xml).toContain('<msg:Confirmation>');
    expect(xml).toContain('ERP &amp; Co');
    expect(parseEnterpriseDataXml(xml).confirmation).toEqual(header);
    expect(parseEnterpriseDataXml(xml.replaceAll('msg:', 'e:').replace('xmlns:msg=', 'xmlns:e=')).confirmation).toEqual(header);
  });

  test('accepts an acknowledgement-only response and requires an unambiguous header', () => {
    const { xml } = generateEnterpriseData(empty, dates, { header });
    expect(parseEnterpriseDataXml(xml.replace(/<Body[^>]*>[\s\S]*?<\/Body>/, ''), { sync: true }).confirmation).toEqual(header);
    expect(parseEnterpriseDataXml(xml.replace('</msg:MessageNo>', '</msg:MessageNo><msg:MessageNo>8</msg:MessageNo>'), { sync: true }).confirmation).toBeUndefined();
    expect(parseEnterpriseDataXml(generateEnterpriseData(empty, dates).xml).confirmation).toBeUndefined();
  });

  test('writes only selected objects, preserves dependency references and parses removals', () => {
    const { xml, summary } = generateEnterpriseData({
      ...empty,
      organizations: [{ id: orgId, name: 'Organization reference' }],
      companies: [{ id: companyId, name: 'Company reference' }],
      documents: [{ id: documentId, type: 'realization', number: '1', date: dates.dateTo, organizationId: orgId,
        companyId, currency: 'RUB', total: '11.00', priceIncludesVat: true, posted: false }],
    }, dates, {
      header, selectedIds: { document: new Set([documentId]) },
      deleted: [{ type: 'company', refUuid: companyId }],
    });
    expect(summary.totalObjects).toBe(2);
    expect(xml).toContain('Organization reference');
    expect(xml).toContain('<УдалениеОбъекта>');
    const parsed = parseEnterpriseDataXml(xml, { sync: true });
    expect(parsed.catalogs).toEqual([]);
    expect(parsed.documents).toEqual([]);
    expect(parsed.removals).toEqual([
      { type: 'document', refUuid: documentId, unposted: true },
      { type: 'company', refUuid: companyId, unposted: false },
    ]);
  });

  test('accepts monotonic receipts even on a duplicate and rejects an acknowledgement for an unsent package', () => {
    expect(receiveIcMessage({ messageNo: 3, receivedNo: 6 }, 3, 7, 4)).toEqual({ duplicate: true, ackedSentMessageNo: 6 });
    expect(receiveIcMessage({ messageNo: 8, receivedNo: 2 }, 3, 7, 6)).toEqual({ duplicate: false, ackedSentMessageNo: 6 });
    expect(() => receiveIcMessage({ messageNo: 4, receivedNo: 8 }, 3, 7, 6)).toThrow();
    expect(() => receiveIcMessage({ messageNo: 0, receivedNo: 1 }, 0, 7, 0)).toThrow();
    expect(() => nextIcMessage(2_147_483_647, 0, 'БП', 'ERP')).toThrow();
  });

  test.each([['1c_wins', 'apply'], ['erp_wins', 'keep_local'], ['manual', 'review']] as const)(
    '%s resolves concurrent changes as %s', (policy, decision) => {
      expect(resolveIcConflict(policy, true)).toBe(decision);
      expect(resolveIcConflict(policy, false)).toBe('apply');
    },
  );

  test('validates channel settings and credentials without permitting hidden counter updates', () => {
    expect(icChannelCreate.parse(channel)).toMatchObject({ enabled: false, intervalMinutes: 60, conflictPolicy: '1c_wins' });
    expect(icChannelCreate.safeParse({ ...channel, authType: 'bearer', username: undefined, secret: 'token-1' }).success).toBe(true);
    for (const patch of [
      { endpointUrl: 'https://user:pass@example.com' }, { endpointUrl: 'https://127.0.0.1/hs' },
      { endpointUrl: 'http://example.com' }, { endpointUrl: 'https://example.com/hs?token=abc' },
      { endpointUrl: 'https://example.com/hs#token' }, { nodeName: ' ' }, { localNodeName: 'БП' },
      { username: 'bad:name' }, { secret: '' }, { intervalMinutes: 0 }, { intervalMinutes: 2.5 },
      { conflictPolicy: 'latest' }, { source: 'unknown' }, { lastSentMessageNo: 123 },
    ]) expect(icChannelCreate.safeParse({ ...channel, ...patch }).success).toBe(false);
    expect(icChannelPatch.parse({ enabled: true })).toEqual({ enabled: true });
    expect(icChannelPatch.safeParse({ source: 'ut' }).success).toBe(false);
  });
});
