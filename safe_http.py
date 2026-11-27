"""Bounded public HTTP requests with verified TLS and DNS pinning (stdlib only)."""
import http.client
import ipaddress
import socket
import ssl
import time
import urllib.error
import urllib.parse

TLS_CONTEXT = ssl.create_default_context()


def resolve_public(url):
    if any(ord(ch) <= 32 or ord(ch) == 127 for ch in url) or "\\" in url:
        raise ValueError("Invalid target URL")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme not in ("http", "https") or not parsed.hostname
            or parsed.username is not None or parsed.password is not None
            or "%" in parsed.hostname):
        raise ValueError("Invalid target URL")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses_v4 = []
    addresses_v6 = []
    for entry in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM):
        address = entry[4][0]
        ip = ipaddress.ip_address(address)
        mapped = getattr(ip, "ipv4_mapped", None)
        if not ip.is_global or ip.is_multicast or (mapped and (not mapped.is_global or mapped.is_multicast)):
            raise ValueError("Private or reserved target address")
        bucket = addresses_v4 if ip.version == 4 else addresses_v6
        if address not in bucket:
            bucket.append(address)
    addresses = addresses_v4 + addresses_v6
    if not addresses:
        raise ValueError("No public target address")
    return parsed, port, addresses


def request(url, headers=None, timeout=8, max_bytes=4_194_304, method="GET", body=None, include_headers=False):
    """Resolve each redirect once, connect only to that validated address set."""
    headers = dict(headers or {})
    deadline = time.monotonic() + timeout
    def remaining():
        value = deadline - time.monotonic()
        if value <= 0: raise TimeoutError('Upstream deadline exceeded')
        return value
    for _ in range(6):
        remaining()
        parsed, port, addresses = resolve_public(url)

        def connect_pinned(_destination, timeout=timeout, source_address=None):
            last_error = None
            total = len(addresses)
            for idx, address in enumerate(addresses):
                try:
                    left = remaining()
                    step_to = min(left, 2.2) if (idx + 1 < total and left > 2.2) else left
                    return socket.create_connection((address, port), step_to, source_address)
                except OSError as exc:
                    last_error = exc
            raise last_error or OSError("No target address")

        if parsed.scheme == "https":
            conn = http.client.HTTPSConnection(parsed.hostname, port, timeout=remaining(), context=TLS_CONTEXT)
        else:
            conn = http.client.HTTPConnection(parsed.hostname, port, timeout=remaining())
        conn._create_connection = connect_pinned
        try:
            path = urllib.parse.urlunsplit(("", "", parsed.path or "/", parsed.query, ""))
            conn.request(method, path, body=body, headers=headers)
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise ValueError("Redirect without Location")
                next_url = urllib.parse.urljoin(url, location)
                next_target = urllib.parse.urlsplit(next_url)
                if parsed.scheme == "https" and next_target.scheme != "https":
                    raise ValueError("HTTPS downgrade rejected")
                if method != "GET" and response.status not in (307, 308):
                    raise ValueError("Unsafe method redirect")
                if (parsed.scheme, parsed.hostname, parsed.port) != (next_target.scheme, next_target.hostname, next_target.port):
                    headers = {k: v for k, v in headers.items() if k.lower() not in ("authorization", "cookie")}
                url = next_url
                continue
            if response.status >= 400:
                raise urllib.error.HTTPError(url, response.status, response.reason, response.headers, None)
            chunks = []; size = 0
            while size <= max_bytes:
                seconds = remaining()
                if conn.sock: conn.sock.settimeout(seconds)
                # read1 returns currently available bytes, allowing a whole-body deadline
                # even when an upstream trickles data below the socket idle timeout.
                chunk = response.read1(min(65536, max_bytes + 1 - size))
                if not chunk: break
                chunks.append(chunk); size += len(chunk)
            remaining()
            data = b''.join(chunks)
            if len(data) > max_bytes:
                raise ValueError("Upstream response too large")
            result = (response.status, data, response.getheader("Content-Type", "application/octet-stream"), url)
            return result + ({k.lower():v for k,v in response.getheaders()},) if include_headers else result
        finally:
            conn.close()
    raise ValueError("Too many redirects")
