from pathlib import Path

local = Path('src/services/discord-local.ts')
s = local.read_text()
s = s.replace(
"export async function sendDiscordEmbed(channelId: string, options: { content?: string; embeds: Record<string, unknown>[]; components?: Record<string, unknown>[] }): Promise<Record<string, unknown>> {\n    return await discordRequest(`/channels/${channelId}/messages`, {\n        method: 'POST',\n        body: JSON.stringify(options),\n    });\n}",
"""export type DiscordTextAttachment = { name: string; content: string; contentType?: string };

function discordMultipartBody(payload: Record<string, unknown>, files: DiscordTextAttachment[]): FormData {
    const formData = new FormData();
    const attachments = files.map((file, index) => ({ id: index, filename: file.name }));
    formData.append('payload_json', JSON.stringify({ ...payload, attachments }));
    files.forEach((file, index) => {
        formData.append(`files[${index}]`, new Blob([file.content], { type: file.contentType || 'text/plain; charset=utf-8' }), file.name);
    });
    return formData;
}

export async function sendDiscordEmbed(channelId: string, options: { content?: string; embeds: Record<string, unknown>[]; components?: Record<string, unknown>[]; files?: DiscordTextAttachment[] }): Promise<Record<string, unknown>> {
    const { files = [], ...payload } = options;
    return await discordRequest(`/channels/${channelId}/messages`, {
        method: 'POST',
        ...(files.length
            ? { body: discordMultipartBody(payload, files), headers: { 'Content-Type': undefined as any } }
            : { body: JSON.stringify(payload) }),
    });
}""", 1)
s = s.replace(
"payload: string | { content?: string; embeds?: Record<string, unknown>[]; components?: Record<string, unknown>[] },\n): Promise<void> {\n    const body = typeof payload === 'string' ? { content: payload } : payload;\n    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {\n        method: 'PATCH',\n        body: JSON.stringify(body),\n    });\n}",
"""payload: string | { content?: string; embeds?: Record<string, unknown>[]; components?: Record<string, unknown>[]; files?: DiscordTextAttachment[] },
): Promise<void> {
    const body = typeof payload === 'string' ? { content: payload } : payload;
    const { files = [], ...rest } = body as Exclude<typeof body, string> & { files?: DiscordTextAttachment[] };
    await discordRequest(`/channels/${channelId}/messages/${messageId}`, {
        method: 'PATCH',
        ...(files.length
            ? { body: discordMultipartBody(rest, files), headers: { 'Content-Type': undefined as any } }
            : { body: JSON.stringify(rest) }),
    });
}""", 1)
# FormData must provide its own multipart boundary; strip the default JSON content-type.
s = s.replace("            'Content-Type': 'application/json',\n            ...options.headers,", "            ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),\n            ...options.headers,")
s = s.replace("headers: { 'Content-Type': undefined as any }", "headers: {}")
local.write_text(s)

structured = Path('src/services/discord-structured-replies.ts')
s = structured.read_text()
s = s.replace("import { deleteMessage, editDiscordMessage, sendDiscordEmbed } from './discord-local';", "import { deleteMessage, editDiscordMessage, sendDiscordEmbed, type DiscordTextAttachment } from './discord-local';", 1)
s = s.replace("  forceCleanup?: boolean;\n};", "  forceCleanup?: boolean;\n  files?: DiscordTextAttachment[];\n};", 1)
s = s.replace("...(replyInput.components?.length ? { components: replyInput.components } : {}),\n  };", "...(replyInput.components?.length ? { components: replyInput.components } : {}),\n    ...(replyInput.files?.length ? { files: replyInput.files } : {}),\n  };", 1)
s = s.replace("sent = replyInput.isPrivate || replyInput.components?.length || (!speaker.tenantId && !replyInput.tenantId)", "sent = replyInput.isPrivate || replyInput.components?.length || replyInput.files?.length || (!speaker.tenantId && !replyInput.tenantId)", 1)
s = s.replace("...(effectiveInput.components?.length ? { components: effectiveInput.components } : {}),\n  };", "...(effectiveInput.components?.length ? { components: effectiveInput.components } : {}),\n    ...(effectiveInput.files?.length ? { files: effectiveInput.files } : {}),\n  };", 1)
structured.write_text(s)

chat = Path('src/services/chat-dispatcher.ts')
s = chat.read_text()
old = """function buildDiscordRelayTranscript(history: RelayConversationTurn[]): string {
    let turns = history.slice(-12);
    const render = () => turns.map((turn) =>
        `**${turn.senderUsername} via ${turn.botName}:** ${turn.message}`
    ).join('\\n\\n');
    let transcript = render();
    while (transcript.length > 3900 && turns.length > 1) {
        turns = turns.slice(1);
        transcript = render();
    }
    return transcript.length <= 3900 ? transcript : `${transcript.slice(0, 3897)}…`;
}"""
new = """function buildDiscordRelayTranscript(history: RelayConversationTurn[]): string {
    const turns = history.slice(-2);
    return turns.map((turn) =>
        `**${turn.senderUsername} via ${turn.botName}:** ${turn.message}`
    ).join('\\n\\n');
}

function buildDiscordRelayHistoryFile(history: RelayConversationTurn[]) {
    if (history.length <= 2) return [];
    const archived = history.slice(0, -2);
    const body = archived.map((turn) => {
        const when = turn.createdAt ? new Date(turn.createdAt).toISOString() : '';
        return `${when ? `[${when}] ` : ''}${turn.senderUsername} via ${turn.botName}: ${turn.message}`;
    }).join('\\n\\n');
    return [{ name: 'relay-history.txt', content: body || 'No archived relay messages.' }];
}"""
assert old in s, 'relay transcript function not found'
s = s.replace(old, new, 1)
s = s.replace("        includeConfiguredMedia: false,\n    });", "        includeConfiguredMedia: false,\n        files: buildDiscordRelayHistoryFile(input.history),\n    });", 1)
s = s.replace("        includeConfiguredMedia: false,\n    });\n    return result.edited;", "        includeConfiguredMedia: false,\n        files: buildDiscordRelayHistoryFile(input.history),\n    });\n    return result.edited;", 1)
chat.write_text(s)

print('compact relay history attachment patch applied')
