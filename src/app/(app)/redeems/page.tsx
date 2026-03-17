'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Users, Sparkles, Save, RefreshCw, Gift, ChevronDown, ChevronRight, Search, Check } from 'lucide-react';

interface CustomReward { pointCost: number; response: string }
interface RedeemsConfig {
  partnerCheckin: { rewardTitle: string; pointCost: number; discordGuildId: string; discordRoleName: string };
  pokePack: { rewardTitle: string; pointCost: number; enabledSets: string[] };
  customRewards: Record<string, CustomReward>;
}

interface TcgSet { id: string; name: string; series: string; total: number; releaseDate: string; images: { symbol: string; logo: string } }

interface TwitchReward { id: string; title: string; cost: number; isEnabled: boolean }
interface DiscordGuild { id: string; name: string; icon: string | null }
interface DiscordRole { id: string; name: string; color: number }
interface Partner { id: number; name: string; discordUserId: string; avatarUrl: string; inviteLink: string; communityCheckins: number }
interface CheckinStats { userCounts: Record<string, number>; partnerCounts: Record<string, number> }

const selectClass = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export default function RedeemsPage() {
  const { toast } = useToast();
  const [config, setConfig] = useState<RedeemsConfig | null>(null);
  const [rewards, setRewards] = useState<TwitchReward[]>([]);
  const [guilds, setGuilds] = useState<DiscordGuild[]>([]);
  const [roles, setRoles] = useState<DiscordRole[]>([]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [stats, setStats] = useState<CheckinStats | null>(null);
  const [inviteEdits, setInviteEdits] = useState<Record<string, string>>({});
  const [loadingRewards, setLoadingRewards] = useState(false);
  const [loadingPartners, setLoadingPartners] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expandedRewards, setExpandedRewards] = useState<Set<string>>(new Set());
  const [allSets, setAllSets] = useState<TcgSet[]>([]);
  const [setSearch, setSetSearch] = useState('');

  useEffect(() => { loadAll(); }, []);

  async function loadAll() {
    try {
      const res = await fetch('/api/local-config/redeems');
      if (!res.ok) return;
      const data = await res.json();
      const cfg = data.config as RedeemsConfig | undefined;
      if (cfg) {
        if (!cfg.customRewards) cfg.customRewards = {};
        if (!cfg.pokePack.enabledSets) cfg.pokePack.enabledSets = [];
        setConfig(cfg);
        fetchRewards();
        fetchSets();
        fetchGuilds().then(() => {
          if (cfg.partnerCheckin.discordGuildId) fetchRoles(cfg.partnerCheckin.discordGuildId);
        });
        if (cfg.partnerCheckin.discordGuildId && cfg.partnerCheckin.discordRoleName) {
          fetchPartners(cfg.partnerCheckin.discordGuildId, cfg.partnerCheckin.discordRoleName);
        }
      }
    } catch {}
  }

  async function fetchSets() {
    try {
      const res = await fetch('/api/pokemon/sets');
      if (res.ok) setAllSets((await res.json()).sets || []);
    } catch {}
  }

  function toggleSet(setId: string) {
    if (!config) return;
    const current = config.pokePack.enabledSets || [];
    const next = current.includes(setId) ? current.filter(s => s !== setId) : [...current, setId];
    setConfig({ ...config, pokePack: { ...config.pokePack, enabledSets: next } });
  }

  async function fetchRewards() {
    setLoadingRewards(true);
    try {
      const res = await fetch('/api/twitch-rewards');
      if (res.ok) setRewards((await res.json()).rewards || []);
    } catch {}
    setLoadingRewards(false);
  }

  async function fetchGuilds() {
    try {
      const res = await fetch('/api/discord/roles');
      if (res.ok) setGuilds((await res.json()).guilds || []);
    } catch {}
  }

  async function fetchRoles(guildId: string) {
    if (!guildId) { setRoles([]); return; }
    try {
      const res = await fetch(`/api/discord/roles?guildId=${guildId}`);
      if (res.ok) setRoles((await res.json()).roles || []);
    } catch {}
  }

  async function fetchPartners(guildId: string, roleName: string) {
    setLoadingPartners(true);
    try {
      const res = await fetch(`/api/partners?guildId=${guildId}&roleName=${encodeURIComponent(roleName)}`);
      if (res.ok) {
        const data = await res.json();
        setPartners(data.partners || []);
        setStats(data.stats || null);
        const edits: Record<string, string> = {};
        for (const p of data.partners || []) edits[p.discordUserId] = p.inviteLink || '';
        setInviteEdits(edits);
      }
    } catch {}
    setLoadingPartners(false);
  }

  async function saveConfig() {
    if (!config) return;
    setSaving(true);
    try {
      const key = localStorage.getItem('streamweaver.localApiKey') || '';
      const res = await fetch('/api/local-config/redeems', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
        body: JSON.stringify(config),
      });
      if (res.ok) toast({ title: 'Redeems config saved' });
      else toast({ variant: 'destructive', title: 'Save failed' });
    } catch { toast({ variant: 'destructive', title: 'Save failed' }); }
    finally { setSaving(false); }
  }

  async function saveInviteLinks() {
    const overrides: Record<string, { inviteLink: string }> = {};
    for (const [uid, link] of Object.entries(inviteEdits)) {
      if (link) overrides[uid] = { inviteLink: link };
    }
    try {
      const res = await fetch('/api/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      });
      if (res.ok) toast({ title: 'Partner invite links saved' });
      else toast({ variant: 'destructive', title: 'Save failed' });
    } catch { toast({ variant: 'destructive', title: 'Save failed' }); }
  }

  function toggleExpand(title: string) {
    setExpandedRewards(prev => {
      const next = new Set(prev);
      next.has(title) ? next.delete(title) : next.add(title);
      return next;
    });
  }

  function getCustomReward(title: string): CustomReward {
    return config?.customRewards?.[title] || { pointCost: 0, response: '' };
  }

  function setCustomReward(title: string, updates: Partial<CustomReward>) {
    if (!config) return;
    const current = getCustomReward(title);
    const updated = { ...current, ...updates };
    if (updated.pointCost === 0 && !updated.response) {
      const { [title]: _, ...rest } = config.customRewards;
      setConfig({ ...config, customRewards: rest });
    } else {
      setConfig({ ...config, customRewards: { ...config.customRewards, [title]: updated } });
    }
  }

  function getRewardAction(r: TwitchReward): string | null {
    if (!config) return null;
    if (config.partnerCheckin.rewardTitle && r.title.toLowerCase().includes(config.partnerCheckin.rewardTitle.toLowerCase())) return 'partner';
    if (config.pokePack.rewardTitle && r.title.toLowerCase().includes(config.pokePack.rewardTitle.toLowerCase())) return 'pokepack';
    return null;
  }

  if (!config) return <div className="p-6 text-muted-foreground">Loading redeems config...</div>;

  const partnerReady = !!(config.partnerCheckin.rewardTitle && config.partnerCheckin.discordGuildId && config.partnerCheckin.discordRoleName);
  const pokeReady = !!config.pokePack.rewardTitle;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Channel Point Redeems</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={fetchRewards} disabled={loadingRewards}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loadingRewards ? 'animate-spin' : ''}`} />
            Refresh Rewards
          </Button>
          <Button onClick={saveConfig} disabled={saving}>
            <Save className="w-4 h-4 mr-2" />
            {saving ? 'Saving...' : 'Save Config'}
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground">
        Set StreamWeaver point costs on any Twitch reward. Twitch channel points are just the trigger — your economy controls access. Positive cost = deducts points, negative = awards points.
      </p>

      {/* ── All Channel Point Rewards ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Gift className="w-5 h-5" />
            <div>
              <CardTitle>All Channel Point Rewards</CardTitle>
              <CardDescription>Click any reward to set its StreamWeaver point cost and response message.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {rewards.length === 0 ? (
            <p className="text-sm text-muted-foreground">No rewards loaded. Click Refresh to fetch from Twitch.</p>
          ) : (
            <div className="space-y-1">
              {rewards.map(r => {
                const action = getRewardAction(r);
                const custom = getCustomReward(r.title);
                const hasCustom = custom.pointCost !== 0 || !!custom.response;
                const isExpanded = expandedRewards.has(r.title);
                const isSpecial = !!action;

                return (
                  <div key={r.id} className={`border rounded ${isSpecial ? 'border-primary/50 bg-primary/5' : hasCustom ? 'border-blue-500/50 bg-blue-500/5' : ''}`}>
                    <button
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-muted/50 transition-colors"
                      onClick={() => !isSpecial && toggleExpand(r.title)}
                      disabled={isSpecial}
                    >
                      <div className="flex items-center gap-3">
                        {isSpecial ? null : isExpanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}
                        <span className="font-medium">{r.title}</span>
                        {!r.isEnabled && <Badge variant="secondary" className="text-xs">Disabled</Badge>}
                      </div>
                      <div className="flex items-center gap-2">
                        {action === 'partner' && (
                          <Badge variant="default">Partner Check-In{config.partnerCheckin.pointCost > 0 ? ` · ${config.partnerCheckin.pointCost} pts` : ''}</Badge>
                        )}
                        {action === 'pokepack' && (
                          <Badge variant="default">PokePack{config.pokePack.pointCost > 0 ? ` · ${config.pokePack.pointCost} pts` : ''}</Badge>
                        )}
                        {!isSpecial && hasCustom && (
                          <Badge variant="default">
                            {custom.pointCost > 0 ? `Costs ${custom.pointCost} pts` : custom.pointCost < 0 ? `Awards ${Math.abs(custom.pointCost)} pts` : 'Response only'}
                          </Badge>
                        )}
                        {!isSpecial && !hasCustom && <Badge variant="secondary">No action</Badge>}
                      </div>
                    </button>
                    {isExpanded && !isSpecial && (
                      <div className="px-3 pb-3 pt-1 border-t flex items-center gap-3">
                        <div className="w-40">
                          <Label className="text-xs">Point Cost</Label>
                          <Input type="number" className="h-8 text-sm" value={custom.pointCost}
                            onChange={e => setCustomReward(r.title, { pointCost: parseInt(e.target.value) || 0 })} />
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {custom.pointCost > 0 ? 'Deducts' : custom.pointCost < 0 ? 'Awards' : 'No cost'}
                          </p>
                        </div>
                        <div className="flex-1">
                          <Label className="text-xs">Response Message <span className="text-muted-foreground">(optional, {'{user}'} = redeemer)</span></Label>
                          <Input className="h-8 text-sm" placeholder="e.g. @{user} redeemed! Stay hydrated! 💧"
                            value={custom.response}
                            onChange={e => setCustomReward(r.title, { response: e.target.value })} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Partner Check-In ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Users className="w-5 h-5" />
              <div>
                <CardTitle>Partner Check-In</CardTitle>
                <CardDescription>Viewers redeem to check in under a partner&apos;s banner. Partners are pulled from a Discord role.</CardDescription>
              </div>
            </div>
            <Badge variant={partnerReady ? 'default' : 'secondary'}>
              {partnerReady ? (config.partnerCheckin.pointCost > 0 ? `Ready · ${config.partnerCheckin.pointCost} pts` : 'Ready · Free') : 'Not Configured'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label>Twitch Reward</Label>
              <select className={selectClass} value={config.partnerCheckin.rewardTitle}
                onChange={e => setConfig({ ...config, partnerCheckin: { ...config.partnerCheckin, rewardTitle: e.target.value } })}>
                <option value="">Select a reward...</option>
                {rewards.map(r => <option key={r.id} value={r.title}>{r.title}{!r.isEnabled ? ' [disabled]' : ''}</option>)}
              </select>
            </div>
            <div>
              <Label>Point Cost</Label>
              <Input type="number" min={0} value={config.partnerCheckin.pointCost ?? 0}
                onChange={e => setConfig({ ...config, partnerCheckin: { ...config.partnerCheckin, pointCost: parseInt(e.target.value) || 0 } })} />
            </div>
            <div>
              <Label>Discord Server</Label>
              <select className={selectClass} value={config.partnerCheckin.discordGuildId}
                onChange={e => {
                  setConfig({ ...config, partnerCheckin: { ...config.partnerCheckin, discordGuildId: e.target.value, discordRoleName: '' } });
                  setRoles([]); setPartners([]);
                  fetchRoles(e.target.value);
                }}>
                <option value="">Select a server...</option>
                {guilds.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <div>
              <Label>Partner Role</Label>
              <select className={selectClass} value={config.partnerCheckin.discordRoleName}
                onChange={e => {
                  setConfig({ ...config, partnerCheckin: { ...config.partnerCheckin, discordRoleName: e.target.value } });
                  setPartners([]);
                }}>
                <option value="">Select a role...</option>
                {roles.map(r => <option key={r.id} value={r.name}>{r.name}</option>)}
              </select>
              {!config.partnerCheckin.discordGuildId && <p className="text-xs text-muted-foreground mt-1">Select a server first</p>}
            </div>
          </div>

          {partnerReady && (
            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Partners ({partners.length})</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => fetchPartners(config.partnerCheckin.discordGuildId, config.partnerCheckin.discordRoleName)} disabled={loadingPartners}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${loadingPartners ? 'animate-spin' : ''}`} />
                    Refresh
                  </Button>
                  {partners.length > 0 && (
                    <Button size="sm" onClick={saveInviteLinks}>
                      <Save className="w-4 h-4 mr-2" />
                      Save Links
                    </Button>
                  )}
                </div>
              </div>
              {partners.length > 0 ? (
                <div className="space-y-2">
                  {partners.map(p => (
                    <div key={p.id} className="flex items-center gap-3 p-2 rounded bg-muted/50">
                      <img src={p.avatarUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                      <span className="font-medium w-6 text-right">{p.id}.</span>
                      <span className="w-40 truncate">{p.name}</span>
                      <Input
                        className="flex-1 h-8 text-sm"
                        placeholder="Discord invite link"
                        value={inviteEdits[p.discordUserId] ?? ''}
                        onChange={e => setInviteEdits({ ...inviteEdits, [p.discordUserId]: e.target.value })}
                      />
                      <Badge variant="secondary" className="flex-shrink-0">
                        {p.communityCheckins} check-ins
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Click Refresh to load partners from Discord.</p>
              )}

              {stats && Object.keys(stats.userCounts).length > 0 && (
                <div className="pt-3 border-t">
                  <span className="font-medium text-sm">Top Check-In Users</span>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {Object.entries(stats.userCounts)
                      .sort(([,a], [,b]) => b - a)
                      .slice(0, 10)
                      .map(([user, count]) => (
                        <Badge key={user} variant="outline">{user}: {count}</Badge>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── PokePack ── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Sparkles className="w-5 h-5" />
              <div>
                <CardTitle>PokePack</CardTitle>
                <CardDescription>Viewers redeem to open a Pokemon card pack from the enabled sets below.</CardDescription>
              </div>
            </div>
            <Badge variant={pokeReady ? 'default' : 'secondary'}>
              {pokeReady ? `Ready · ${config.pokePack.pointCost ?? 1500} pts · ${(config.pokePack.enabledSets || []).length} sets` : 'Not Configured'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-lg">
            <div>
              <Label>Twitch Reward</Label>
              <select className={selectClass} value={config.pokePack.rewardTitle}
                onChange={e => setConfig({ ...config, pokePack: { ...config.pokePack, rewardTitle: e.target.value } })}>
                <option value="">Select a reward...</option>
                {rewards.map(r => <option key={r.id} value={r.title}>{r.title}{!r.isEnabled ? ' [disabled]' : ''}</option>)}
              </select>
            </div>
            <div>
              <Label>Point Cost</Label>
              <Input type="number" min={0} value={config.pokePack.pointCost ?? 1500}
                onChange={e => setConfig({ ...config, pokePack: { ...config.pokePack, pointCost: parseInt(e.target.value) || 0 } })} />
            </div>
          </div>

          {/* Set selection */}
          <div className="border rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">Enabled Sets ({(config.pokePack.enabledSets || []).length} of {allSets.length})</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setConfig({ ...config, pokePack: { ...config.pokePack, enabledSets: [] } })}>
                  Clear All
                </Button>
              </div>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input className="pl-9 h-8 text-sm" placeholder="Search sets..." value={setSearch} onChange={e => setSetSearch(e.target.value)} />
            </div>
            {allSets.length === 0 ? (
              <p className="text-sm text-muted-foreground">Loading sets...</p>
            ) : (
              <div className="max-h-80 overflow-y-auto space-y-0.5">
                {(() => {
                  const q = setSearch.toLowerCase();
                  const filtered = q ? allSets.filter(s => s.name.toLowerCase().includes(q) || s.series.toLowerCase().includes(q) || s.id.includes(q)) : allSets;
                  const enabled = config.pokePack.enabledSets || [];
                  // Show enabled first, then the rest
                  const sorted = [...filtered].sort((a, b) => {
                    const aOn = enabled.includes(a.id) ? 0 : 1;
                    const bOn = enabled.includes(b.id) ? 0 : 1;
                    return aOn - bOn;
                  });
                  let lastSeries = '';
                  return sorted.map(s => {
                    const isEnabled = enabled.includes(s.id);
                    const showSeries = s.series !== lastSeries;
                    lastSeries = s.series;
                    return (
                      <div key={s.id}>
                        {showSeries && <div className="text-xs font-semibold text-muted-foreground pt-2 pb-1">{s.series}</div>}
                        <button
                          className={`w-full flex items-center gap-3 p-2 rounded text-left text-sm transition-colors ${
                            isEnabled ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
                          }`}
                          onClick={() => toggleSet(s.id)}
                        >
                          <div className={`w-5 h-5 rounded border flex items-center justify-center flex-shrink-0 ${
                            isEnabled ? 'bg-primary border-primary text-primary-foreground' : 'border-input'
                          }`}>
                            {isEnabled && <Check className="w-3 h-3" />}
                          </div>
                          {s.images?.symbol && <img src={s.images.symbol} alt="" className="w-5 h-5 flex-shrink-0" />}
                          <span className="flex-1 truncate">{s.name}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0">{s.total} cards</span>
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
