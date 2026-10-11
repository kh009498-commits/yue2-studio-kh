import logging
import re
import threading
from unittest.mock import patch

import pytest
import ai_assist


def test_start_is_logged_before_request_and_success_is_correlated(caplog):
    def respond(*args, **kwargs):
        assert "started:" in caplog.text
        assert "provider=nvidia" in caplog.text
        assert "timeout=150s" in caplog.text
        return "Title: Test"
    with caplog.at_level(logging.INFO, logger="yue2.assist"), patch.object(ai_assist, "_complete_inner", side_effect=respond):
        assert ai_assist._complete("nvidia", "test-model", "PRIVATE_KEY", "PRIVATE_SYSTEM", "PRIVATE_USER", timeout=45, label="chat") == "Title: Test"
    ids = re.findall(r"Writing \[([0-9a-f]+)\]", caplog.text)
    assert len(ids) == 2 and ids[0] == ids[1]
    assert "completed:" in caplog.text and "output_chars=11" in caplog.text
    assert "PRIVATE" not in caplog.text
    assert not any(thread.name.startswith("writing-log-") for thread in threading.enumerate())


@pytest.mark.parametrize("message,outcome", [
    ("NVIDIA NIM did not answer within 150s. PRIVATE_BODY", "timed out"),
    ("Writing provider HTTP 404: PRIVATE_BODY", "HTTP 404"),
    ("PRIVATE_BODY", "request failed"),
])
def test_failure_is_distinct_and_does_not_log_provider_body(caplog, message, outcome):
    with caplog.at_level(logging.INFO, logger="yue2.assist"), patch.object(ai_assist, "_complete_inner", side_effect=RuntimeError(message)):
        with pytest.raises(RuntimeError):
            ai_assist._complete("nvidia", "test-model", "PRIVATE_KEY", "PRIVATE_SYSTEM", "PRIVATE_USER")
    assert outcome + ":" in caplog.text
    assert "completed:" not in caplog.text and "PRIVATE" not in caplog.text
    assert not any(thread.name.startswith("writing-log-") for thread in threading.enumerate())


def test_empty_response_is_not_reported_as_completed(caplog):
    with caplog.at_level(logging.INFO, logger="yue2.assist"), patch.object(ai_assist, "_complete_inner", return_value=""):
        ai_assist._complete("gemini", "test-model", "key", "system", "user")
    assert "empty response:" in caplog.text
    assert "completed:" not in caplog.text


def test_waiting_progress_is_correlated_and_worker_is_stopped(caplog):
    from unittest.mock import MagicMock
    done = MagicMock()
    done.wait.side_effect = [False, True]
    worker = MagicMock()
    worker.start.side_effect = lambda: worker.target()
    def make_worker(*, target, **kwargs):
        worker.target = target
        return worker
    with caplog.at_level(logging.INFO, logger="yue2.assist"), patch.object(ai_assist.threading, "Event", return_value=done), patch.object(ai_assist.threading, "Thread", side_effect=make_worker), patch.object(ai_assist, "_complete_inner", return_value="draft"):
        ai_assist._complete("nvidia", "test-model", "PRIVATE_KEY", "PRIVATE_SYSTEM", "PRIVATE_USER")
    ids = re.findall(r"Writing \[([0-9a-f]+)\]", caplog.text)
    assert len(ids) == 3 and len(set(ids)) == 1
    assert "waiting: provider=nvidia model=test-model" in caplog.text
    assert "elapsed=" in caplog.text and "timeout=150s" in caplog.text
    assert done.set.called and worker.join.called
    assert "PRIVATE" not in caplog.text


def test_cancelled_request_is_not_reported_as_completed(caplog):
    with caplog.at_level(logging.INFO, logger="yue2.assist"), patch.object(ai_assist, "writing_cancelled", side_effect=[False, True, True]), patch.object(ai_assist, "_complete_inner", return_value="draft"):
        with pytest.raises(RuntimeError, match="Writing cancelled"):
            ai_assist._complete("nvidia", "test-model", "key", "system", "user")
    assert "cancelled:" in caplog.text and "completed:" not in caplog.text


def test_operation_validation_failure_is_logged_without_private_detail(caplog):
    @ai_assist.writing_operation
    def sample_operation():
        raise ai_assist.WritingValidationError("PRIVATE_LYRICS")
    with caplog.at_level(logging.INFO, logger="yue2.assist"):
        with pytest.raises(ai_assist.WritingValidationError):
            sample_operation()
    assert "validation failed:" in caplog.text
    assert "finished:" not in caplog.text and "PRIVATE" not in caplog.text


def test_settings_change_logs_selection_without_credentials(caplog):
    import main
    previous = {"provider": "gemini", "model": "old-model", "enabled": True}
    selected = {"provider": "nvidia", "model": "openai/gpt-oss-20b", "enabled": True}
    with caplog.at_level(logging.INFO), patch.object(main.ai_vault, "load", return_value={"capabilities": {"writing": previous}, "providers": {"nvidia": {"key": "PRIVATE_KEY"}}}), patch.object(main.ai_vault, "apply_update", return_value={"capabilities": {"writing": selected}}):
        main.put_ai_keys(main.AiKeysUpdate(capabilities={"writing": selected}))
    assert "Writing settings saved: provider=nvidia model=openai/gpt-oss-20b" in caplog.text
    assert "PRIVATE" not in caplog.text
