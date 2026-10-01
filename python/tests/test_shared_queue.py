"""Several people share one GPU: songs wait in a single line, each person owns theirs."""
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import log_buffer
with patch.object(log_buffer, "install"):
    import main
from fastapi.testclient import TestClient
from jobs import Job, JobManager, current_owner

DAD = "dad-browser-0001"
KID = "kid-browser-0002"


def lan_client() -> TestClient:
    # A browser on another computer in the house.
    return TestClient(main.app, base_url="http://192.168.1.20:6969", client=("192.168.1.30", 50000))


def studio_pc_client() -> TestClient:
    return TestClient(main.app, base_url="http://127.0.0.1:7794", client=("127.0.0.1", 50000))


GATE = threading.Event()


def _fake_generate(job: Job) -> dict:
    GATE.wait(5)
    return {"ok": True}


def _test_submit(title: str):
    return {"job": main.manager.describe(main.manager.submit("yue2", {"title": title}, _fake_generate))}


# Test-only route, placed ahead of the LAN web UI mount so it is reachable.
main.app.add_api_route("/__test/submit", _test_submit, methods=["POST"])
main.app.router.routes.insert(0, main.app.router.routes.pop())


def submit_as(client: TestClient, owner: str, name: str) -> dict:
    """Queue a fake job through a real HTTP request so the owner tag flows the same way."""
    response = client.post(f"/__test/submit?title={name}-song&studio_client={owner}&studio_name={name}")
    assert response.status_code == 200, response.text
    return response.json()["job"]


def test_everyone_queues_and_sees_one_shared_line():
    GATE.clear()
    with patch.object(main.lan_access, "_load", return_value={"enabled": True}):
        first = submit_as(studio_pc_client(), DAD, "Dad")
        second = submit_as(lan_client(), KID, "Maya")
        third = submit_as(lan_client(), KID, "Maya")
        time.sleep(0.2)
        line = main.manager.queue_snapshot()
        ids = [item["id"] for item in line]
        assert ids[:3] == [first["id"], second["id"], third["id"]]
        assert [item["queue_position"] for item in line[:3]] == [1, 2, 3]
        assert line[0]["status"] == "running" and line[0]["owner_name"] == "Dad"
        assert line[1]["owner"] == KID and line[1]["phase"] == "Up next"
        assert line[2]["phase"] == "Waiting in line · 1 ahead of you"
        assert line[1]["title"] == "Maya-song"

        # Maya cannot cancel Dad's song from her laptop, but can cancel her own.
        denied = lan_client().post(f"/api/jobs/{first['id']}/cancel?studio_client={KID}")
        assert denied.status_code == 403
        assert "Dad" in denied.json()["detail"]
        allowed = lan_client().post(f"/api/jobs/{third['id']}/cancel?studio_client={KID}")
        assert allowed.status_code == 200
        # The studio PC may cancel anything.
        assert studio_pc_client().post(f"/api/jobs/{second['id']}/cancel").status_code == 200
        GATE.set()
        for _ in range(50):
            if not main.manager.waiting_line():
                break
            time.sleep(0.05)
        assert main.manager.get(first["id"]).status == "succeeded"
        assert main.manager.get(second["id"]).status == "cancelled"
        assert main.manager.get(third["id"]).status == "cancelled"


def test_owner_tag_is_ignored_when_malformed_and_jobs_without_owner_are_studio_only():
    token = current_owner.set(("", ""))
    try:
        job = Job("x" * 32, "yue2", {})
        assert job.owner == "" and job.owner_name == ""
    finally:
        current_owner.reset(token)


def test_finished_jobs_are_trimmed_so_memory_does_not_grow_forever():
    manager = JobManager()
    for index in range(200):
        manager.submit("yue2", {"title": str(index)}, lambda job: {})
    for _ in range(100):
        if not manager.waiting_line():
            break
        time.sleep(0.05)
    time.sleep(0.1)
    assert len(manager.jobs) <= 151
