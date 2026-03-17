'use client';
import { useState } from 'react';

export default function PokemonTestPage() {
  const [username, setUsername] = useState('mtman1987');
  const [userA, setUserA] = useState('mtman1987');
  const [userB, setUserB] = useState('');
  const [result, setResult] = useState('');

  const showCollection = async () => {
    setResult('Loading...');
    try {
      const res = await fetch('/api/pokemon/collection/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username })
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setResult('Error: ' + e.message);
    }
  };

  const showTrade = async () => {
    setResult('Loading...');
    try {
      const res = await fetch('/api/pokemon/trade/show', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userA, userB })
      });
      const data = await res.json();
      setResult(JSON.stringify(data, null, 2));
    } catch (e: any) {
      setResult('Error: ' + e.message);
    }
  };

  return (
    <div style={{ padding: '40px', fontFamily: 'monospace' }}>
      <h1>Pokemon Overlay Triggers</h1>
      
      <div style={{ marginBottom: '40px', padding: '20px', border: '1px solid #ccc' }}>
        <h2>Show Collection</h2>
        <input 
          type="text" 
          value={username} 
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          style={{ padding: '8px', width: '300px', marginRight: '10px' }}
        />
        <button onClick={showCollection} style={{ padding: '8px 20px' }}>
          Show Collection
        </button>
      </div>

      <div style={{ marginBottom: '40px', padding: '20px', border: '1px solid #ccc' }}>
        <h2>Show Trade</h2>
        <input 
          type="text" 
          value={userA} 
          onChange={(e) => setUserA(e.target.value)}
          placeholder="User A"
          style={{ padding: '8px', width: '200px', marginRight: '10px' }}
        />
        <input 
          type="text" 
          value={userB} 
          onChange={(e) => setUserB(e.target.value)}
          placeholder="User B"
          style={{ padding: '8px', width: '200px', marginRight: '10px' }}
        />
        <button onClick={showTrade} style={{ padding: '8px 20px' }}>
          Show Trade
        </button>
      </div>

      <div style={{ padding: '20px', background: '#f5f5f5', borderRadius: '4px' }}>
        <h3>Result:</h3>
        <pre>{result}</pre>
      </div>
    </div>
  );
}
