import { describe, expect, test } from 'bun:test';
import { PRINT_CSP, withPrintCsp } from './print-csp';

describe('withPrintCsp', () => {
  test('the meta tag goes first into <head>', () => {
    const out = withPrintCsp('<!doctype html><html lang="ru"><head><title>x</title></head><body><script>alert(1)</script></body></html>');
    expect(out).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${PRINT_CSP}"><title>`);
  });
  test('a fragment without <head> is wrapped', () => {
    expect(withPrintCsp('<p>a</p>')).toStartWith('<!doctype html><html><head><meta http-equiv="Content-Security-Policy"');
  });
  test('scripts are not allowed by the policy', () => {
    expect(PRINT_CSP).toContain("default-src 'none'");
    expect(PRINT_CSP).not.toContain('script-src');
  });
});
