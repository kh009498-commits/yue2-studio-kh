"""Websites other than Studio must not be able to control the local service."""
from fastapi import FastAPI, WebSocket
from fastapi.testclient import TestClient
import pytest

from origin_guard import OriginGuard, is_home_host, origin_allowed


def make_client(host: str = "127.0.0.1:7794") -> TestClient:
    app = FastAPI()

    @app.delete("/api/library/song")
    def delete_song():
        return {"deleted": True}

    @app.websocket("/ws/jobs/1")
    async def socket(ws: WebSocket):
        await ws.accept(); await ws.send_json({"ok": True}); await ws.close()

    app.add_middleware(OriginGuard)
    return TestClient(app, base_url=f"http://{host}")


@pytest.mark.parametrize("origin", [None, "http://tauri.localhost", "https://tauri.localhost", "tauri://localhost",
                                    "http://localhost:1434", "http://127.0.0.1:7794"])
def test_studio_pages_are_allowed(origin):
    headers = {"Origin": origin} if origin else {}
    response = make_client().delete("/api/library/song", headers=headers)
    assert response.status_code == 200
    if origin:
        assert response.headers["access-control-allow-origin"] == origin


@pytest.mark.parametrize("origin", ["https://evil.example", "null", "http://192.168.1.50:6969"])
def test_other_websites_are_blocked(origin):
    response = make_client().delete("/api/library/song", headers={"Origin": origin})
    assert response.status_code == 403
    assert "access-control-allow-origin" not in response.headers


def test_lan_web_ui_on_its_own_address_is_allowed():
    client = make_client("192.168.1.50:6969")
    assert client.delete("/api/library/song", headers={"Origin": "http://192.168.1.50:6969"}).status_code == 200
    kraken = make_client("kraken:6969")
    assert kraken.delete("/api/library/song", headers={"Origin": "http://kraken:6969"}).status_code == 200


def test_dns_rebinding_is_blocked():
    client = make_client("evil.example:7794")
    assert client.delete("/api/library/song", headers={"Origin": "http://evil.example:7794"}).status_code == 403
    assert client.delete("/api/library/song").status_code == 403


def test_preflight_from_blocked_site_is_refused_and_allowed_site_is_answered():
    client = make_client()
    ask = {"Access-Control-Request-Method": "DELETE", "Access-Control-Request-Private-Network": "true"}
    assert client.options("/api/library/song", headers={**ask, "Origin": "https://evil.example"}).status_code == 403
    ok = client.options("/api/library/song", headers={**ask, "Origin": "http://tauri.localhost"})
    assert ok.status_code == 204
    assert ok.headers["access-control-allow-private-network"] == "true"


def test_websocket_from_blocked_site_is_refused():
    client = make_client()
    with client.websocket_connect("/ws/jobs/1", headers={"Origin": "http://tauri.localhost"}) as ws:
        assert ws.receive_json() == {"ok": True}
    with pytest.raises(Exception):
        with client.websocket_connect("/ws/jobs/1", headers={"Origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_host_rules():
    assert is_home_host("127.0.0.1:7794") and is_home_host("[::1]:7794") and is_home_host("kraken")
    assert is_home_host("kraken.local:6969") and is_home_host("10.0.0.4")
    assert not is_home_host("evil.example") and not is_home_host("")
    assert not origin_allowed("file://", "127.0.0.1:7794")
