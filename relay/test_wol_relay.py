import json
import os
import tempfile
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

import wol_relay

TOKEN = "segreto-segreto-123"


class MagicPacketTest(unittest.TestCase):
    def test_packet_layout(self):
        p = wol_relay.magic_packet("AA:bb-CC:dd:EE:ff")
        self.assertEqual(len(p), 102)
        self.assertEqual(p[:6], b"\xff" * 6)
        self.assertEqual(p[6:12], bytes.fromhex("aabbccddeeff"))
        self.assertEqual(p[-6:], bytes.fromhex("aabbccddeeff"))

    def test_bad_mac(self):
        with self.assertRaises(ValueError):
            wol_relay.magic_packet("12:34")

    def test_config_created_with_token(self):
        with tempfile.TemporaryDirectory() as d:
            path = os.path.join(d, "relay.json")
            cfg, created = wol_relay.load_config(path)
            self.assertTrue(created)
            self.assertGreaterEqual(len(cfg["token"]), 16)
            self.assertEqual(cfg["port"], 8765)
            _, created = wol_relay.load_config(path)
            self.assertFalse(created)


class ServerTest(unittest.TestCase):
    def setUp(self):
        self.sent = []
        cfg = dict(wol_relay.DEFAULTS, token=TOKEN, mac="AA:BB:CC:DD:EE:FF", pc_host="192.168.1.12")
        handler = wol_relay.make_handler(cfg, wake=lambda mac, bc: self.sent.append((mac, bc)), probe=lambda h, p: True)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, path, method="GET", token=TOKEN):
        req = urllib.request.Request(self.base + path, method=method, data=b"" if method == "POST" else None)
        if token:
            req.add_header("Authorization", f"Bearer {token}")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_health_is_public(self):
        self.assertEqual(self.call("/health", token=None)[0], 200)

    def test_wake_needs_token(self):
        self.assertEqual(self.call("/wake", "POST", token=None)[0], 401)
        self.assertEqual(self.call("/wake", "POST", token="sbagliato")[0], 401)
        self.assertEqual(self.sent, [])
        status, body = self.call("/wake", "POST")
        self.assertEqual(status, 200)
        self.assertEqual(self.sent, [("AA:BB:CC:DD:EE:FF", "255.255.255.255")])

    def test_status(self):
        self.assertEqual(self.call("/status"), (200, {"pcHost": "192.168.1.12", "agentReachable": True}))

    def test_rate_limit(self):
        for _ in range(10):
            self.call("/wake", "POST", token="no")
        self.assertEqual(self.call("/wake", "POST")[0], 429)


if __name__ == "__main__":
    unittest.main()
