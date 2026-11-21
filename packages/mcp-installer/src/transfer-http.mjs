import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP } from 'node:net';

export class TransferError extends Error {}

const privateIPv4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) privateIPv4.addSubnet(address, prefix, 'ipv4');

const globalIPv6 = new BlockList();
globalIPv6.addSubnet('2000::', 3, 'ipv6');
const reservedIPv6 = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  reservedIPv6.addSubnet(address, prefix, 'ipv6');
}

export function isPublicAddress(address) {
  if (isIP(address) === 4) return !privateIPv4.check(address, 'ipv4');
  return isIP(address) === 6 && globalIPv6.check(address, 'ipv6') && !reservedIPv6.check(address, 'ipv6');
}

export function transferURL(value, trustedOrigin) {
  let url;
  try { url = new URL(value); } catch { throw new TransferError('Use an absolute HTTPS download URL.'); }
  if (url.username || url.password || url.hash) throw new TransferError('Download URLs must not contain login credentials or fragments.');
  const trusted = url.origin === trustedOrigin;
  if (url.protocol !== 'https:' && !(trusted && url.protocol === 'http:')) {
    throw new TransferError('HTTPS is required for internet downloads and redirects.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!trusted && (host.toLowerCase().replace(/\.$/, '') === 'localhost' || (isIP(host) && !isPublicAddress(host)))) {
    throw new TransferError('Internet downloads cannot access private, loopback or reserved addresses.');
  }
  return url;
}

export function publicLookup(resolve = lookup) {
  return (hostname, options, callback) => {
    void resolve(hostname, { all: true, verbatim: true }).then((addresses) => {
      if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
        throw new TransferError('The download host resolves to a private or reserved address.');
      }
      const matches = options.family ? addresses.filter(({ family }) => family === options.family) : addresses;
      if (!matches.length) throw new TransferError('The download host has no usable public address.');
      if (options.all) callback(null, matches);
      else callback(null, matches[0].address, matches[0].family);
    }).catch((error) => callback(error));
  };
}

export function requestTransfer(value, { trustedOrigin, signal, method = 'GET', headers = {}, body } = {}) {
  const url = transferURL(value, trustedOrigin);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request(url, {
      method, headers, signal, agent: false,
      ...(url.origin === trustedOrigin ? {} : { lookup: publicLookup() }),
    }, (response) => { clearTimeout(deadline); resolve(response); });
    const deadline = setTimeout(() => request.destroy(new TransferError('The download server did not respond within 15 seconds.')), 15_000);
    deadline.unref?.();
    request.setTimeout(30_000, () => request.destroy(new TransferError('The download connection stalled for 30 seconds.')));
    request.once('error', (error) => { clearTimeout(deadline); reject(error); });
    if (body) request.end(body);
    else request.end();
  });
}

export async function downloadResponse(value, { trustedOrigin, signal, request = requestTransfer } = {}) {
  let url = transferURL(value, trustedOrigin);
  for (let redirects = 0; redirects <= 5; redirects++) {
    const response = await request(url, { trustedOrigin, signal, headers: { 'Accept-Encoding': 'identity' } });
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      const location = response.headers.location;
      response.destroy();
      if (!location || redirects === 5) throw new TransferError('The download has too many redirects or no redirect target.');
      url = transferURL(new URL(location, url).href, trustedOrigin);
      continue;
    }
    if (response.statusCode !== 200) {
      response.destroy();
      throw new TransferError(`Download failed (HTTP ${response.statusCode}). Refresh an expired project link; do not render again.`);
    }
    return response;
  }
}

export async function readTransferJSON(response, maxBytes = 2 * 1024 * 1024) {
  try {
    if (!response.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      throw new TransferError('The API returned an unexpected response instead of JSON.');
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new TransferError('The API response exceeded the safety limit.');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally {
    response.destroy();
  }
}
