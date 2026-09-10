/**
 * SSRF policy (docs/SECURITY.md section 2, docs/DECISIONS.md D-016).
 *
 * The policy is a constructor parameter, never a global and never an
 * environment check buried inside the fetcher. apps/api constructs
 * SsrfPolicy.strict() and has no code path that constructs anything else;
 * tools/evaluate constructs SsrfPolicy.fromEnv(), which defaults to strict and
 * relaxes only for host:port pairs named explicitly. The evaluator's localhost
 * exception is therefore unreachable from production code rather than merely
 * unused by it.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, type Dispatcher } from 'undici';
import {
  BLOCKED_IPV4_CIDRS,
  BLOCKED_IPV6_CIDRS,
  inIpv4Cidr,
  inIpv6Cidr,
  unwrapIpv4Mapped,
} from './ip.js';

export type SsrfRejection =
  | 'invalid_url'
  | 'protocol_not_allowed'
  | 'credentials_in_url'
  | 'port_not_allowed'
  | 'blocked_hostname'
  | 'dns_failure'
  | 'blocked_address';

export interface SsrfAllowed {
  allowed: true;
  url: URL;
  addresses: string[];
}

export interface SsrfDenied {
  allowed: false;
  reason: SsrfRejection;
  detail: string;
}

export type SsrfDecision = SsrfAllowed | SsrfDenied;

export type DnsResolver = (hostname: string) => Promise<string[]>;

export interface SsrfPolicyOptions {
  allowedProtocols?: readonly string[];
  /** Standard web ports only by default - a real company site needs no more. */
  allowedPorts?: readonly number[];
  /**
   * host:port entries permitted to resolve to otherwise-blocked addresses.
   * Evaluator fixtures only. Never populated by the production API.
   */
  allowPrivateHosts?: readonly string[];
  resolve?: DnsResolver;
}

const DEFAULT_PROTOCOLS = ['http:', 'https:'] as const;
const DEFAULT_PORTS = [80, 443] as const;

/** Hostnames that must never be reachable, whatever DNS claims. */
const BLOCKED_HOSTNAMES = new Set(['localhost', 'ip6-localhost', 'ip6-loopback']);

const defaultResolver: DnsResolver = async (hostname) => {
  const records = await dnsLookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

function portOf(url: URL): number {
  if (url.port !== '') return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

export class SsrfPolicy {
  readonly #protocols: ReadonlySet<string>;
  readonly #ports: ReadonlySet<number>;
  readonly #allowPrivateHosts: ReadonlySet<string>;
  readonly #resolve: DnsResolver;

  constructor(options: SsrfPolicyOptions = {}) {
    this.#protocols = new Set(options.allowedProtocols ?? DEFAULT_PROTOCOLS);
    this.#ports = new Set(options.allowedPorts ?? DEFAULT_PORTS);
    this.#allowPrivateHosts = new Set(
      (options.allowPrivateHosts ?? []).map((entry) => entry.trim().toLowerCase()),
    );
    this.#resolve = options.resolve ?? defaultResolver;
  }

  /** The production policy. Never allows a private destination. */
  static strict(options: Omit<SsrfPolicyOptions, 'allowPrivateHosts'> = {}): SsrfPolicy {
    return new SsrfPolicy({ ...options, allowPrivateHosts: [] });
  }

  /**
   * Defaults to strict. Relaxes only for the host:port pairs named in
   * EVAL_ALLOW_PRIVATE_HOSTS, and only for those exact pairs.
   */
  static fromEnv(
    env: Record<string, string | undefined>,
    options: SsrfPolicyOptions = {},
  ): SsrfPolicy {
    const allowPrivateHosts = (env['EVAL_ALLOW_PRIVATE_HOSTS'] ?? '')
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
    const ports = new Set<number>(options.allowedPorts ?? DEFAULT_PORTS);
    // A fixture on :8099 needs that port allowed too, but only for itself.
    for (const entry of allowPrivateHosts) {
      const port = Number(entry.split(':')[1]);
      if (Number.isInteger(port) && port > 0) ports.add(port);
    }
    return new SsrfPolicy({ ...options, allowPrivateHosts, allowedPorts: [...ports] });
  }

  get allowsPrivateHosts(): boolean {
    return this.#allowPrivateHosts.size > 0;
  }

  #isExempt(hostname: string, port: number): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      this.#allowPrivateHosts.has(`${host}:${port}`) || this.#allowPrivateHosts.has(host)
    );
  }

  /**
   * Host-level exemption, ignoring port. Used only by the connect hook, where
   * the port is not available - and not needed, because checkUrl has already
   * enforced the exact host:port before any connection is attempted.
   */
  #isExemptHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    for (const entry of this.#allowPrivateHosts) {
      if (entry === host) return true;
      if (entry.startsWith(`${host}:`)) return true;
    }
    return false;
  }

  /** Address check for the connect hook, where only the hostname is known. */
  isAddressAllowedForHost(address: string, hostname: string): boolean {
    if (this.#isExemptHost(hostname)) return true;
    return this.#checkAddressRanges(address, (mapped) =>
      this.isAddressAllowedForHost(mapped, hostname),
    );
  }

  /** Synchronous checks that need no DNS. */
  checkUrl(input: string | URL): SsrfDecision {
    let url: URL;
    try {
      url = input instanceof URL ? input : new URL(input);
    } catch {
      return {
        allowed: false,
        reason: 'invalid_url',
        detail: `cannot parse ${String(input)}`,
      };
    }

    if (!this.#protocols.has(url.protocol)) {
      return {
        allowed: false,
        reason: 'protocol_not_allowed',
        detail: `protocol ${url.protocol} is not allowed`,
      };
    }
    if (url.username !== '' || url.password !== '') {
      return {
        allowed: false,
        reason: 'credentials_in_url',
        detail: 'URLs carrying credentials are rejected',
      };
    }
    if (url.hostname === '') {
      return { allowed: false, reason: 'invalid_url', detail: 'URL has no hostname' };
    }

    const port = portOf(url);
    const exempt = this.#isExempt(url.hostname, port);

    // Hostname first: it yields the more specific reason for names like
    // localhost, which would otherwise be reported as a port problem.
    const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if ((BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith('.localhost')) && !exempt) {
      return {
        allowed: false,
        reason: 'blocked_hostname',
        detail: `hostname ${hostname} is not reachable`,
      };
    }

    if (!this.#ports.has(port) && !exempt) {
      return {
        allowed: false,
        reason: 'port_not_allowed',
        detail: `port ${port} is not allowed`,
      };
    }

    return { allowed: true, url, addresses: [] };
  }

  /** True when a resolved address is acceptable for this hostname and port. */
  isAddressAllowed(address: string, hostname: string, port: number): boolean {
    if (this.#isExempt(hostname, port)) return true;
    return this.#checkAddressRanges(address, (mapped) =>
      this.isAddressAllowed(mapped, hostname, port),
    );
  }

  #checkAddressRanges(
    address: string,
    recheckMapped: (mapped: string) => boolean,
  ): boolean {
    const family = isIP(address);
    if (family === 4) {
      return !BLOCKED_IPV4_CIDRS.some((cidr) => inIpv4Cidr(address, cidr));
    }
    if (family === 6) {
      // An IPv4-mapped IPv6 address is an IPv4 address wearing a hat.
      const mapped = unwrapIpv4Mapped(address);
      if (mapped !== null) return recheckMapped(mapped);
      return !BLOCKED_IPV6_CIDRS.some((cidr) => inIpv6Cidr(address, cidr));
    }
    return false;
  }

  /** Full check: syntax, then DNS, then every resolved address. */
  async checkDestination(input: string | URL): Promise<SsrfDecision> {
    const syntax = this.checkUrl(input);
    if (!syntax.allowed) return syntax;

    const { url } = syntax;
    const port = portOf(url);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');

    if (isIP(hostname) !== 0) {
      if (!this.isAddressAllowed(hostname, hostname, port)) {
        return {
          allowed: false,
          reason: 'blocked_address',
          detail: `${hostname} is in a blocked range`,
        };
      }
      return { allowed: true, url, addresses: [hostname] };
    }

    let addresses: string[];
    try {
      addresses = await this.#resolve(hostname);
    } catch (error) {
      return {
        allowed: false,
        reason: 'dns_failure',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    if (addresses.length === 0) {
      return {
        allowed: false,
        reason: 'dns_failure',
        detail: `${hostname} did not resolve`,
      };
    }

    // Every record must be acceptable. One private answer poisons the name.
    for (const address of addresses) {
      if (!this.isAddressAllowed(address, hostname, port)) {
        return {
          allowed: false,
          reason: 'blocked_address',
          detail: `${hostname} resolves to ${address}, which is in a blocked range`,
        };
      }
    }
    return { allowed: true, url, addresses };
  }

  /**
   * An undici Agent whose connect step re-validates the address it is about to
   * use. Validating the hostname and then handing that hostname to the client
   * leaves a window in which a second lookup returns a different address; here
   * the address that was validated is the address the socket connects to.
   */
  createDispatcher(options: { connectTimeoutMs?: number } = {}): Dispatcher {
    const policy = this;
    return new Agent({
      connect: {
        timeout: options.connectTimeoutMs ?? 8_000,
        lookup(hostname, _opts, callback) {
          void (async () => {
            try {
              const addresses =
                isIP(hostname) === 0 ? await policy.#resolve(hostname) : [hostname];
              for (const address of addresses) {
                if (!policy.isAddressAllowedForHost(address, hostname)) {
                  callback(
                    new Error(
                      `SSRF: ${hostname} resolves to ${address}, which is in a blocked range`,
                    ),
                    '',
                    0,
                  );
                  return;
                }
              }
              const chosen = addresses[0] ?? hostname;
              callback(null, chosen, isIP(chosen) === 6 ? 6 : 4);
            } catch (error) {
              callback(error instanceof Error ? error : new Error(String(error)), '', 0);
            }
          })();
        },
      },
    });
  }
}
