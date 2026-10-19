"""Run inside the worker; proves health and real PCM audio, never a paid call."""
import io
import json
import time
import urllib.error
import urllib.request
import wave

health = json.load(urllib.request.urlopen('http://localhost:8080/health', timeout=10))
assert health['ready'] and health['cpuThreads'] == 2

for voice in ('af_heart', 'af_nicole', 'am_puck', 'bf_emma', 'bm_george'):
    request = urllib.request.Request(
        'http://localhost:8080/v1/audio/speech',
        data=json.dumps({'input': 'Free voice trial is ready.', 'voice': voice}).encode(),
        headers={'Content-Type': 'application/json'},
    )
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                audio = response.read()
            break
        except urllib.error.HTTPError as error:
            # The shared worker may briefly rate-limit bursts during deployment smoke tests.
            # Retry only 429s; surface all other failures immediately.
            if error.code != 429 or attempt == 3:
                raise
            retry_after = error.headers.get('Retry-After')
            try:
                delay = max(1, min(30, int(retry_after))) if retry_after else 2 ** (attempt + 1)
            except ValueError:
                delay = 2 ** (attempt + 1)
            print(
                f'{voice}: worker returned HTTP 429; retry {attempt + 1}/3 '
                f'after {delay}s',
                flush=True,
            )
            error.close()
            time.sleep(delay)
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnframes() > 2400 and wav.getframerate() == 24000
        assert wav.getsampwidth() == 2
    print(f'{voice}: real PCM speech verified ({len(audio)} bytes)', flush=True)
