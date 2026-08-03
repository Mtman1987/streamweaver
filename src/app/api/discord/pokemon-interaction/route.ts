import { NextRequest, NextResponse } from 'next/server';
import { buildDiscordBotEmbed } from '@/services/discord-branding';
import {
  actOnDiscordPokemonTrade,
  discordPokemonTradeComponents,
  formatDiscordPokemonTrade,
  getDiscordPokemonTradeCards,
  offerDiscordPokemonCard,
} from '@/services/discord-pokemon-trades';
import { resolveDiscordStreamHubTwitchIdentity } from '@/services/discord-stream-hub';
import { getUserCollection } from '@/services/pokemon-storage-discord';

function authorized(request: NextRequest): boolean {
  const token = String(request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const allowed = [
    process.env.DSH_SERVICE_SECRET,
    process.env.DSH_CLIENT_SECRET,
    process.env.BOT_SECRET_KEY,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return Boolean(token && allowed.includes(token));
}

function rarityScore(rarity: string): number {
  const value = String(rarity || '').toLowerCase();
  if (value.includes('secret') || value.includes('hyper')) return 6;
  if (value.includes('ultra')) return 5;
  if (value.includes('holo')) return 4;
  if (value.includes('rare')) return 3;
  if (value.includes('uncommon')) return 2;
  return 1;
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const customId = String(body?.customId || body?.data?.custom_id || '').trim();
  const values = Array.isArray(body?.values) ? body.values : Array.isArray(body?.data?.values) ? body.data.values : [];
  const actorDiscordId = String(body?.actorDiscordId || body?.member?.user?.id || body?.user?.id || '').trim();
  const actorName = String(body?.actorName || body?.member?.user?.global_name || body?.member?.user?.username || body?.user?.username || 'Discord User').trim();
  const explicitTradeId = String(body?.tradeId || '').trim();
  const explicitAction = body?.action === 'decline' ? 'decline' : body?.action === 'accept' ? 'accept' : '';
  const guildId = String(body?.guildId || body?.guild_id || '').trim();

  const cardViewMatch = customId.match(/^sw_pokemon_trade_cards:([^:]+):(mine|theirs)$/);
  const offerMatch = customId.match(/^sw_pokemon_trade_offer:([^:]+)$/);
  const actionMatch = customId.match(/^sw_pokemon_trade_(accept|decline):([^:]+)$/);
  const tradeId = explicitTradeId || cardViewMatch?.[1] || offerMatch?.[1] || actionMatch?.[2] || '';
  const action = explicitAction || (actionMatch?.[1] === 'accept' || actionMatch?.[1] === 'decline' ? actionMatch[1] : '');

  if (!actorDiscordId || (!tradeId && !customId)) {
    return NextResponse.json({ error: 'actorDiscordId and a supported component action are required' }, { status: 400 });
  }

  try {
    if (customId === 'sw_pokemon_collection:mine' || customId === 'sw_pokemon_deck:mine') {
      if (!guildId) throw new Error('Discord server information is missing.');
      const linked = await resolveDiscordStreamHubTwitchIdentity(actorDiscordId, guildId);
      const pokemonUser = String(linked?.twitchLogin || '').trim().toLowerCase();
      if (!pokemonUser) {
        throw new Error('Link your Twitch account in DiscordStreamHub before opening your Pokémon collection.');
      }

      const collection = await getUserCollection(pokemonUser);
      if (customId === 'sw_pokemon_deck:mine') {
        const cards = collection.deck?.cards || [];
        const lines = cards.slice(0, 25).map((index) => {
          const card = collection.cards[index - 1];
          return card ? `**${card.name}** • ${card.setCode}-${card.number}` : `Missing collection card #${index}`;
        });
        const energy = Object.entries(collection.deck?.energy || {})
          .filter(([, count]) => Number(count) > 0)
          .map(([type, count]) => `${count} ${type}`)
          .join(', ');
        const embed = await buildDiscordBotEmbed({
          description: lines.length ? lines.join('\n') : 'You do not have a saved deck yet.',
          responseType: 'Saved Deck',
          title: `${pokemonUser}'s Pokémon Deck`,
          sourceMessage: 'Build Deck',
          sourceUser: actorName,
          fields: energy ? [{ name: 'Energy', value: energy }] : undefined,
        });
        return NextResponse.json({
          type: 4,
          data: { content: '', embeds: [embed], flags: 64, allowed_mentions: { parse: [] } },
        });
      }

      const rareCount = collection.cards.filter((card) => rarityScore(card.rarity) >= 3).length;
      const uniqueCards = new Set(collection.cards.map((card) => `${card.setCode}:${card.number}`)).size;
      const uniqueSets = new Set(collection.cards.map((card) => card.setCode).filter(Boolean)).size;
      const rarest = [...collection.cards].sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity))[0];
      const description = collection.cards.length
        ? `Your Discord and Twitch cards share one Pokédex.${rarest ? ` Rarest pull: **${rarest.name}** (${rarest.rarity || 'Common'}).` : ''}`
        : 'Your shared Pokémon collection is empty. Use `!pack` to see the available sets.';
      const embed = await buildDiscordBotEmbed({
        description,
        responseType: 'Collection',
        title: `${pokemonUser}'s Pokémon Collection`,
        sourceMessage: 'Open My Cards',
        sourceUser: actorName,
        imageUrl: rarest?.imageUrl,
        fields: [
          { name: 'Total cards', value: String(collection.cards.length), inline: true },
          { name: 'Unique cards', value: String(uniqueCards), inline: true },
          { name: 'Rare cards', value: String(rareCount), inline: true },
          { name: 'Sets collected', value: String(uniqueSets), inline: true },
          { name: 'Packs opened', value: String(collection.packsOpened || 0), inline: true },
        ],
      });
      return NextResponse.json({
        type: 4,
        data: { content: '', embeds: [embed], flags: 64, allowed_mentions: { parse: [] } },
      });
    }

    if (cardViewMatch) {
      const view = cardViewMatch[2] as 'mine' | 'theirs';
      const result = await getDiscordPokemonTradeCards(tradeId, actorDiscordId, view);
      const shown = result.cards.slice(0, 25);
      const description = shown.length
        ? shown.map((card) => `#${card.index + 1} **${card.name}** (${card.setCode}-${card.number}) • ${card.rarity}`).join('\n')
        : `${result.owner.discordName} has no trade-eligible cards.`;
      const embed = await buildDiscordBotEmbed({
        description,
        tenantId: result.trade.tenantId,
        responseType: view === 'mine' ? 'Choose Trade Card' : 'Trade Collection',
        title: `${result.owner.discordName}'s Cards`,
        sourceMessage: view === 'mine' ? 'Choose My Card' : 'View Their Cards',
        sourceUser: actorName,
      });
      const components = view === 'mine' && shown.length
        ? [{
            type: 1,
            components: [{
              type: 3,
              custom_id: `sw_pokemon_trade_offer:${tradeId}`,
              placeholder: 'Choose one card to offer',
              min_values: 1,
              max_values: 1,
              options: shown.map((card) => ({
                label: card.name.slice(0, 100),
                description: `${card.setCode}-${card.number} • ${card.rarity}`.slice(0, 100),
                value: String(card.index + 1),
              })),
            }],
          }]
        : [];
      return NextResponse.json({
        type: 4,
        data: {
          content: '',
          embeds: [embed],
          components,
          flags: 64,
          allowed_mentions: { parse: [] },
        },
      });
    }

    if (offerMatch) {
      const identifier = String(values[0] || '').trim();
      if (!identifier) throw new Error('Choose one card from the list.');
      const trade = await offerDiscordPokemonCard(actorDiscordId, identifier);
      const embed = await buildDiscordBotEmbed({
        description: formatDiscordPokemonTrade(trade),
        tenantId: trade.tenantId,
        responseType: 'Trade Offer',
        title: 'Pokémon Card Trade',
        sourceMessage: 'Choose My Card',
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
    }

    if (!tradeId || !action) {
      return NextResponse.json({ error: 'Unsupported Pokémon interaction' }, { status: 400 });
    }

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
