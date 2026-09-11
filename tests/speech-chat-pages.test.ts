import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import { captureSpeechChat } from '../src/services/speech-chat-capture';
import * as voices from '../src/lib/tts-voices';

// Execute the actual page handlers with browser recognition and network I/O
// replaced. This checks that the selected voice survives the completed capture.
for (const page of ['say-player', 'tts-mixer']) {
  for (const voice of ['edenai:amazon:Joanna', 'deepgram:aura-2:athena']) {
    test(`${page}: growing transcript posts once with ${voice} unchanged`, async () => {
      const requests: any[] = [];
      const recognitions: any[] = [];
      let stateIndex = 0;
      const react = {
        useState(initial: any) {
          const index = stateIndex++;
          let value = typeof initial === 'function' ? initial() : initial;
          if (page === 'say-player' && index === 1) value = 'discord:123456789012345678';
          if (page === 'say-player' && index === 3) value = voice;
          if (page === 'tts-mixer' && index === 1) value = { ...value, selected: ['discord:123456789012345678'], voice };
          return [value, () => {}];
        },
        useRef(value: any) { return { current: value }; },
        useEffect() {},
        useCallback(fn: any) { return fn; },
        useMemo(fn: any) { return fn(); },
      };
      const output = { exports: {} as any };
      const jsx = (type: any, props: any) => ({ type, props });
      const source = readFileSync(new URL(`../src/app/${page}/page.tsx`, import.meta.url), 'utf8');
      const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 } }).outputText;
      vm.runInNewContext(compiled, {
        exports: output.exports,
        require(name: string) {
          if (name === 'react') return react;
          if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx };
          if (name === '@/lib/tts-voices') return voices;
          if (name === '@/services/speech-chat-capture') return { captureSpeechChat };
          throw new Error(`Unexpected import ${name}`);
        },
        crypto: { randomUUID },
        window: { SpeechRecognition: class {
          onend: any;
          constructor() { recognitions.push(this); }
          start() {}
          stop() {}
          abort() { this.onend?.(); }
        } },
        fetch: async (_url: string, options: any) => {
          requests.push(JSON.parse(options.body));
          return { ok: true, json: async () => ({ ok: true }) };
        },
      });
      const tree = output.exports.default();
      const buttons: any[] = [];
      const visit = (node: any) => {
        if (Array.isArray(node)) { node.forEach(visit); return; }
        if (!node?.props) return;
        if (node.type === 'button') buttons.push(node.props);
        visit(node.props.children);
      };
      visit(tree);
      const button = page === 'say-player'
        ? buttons.find(props => String(props.children).includes('Speak to Chat'))
        : buttons.find(props => props.onMouseDown);
      assert.ok(button, 'microphone control must be rendered');
      const start = page === 'say-player' ? button.onClick : button.onMouseDown;
      start();
      start(); // React state may not have rerendered before a second input event.
      assert.equal(recognitions.length, 1);
      const recognition = recognitions[0];
      for (const transcript of ['like', 'like this', 'like this it sends STT']) {
        recognition.onresult({ results: [Object.assign([{ transcript }], { isFinal: true })] });
      }
      assert.equal(requests.length, 0);
      recognition.onend();
      recognition.onend();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(requests.length, 1);
      assert.equal(requests[0].text, 'like this it sends STT');
      assert.equal(requests[0].voice, voice);
      assert.equal(requests[0].streamKey, 'discord:123456789012345678');
      assert.match(requests[0].captureId, /^[0-9a-f-]{36}$/);
    });
  }
}
