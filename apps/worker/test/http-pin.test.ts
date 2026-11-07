/* HTTP-узел автоматизаций: подключение к проверенному адресу (DNS rebinding), запрет частных адресов. */
import { describe, expect, test } from 'bun:test';
import { pinnedRequest, resolvePublic } from '../src/flows/http';

const opts = (addrs: Record<string, string[]>, calls: string[] = []) => ({
  allowPrivate: false,
  resolve: async (host: string) => (calls.push(host), addrs[host] ?? []),
});

describe('pinned requests', () => {
  test('the checked address goes into the URL; Host and the TLS name stay the original host', async () => {
    const calls: string[] = [];
    const { url, address } = await resolvePublic('https://api.example.com:8443/hook?x=1', opts({ 'api.example.com': ['8.8.8.8', '1.1.1.1'] }, calls));
    expect(address).toBe('8.8.8.8');
    expect(calls).toEqual(['api.example.com']);
    const pin = pinnedRequest(url, address);
    expect(pin.target.toString()).toBe('https://8.8.8.8:8443/hook?x=1');
    expect(pin.host).toBe('api.example.com:8443');
    expect(pin.serverName).toBe('api.example.com');
  });

  test('IPv6 addresses are bracketed; plain http has no TLS name', async () => {
    const { url, address } = await resolvePublic('http://v6.example.com/', opts({ 'v6.example.com': ['2606:4700:4700::1111'] }));
    const pin = pinnedRequest(url, address);
    expect(pin.target.hostname).toBe('[2606:4700:4700::1111]');
    expect(pin.serverName).toBeNull();
  });

  test('a host that resolves to any private address is blocked', async () => {
    await expect(resolvePublic('https://rebind.example.com/', opts({ 'rebind.example.com': ['8.8.8.8', '127.0.0.1'] }))).rejects.toThrow('private or local');
    await expect(resolvePublic('http://169.254.169.254/latest/meta-data', opts({}))).rejects.toThrow('private or local');
  });

  test('an IP literal is used as is, without pinning', async () => {
    const { url, address } = await resolvePublic('https://8.8.4.4/', opts({}));
    expect(address).toBeNull();
    expect(pinnedRequest(url, address).target).toBe(url);
  });
});
