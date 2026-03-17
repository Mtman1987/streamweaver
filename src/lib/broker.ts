function normalizeBaseUrl(value: string): string {
  // Remove trailing slashes for consistent URL joining.
  return value.replace(/\/+$/, "");
}

export function getBrokerBaseUrl(): string | undefined {
  const raw = process.env.BROKER_BASE_URL || process.env.STREAMWEAVER_BROKER_BASE_URL;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return normalizeBaseUrl(trimmed);
}

export function isBrokerEnabled(): boolean {
  return Boolean(getBrokerBaseUrl());
}

export async function getBrokerAuthHeaders(): Promise<Record<string, string>> {
  const { installId, installSecret } = await getOrCreateInstallIdentity();
  return {
    "x-streamweaver-install-id": installId,
    "x-streamweaver-install-secret": installSecret,
  };
}

export function joinBrokerUrl(baseUrl: string, path: string): string {
  if (path.startsWith("/")) return `${baseUrl}${path}`;
  return `${baseUrl}/${path}`;
}

async function getOrCreateInstallIdentity(): Promise<{ installId: string; installSecret: string }> {
  if (process.env.STREAMWEAVER_INSTALL_ID && process.env.STREAMWEAVER_INSTALL_SECRET) {
    return {
      installId: process.env.STREAMWEAVER_INSTALL_ID,
      installSecret: process.env.STREAMWEAVER_INSTALL_SECRET,
    };
  }

  if (typeof window === 'undefined') {
    try {
      const fs = await import('fs');
      const path = await import('path');
      const crypto = await import('crypto');

      const filePath = path.join(process.cwd(), 'install-identity.json');

      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(content);
      }

      const identity = {
        installId: crypto.randomUUID(),
        installSecret: crypto.randomBytes(32).toString('hex'),
      };

      fs.writeFileSync(filePath, JSON.stringify(identity, null, 2));
      return identity;
    } catch (e) {
      console.error("Failed to load/save install identity:", e);
    }
  }
  return { installId: "ephemeral", installSecret: "ephemeral" };
}
