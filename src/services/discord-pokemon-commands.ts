import type { StorageContext } from './storage';
import { getConfigSection } from '@/lib/local-config/service';
import { addPoints, getPoints } from './points';
import { getUserCards } from './pokemon-collection';
import { getUserCollection } from './pokemon-storage-discord';
import { formatSetList, getEnabledSetMap, openEeveePack, openPack } from './pokemon-packs';
import {
  getDiscordStreamHubCheckinMembers,
  resolveDiscordStreamHubTwitchIdentity,
} from './discord-stream-hub';
import { sendStructuredDiscordReply } from './discord-structured-replies';
import { sendAnimatedPackReveal } from './discord-pack-reveal';
import { buildDiscordUserAvatarUrl } from './discord-branding';
import {
  createDiscordPokemonTrade,
  discordPokemonTradeComponents,
  formatDiscordPokemonTrade,
  offerDiscordPokemonCard,
} from './discord-pokemon-trades';

const DISCORD_POKEMON_COMMANDS = new Set(['pack', 'collection', 'collections', 'show', 'eevee', 'deck', 'trade', 'offer']);

function messageUser(msg: any) {
  const user = msg.author || {};
  return {
    discordId: String(user.id || msg.userId || msg.user_id || '').trim(),
    discordName: String(user.globalName || user.global_name || user.username || 'Discord User').trim(),
    avatarUrl: String(
      user.avatarUrl
      || user.displayAvatarURL
      || msg.userAvatar
      || msg.avatarUrl
      || msg.avatar_url
      || buildDiscordUserAvatarUrl(user.id || msg.userId || msg.user_id, user.avatar)
      || '',
    ).trim(),
  };
}

function targetDiscordId(msg: any, rawTarget: string): string {
  const explicit = String(rawTarget || '').match(/^<@!?(\d+)>$/)?.[1];
  if (explicit) return explicit;
  const users = msg.mentions?.users;
  if (typeof users?.first === 'function') return String(users.first()?.id || '');
  if (typeof users?.values === 'function') return String(users.values().next().value?.id || '');
  if (Array.isArray(users)) return String(users[0]?.id || '');
  if (Array.isArray(msg.mentions)) return String(msg.mentions[0]?.id || '');
  return '';
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

function findCard(cards: any[], identifier: string) {
  const normalized = String(identifier || '').trim().toLowerCase();
  if (!normalized) return { card: null, index: -1, ambiguous: false };
  const numeric = Number(normalized.replace(/^#/, ''));
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= cards.length) {
    return { card: cards[numeric - 1], index: numeric - 1, ambiguous: false };
  }
  const setMatch = normalized.match(/^([a-z0-9]+)-(.+)$/i);
  const matches = cards
    .map((card, index) => ({ card, index }))
    .filter(({ card }) => setMatch
      ? String(card.setCode).toLowerCase() === setMatch[1] && String(card.number).toLowerCase() === setMatch[2]
      : String(card.name).toLowerCase().includes(normalized));
  return {
    card: matches.length === 1 ? matches[0].card : null,
    index: matches.length === 1 ? matches[0].index : -1,
    ambiguous: matches.length > 1,
  };
}

async function linkedIdentity(msg: any, guildId: string) {
  const user = messageUser(msg);
  if (!user.discordId || !guildId) return { user, pokemonUser: '' };
  const linked = await resolveDiscordStreamHubTwitchIdentity(user.discordId, guildId).catch(() => null);
  return { user, pokemonUser: String(linked?.twitchLogin || '').trim().toLowerCase() };
}

export async function handleDiscordPokemonCommand(msg: any, tenantId?: string): Promise<boolean> {
  const sourceMessage = String(msg.content || '').trim();
  const commandName = sourceMessage.slice(1).split(/\s+/)[0]?.toLowerCase() || '';
  if (!DISCORD_POKEMON_COMMANDS.has(commandName)) return false;

  const channelId = String(msg.channelId || msg.channel_id || '').trim();
  const guildId = String(msg.guildId || msg.guild_id || '').trim();
  const sourceMessageId = String(msg.messageId || msg.message_id || '').trim();
  const { user, pokemonUser } = await linkedIdentity(msg, guildId);
  const reply = (message: string, options: {
    responseType?: string;
    title?: string;
    imageUrl?: string;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    components?: Record<string, unknown>[];
  } = {}) => sendStructuredDiscordReply({
    channelId,
    message,
    tenantId,
    title: options.title,
    responseType: options.responseType || 'Pokémon Cards',
    sourceMessageId,
    sourceMessage,
    sourceUser: user.discordName,
    sourceUserAvatarUrl: user.avatarUrl,
    imageUrl: options.imageUrl,
    fields: options.fields,
    components: options.components,
  });

  if (!pokemonUser) {
    await reply(
      'Link your Twitch account in DiscordStreamHub first. Pokémon cards opened in Discord and Twitch use one shared collection.',
      { responseType: 'Account Link Required' },
    );
    return true;
  }

  if (commandName === 'pack') {
    const config = await getConfigSection('redeems', tenantId);
    const enabledSets = config.pokePack.enabledSets || [];
    const setMap = getEnabledSetMap(enabledSets);
    const setNumber = Number(sourceMessage.substring('!pack'.length).trim());
    if (!Number.isInteger(setNumber) || !setMap[setNumber]) {
      await reply(`${formatSetList(setMap)}\n\nUse \`!pack 1-${Object.keys(setMap).length}\`.`, {
        responseType: 'Pack Selection',
      });
      return true;
    }

    const pointCost = Number(config.pokePack.pointCost || 0);
    const pointsContext: StorageContext | undefined = tenantId ? { tenantId, username: pokemonUser } : undefined;
    const balance = await getPoints(pokemonUser, pointsContext);
    if (pointCost > 0 && balance.points < pointCost) {
      await reply(`You need ${pointCost.toLocaleString()} points to open this pack. Current balance: ${balance.pointsDisplay}.`, {
        responseType: 'Pack Open',
      });
      return true;
    }
    if (pointCost > 0) await addPoints(pokemonUser, -pointCost, 'discord-pokemon-pack', pointsContext);
    const result = await openPack(setNumber, pokemonUser, enabledSets, tenantId);
    if (!result) {
      if (pointCost > 0) await addPoints(pokemonUser, pointCost, 'discord-pokemon-pack-refund', pointsContext);
      await reply('That pack could not be opened. Your points were not charged.', { responseType: 'Pack Open' });
      return true;
    }

    const allCards = await getUserCards(pokemonUser);
    const feature = [...result.pack].sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity))[0];
    await sendAnimatedPackReveal({
      channelId,
      tenantId,
      cards: result.pack,
      featureCard: feature,
      responseType: 'Pack Opened',
      title: `${result.setName} • 9-Card Pack`,
      sourceMessageId,
      sourceMessage,
      sourceUser: user.discordName,
      sourceUserAvatarUrl: user.avatarUrl,
      fields: [
        { name: 'Collection', value: `${allCards.length} total cards`, inline: true },
        { name: 'Cost', value: pointCost ? `${pointCost.toLocaleString()} points` : 'Free', inline: true },
      ],
    });
    return true;
  }

  if (commandName === 'collection' || commandName === 'collections') {
    const collection = await getUserCollection(pokemonUser);
    const rareCount = collection.cards.filter((card) => rarityScore(card.rarity) >= 3).length;
    const uniqueCards = new Set(collection.cards.map((card) => `${card.setCode}:${card.number}`)).size;
    const uniqueSets = new Set(collection.cards.map((card) => card.setCode).filter(Boolean)).size;
    if (!collection.cards.length) {
      await reply('Your shared Pokémon collection is empty. Use `!pack` to see the available sets.', {
        responseType: 'Collection',
        components: [{
          type: 1,
          components: [{ type: 2, style: 1, label: 'Open My Cards', custom_id: 'sw_pokemon_collection:mine' }],
        }],
      });
      return true;
    }
    const rarest = [...collection.cards].sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity))[0];
    await reply(
      `Your Discord and Twitch cards share one Pokédex.${rarest ? ` Rarest pull: **${rarest.name}** (${rarest.rarity || 'Common'}).` : ''}`,
      {
        responseType: 'Collection',
        title: `${pokemonUser}'s Pokémon Collection`,
        imageUrl: rarest?.imageUrl,
        fields: [
          { name: 'Total cards', value: String(collection.cards.length), inline: true },
          { name: 'Unique cards', value: String(uniqueCards), inline: true },
          { name: 'Rare cards', value: String(rareCount), inline: true },
          { name: 'Sets collected', value: String(uniqueSets), inline: true },
          { name: 'Packs opened', value: String(collection.packsOpened || 0), inline: true },
        ],
        components: [{
          type: 1,
          components: [
            { type: 2, style: 1, label: 'Open My Cards', custom_id: 'sw_pokemon_collection:mine' },
            { type: 2, style: 2, label: 'Build Deck', custom_id: 'sw_pokemon_deck:mine' },
          ],
        }],
      },
    );
    return true;
  }

  if (commandName === 'show') {
    const cards = await getUserCards(pokemonUser);
    const identifier = sourceMessage.substring('!show'.length).trim();
    const match = findCard(cards, identifier);
    if (!match.card) {
      await reply(
        match.ambiguous
          ? 'More than one card matched. Use the collection number or `set-number` shown by `!collection`.'
          : 'Card not found. Use `!show <collection # | set-number | card name>`.',
        { responseType: 'Card Display' },
      );
      return true;
    }
    await reply(
      `Collection #${match.index + 1}\nSet: **${match.card.setCode}**\nNumber: **${match.card.number}**\nRarity: **${match.card.rarity || 'Common'}**`,
      {
        responseType: 'Card Display',
        title: match.card.name,
        imageUrl: match.card.imageUrl,
      },
    );
    return true;
  }

  if (commandName === 'eevee') {
    if (pokemonUser !== 'mothermayrien') {
      await reply("This special Eevee booster belongs to mothermayrien's linked collection.", {
        responseType: 'Eevee Pack',
      });
      return true;
    }
    const result = await openEeveePack(pokemonUser, tenantId);
    if (!result) {
      await reply('The Eevee booster could not be opened.', { responseType: 'Eevee Pack' });
      return true;
    }
    const feature = [...result.pack].sort((a, b) => rarityScore(b.rarity) - rarityScore(a.rarity))[0];
    await sendAnimatedPackReveal({
      channelId,
      tenantId,
      cards: result.pack,
      featureCard: feature,
      responseType: 'Eevee Pack Opened',
      title: 'Eevee Booster • 9 Cards',
      sourceMessageId,
      sourceMessage,
      sourceUser: user.discordName,
      sourceUserAvatarUrl: user.avatarUrl,
    });
    return true;
  }

  if (commandName === 'deck') {
    const collection = await getUserCollection(pokemonUser);
    if (!collection.deck?.cards?.length) {
      await reply('You do not have a saved deck yet. Build one from your Pokédex collection.', {
        responseType: 'Saved Deck',
      });
      return true;
    }
    const cardLines = collection.deck.cards.slice(0, 25).map((index) => {
      const card = collection.cards[index - 1];
      return card ? `**${card.name}** • ${card.setCode}-${card.number}` : `Missing collection card #${index}`;
    });
    const energy = Object.entries(collection.deck.energy || {})
      .filter(([, count]) => Number(count) > 0)
      .map(([type, count]) => `${count} ${type}`)
      .join(', ');
    await reply(cardLines.join('\n'), {
      responseType: 'Saved Deck',
      title: `${pokemonUser}'s Pokémon Deck`,
      fields: energy ? [{ name: 'Energy', value: energy }] : undefined,
    });
    return true;
  }

  if (commandName === 'trade') {
    const rawTarget = sourceMessage.substring('!trade'.length).trim();
    const discordTargetId = targetDiscordId(msg, rawTarget);
    if (!discordTargetId) {
      await reply('Mention the Discord player you want to trade with: `!trade @user`.', {
        responseType: 'Trade',
      });
      return true;
    }
    const members = await getDiscordStreamHubCheckinMembers(guildId);
    const target = members.find((member) => member.discordUserId === discordTargetId && member.twitchLogin);
    if (!target) {
      await reply('That player must link their Twitch account in DiscordStreamHub before trading.', {
        responseType: 'Trade',
      });
      return true;
    }
    try {
      const trade = await createDiscordPokemonTrade({
        tenantId,
        guildId,
        channelId,
        initiator: { discordId: user.discordId, discordName: user.discordName, pokemonUser },
        target: {
          discordId: target.discordUserId,
          discordName: target.displayName || target.username || target.twitchLogin,
          pokemonUser: target.twitchLogin,
        },
      });
      await reply(formatDiscordPokemonTrade(trade), {
        responseType: 'Trade Started',
        title: 'Pokémon Card Trade',
        components: discordPokemonTradeComponents(trade),
      });
    } catch (error: any) {
      await reply(error?.message || 'The trade could not be started.', { responseType: 'Trade' });
    }
    return true;
  }

  const identifier = sourceMessage.substring('!offer'.length).trim();
  try {
    const trade = await offerDiscordPokemonCard(user.discordId, identifier);
    await reply(formatDiscordPokemonTrade(trade), {
      responseType: trade.status === 'ready' ? 'Trade Ready' : 'Trade Offer',
      title: 'Pokémon Card Trade',
      components: discordPokemonTradeComponents(trade),
      imageUrl: trade.offers[user.discordId]?.imageUrl,
    });
  } catch (error: any) {
    await reply(error?.message || 'The card could not be offered.', { responseType: 'Trade Offer' });
  }
  return true;
}
