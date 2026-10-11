"""J1939 helpers used for heavy trucks and machinery."""
import cartune_orchestrator as co


def test_extended_vs_standard_ids():
    assert co.is_j1939_frame_id(0x18FECA00)
    assert not co.is_j1939_frame_id(0x7E8)


def test_source_address_and_pgn_broadcast():
    # DM1 from engine #1: priority 6, PGN 65226 (0xFECA), SA 0x00
    can_id = 0x18FECA00
    assert co.j1939_source_address(can_id) == 0x00
    assert co.j1939_pgn(can_id) == co.PGN_DM1


def test_pgn_pdu1_drops_destination():
    # UDS request to engine from tester: 18DA00F9 -> PGN 0xDA00 (55808)
    assert co.j1939_pgn(0x18DA00F9) == 0xDA00
    assert co.j1939_source_address(0x18DA00F9) == co.J1939_TESTER_SA


def test_decode_dm1_single_dtc():
    # SPN 100 (oil pressure), FMI 1, occurrence 3
    data = bytes([0x04, 0xFF, 100, 0x00, 0x01, 0x03, 0xFF, 0xFF])
    assert co.decode_dm1_dtcs(data) == [{"spn": 100, "fmi": 1, "occurrences": 3}]


def test_decode_dm1_high_spn_bits():
    # SPN 3226 (0xC9A) needs no high bits; SPN 520192 (0x7F000) uses them
    spn = 0x7F000
    b = bytes([spn & 0xFF, (spn >> 8) & 0xFF, ((spn >> 16) << 5) | 4, 1])
    assert co.decode_dm1_dtcs(bytes([0, 0]) + b) == [{"spn": spn, "fmi": 4, "occurrences": 1}]


def test_decode_dm1_no_active_codes():
    assert co.decode_dm1_dtcs(bytes([0x00, 0xFF, 0, 0, 0, 0, 0xFF, 0xFF])) == []


def test_module_list_matches_app():
    assert co.J1939_MODULES[0x00] == "Engine #1"
    assert co.J1939_MODULES[0x3D] == "Exhaust emission controller"
