"""Private Kokoro voice trial: one inference at a time, two CPU threads."""
import io
import json
import os
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

VOICES = {"af_heart", "af_bella", "am_michael"}
options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.inter_op_num_threads = 1
options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
session = ort.InferenceSession(os.getenv("MODEL_PATH", "/models/kokoro.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
engine = Kokoro.from_session(session, os.getenv("VOICES_PATH", "/models/voices.bin"))
lock = threading.Lock()
# Fail startup rather than advertising a ready but broken worker.
engine.create("Voice ready.", voice="af_heart", lang="en-us")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass  # Never log request text or credentials.

    def reply(self, status, body, content_type="application/json"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        if self.path != "/health":
            return self.reply(404, b'{"error":"not found"}')
        self.reply(200, b'{"ready":true,"provider":"kokoro","cpuThreads":2}')

    def do_POST(self):
        if self.path != "/v1/audio/speech":
            return self.reply(404, b'{"error":"not found"}')
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 16384:
                return self.reply(413, b'{"error":"invalid body size"}')
            payload = json.loads(self.rfile.read(size))
            text = payload.get("input", "")
            voice = payload.get("voice", "af_heart")
            if not isinstance(text, str) or not text.strip() or len(text) > 2000 or voice not in VOICES:
                return self.reply(400, b'{"error":"invalid text or voice"}')
        except (ValueError, AttributeError, TypeError):
            return self.reply(400, b'{"error":"invalid request"}')
        if not lock.acquire(blocking=False):
            return self.reply(429, b'{"error":"voice worker busy"}')
        try:
            samples, rate = engine.create(text.strip(), voice=voice, lang="en-us")
            audio = io.BytesIO()
            sf.write(audio, samples, rate, format="WAV", subtype="PCM_16")
            self.reply(200, audio.getvalue(), "audio/wav")
        except Exception:
            self.reply(503, b'{"error":"voice temporarily unavailable"}')
        finally:
            lock.release()


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()

    def get_request(self):
        connection, address = super().get_request()
        connection.settimeout(15)
        return connection, address


if __name__ == "__main__":
    print("Kokoro ready; two CPU threads; private port 8080", flush=True)
    Server(("::", 8080), Handler).serve_forever()
