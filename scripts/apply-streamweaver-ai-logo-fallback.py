from pathlib import Path

branding = Path('src/services/discord-branding.ts')
text = branding.read_text(encoding='utf-8')
old = """    const defaultBotName = input.botName || getBotName(resolvedTenantId);
    const avatarMediaUrl = buildBotAvatarUrl(resolvedTenantId);
    const configuredMediaUrl = input.includeConfiguredMedia
        ? getConfiguredDiscordEmbedMediaUrl(resolvedTenantId, input.mediaSlot)
        : '';
"""
new = """    const defaultBotName = input.botName || getBotName(resolvedTenantId);
    // Only use tenant media when that AI has an avatar explicitly saved.
    // The generated /api/discord-avatar endpoint can fall through to another
    // character's media (for example Scarlett), so it must not be the generic
    // identity for unnamed or newly-created AI speakers.
    const savedAvatarMediaUrl = getConfiguredDiscordEmbedMediaUrl(resolvedTenantId, input.mediaSlot);
    const avatarMediaUrl = savedAvatarMediaUrl || buildStreamWeaverLogoUrl();
    const configuredMediaUrl = input.includeConfiguredMedia
        ? savedAvatarMediaUrl
        : '';
"""
if old not in text:
    raise SystemExit('Expected Discord avatar block not found')
branding.write_text(text.replace(old, new, 1), encoding='utf-8')

replies = Path('src/services/discord-structured-replies.ts')
text = replies.read_text(encoding='utf-8')
text = text.replace(
    "import { buildDiscordBotEmbed, getDiscordBotProfileAvatarUrl, getDiscordBotWebhookIdentity } from './discord-branding';",
    "import { buildDiscordBotEmbed, buildStreamWeaverLogoUrl, getDiscordBotWebhookIdentity } from './discord-branding';",
    1,
)
old = """  const avatarUrl = webhookIdentity.avatarUrl || await getDiscordBotProfileAvatarUrl() || await getAvatarUrlForTenant(speaker.tenantId);
"""
new = """  // Keep Scarlett's saved avatar exclusive to Scarlett. When a speaker has no
  // explicit webhook avatar, brand the webhook with StreamWeaver instead of
  // borrowing the Discord bot profile or another tenant's avatar.
  const avatarUrl = webhookIdentity.avatarUrl || buildStreamWeaverLogoUrl();
"""
if old not in text:
    raise SystemExit('Expected structured reply avatar block not found')
text = text.replace(old, new, 1)
text = text.replace("import { getAvatarUrlForTenant } from './discord-webhook-avatar';\n", '', 1)
replies.write_text(text, encoding='utf-8')
print('StreamWeaver AI logo fallback applied.')
