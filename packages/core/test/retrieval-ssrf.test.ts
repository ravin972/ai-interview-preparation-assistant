import { describe, expect, it } from 'vitest';
import {
  inIpv4Cidr,
  inIpv6Cidr,
  ipv4ToInt,
  unwrapIpv4Mapped,
} from '../src/retrieval/ip.js';
import { SsrfPolicy } from '../src/retrieval/ssrf.js';

const publicDns = async () => ['93.184.216.34'];
const strict = (resolve = publicDns) => SsrfPolicy.strict({ resolve });

describe('address parsing', () => {
  it.each([
    ['0.0.0.0', 0],
    ['127.0.0.1', 2130706433],
    ['255.255.255.255', 4294967295],
  ])('parses %s', (ip, expected) => {
    expect(ipv4ToInt(ip)).toBe(expected);
  });

  it.each(['256.0.0.1', '1.2.3', 'abc', '1.2.3.4.5'])('rejects %s', (ip) => {
    expect(ipv4ToInt(ip)).toBeNull();
  });

  it('matches IPv4 CIDRs without sign errors on wide prefixes', () => {
    expect(inIpv4Cidr('10.255.255.254', '10.0.0.0/8')).toBe(true);
    expect(inIpv4Cidr('11.0.0.1', '10.0.0.0/8')).toBe(false);
    expect(inIpv4Cidr('172.31.255.255', '172.16.0.0/12')).toBe(true);
    expect(inIpv4Cidr('172.32.0.1', '172.16.0.0/12')).toBe(false);
    expect(inIpv4Cidr('240.0.0.1', '240.0.0.0/4')).toBe(true);
  });

  it('matches IPv6 CIDRs including non-byte-aligned prefixes', () => {
    expect(inIpv6Cidr('::1', '::1/128')).toBe(true);
    expect(inIpv6Cidr('fe80::1', 'fe80::/10')).toBe(true);
    expect(inIpv6Cidr('fec0::1', 'fe80::/10')).toBe(false);
    expect(inIpv6Cidr('fd00::1', 'fc00::/7')).toBe(true);
    expect(inIpv6Cidr('ff02::1', 'ff00::/8')).toBe(true);
  });

  it('unwraps IPv4-mapped IPv6 addresses', () => {
    expect(unwrapIpv4Mapped('::ffff:127.0.0.1')).toBe('127.0.0.1');
    expect(unwrapIpv4Mapped('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(unwrapIpv4Mapped('2001:db8::1')).toBeNull();
  });
});

describe('SSRF policy - blocked destinations', () => {
  it.each([
    ['localhost', 'http://localhost/', 'blocked_hostname'],
    ['a .localhost subdomain', 'http://api.localhost/', 'blocked_hostname'],
    ['IPv4 loopback', 'http://127.0.0.1/', 'blocked_address'],
    ['loopback anywhere in 127/8', 'http://127.99.42.7/', 'blocked_address'],
    ['private 10/8', 'http://10.1.2.3/', 'blocked_address'],
    ['private 172.16/12', 'http://172.20.0.1/', 'blocked_address'],
    ['private 192.168/16', 'http://192.168.1.1/', 'blocked_address'],
    [
      'link-local metadata',
      'http://169.254.169.254/latest/meta-data/',
      'blocked_address',
    ],
    ['CGNAT', 'http://100.64.0.1/', 'blocked_address'],
    ['unspecified', 'http://0.0.0.0/', 'blocked_address'],
    ['multicast', 'http://224.0.0.1/', 'blocked_address'],
    ['reserved 240/4', 'http://250.1.2.3/', 'blocked_address'],
    ['IPv6 loopback', 'http://[::1]/', 'blocked_address'],
    ['IPv6 link-local', 'http://[fe80::1]/', 'blocked_address'],
    ['IPv6 unique-local', 'http://[fd00::1]/', 'blocked_address'],
    ['IPv4-mapped loopback', 'http://[::ffff:127.0.0.1]/', 'blocked_address'],
    ['decimal-encoded loopback', 'http://2130706433/', 'blocked_address'],
    ['hex-encoded loopback', 'http://0x7f.0.0.1/', 'blocked_address'],
  ])('rejects %s', async (_label, url, reason) => {
    const decision = await strict().checkDestination(url);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe(reason);
  });

  it.each([
    ['credentials in the URL', 'http://user:pass@example.com/', 'credentials_in_url'],
    ['a password-only credential', 'http://:secret@example.com/', 'credentials_in_url'],
    ['the file protocol', 'file:///etc/passwd', 'protocol_not_allowed'],
    ['the gopher protocol', 'gopher://example.com/', 'protocol_not_allowed'],
    ['a non-standard port', 'http://example.com:8099/', 'port_not_allowed'],
    ['unparseable input', 'not a url', 'invalid_url'],
  ])('rejects %s', async (_label, url, reason) => {
    const decision = await strict().checkDestination(url);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe(reason);
  });
});

describe('SSRF policy - DNS behaviour', () => {
  it('rejects a hostname that resolves to a private address', async () => {
    const decision = await strict(async () => ['10.0.0.5']).checkDestination(
      'http://rebind.example/',
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('blocked_address');
      expect(decision.detail).toContain('10.0.0.5');
    }
  });

  it('rejects a legitimate company subdomain when it resolves to a private IP', async () => {
    const policy = strict(async () => ['10.20.30.40']);
    const decision = await policy.checkDestination('https://careers.acme.example/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('blocked_address');
      expect(decision.detail).toContain('10.20.30.40');
    }
  });

  it('rejects a subdomain resolving to IPv4 loopback (127.0.0.1)', async () => {
    const policy = strict(async () => ['127.0.0.1']);
    const decision = await policy.checkDestination('https://internal.company.com/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe('blocked_address');
      expect(decision.detail).toContain('127.0.0.1');
    }
  });

  it('rejects when any one of several records is private', async () => {
    const policy = strict(async () => ['93.184.216.34', '192.168.0.9']);
    expect((await policy.checkDestination('http://mixed.example/')).allowed).toBe(false);
  });

  it('reports a DNS failure distinctly from a blocked address', async () => {
    const policy = strict(async () => {
      throw new Error('ENOTFOUND');
    });
    const decision = await policy.checkDestination('http://missing.example/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('dns_failure');
  });

  it('rejects a hostname that resolves to nothing', async () => {
    const decision = await strict(async () => []).checkDestination(
      'http://empty.example/',
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe('dns_failure');
  });

  it('re-validates at connect time, closing the rebinding window', async () => {
    // First lookup answers public, the second answers private - exactly the
    // shape of a DNS rebinding attack. The connect hook must still refuse.
    let call = 0;
    const policy = SsrfPolicy.strict({
      resolve: async () => (++call === 1 ? ['93.184.216.34'] : ['169.254.169.254']),
    });

    expect((await policy.checkDestination('http://rebind.example/')).allowed).toBe(true);
    expect(policy.isAddressAllowedForHost('169.254.169.254', 'rebind.example')).toBe(
      false,
    );
    expect(policy.isAddressAllowedForHost('93.184.216.34', 'rebind.example')).toBe(true);
  });

  it('builds a dispatcher carrying the guarded lookup', () => {
    const dispatcher = strict().createDispatcher();
    expect(dispatcher).toBeDefined();
    void dispatcher.close();
  });
});

describe('SSRF policy - allowed destinations', () => {
  it.each([
    'http://example.com/',
    'https://example.com/careers',
    'https://example.com:443/',
    'http://example.com:80/about',
  ])('allows %s', async (url) => {
    expect((await strict().checkDestination(url)).allowed).toBe(true);
  });

  it('allows a public IP literal without a DNS round trip', async () => {
    const policy = SsrfPolicy.strict({
      resolve: async () => {
        throw new Error('DNS should not be consulted for an IP literal');
      },
    });
    expect((await policy.checkDestination('http://93.184.216.34/')).allowed).toBe(true);
  });
});

describe('SSRF policy - the evaluator exception', () => {
  const fixture = () =>
    SsrfPolicy.fromEnv({ EVAL_ALLOW_PRIVATE_HOSTS: '127.0.0.1:8099,localhost:8099' });

  it('allows exactly the named host and port', async () => {
    expect(
      (await fixture().checkDestination('http://127.0.0.1:8099/acme/')).allowed,
    ).toBe(true);
    expect(
      (await fixture().checkDestination('http://localhost:8099/acme/')).allowed,
    ).toBe(true);
  });

  it('does not allow the same host on another port', async () => {
    expect((await fixture().checkDestination('http://127.0.0.1:9999/')).allowed).toBe(
      false,
    );
  });

  it('does not allow a different private host', async () => {
    expect((await fixture().checkDestination('http://10.0.0.1:8099/')).allowed).toBe(
      false,
    );
    expect((await fixture().checkDestination('http://169.254.169.254/')).allowed).toBe(
      false,
    );
  });

  it.each([{}, { EVAL_ALLOW_PRIVATE_HOSTS: '' }, { EVAL_ALLOW_PRIVATE_HOSTS: '  ' }])(
    'defaults to strict for env %j',
    async (env) => {
      const policy = SsrfPolicy.fromEnv(env);
      expect(policy.allowsPrivateHosts).toBe(false);
      expect((await policy.checkDestination('http://127.0.0.1:8099/')).allowed).toBe(
        false,
      );
    },
  );

  it('strict() cannot be weakened by configuration', async () => {
    // The production policy must not be reachable in a relaxed form, even if a
    // caller tries to smuggle an allowlist through its options.
    const policy = SsrfPolicy.strict({
      ...({ allowPrivateHosts: ['127.0.0.1:8099'] } as object),
    });
    expect(policy.allowsPrivateHosts).toBe(false);
    expect((await policy.checkDestination('http://127.0.0.1:8099/')).allowed).toBe(false);
  });
});
