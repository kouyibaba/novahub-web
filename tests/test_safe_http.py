import io
import socket
import unittest
from unittest import mock

import safe_http


class SocketResponse:
    def __init__(self, wire):
        self.stream = io.BytesIO(wire)

    def makefile(self, mode):
        return self.stream

    def sendall(self, data):
        pass

    def setsockopt(self, *args):
        pass

    def close(self):
        pass


class SafeHttpTests(unittest.TestCase):
    def test_redirect_to_private_target_is_blocked_before_connection(self):
        wire = b'HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/secret\r\nContent-Length: 0\r\n\r\n'
        def dns(host, port, **kwargs):
            address = "127.0.0.1" if host == "127.0.0.1" else "8.8.8.8"
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (address, port))]
        with mock.patch.object(socket, "getaddrinfo", side_effect=dns), mock.patch.object(
            socket, "create_connection", return_value=SocketResponse(wire)
        ) as connect:
            with self.assertRaisesRegex(ValueError, "Private"):
                safe_http.request("http://public.example/start")
            self.assertEqual(connect.call_count, 1)

    def test_connection_uses_validated_ip_and_preserves_host_header(self):
        sock = SocketResponse(b'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK')
        with mock.patch.object(socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 80))]), mock.patch.object(
            socket, "create_connection", return_value=sock
        ) as connect, mock.patch.object(sock, "sendall") as send:
            self.assertEqual(safe_http.request("http://public.example/")[1], b"OK")
            self.assertEqual(connect.call_args.args[0], ("8.8.8.8", 80))
            self.assertIn(b"Host: public.example", send.call_args.args[0])

    def test_response_limit_rejects_truncated_media(self):
        wire = b'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nlarge'
        with mock.patch.object(socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("8.8.8.8", 80))]), mock.patch.object(
            socket, "create_connection", return_value=SocketResponse(wire)
        ):
            with self.assertRaisesRegex(ValueError, "too large"):
                safe_http.request("http://public.example/", max_bytes=4)


if __name__ == "__main__":
    unittest.main()
