import path from 'path';
import { readJsonFile, writeJsonFile } from './storage';

const BITS_FILE = 'bits.json';

type BitsRecord = Record<
  string,
  {
    bits: number;
    totalSpent: number;
    totalEarned: number;
    updatedAt: string;
  }
>;

async function loadBits(): Promise<BitsRecord> {
  return readJsonFile<BitsRecord>(BITS_FILE, {});
}

async function saveBits(data: BitsRecord): Promise<void> {
  await writeJsonFile(BITS_FILE, data);
}

export async function getBits(userId: string): Promise<{ bits: number; totalSpent: number; totalEarned: number }> {
  const store = await loadBits();
  const entry = store[userId.toLowerCase()];
  return entry ? {
    bits: entry.bits,
    totalSpent: entry.totalSpent,
    totalEarned: entry.totalEarned
  } : { bits: 0, totalSpent: 0, totalEarned: 0 };
}

export async function addBits(
  userId: string,
  amount: number
): Promise<{ bits: number; totalSpent: number; totalEarned: number }> {
  const store = await loadBits();
  const key = userId.toLowerCase();
  const current = store[key] ?? { bits: 0, totalSpent: 0, totalEarned: 0, updatedAt: new Date().toISOString() };
  const newBits = Math.max(0, current.bits + amount);
  const newTotalEarned = current.totalEarned + (amount > 0 ? amount : 0);
  store[key] = {
    bits: newBits,
    totalSpent: current.totalSpent,
    totalEarned: newTotalEarned,
    updatedAt: new Date().toISOString()
  };
  await saveBits(store);
  return { bits: newBits, totalSpent: current.totalSpent, totalEarned: newTotalEarned };
}

export async function spendBits(
  userId: string,
  amount: number
): Promise<{ bits: number; totalSpent: number; totalEarned: number } | null> {
  const store = await loadBits();
  const key = userId.toLowerCase();
  const current = store[key];
  if (!current || current.bits < amount) {
    return null; // Insufficient bits
  }
  const newBits = current.bits - amount;
  const newTotalSpent = current.totalSpent + amount;
  store[key] = {
    bits: newBits,
    totalSpent: newTotalSpent,
    totalEarned: current.totalEarned,
    updatedAt: new Date().toISOString()
  };
  await saveBits(store);
  return { bits: newBits, totalSpent: newTotalSpent, totalEarned: current.totalEarned };
}

export async function setBits(
  userId: string,
  value: number
): Promise<{ bits: number; totalSpent: number; totalEarned: number }> {
  const store = await loadBits();
  const key = userId.toLowerCase();
  const current = store[key] ?? { bits: 0, totalSpent: 0, totalEarned: 0, updatedAt: new Date().toISOString() };
  const bits = Math.max(0, value);
  store[key] = { bits, totalSpent: current.totalSpent, totalEarned: current.totalEarned, updatedAt: new Date().toISOString() };
  await saveBits(store);
  return { bits, totalSpent: current.totalSpent, totalEarned: current.totalEarned };
}

export async function getBitsLeaderboard(limit = 10): Promise<Array<{ user: string; bits: number; totalSpent: number; totalEarned: number }>> {
  const store = await loadBits();
  return Object.entries(store)
    .map(([user, data]) => ({ user, bits: data.bits, totalSpent: data.totalSpent, totalEarned: data.totalEarned }))
    .sort((a, b) => b.bits - a.bits)
    .slice(0, limit);
}
