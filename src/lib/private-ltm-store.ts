export const privateLtmStore = {
  get: (key: string) => null,
  set: (key: string, value: any) => {},
  getMessages: () => []
};

export async function getPrivateMessageCount(): Promise<number> {
  return 0;
}

export async function incrementPrivateMessageCount(): Promise<number> {
  return 1;
}

export async function getPrivateLTMTitles(): Promise<string[]> {
  return ['Athena\'s Eager Simulation', 'Stream Setup Preferences', 'Chat Moderation Style'];
}