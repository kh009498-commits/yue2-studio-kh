"""Only let YuE2 Studio's own pages talk to this local service.

Without this, any website open in a browser on this PC (or on the home
network) could send commands to the studio in the background: delete songs,
queue GPU jobs, change AI settings. Browsers attach an Origin header to those
cross-site requests, so we reject any origin that is not Studio itself.

Allowed:
- No Origin header (the desktop app's Rust bridge, the MCP server, curl).
- The Tauri desktop window (tauri.localhost).
- Pages served from this PC's own loopback address (Vite dev server, Video Studio).
- The page's own server (the LAN web UI your family opens at http://<pc>:6969),
  but only when the Host is an IP address or a home-network name. That blocks
  "DNS rebinding", where a real website pretends to be a local address.
"""
from __future__ import annotations

import ipaddress
from urllib.parse import urlsplit

from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

TAURI_ORIGINS = {"http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"}
LOOPBACK_NAMES = {"localhost", "127.0.0.1", "::1", "[::1]"}
HOME_SUFFIXES = (".local", ".lan", ".home", ".home.arpa", ".localdomain")


def _host_only(value: str) -> str:
    value = (value or "").strip().lower()
    if value.startswith("["):
        return value[1:value.find("]")] if "]" in value else value
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def is_home_host(host_header: str) -> bool:
    """True for IP literals, localhost, single-label PC names, and .local style names."""
    host = _host_only(host_header).rstrip(".")
    if not host:
        return False
    if host in LOOPBACK_NAMES:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    return "." not in host or host.endswith(HOME_SUFFIXES)


def origin_allowed(origin: str | None, host_header: str) -> bool:
    if origin is None:
        return True
    origin = origin.strip().lower().rstrip("/")
    if origin in TAURI_ORIGINS:
        return True
    parts = urlsplit(origin)
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        return False  # includes the literal "null" origin (sandboxed frames, files)
    if parts.hostname in LOOPBACK_NAMES or parts.hostname == "::1":
        return True
    # Same-origin page served by this studio (the LAN web UI).
    return parts.netloc == (host_header or "").strip().lower() and is_home_host(host_header)


class OriginGuard:
    """ASGI middleware: block foreign origins, add CORS headers for allowed ones."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        headers = {key.decode("latin-1").lower(): value.decode("latin-1") for key, value in scope.get("headers", [])}
        origin = headers.get("origin")
        host = headers.get("host", "")
        if not is_home_host(host):
            # A request that names a public website as its host reached this PC:
            # that is DNS rebinding, never a real Studio page.
            await self._reject(scope, receive, send, "Unknown host")
            return
        if not origin_allowed(origin, host):
            await self._reject(scope, receive, send, "This website is not allowed to control YuE2 Studio.")
            return
        if origin is None:
            await self.app(scope, receive, send)
            return
        cors = [
            (b"access-control-allow-origin", origin.encode("latin-1")),
            (b"access-control-allow-credentials", b"true"),
            (b"access-control-allow-private-network", b"true"),
            (b"vary", b"Origin"),
        ]
        if scope["type"] == "http" and scope["method"] == "OPTIONS" and "access-control-request-method" in headers:
            requested = headers.get("access-control-request-headers", "content-type")
            response = Response(status_code=204, headers={
                "Access-Control-Allow-Origin": origin,
                "Access-Control-Allow-Credentials": "true",
                "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
                "Access-Control-Allow-Headers": requested,
                "Access-Control-Allow-Private-Network": "true",
                "Access-Control-Max-Age": "600",
                "Vary": "Origin",
            })
            await response(scope, receive, send)
            return

        async def send_with_cors(message):
            if message["type"] == "http.response.start":
                kept = [(k, v) for k, v in message.get("headers", []) if not k.lower().startswith(b"access-control-") and k.lower() != b"vary"]
                message = {**message, "headers": kept + cors}
            await send(message)

        await self.app(scope, receive, send_with_cors)

    @staticmethod
    async def _reject(scope: Scope, receive: Receive, send: Send, detail: str) -> None:
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 4403})
            return
        await JSONResponse({"detail": detail}, status_code=403)(scope, receive, send)
