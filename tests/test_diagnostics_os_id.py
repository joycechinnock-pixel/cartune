import cartune_orchestrator as co


class FakeResponse:
    def __init__(self, value=None, is_null_flag=False):
        self._value = value
        self._is_null_flag = is_null_flag

    def is_null(self):
        return self._is_null_flag

    @property
    def value(self):
        return self._value


class FakeConnection:
    def __init__(self, responses: dict, raise_on_query=False):
        self.responses = responses
        self.raise_on_query = raise_on_query
        self.closed = False

    def query(self, command):
        if self.raise_on_query:
            raise RuntimeError("adapter dropped mid-query")
        return self.responses.get(command, FakeResponse(is_null_flag=True))

    def close(self):
        self.closed = True


class FakeCommands:
    CALIBRATION_ID = "CALIBRATION_ID"


class FakeObdModule:
    commands = FakeCommands()


def test_os_id_is_none_when_obd_library_is_not_installed(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "obd", None)
    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: None)

    result = co.DiagnosticsAgent(tmp_path).run()

    assert result["os_id"] is None


def test_os_id_is_none_when_no_connection_available(tmp_path, monkeypatch):
    monkeypatch.setattr(co, "obd", FakeObdModule())
    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: None)

    result = co.DiagnosticsAgent(tmp_path).run()

    assert result["os_id"] is None


def test_os_id_is_read_via_standard_calibration_id_pid(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({fake_obd.commands.CALIBRATION_ID: FakeResponse(value="12345678")})
    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: fake_conn)

    result = co.DiagnosticsAgent(tmp_path).run()

    assert result["os_id"] == "12345678"
    assert fake_conn.closed is True, "connection must always be closed after the read"


def test_os_id_is_none_when_pcm_returns_null_for_mode_09(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({fake_obd.commands.CALIBRATION_ID: FakeResponse(is_null_flag=True)})
    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: fake_conn)

    result = co.DiagnosticsAgent(tmp_path).run()

    assert result["os_id"] is None


def test_os_id_read_failure_degrades_to_none_not_a_crash(tmp_path, monkeypatch):
    fake_obd = FakeObdModule()
    monkeypatch.setattr(co, "obd", fake_obd)
    fake_conn = FakeConnection({}, raise_on_query=True)
    monkeypatch.setattr(co, "_open_obd_connection", lambda portstr=None: fake_conn)

    result = co.DiagnosticsAgent(tmp_path).run()

    assert result["os_id"] is None
    assert fake_conn.closed is True, "connection must be closed even after a failed query"
