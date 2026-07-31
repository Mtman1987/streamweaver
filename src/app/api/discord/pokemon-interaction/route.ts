import { NextRequest, NextResponse } from 'next/server';
import { buildDiscordBotEmbed } from '@/services/discord-branding';
import {
  actOnDiscordPokemonTrade,
  discordPokemonTradeComponents,
  formatDiscordPokemonTrade,
} from '@/services/discord-pokemon-trades';

function authorized(request: NextRequest): boolean {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const allowed = [
    process.env.DSH_SERVICE_SECRET,
    process.env.DSH_CLIENT_SECRET,
    process.env.BOT_SECRET_KEY,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return Boolean(token && allowed.includes(token));
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const tradeId = String(body?.tradeId || '').trim();
  const actorDiscordId = String(body?.actorDiscordId || '').trim();
  const actorName = String(body?.actorName || 'Discord User').trim();
  const action = body?.action === 'decline' ? 'decline' : body?.action === 'accept' ? 'accept' : '';
  if (!tradeId || !actorDiscordId || !action) {
    return NextResponse.json({ error: 'tradeId, actorDiscordId, and action are required' }, { status: 400 });
  }

  try {
    const result = await actOnDiscordPokemonTrade(tradeId, actorDiscordId, action);
    const trade = result.trade;
    const completedMessage = result.completed
      ? `✅ Trade complete!\n\n**${trade.initiator.discordName}** received **${result.completed.cardB.name}**.\n**${trade.target.discordName}** received **${result.completed.cardA.name}**.`
      : trade.status === 'cancelled'
        ? `Trade declined by **${actorName}**. No cards moved.`
        : formatDiscordPokemonTrade(trade);
    const embed = await buildDiscordBotEmbed({
      description: completedMessage,
      tenantId: trade.tenantId,
      responseType: result.completed ? 'Trade Complete' : trade.status === 'cancelled' ? 'Trade Declined' : 'Trade Confirmation',
      title: 'Pokémon Card Trade',
      sourceMessage: action === 'accept' ? 'Accept Trade' : 'Decline Trade',
      sourceUser: actorName,
    });
    return NextResponse.json({
      type: 7,
      data: {
        content: '',
        embeds: [embed],
        components: discordPokemonTradeComponents(trade),
        allowed_mentions: { parse: [] },
      },
    });
  } catch (error: any) {
    const embed = await buildDiscordBotEmbed({
      description: error?.message || 'That trade action could not be completed.',
      responseType: 'Trade Error',
      title: 'Pokémon Card Trade',
      sourceMessage: action === 'accept' ? 'Accept Trade' : 'Decline Trade',
      sourceUser: actorName,
    });
    return NextResponse.json({
      type: 4,
      data: {
        content: '',
        embeds: [embed],
        flags: 64,
        allowed_mentions: { parse: [] },
      },
    });
  }
}
