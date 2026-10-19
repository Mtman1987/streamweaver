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
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                audio = response.read()
            break
        except urllib.error.HTTPError as error:
            # A shared worker may briefly rate-limit deployment smoke-test bursts.
            # Respect Retry-After; otherwise back off for a full minute.
            if error.code != 429 or attempt == 2:
                raise
            retry_after = error.headers.get('Retry-After')
            try:
                delay = max(1, min(120, int(retry_after))) if retry_after else 60 * (attempt + 1)
            except ValueError:
                delay = 60 * (attempt + 1)
            print(
                f'{voice}: worker returned HTTP 429; retry {attempt + 1}/2 '
                f'after {delay}s',
                flush=True,
            )
            error.close()
            time.sleep(delay)
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnframes() > 2400 and wav.getframerate() == 24000
        assert wav.getsampwidth() == 2
    print(f'{voice}: real PCM speech verified ({len(audio)} bytes)', flush=True)
