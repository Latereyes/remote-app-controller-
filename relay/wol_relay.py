#!/usr/bin/env python3
"""Relay Wake-on-LAN per il telefono vecchio (Termux).

Riceve dall'app, via Tailscale, `POST /wake` con il token e manda il magic packet al PC sulla rete di casa.
Solo libreria standard di Python. Configurazione in relay.json accanto a questo file (creato al primo avvio).
"""
import hmac
import json
import os
import re
import secrets
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE = os.environ.get("RELAY_CONFIG", os.path.join(HERE, "relay.json"))

DEFAULTS = {
    "host": "0.0.0.0",
    "port": 8765,
    "token": "",
    "mac": "",                      # MAC della scheda di rete del PC, es. "AA:BB:CC:DD:EE:FF"
    "broadcast": "255.255.255.255", # meglio l'indirizzo di broadcast della rete, es. "192.168.1.255"
    "pc_host": "",                  # IP del PC in casa (facoltativo, per /status)
    "agent_port": 7070,
}


def parse_mac(mac):
    hexdigits = re.sub(r"[^0-9a-fA-F]", "", mac or "")
    if len(hexdigits) != 12:
        raise ValueError(f"MAC non valido: {mac!r}")
    return bytes.fromhex(hexdigits)


def magic_packet(mac):
    """6 byte 0xFF seguiti dal MAC ripetuto 16 volte."""
    return b"\xff" * 6 + parse_mac(mac) * 16


def send_magic_packet(mac, broadcast, repeats=3):
    packet = magic_packet(mac)
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(repeats):
            for port in (9, 7):
                s.sendto(packet, (broadcast, port))
            time.sleep(0.1)


def tcp_open(host, port, timeout=1.5):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def load_config(path=CONFIG_FILE):
    created = False
    if not os.path.exists(path):
        cfg = dict(DEFAULTS, token=secrets.token_urlsafe(24))
        with open(path, "w") as f:
            json.dump(cfg, f, indent=2)
        created = True
    with open(path) as f:
        cfg = dict(DEFAULTS, **json.load(f))
    if len(cfg["token"]) < 16:
        raise ValueError("token mancante o troppo corto in relay.json (servono almeno 16 caratteri)")
    return cfg, created


def make_handler(cfg, wake=send_magic_packet, probe=tcp_open):
    failures = {}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *args):
            sys.stderr.write("%s %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

        def send_json(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            ip = self.client_address[0]
            now = time.time()
            recent = [t for t in failures.get(ip, []) if now - t < 60]
            if len(recent) >= 10:
                self.send_json(429, {"error": "troppi tentativi, riprova tra un minuto"})
                return False
            header = self.headers.get("Authorization", "")
            given = header[7:] if header.startswith("Bearer ") else ""
            if not hmac.compare_digest(given.encode(), cfg["token"].encode()):
                failures[ip] = recent + [now]
                self.send_json(401, {"error": "token mancante o sbagliato"})
                return False
            return True

        def do_GET(self):
            if self.path == "/health":
                return self.send_json(200, {"ok": True, "service": "wol-relay"})
            if self.path == "/status":
                if not self.authorized():
                    return
                host = cfg.get("pc_host")
                up = bool(host) and probe(host, int(cfg["agent_port"]))
                return self.send_json(200, {"pcHost": host or None, "agentReachable": up})
            self.send_json(404, {"error": "rotta sconosciuta"})

        def do_POST(self):
            length = int(self.headers.get("Content-Length") or 0)
            if length:
                self.rfile.read(min(length, 4096))
            if self.path != "/wake":
                return self.send_json(404, {"error": "rotta sconosciuta"})
            if not self.authorized():
                return
            try:
                wake(cfg["mac"], cfg["broadcast"])
            except (ValueError, OSError) as e:
                return self.send_json(500, {"error": f"invio non riuscito: {e}"})
            self.log_message("magic packet inviato a %s via %s", cfg["mac"], cfg["broadcast"])
            self.send_json(200, {"ok": True, "sentTo": cfg["mac"]})

    return Handler


def main():
    try:
        cfg, created = load_config()
    except (ValueError, json.JSONDecodeError) as e:
        sys.exit(f"Configurazione non valida ({CONFIG_FILE}): {e}")
    if created or not cfg["mac"]:
        print(f"Configurazione in {CONFIG_FILE}")
        print(f"Token per l'app: {cfg['token']}")
        if not cfg["mac"]:
            print("Manca il MAC del PC: impostalo in relay.json (\"mac\") e riavvia.")
    server = ThreadingHTTPServer((cfg["host"], int(cfg["port"])), make_handler(cfg))
    print(f"Relay Wake-on-LAN in ascolto sulla porta {cfg['port']}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
