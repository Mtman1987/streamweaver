/** A microphone sends as its authenticated user, independently of the destination. */
export async function sendSignedInTwitchMessage<Client extends { getUsername(): string }>(input: {
  tenantId: string; login: string; channel?: string; message: string;
}, deps: {
  getClient: (tenantId: string) => Client | null;
  reconnect: (tenantId: string) => Promise<unknown>;
  send: (client: Client, channel: string, login: string) => Promise<void>;
}): Promise<string> {
  const tenantId = String(input.tenantId || '').trim();
  const login = String(input.login || '').trim().toLowerCase();
  const channel = String(input.channel || login).replace(/^#/, '').trim().toLowerCase();
  if (!tenantId || !/^[a-z0-9_]{1,25}$/.test(login) || !/^[a-z0-9_]{1,25}$/.test(channel)) {
    throw new Error('A signed-in Twitch account and valid destination are required');
  }
  let client = deps.getClient(tenantId);
  if (!client) {
    await deps.reconnect(tenantId);
    client = deps.getClient(tenantId);
  }
  if (!client || String(client.getUsername() || '').toLowerCase() !== login) {
    throw new Error('Your signed-in Twitch account is not connected. Re-authorize your Twitch account; speech was not posted.');
  }
  await deps.send(client, channel, login);
  return login;
}
