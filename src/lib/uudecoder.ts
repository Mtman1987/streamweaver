/**
 * UUDecoder utility for decoding UUEncoded Streamerbot exports
 */
import * as pako from 'pako';

export function uudecode(encoded: string): string {
  const trimmed = encoded.trim();
  
  try {
    // Clean base64 string - remove all whitespace
    const base64Cleaned = trimmed.replace(/\s+/g, '');
    
    // Validate base64
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64Cleaned)) {
      throw new Error('Invalid base64 format');
    }
    
    // Decode base64 to binary using proper method
    const binaryString = atob(base64Cleaned);
    
    // Convert to Uint8Array properly
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i) & 0xFF;
    }
    
    console.log('First few bytes:', Array.from(bytes.slice(0, 10)).map(b => b.toString(16)).join(' '));
    
    // Look for gzip header (0x1f 0x8b) anywhere in the first few bytes
    let gzipStart = -1;
    for (let i = 0; i < Math.min(bytes.length - 1, 10); i++) {
      if (bytes[i] === 0x1f && bytes[i + 1] === 0x8b) {
        gzipStart = i;
        break;
      }
    }
    
    if (gzipStart !== -1) {
      console.log('Detected gzip format at position:', gzipStart);
      // Extract gzip data starting from the header
      const gzipData = bytes.slice(gzipStart);
      const decompressed = pako.inflate(gzipData, { to: 'string' });
      console.log('Decompressed length:', decompressed.length);
      console.log('Decompressed preview:', decompressed.substring(0, 200));
      return decompressed;
    }
    
    // If not gzipped, convert bytes back to string
    const result = new TextDecoder('utf-8').decode(bytes);
    console.log('Non-gzipped result preview:', result.substring(0, 200));
    return result;
  } catch (e) {
    console.error('UUDecode error:', e);
    throw new Error(`Failed to decode: ${e instanceof Error ? e.message : 'Unknown error'}`);
  }
}

export function isUUEncoded(text: string): boolean {
  // Check for traditional UUEncoding
  if (text.includes('begin ') && text.includes('end')) {
    return true;
  }
  
  // Check for base64-like encoding (Streamerbot format)
  const trimmed = text.trim();
  
  // More specific check for base64 gzipped data
  if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.length > 50) {
    // Check if it starts with common gzip base64 patterns
    const cleaned = trimmed.replace(/\s/g, '');
    if (cleaned.startsWith('H4sI') || cleaned.startsWith('UEsD') || cleaned.startsWith('SBAE')) {
      return true;
    }
    // Fallback for other base64 patterns
    if (trimmed.length > 100) {
      return true;
    }
  }
  
  return false;
}