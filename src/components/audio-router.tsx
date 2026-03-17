"use client";

import React, { useEffect, useState, useRef } from "react";
import { getBrowserWebSocketUrl } from "@/lib/ws-config";

type DeviceInfoSimple = {
  deviceId: string;
  label: string;
};

export default function AudioRouter() {
  const [outputs, setOutputs] = useState<DeviceInfoSimple[]>([]);
  const [inputs, setInputs] = useState<DeviceInfoSimple[]>([]);
  const [selectedOutput, setSelectedOutput] = useState<string>("");
  const [selectedInput, setSelectedInput] = useState<string>("");
  const [status, setStatus] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    // Listen for TTS via WebSocket
    const ws = new WebSocket(getBrowserWebSocketUrl());
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'play-tts' && data.payload?.audioDataUri) {
          playTTS(data.payload.audioDataUri);
        }
      } catch (e) {
        console.error('WS message error:', e);
      }
    };
    return () => ws.close();
  }, [selectedOutput]);

  function playTTS(audioDataUri: string) {
    if (!ttsAudioRef.current) {
      const a = document.createElement('audio');
      a.style.display = 'none';
      document.body.appendChild(a);
      ttsAudioRef.current = a;
    }
    const a = ttsAudioRef.current;
    a.src = audioDataUri;
    if ((a as any).setSinkId && selectedOutput) {
      (a as any).setSinkId(selectedOutput).then(() => a.play()).catch(() => a.play());
    } else {
      a.play();
    }
  }

  useEffect(() => {
    async function refreshDevices() {
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
          setStatus('Media devices API not available');
          return;
        }

        // Trigger permission prompt for labels to be populated
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          // ignore user denial, labels may be empty
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const outs = devices
          .filter(d => d.kind === 'audiooutput')
          .map(d => ({ deviceId: d.deviceId, label: d.label || 'Unknown output' }));
        const ins = devices
          .filter(d => d.kind === 'audioinput')
          .map(d => ({ deviceId: d.deviceId, label: d.label || 'Unknown input' }));

        setOutputs(outs);
        setInputs(ins);

        // load saved settings
        try {
          const resp = await fetch('/api/audio/settings');
          if (resp.ok) {
            const data = await resp.json();
            if (data.output) setSelectedOutput(data.output);
            if (data.input) setSelectedInput(data.input);
          }
        } catch (e) {
          // ignore
        }
      } catch (err) {
        console.error('Error enumerating devices', err);
        setStatus('Failed to list audio devices');
      }
    }

    refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshDevices);
  }, []);

  async function saveSettings() {
    try {
      const resp = await fetch('/api/audio/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ output: selectedOutput, input: selectedInput })
      });
      if (!resp.ok) throw new Error('Save failed');
      setStatus('Saved');
      setTimeout(() => setStatus(null), 2000);
    } catch (err: any) {
      console.error('Failed to save audio settings', err);
      setStatus('Save failed');
    }
  }

  async function playTestSound() {
    try {
      if (!audioRef.current) {
        const a = document.createElement('audio');
        a.controls = true;
        a.style.display = 'none';
        document.body.appendChild(a);
        audioRef.current = a;
      }

      const a = audioRef.current;
      // Create a short beep via WebAudio and capture as blob
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.value = 0.0001; // very low - we'll render offline

      // Use OfflineAudioContext to render and play via audio element so we can set sinkId
      const offline = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(1, ctx.sampleRate * 0.25, ctx.sampleRate);
      const o2 = offline.createOscillator();
      const g2 = offline.createGain();
      o2.type = 'sine';
      o2.frequency.value = 880;
      o2.connect(g2);
      g2.connect(offline.destination);
      g2.gain.value = 0.2;
      o2.start(0);
      offline.startRendering().then(rendered => {
        const wav = audioBufferToWav(rendered);
        const blob = new Blob([new DataView(wav)], { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        a.src = url;

        // set sink if available
        if ((a as any).setSinkId && selectedOutput) {
          try {
            (a as any).setSinkId(selectedOutput).then(() => {
              a.play();
            }).catch((e: any) => {
              console.warn('setSinkId failed', e);
              a.play();
            });
          } catch (e) {
            console.warn('setSinkId error', e);
            a.play();
          }
        } else {
          a.play();
        }
      });
    } catch (err) {
      console.error('Failed to play test sound', err);
      setStatus('Playback failed');
    }
  }

  // helper: convert AudioBuffer to WAV ArrayBuffer
  function audioBufferToWav(buffer: AudioBuffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const samples = buffer.getChannelData(0);
    const bufferLength = samples.length * 2 + 44;
    const arrayBuffer = new ArrayBuffer(bufferLength);
    const view = new DataView(arrayBuffer);

    function writeString(view: DataView, offset: number, string: string) {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    }

    let offset = 0;
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + samples.length * 2, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;
    view.setUint16(offset, 1, true); offset += 2;
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, sampleRate * numChannels * 2, true); offset += 4;
    view.setUint16(offset, numChannels * 2, true); offset += 2;
    view.setUint16(offset, 16, true); offset += 2;
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, samples.length * 2, true); offset += 4;

    // PCM 16-bit
    let idx = 0;
    for (let i = 0; i < samples.length; i++, idx += 2) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset + idx, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }

    return arrayBuffer;
  }

  return (
    <div className="p-4 border rounded">
      <h3 className="font-semibold mb-2">Audio Router (Virtual Cable)</h3>
      <div className="mb-2">
        <label className="block text-sm">AI Output (choose your VB-Cable output)</label>
        <select aria-label="AI Output Device" value={selectedOutput} onChange={e => setSelectedOutput(e.target.value)} className="w-full bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="" className="bg-background text-foreground">-- select output --</option>
          {outputs.map(o => (
            <option key={o.deviceId} value={o.deviceId} className="bg-background text-foreground">{o.label || o.deviceId}</option>
          ))}
        </select>
      </div>

      <div className="mb-2">
        <label className="block text-sm">My Mic/Target (where your mic is picked up)</label>
        <select aria-label="My Mic Target" value={selectedInput} onChange={e => setSelectedInput(e.target.value)} className="w-full bg-background border border-border rounded-md px-3 py-2 text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
          <option value="" className="bg-background text-foreground">-- select input --</option>
          {inputs.map(i => (
            <option key={i.deviceId} value={i.deviceId} className="bg-background text-foreground">{i.label || i.deviceId}</option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button onClick={saveSettings} className="px-3 py-1 border rounded">Save</button>
        <button onClick={playTestSound} className="px-3 py-1 border rounded">Play Test Sound</button>
        <button onClick={() => { navigator.mediaDevices.enumerateDevices().then(d => alert(JSON.stringify(d, null, 2))); }} className="px-3 py-1 border rounded">Dump Devices</button>
      </div>

      {status && <div className="mt-2 text-sm">{status}</div>}
    </div>
  );
}
