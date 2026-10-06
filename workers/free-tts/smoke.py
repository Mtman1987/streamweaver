"""Run inside the worker; proves health and real PCM audio, never a paid call."""
import io
import json
import urllib.request
import wave

health = json.load(urllib.request.urlopen('http://localhost:8080/health', timeout=10))
assert health['ready'] and health['cpuThreads'] == 2
for voice in ('af_heart', 'am_michael'):
    request = urllib.request.Request('http://localhost:8080/v1/audio/speech', data=json.dumps({'input': 'Free voice trial is ready.', 'voice': voice}).encode(), headers={'Content-Type': 'application/json'})
    audio = urllib.request.urlopen(request, timeout=45).read()
    with wave.open(io.BytesIO(audio)) as wav:
        assert wav.getnframes() > 2400 and wav.getframerate() == 24000
        assert wav.getsampwidth() == 2
    print(f'{voice}: real PCM speech verified ({len(audio)} bytes)')
