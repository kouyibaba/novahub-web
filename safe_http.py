"""Bounded public HTTP requests with verified TLS and DNS pinning (stdlib only)."""
import http.client
import ipaddress
import socket
import ssl
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
    addresses = []
    for entry in socket.getaddrinfo(parsed.hostname, port, type=socket.SOCK_STREAM):
        address = entry[4][0]
        ip = ipaddress.ip_address(address)
        mapped = getattr(ip, "ipv4_mapped", None)
        if not ip.is_global or ip.is_multicast or (mapped and (not mapped.is_global or mapped.is_multicast)):
            raise ValueError("Private or reserved target address")
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ValueError("No public target address")
    return parsed, port, addresses


def request(url, headers=None, timeout=8, max_bytes=4_194_304, method="GET", body=None):
    """Resolve each redirect once, connect only to that validated address set."""
    headers = dict(headers or {})
    for _ in range(6):
        parsed, port, addresses = resolve_public(url)

        def connect_pinned(_destination, timeout=timeout, source_address=None):
            last_error = None
            for address in addresses:
                try:
                    return socket.create_connection((address, port), timeout, source_address)
                except OSError as exc:
                    last_error = exc
            raise last_error or OSError("No target address")

        if parsed.scheme == "https":
            conn = http.client.HTTPSConnection(parsed.hostname, port, timeout=timeout, context=TLS_CONTEXT)
        else:
            conn = http.client.HTTPConnection(parsed.hostname, port, timeout=timeout)
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
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise ValueError("Upstream response too large")
            return response.status, data, response.getheader("Content-Type", "application/octet-stream"), url
        finally:
            conn.close()
    raise ValueError("Too many redirects")
