"""Offline enum-only station logging; no provider/GPU requests."""
from unittest.mock import patch
import pytest
from pydantic import ValidationError
import main


def test_station_events_are_bounded_and_rate_limited():
    main.live_events.clear()
    main.live_event_last.clear()
    request = main.LiveEventRequest(event='paused', reason='credits')
    with patch.object(main.time, 'monotonic', return_value=100), patch.object(main.log, 'info') as log:
        for _ in range(100):
            assert main.record_live_event(request) == {'ok': True}
        assert len(main.live_events) == 1
        log.assert_called_once_with('Live station: %s (%s)', 'paused', 'credits')
    with patch.object(main.log, 'info'), patch.object(main.time, 'monotonic', side_effect=range(200, 6200, 60)):
        for _ in range(100):
            main.record_live_event(request)
    assert len(main.live_events) == 50
    assert len(main.live_event_last) == 1
    assert all(set(item) == {'at', 'event', 'reason'} for item in main.live_events)


@pytest.mark.parametrize('body', [
    {'event': 'paused', 'reason': 'credits', 'message': 'KEYSECRET'},
    {'event': 'paused', 'reason': '402 private raw provider response'},
    {'event': 'raw exception', 'reason': 'writing'},
])
def test_raw_payloads_rejected(body):
    with pytest.raises(ValidationError):
        main.LiveEventRequest(**body)
