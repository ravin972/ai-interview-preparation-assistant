/**
 * Address parsing and CIDR matching for the SSRF policy.
 *
 * Hand-rolled rather than pulled from a package: the logic is small, it is
 * security-critical enough to want to read in full, and it avoids a
 * dependency in the framework-independent core.
 */

/** IPv4 ranges that must never be reachable from user-supplied URLs. */
export const BLOCKED_IPV4_CIDRS: readonly string[] = [
  '0.0.0.0/8', // "this network" / unspecified
  '10.0.0.0/8', // RFC1918 private
  '100.64.0.0/10', // CGNAT
  '127.0.0.0/8', // loopback
  '169.254.0.0/16', // link-local, incl. cloud metadata
  '172.16.0.0/12', // RFC1918 private
  '192.0.0.0/24', // IETF protocol assignments
  '192.0.2.0/24', // TEST-NET-1
  '192.168.0.0/16', // RFC1918 private
  '198.18.0.0/15', // benchmarking
  '198.51.100.0/24', // TEST-NET-2
  '203.0.113.0/24', // TEST-NET-3
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved, incl. 255.255.255.255
];

export const BLOCKED_IPV6_CIDRS: readonly string[] = [
  '::/128', // unspecified
  '::1/128', // loopback
  'fc00::/7', // unique local
  'fe80::/10', // link-local
  'ff00::/8', // multicast
  '2001:db8::/32', // documentation
  '64:ff9b::/96', // NAT64
  '100::/64', // discard-only
];

export function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^[0-9]{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** Expand an IPv6 literal to 16 bytes, handling :: and IPv4-mapped tails. */
export function ipv6ToBytes(ip: string): Uint8Array | null {
  let text = ip.trim();
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone !== -1) text = text.slice(0, zone);
  if (text === '') return null;

  // An IPv4 tail (::ffff:1.2.3.4) becomes two 16-bit groups.
  let head = text;
  let tailGroups: string[] = [];
  const lastColon = text.lastIndexOf(':');
  const maybeV4 = lastColon === -1 ? '' : text.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const asInt = ipv4ToInt(maybeV4);
    if (asInt === null) return null;
    head = text.slice(0, lastColon);
    tailGroups = [Math.floor(asInt / 65_536).toString(16), (asInt % 65_536).toString(16)];
  }

  const doubleColon = head.indexOf('::');
  let groups: string[];
  if (doubleColon === -1) {
    groups = [...head.split(':').filter((g) => g !== ''), ...tailGroups];
    if (groups.length !== 8) return null;
  } else {
    const left = head
      .slice(0, doubleColon)
      .split(':')
      .filter((g) => g !== '');
    const right = head
      .slice(doubleColon + 2)
      .split(':')
      .filter((g) => g !== '');
    const known = [...left, ...right, ...tailGroups];
    if (known.length > 8) return null;
    const fill = new Array<string>(8 - known.length).fill('0');
    groups = [...left, ...fill, ...right, ...tailGroups];
  }

  const bytes = new Uint8Array(16);
  for (let i = 0; i < 8; i += 1) {
    const group = groups[i] ?? '0';
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes[i * 2] = Math.floor(value / 256);
    bytes[i * 2 + 1] = value % 256;
  }
  return bytes;
}

export function inIpv4Cidr(ip: string, cidr: string): boolean {
  const [base, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const address = ipv4ToInt(ip);
  const network = base === undefined ? null : ipv4ToInt(base);
  if (address === null || network === null || !Number.isInteger(prefix)) return false;
  // Division rather than bitwise: >>> would make a /0..8 comparison signed.
  const size = 2 ** (32 - prefix);
  return Math.floor(address / size) === Math.floor(network / size);
}

export function inIpv6Cidr(ip: string, cidr: string): boolean {
  const [base, prefixText] = cidr.split('/');
  const prefix = Number(prefixText);
  const address = ipv6ToBytes(ip);
  const network = base === undefined ? null : ipv6ToBytes(base);
  if (address === null || network === null || !Number.isInteger(prefix)) return false;

  const fullBytes = Math.floor(prefix / 8);
  for (let i = 0; i < fullBytes; i += 1) {
    if (address[i] !== network[i]) return false;
  }
  const remainder = prefix % 8;
  if (remainder === 0) return true;
  const mask = (0xff << (8 - remainder)) & 0xff;
  return ((address[fullBytes] ?? 0) & mask) === ((network[fullBytes] ?? 0) & mask);
}

/** ::ffff:a.b.c.d and ::a.b.c.d carry an IPv4 address that must be re-checked. */
export function unwrapIpv4Mapped(ip: string): string | null {
  const bytes = ipv6ToBytes(ip);
  if (bytes === null) return null;
  const firstTenZero = bytes.slice(0, 10).every((byte) => byte === 0);
  if (!firstTenZero) return null;
  const marker = (bytes[10] ?? 0) === 0xff && (bytes[11] ?? 0) === 0xff;
  const compat = (bytes[10] ?? 0) === 0 && (bytes[11] ?? 0) === 0;
  if (!marker && !compat) return null;
  return `${bytes[12] ?? 0}.${bytes[13] ?? 0}.${bytes[14] ?? 0}.${bytes[15] ?? 0}`;
}
