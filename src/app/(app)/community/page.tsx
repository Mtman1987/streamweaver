'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Download, RefreshCw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

type FlowPackage = {
  packageId: string;
  name: string;
  packageKind: 'command_flow' | 'action_flow' | 'support_flow';
  installUnit: 'flow';
  sourceModule: string;
  freezeTier: 'starter' | 'built_in_module' | 'official_library' | 'internal_only' | 'legacy_hold';
  visibility: 'default' | 'advanced' | 'hidden';
  collection: string;
  commands: any[];
  actions: any[];
  items: {
    commands: Array<{
      key: string;
      label: string;
      group: string;
      required: boolean;
      role: 'primary' | 'support' | 'admin' | 'variant' | 'overlay';
      tags: string[];
      description: string;
    }>;
    actions: Array<{
      key: string;
      label: string;
      group: string;
      required: boolean;
      role: 'primary' | 'support' | 'admin' | 'variant' | 'overlay';
      tags: string[];
      description: string;
    }>;
  };
};

type ImportSelection = {
  commandKeys: string[];
  actionKeys: string[];
};

type SandboxResult = {
  packageId: string;
  packageName: string;
  selectedCommand?: string | null;
  executedActions: string[];
  events: Array<{
    type: string;
    label: string;
    detail?: string;
  }>;
  warnings: string[];
  variables: Record<string, any>;
  chatTranscript: Array<{
    speaker: 'viewer' | 'bot' | 'discord';
    message: string;
  }>;
  obsState: {
    currentScene: string;
    sources: Record<string, { scene?: string; visible: boolean }>;
    textSources: Record<string, string>;
  };
};

type ManifestItem = {
  key: string;
  label?: string;
  group?: string;
  required?: boolean;
  enabledByDefault?: boolean;
  role?: 'primary' | 'support' | 'admin' | 'variant' | 'overlay';
  tags?: string[];
  description?: string;
};

type ManifestDraft = {
  packageId: string;
  name?: string;
  collection?: string;
  visibility?: 'default' | 'advanced' | 'hidden';
  notes?: string[];
  items: {
    commands: ManifestItem[];
    actions: ManifestItem[];
  };
};

function getCommandKey(command: any): string {
  return String(command?.id || command?.command || command?.name || '').trim();
}

function getActionKey(action: any): string {
  return String(action?.id || `${action?.name || ''}:${action?.group || ''}` || action?.name || '').trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeCommandComparable(value: unknown): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^!+/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function formatTag(tag: string): string {
  return tag
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function formatVisibility(value: 'default' | 'advanced' | 'hidden'): string {
  if (value === 'advanced') return 'Advanced only';
  if (value === 'hidden') return 'Hidden';
  return 'Normal';
}

function formatManifestRole(value: ManifestItem['role'] | undefined): string {
  if (value === 'primary') return 'Main feature';
  if (value === 'admin') return 'Admin or moderator';
  if (value === 'variant') return 'Optional variant';
  if (value === 'overlay') return 'Overlay or visual';
  return 'Support step';
}

function formatManifestSource(value: 'tenant' | 'published'): string {
  return value === 'tenant' ? 'Your library copy' : 'Shared library copy';
}

function isFlowPackageFile(value: unknown): value is FlowPackage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'streamweaver.flow-package' && typeof candidate.packageId === 'string';
}

function isStreamerbotPackageFile(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.format === 'streamerbot-package' || candidate.kind === 'streamerbot-package';
}

function cleanSandboxErrorMessage(message: unknown): string {
  const text = String(message || '').trim();
  if (!text) return 'Could not run sandbox';
  if (text.startsWith('[') || text.includes('invalid_literal') || text.includes('streamweaver.flow-package')) {
    return 'This preview only works with StreamWeaver flow packages. Import Streamer.bot exports first, or export the item as a StreamWeaver Flow.';
  }
  return text;
}

function collectReferencedActionIds(subActions: any[], into: Set<string>) {
  for (const subAction of subActions || []) {
    if (subAction?.actionId) into.add(String(subAction.actionId));
    if (Array.isArray(subAction?.subActions)) {
      collectReferencedActionIds(subAction.subActions, into);
    }
  }
}

function getRequiredActionKeys(pkg: FlowPackage, selectedCommandKeys: string[]): string[] {
  const selectedCommands = new Set(selectedCommandKeys);
  const selectedCommandEntries = (pkg.commands || []).filter((command) => selectedCommands.has(getCommandKey(command)));
  const selectedCommandIds = new Set(selectedCommandEntries.map((command) => String(command?.id || '')).filter(Boolean));
  const selectedCommandTexts = new Set(selectedCommandEntries.map((command) => String(command?.command || '').trim().toLowerCase()).filter(Boolean));
  const selectedCommandComparables = new Set(
    selectedCommandEntries
      .map((command) => normalizeCommandComparable(command?.command || command?.name))
      .filter(Boolean)
  );
  const requiredActionIds = new Set<string>();

  for (const command of selectedCommandEntries) {
    if (command?.actionId) requiredActionIds.add(String(command.actionId));
  }

  for (const action of pkg.actions || []) {
    if (action?.id && selectedCommandComparables.has(normalizeCommandComparable(action?.name))) {
      requiredActionIds.add(String(action.id));
    }

    for (const trigger of Array.isArray(action?.triggers) ? action.triggers : []) {
      if (trigger?.commandId && selectedCommandIds.has(String(trigger.commandId)) && action?.id) {
        requiredActionIds.add(String(action.id));
      }

      const triggerType = String(trigger?.type || '').toLowerCase();
      const triggerCommand = String(trigger?.config?.command || trigger?.pattern || '').trim().toLowerCase();
      if ((triggerType === 'chat command' || triggerType === 'command') && triggerCommand && selectedCommandTexts.has(triggerCommand) && action?.id) {
        requiredActionIds.add(String(action.id));
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const action of pkg.actions || []) {
      if (action?.id && requiredActionIds.has(String(action.id))) {
        const before = requiredActionIds.size;
        collectReferencedActionIds(Array.isArray(action?.subActions) ? action.subActions : [], requiredActionIds);
        if (requiredActionIds.size !== before) changed = true;
      }
    }
  }

  return (pkg.actions || [])
    .filter((action) => action?.id && requiredActionIds.has(String(action.id)))
    .map(getActionKey);
}

export default function CommunityPage() {
  const { toast } = useToast();
  const [tenantPackages, setTenantPackages] = useState<FlowPackage[]>([]);
  const [communityPackages, setCommunityPackages] = useState<FlowPackage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'flow'>('flow');
  const [previewPackage, setPreviewPackage] = useState<FlowPackage | null>(null);
  const [previewSelection, setPreviewSelection] = useState<ImportSelection>({ commandKeys: [], actionKeys: [] });
  const [previewImporting, setPreviewImporting] = useState(false);
  const [manifestPackage, setManifestPackage] = useState<FlowPackage | null>(null);
  const [manifestSource, setManifestSource] = useState<'tenant' | 'published'>('tenant');
  const [manifestDraft, setManifestDraft] = useState('');
  const [manifestTab, setManifestTab] = useState<'structured' | 'json'>('structured');
  const [manifestSaving, setManifestSaving] = useState(false);
  const [sandboxPackage, setSandboxPackage] = useState<FlowPackage | null>(null);
  const [sandboxCommandKey, setSandboxCommandKey] = useState('');
  const [sandboxUserName, setSandboxUserName] = useState('SandboxUser');
  const [sandboxRawInput, setSandboxRawInput] = useState('');
  const [sandboxPlatform, setSandboxPlatform] = useState('twitch');
  const [sandboxResult, setSandboxResult] = useState<SandboxResult | null>(null);
  const [sandboxRunning, setSandboxRunning] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [tenantRes, communityRes] = await Promise.all([
        fetch('/api/flow-packages'),
        fetch('/api/community/flow-packages'),
      ]);
      if (!tenantRes.ok || !communityRes.ok) throw new Error('Failed to load flow packages');
      const tenantData = await tenantRes.json();
      const communityData = await communityRes.json();
      setTenantPackages(Array.isArray(tenantData?.packages) ? tenantData.packages : []);
      setCommunityPackages(Array.isArray(communityData?.packages) ? communityData.packages : []);
      setLoaded(true);
    } catch {
      toast({ variant: 'destructive', title: 'Failed to load data' });
    }
  }, [toast]);

  useEffect(() => {
    if (!loaded) void loadData();
  }, [loadData, loaded]);

  const visibleTenantPackages = useMemo(
    () => tenantPackages.filter((item) => item.visibility !== 'hidden'),
    [tenantPackages]
  );
  const visibleCommunityPackages = useMemo(
    () => communityPackages.filter((item) => item.visibility !== 'hidden'),
    [communityPackages]
  );
  const parsedManifest = useMemo(() => {
    try {
      return JSON.parse(manifestDraft) as ManifestDraft;
    } catch {
      return null;
    }
  }, [manifestDraft]);

  const downloadJson = (filename: string, payload: unknown) => {
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateManifestDraft = (mutator: (draft: ManifestDraft) => void) => {
    if (!parsedManifest) return;
    const next = JSON.parse(JSON.stringify(parsedManifest)) as ManifestDraft;
    mutator(next);
    setManifestDraft(JSON.stringify(next, null, 2));
  };

  const handleExportFlow = (pkg: FlowPackage) => {
    downloadJson(`${pkg.packageId.replace(/[^a-zA-Z0-9._-]/g, '_')}.json`, pkg);
    toast({ title: 'Flow exported', description: pkg.name });
  };

  const handleExportAllFlows = () => {
    downloadJson(
      `streamweaver-flow-packages-${new Date().toISOString().slice(0, 10)}.json`,
      visibleTenantPackages
    );
    toast({ title: 'Flow packages exported', description: `${visibleTenantPackages.length} flows` });
  };

  const handleImportClick = (type: 'flow') => {
    setImportType(type);
    fileInputRef.current?.click();
  };

  const openImportPreview = (pkg: FlowPackage) => {
    setPreviewPackage(pkg);
    setPreviewSelection({
      commandKeys: (pkg.commands || []).map(getCommandKey),
      actionKeys: (pkg.actions || []).map(getActionKey),
    });
  };

  const handlePublishFlow = async (pkg: FlowPackage) => {
    try {
      const res = await fetch('/api/community/flow-packages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageId: pkg.packageId }),
      });
      if (!res.ok) throw new Error('Publish failed');
      toast({ title: 'Published to community', description: pkg.name });
      setLoaded(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Publish failed', description: error?.message || 'Could not publish flow' });
    }
  };

  const handleDeleteTenantFlow = async (pkg: FlowPackage) => {
    const ok = window.confirm(`Delete "${pkg.name}" from your flows? This removes the package's commands and actions from this workspace.`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/flow-packages?packageId=${encodeURIComponent(pkg.packageId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Delete failed');
      toast({
        title: 'Flow deleted',
        description: `${body?.deleted?.commands ?? 0} commands and ${body?.deleted?.actions ?? 0} actions removed.`,
      });
      setLoaded(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Delete failed', description: error?.message || 'Could not delete flow' });
    }
  };

  const handleUnpublishFlow = async (pkg: FlowPackage) => {
    const ok = window.confirm(`Remove "${pkg.name}" from the community library?`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/community/flow-packages?packageId=${encodeURIComponent(pkg.packageId)}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Unpublish failed');
      toast({ title: 'Flow unpublished', description: pkg.name });
      setLoaded(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Unpublish failed', description: error?.message || 'Could not unpublish flow' });
    }
  };

  const openManifestEditor = async (pkg: FlowPackage, source: 'tenant' | 'published') => {
    try {
      const res = await fetch(`/api/flow-packages/manifest?packageId=${encodeURIComponent(pkg.packageId)}&source=${source}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to load manifest');
      setManifestPackage(pkg);
      setManifestSource(source);
      setManifestDraft(JSON.stringify(body.manifest, null, 2));
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Manifest load failed', description: error?.message || 'Could not load manifest' });
    }
  };

  const saveManifestEditor = async () => {
    if (!manifestPackage) return;
    setManifestSaving(true);
    try {
      const parsed = JSON.parse(manifestDraft);
      const res = await fetch('/api/flow-packages/manifest', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest: parsed }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Failed to save manifest');
      toast({ title: 'Manifest saved', description: manifestPackage.packageId });
      setManifestPackage(null);
      setLoaded(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Manifest save failed', description: error?.message || 'Invalid manifest JSON' });
    } finally {
      setManifestSaving(false);
    }
  };

  const openSandbox = (pkg: FlowPackage) => {
    setSandboxPackage(pkg);
    setSandboxCommandKey((pkg.commands || []).length > 0 ? getCommandKey(pkg.commands[0]) : '');
    setSandboxUserName('SandboxUser');
    setSandboxRawInput('');
    setSandboxPlatform('twitch');
    setSandboxResult(null);
  };

  const selectedSandboxCommand = useMemo(
    () => (sandboxPackage?.commands || []).find((command) => getCommandKey(command) === sandboxCommandKey) || null,
    [sandboxCommandKey, sandboxPackage]
  );

  const selectedSandboxCommandText = useMemo(() => {
    if (!selectedSandboxCommand) return '';
    return String(selectedSandboxCommand.command || selectedSandboxCommand.name || sandboxCommandKey).trim();
  }, [sandboxCommandKey, selectedSandboxCommand]);

  const runSandbox = async () => {
    if (!sandboxPackage) return;
    setSandboxRunning(true);
    try {
      const res = await fetch('/api/flow-packages/sandbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          package: sandboxPackage,
          commandKey: sandboxCommandKey || undefined,
          sandboxInput: {
            userName: sandboxUserName,
            rawInput: sandboxRawInput,
            message: selectedSandboxCommandText ? `${selectedSandboxCommandText} ${sandboxRawInput}`.trim() : sandboxRawInput,
            platform: sandboxPlatform,
            channel: 'sandbox-channel',
          },
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Sandbox run failed');
      setSandboxResult(body);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Sandbox failed', description: cleanSandboxErrorMessage(error?.message) });
    } finally {
      setSandboxRunning(false);
    }
  };

  const handleExportStreamerbot = async (pkg: FlowPackage) => {
    try {
      const res = await fetch('/api/flow-packages/export/streamerbot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || 'Streamer.bot export failed');
      downloadJson(`${pkg.packageId.replace(/[^a-zA-Z0-9._-]/g, '_')}.streamerbot.json`, body);
      toast({
        title: 'Streamer.bot export ready',
        description: body?.warnings?.length
          ? `${body.warnings.length} compatibility note${body.warnings.length === 1 ? '' : 's'} included`
          : pkg.name,
      });
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Streamer.bot export failed', description: error?.message || 'Could not export package' });
    }
  };

  const importPackage = async (pkg: FlowPackage, selection?: ImportSelection) => {
    const res = await fetch('/api/flow-packages/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(selection ? { package: pkg, selection } : pkg),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body?.error || 'Flow import failed');
    }
    const body = await res.json();
    toast({
      title: 'Flow imported',
      description: `${pkg.name}: ${body?.imported?.commands ?? 0} commands, ${body?.imported?.actions ?? 0} actions`,
    });
    setLoaded(false);
  };

  const requiredActionKeys = useMemo(
    () => previewPackage ? getRequiredActionKeys(previewPackage, previewSelection.commandKeys) : [],
    [previewPackage, previewSelection.commandKeys]
  );
  const optionalActionKeys = useMemo(() => {
    if (!previewPackage) return [];
    const requiredSet = new Set(requiredActionKeys);
    return (previewPackage.actions || [])
      .map(getActionKey)
      .filter((key) => !requiredSet.has(key));
  }, [previewPackage, requiredActionKeys]);
  const optionalActionsSelectedCount = useMemo(
    () => optionalActionKeys.filter((key) => previewSelection.actionKeys.includes(key)).length,
    [optionalActionKeys, previewSelection.actionKeys]
  );
  const hasOptionalActions = optionalActionKeys.length > 0;
  const previewWarnings = useMemo(() => {
    const warnings: string[] = [];

    if (previewSelection.commandKeys.length === 0) {
      warnings.push('No chat trigger is selected. This would only install background support steps.');
    }

    if (hasOptionalActions && optionalActionsSelectedCount === 0) {
      warnings.push('Only the required steps will be installed. Optional extras are excluded.');
    }

    return warnings;
  }, [hasOptionalActions, optionalActionsSelectedCount, previewSelection.commandKeys.length]);
  const requiredActionSet = useMemo(() => new Set(requiredActionKeys), [requiredActionKeys]);
  const previewCommands = useMemo(() => {
    if (!previewPackage) return [];
    return (previewPackage.commands || []).map((command) => ({
      ...command,
      key: getCommandKey(command),
      metadata: previewPackage.items?.commands?.find((item) => item.key === getCommandKey(command)),
    }));
  }, [previewPackage]);
  const requiredPreviewActions = useMemo(() => {
    if (!previewPackage) return [];
    return (previewPackage.actions || [])
      .filter((action) => requiredActionSet.has(getActionKey(action)))
      .map((action) => ({
        ...action,
        key: getActionKey(action),
        metadata: previewPackage.items?.actions?.find((item) => item.key === getActionKey(action)),
      }));
  }, [previewPackage, requiredActionSet]);
  const optionalPreviewActions = useMemo(() => {
    if (!previewPackage) return [];
    return (previewPackage.actions || [])
      .filter((action) => !requiredActionSet.has(getActionKey(action)))
      .map((action) => ({
        ...action,
        key: getActionKey(action),
        metadata: previewPackage.items?.actions?.find((item) => item.key === getActionKey(action)),
      }));
  }, [previewPackage, requiredActionSet]);

  useEffect(() => {
    if (!previewPackage) return;
    setPreviewSelection((current) => ({
      ...current,
      actionKeys: Array.from(new Set([...current.actionKeys, ...requiredActionKeys])),
    }));
  }, [previewPackage, requiredActionKeys]);

  const handleTogglePreviewCommand = (commandKey: string, checked: boolean) => {
    setPreviewSelection((current) => ({
      ...current,
      commandKeys: checked
        ? Array.from(new Set([...current.commandKeys, commandKey]))
        : current.commandKeys.filter((key) => key !== commandKey),
    }));
  };

  const handleTogglePreviewAction = (actionKey: string, checked: boolean) => {
    if (requiredActionKeys.includes(actionKey)) return;
    setPreviewSelection((current) => ({
      ...current,
      actionKeys: checked
        ? Array.from(new Set([...current.actionKeys, actionKey]))
        : current.actionKeys.filter((key) => key !== actionKey),
    }));
  };

  const handleSelectEssentialOnly = () => {
    setPreviewSelection((current) => ({
      ...current,
      actionKeys: unique(requiredActionKeys),
    }));
  };

  const handleSelectEverything = () => {
    if (!previewPackage) return;
    setPreviewSelection({
      commandKeys: (previewPackage.commands || []).map(getCommandKey),
      actionKeys: (previewPackage.actions || []).map(getActionKey),
    });
  };

  const handleImportSelected = async () => {
    if (!previewPackage) return;
    setPreviewImporting(true);
    try {
      await importPackage(previewPackage, previewSelection);
      setPreviewPackage(null);
      setLoaded(false);
    } catch (error: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: error?.message || 'Flow import failed' });
    } finally {
      setPreviewImporting(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (isStreamerbotPackageFile(parsed)) {
        const formData = new FormData();
        formData.append('actionsFile', file);
        const res = await fetch('/api/import/streamerbot', { method: 'POST', body: formData });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success === false) {
          throw new Error(body?.message || 'Streamer.bot import failed');
        }
        toast({
          title: 'Streamer.bot import completed',
          description: `Imported ${body?.results?.actions?.imported ?? 0} actions and ${body?.results?.commands?.imported ?? 0} commands. Skipped ${body?.results?.actions?.skipped ?? 0} actions and ${body?.results?.commands?.skipped ?? 0} commands.`,
        });
        setLoaded(false);
        e.target.value = '';
        return;
      }
      const items = Array.isArray(parsed) ? parsed : [parsed];
      if (!items.every(isFlowPackageFile)) {
        throw new Error('This file is not a StreamWeaver flow package. If it is a Streamer.bot export, use the Streamer.bot importer or upload a combined Streamer.bot package file.');
      }
      if (items.length === 1 && importType === 'flow') {
        openImportPreview(items[0] as FlowPackage);
        e.target.value = '';
        return;
      }
      let imported = 0;
      for (const item of items) {
        if (importType !== 'flow') continue;
        try {
          await importPackage(item as FlowPackage);
          imported += 1;
        } catch (error: any) {
          throw new Error(error?.message || 'Flow import failed');
        }
      }
      toast({ title: `Imported ${imported} flow package(s)`, description: `From ${file.name}` });
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Import failed', description: err.message || 'Invalid JSON file' });
    }

    e.target.value = '';
  };

  return (
    <div className="space-y-6 pb-8">
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Flow Library</h1>
            <p className="text-muted-foreground mt-1">
              Browse ready-made bot features, preview them safely, and install only the pieces you want.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setLoaded(false)}>
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>
            <Button variant="outline" onClick={() => handleImportClick('flow')}>
              <Upload className="h-4 w-4 mr-2" /> Import File
            </Button>
            <Button onClick={handleExportAllFlows}>
              <Download className="h-4 w-4 mr-2" /> Export My Flows
            </Button>
          </div>
        </div>
      </div>

      <Card className="border-border/70 bg-card/75">
        <CardContent className="grid gap-4 px-5 py-5 md:grid-cols-3">
          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className="text-sm font-medium">Preview first</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Use <span className="font-medium text-foreground">Try It</span> to see fake chat, fake OBS changes, and warnings before touching your live setup.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className="text-sm font-medium">Install safely</div>
            <p className="mt-1 text-xs text-muted-foreground">
              The review step keeps required pieces locked so you can remove extras without breaking the feature.
            </p>
          </div>
          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className="text-sm font-medium">Edit details only if needed</div>
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Edit Details</span> is mainly for names, descriptions, tags, and advanced packaging cleanup.
            </p>
          </div>
        </CardContent>
      </Card>

      <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileImport} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Your Flows ({visibleTenantPackages.length})</CardTitle>
                <CardDescription>Features already built or installed in this workspace</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {visibleTenantPackages.map((pkg) => (
                <div key={pkg.packageId} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.collection} · {pkg.commands.length} command{pkg.commands.length === 1 ? '' : 's'} · {pkg.actions.length} action{pkg.actions.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => handleExportFlow(pkg)}>
                      JSON
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => openManifestEditor(pkg, 'tenant')}>
                      Edit Details
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => void handleExportStreamerbot(pkg)}>
                      Streamer.bot
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => openSandbox(pkg)}>
                      Try It
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => void handlePublishFlow(pkg)}>
                      Share
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold text-destructive hover:text-destructive" onClick={() => void handleDeleteTenantFlow(pkg)}>
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {visibleTenantPackages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No saved features yet</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg">Community Library ({visibleCommunityPackages.length})</CardTitle>
                <CardDescription>Shared features you can preview and install</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-96 overflow-y-auto">
              {visibleCommunityPackages.map((pkg) => (
                <div key={pkg.packageId} className="flex items-center justify-between p-2 rounded hover:bg-muted/50 gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{pkg.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {pkg.collection} · {pkg.commands.length} command{pkg.commands.length === 1 ? '' : 's'} · {pkg.actions.length} action{pkg.actions.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => handleExportFlow(pkg)}>
                      JSON
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => openManifestEditor(pkg, 'published')}>
                      Edit Details
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => openSandbox(pkg)}>
                      Try It
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold" onClick={() => openImportPreview(pkg)}>
                      Install
                    </Button>
                    <Button size="sm" variant="ghost" className="px-2 text-[11px] font-semibold text-destructive hover:text-destructive" onClick={() => void handleUnpublishFlow(pkg)}>
                      Unpublish
                    </Button>
                  </div>
                </div>
              ))}
              {visibleCommunityPackages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">No shared features published yet</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={Boolean(previewPackage)} onOpenChange={(open) => !open && setPreviewPackage(null)}>
        <DialogContent className="max-w-3xl border-border/70 bg-card/95">
          <DialogHeader>
            <DialogTitle>Review Before Installing</DialogTitle>
            <DialogDescription>
              Check what this feature includes before installing it. Required support steps stay locked so the feature still works.
            </DialogDescription>
          </DialogHeader>

          {previewPackage ? (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{previewPackage.collection}</Badge>
                <Badge variant="outline">{previewPackage.packageKind}</Badge>
                <Badge variant="outline">{previewSelection.commandKeys.length} commands selected</Badge>
                <Badge variant="outline">{previewSelection.actionKeys.length} actions selected</Badge>
              </div>

              <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="text-sm font-medium">{previewPackage.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{previewPackage.packageId}</div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">Commands</div>
                    <div className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                      Chat triggers
                    </div>
                  </div>
                  <div className="space-y-3">
                    {previewCommands.map((command) => {
                      const key = command.key;
                      const checked = previewSelection.commandKeys.includes(key);
                      return (
                        <label key={key} className="flex items-start gap-3">
                          <Checkbox checked={checked} onCheckedChange={(value) => handleTogglePreviewCommand(key, value === true)} />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="text-sm font-medium">{command.command || command.name}</div>
                              {(command.metadata?.tags || []).map((badge: string) => (
                                <Badge key={`${key}-${badge}`} variant="outline" className="text-[10px]">
                                  {formatTag(badge)}
                                </Badge>
                              ))}
                            </div>
                            <div className="text-xs text-muted-foreground">{command.metadata?.description || command.group || 'Ungrouped command'}</div>
                          </div>
                        </label>
                      );
                    })}
                    {previewPackage.commands.length === 0 && (
                      <div className="text-xs text-muted-foreground">No commands in this package.</div>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium">Actions</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Required steps stay locked. Optional extras can be removed before install.
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={handleSelectEssentialOnly}>
                        Keep essentials
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={handleSelectEverything}>
                        Select everything
                      </Button>
                    </div>
                  </div>

                  <div className="mb-4 rounded-2xl border border-border/70 bg-background/50 p-3">
                    <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                      Import summary
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline">{previewSelection.commandKeys.length} commands</Badge>
                      <Badge variant="outline">{requiredPreviewActions.length} required actions</Badge>
                      <Badge variant="outline">{optionalActionsSelectedCount}/{optionalPreviewActions.length} optional actions</Badge>
                    </div>
                    {previewWarnings.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {previewWarnings.map((warning) => (
                          <div key={warning} className="text-xs text-muted-foreground">
                            {warning}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Required
                      </div>
                      {requiredPreviewActions.map((action) => {
                        const key = action.key;
                        const checked = previewSelection.actionKeys.includes(key);
                        return (
                          <label key={key} className="flex items-start gap-3">
                            <Checkbox checked={checked} disabled />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{action.name}</div>
                                <Badge variant="outline" className="text-[10px]">
                                  Required
                                </Badge>
                                {(action.metadata?.tags || []).map((badge: string) => (
                                  <Badge key={`${key}-${badge}`} variant="outline" className="text-[10px]">
                                    {formatTag(badge)}
                                  </Badge>
                                ))}
                              </div>
                              <div className="text-xs text-muted-foreground">{action.metadata?.description || action.group || 'Ungrouped action'}</div>
                            </div>
                          </label>
                        );
                      })}
                      {requiredPreviewActions.length === 0 && (
                        <div className="text-xs text-muted-foreground">No required actions were detected for the current command selection.</div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Optional
                      </div>
                      {optionalPreviewActions.map((action) => {
                        const key = action.key;
                        const checked = previewSelection.actionKeys.includes(key);
                        return (
                          <label key={key} className="flex items-start gap-3">
                            <Checkbox checked={checked} onCheckedChange={(value) => handleTogglePreviewAction(key, value === true)} />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-sm font-medium">{action.name}</div>
                                <Badge variant="outline" className="text-[10px]">
                                  Optional
                                </Badge>
                                {(action.metadata?.tags || []).map((badge: string) => (
                                  <Badge key={`${key}-${badge}`} variant="outline" className="text-[10px]">
                                    {formatTag(badge)}
                                  </Badge>
                                ))}
                              </div>
                              <div className="text-xs text-muted-foreground">{action.metadata?.description || action.group || 'Ungrouped action'}</div>
                            </div>
                          </label>
                        );
                      })}
                      {optionalPreviewActions.length === 0 && (
                        <div className="text-xs text-muted-foreground">No optional actions in this package.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (!previewPackage) return;
                const pkg = previewPackage;
                setPreviewPackage(null);
                openSandbox(pkg);
              }}
              disabled={previewImporting}
            >
              Try It First
            </Button>
            <Button variant="outline" onClick={() => setPreviewPackage(null)} disabled={previewImporting}>
              Cancel
            </Button>
            <Button onClick={() => void handleImportSelected()} disabled={previewImporting}>
              {previewImporting ? 'Installing...' : `Install Selected`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(manifestPackage)} onOpenChange={(open) => !open && setManifestPackage(null)}>
        <DialogContent className="max-w-4xl border-border/70 bg-card/95">
          <DialogHeader>
            <DialogTitle>Edit Feature Details</DialogTitle>
            <DialogDescription>
              Clean up how this feature appears in the library. Use the structured editor for normal changes, or switch to JSON only if you need full control.
            </DialogDescription>
          </DialogHeader>
          <Tabs value={manifestTab} onValueChange={(value) => setManifestTab(value as 'structured' | 'json')}>
            <TabsList>
              <TabsTrigger value="structured">Structured</TabsTrigger>
              <TabsTrigger value="json">Advanced JSON</TabsTrigger>
            </TabsList>

            <TabsContent value="structured">
              <div className="space-y-4">
                <div className="rounded-2xl border border-border/70 bg-background/40 p-3 text-xs text-muted-foreground">
                  Internal ID: {manifestPackage?.packageId} · Editing: {formatManifestSource(manifestSource)}
                </div>

                {parsedManifest ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 md:grid-cols-3">
                      <div className="space-y-2">
                        <Label>Feature name</Label>
                        <p className="text-xs text-muted-foreground">What people will see in the library.</p>
                        <Input
                          value={parsedManifest.name || ''}
                          onChange={(event) => updateManifestDraft((draft) => { draft.name = event.target.value; })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Browse group</Label>
                        <p className="text-xs text-muted-foreground">Simple browsing bucket like AI, Pokemon, or Utility.</p>
                        <Input
                          value={parsedManifest.collection || ''}
                          onChange={(event) => updateManifestDraft((draft) => { draft.collection = event.target.value; })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Show in library</Label>
                        <p className="text-xs text-muted-foreground">Use hidden for unfinished work or advanced only for power-user features.</p>
                        <Select
                          value={parsedManifest.visibility || 'default'}
                          onValueChange={(value) => updateManifestDraft((draft) => { draft.visibility = value as ManifestDraft['visibility']; })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">{formatVisibility('default')}</SelectItem>
                            <SelectItem value="advanced">{formatVisibility('advanced')}</SelectItem>
                            <SelectItem value="hidden">{formatVisibility('hidden')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Notes</Label>
                      <p className="text-xs text-muted-foreground">One note per line. Good for install tips or warnings.</p>
                      <Textarea
                        value={(parsedManifest.notes || []).join('\n')}
                        onChange={(event) => updateManifestDraft((draft) => {
                          draft.notes = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean);
                        })}
                        className="min-h-[90px]"
                      />
                    </div>

                    <div className="grid gap-6 lg:grid-cols-2">
                      {(['commands', 'actions'] as const).map((section) => (
                        <div key={section} className="space-y-3 rounded-2xl border border-border/70 bg-background/40 p-4">
                          <div className="text-sm font-medium">{section === 'commands' ? 'Chat triggers' : 'Action steps'}</div>
                          <p className="text-xs text-muted-foreground">
                            Describe what each piece does so people can safely decide what to keep.
                          </p>
                          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                            {parsedManifest.items[section].map((item, index) => (
                              <div key={item.key} className="rounded-xl border border-border/60 bg-background/60 p-3">
                                <div className="mb-3 text-xs text-muted-foreground">{item.key}</div>
                                <div className="grid gap-3">
                                  <div className="space-y-2">
                                    <Label>Label</Label>
                                    <Input
                                      value={item.label || ''}
                                      onChange={(event) => updateManifestDraft((draft) => {
                                        draft.items[section][index].label = event.target.value;
                                      })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Group</Label>
                                    <Input
                                      value={item.group || ''}
                                      onChange={(event) => updateManifestDraft((draft) => {
                                        draft.items[section][index].group = event.target.value;
                                      })}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label>Description</Label>
                                    <Textarea
                                      value={item.description || ''}
                                      onChange={(event) => updateManifestDraft((draft) => {
                                        draft.items[section][index].description = event.target.value;
                                      })}
                                      className="min-h-[72px]"
                                    />
                                  </div>
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <Label>What kind of piece is this?</Label>
                                      <p className="text-xs text-muted-foreground">This changes the badges and how the item is explained in the library.</p>
                                      <Select
                                        value={item.role || 'support'}
                                        onValueChange={(value) => updateManifestDraft((draft) => {
                                          draft.items[section][index].role = value as ManifestItem['role'];
                                        })}
                                      >
                                        <SelectTrigger>
                                          <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                          <SelectItem value="primary">{formatManifestRole('primary')}</SelectItem>
                                          <SelectItem value="support">{formatManifestRole('support')}</SelectItem>
                                          <SelectItem value="admin">{formatManifestRole('admin')}</SelectItem>
                                          <SelectItem value="variant">{formatManifestRole('variant')}</SelectItem>
                                          <SelectItem value="overlay">{formatManifestRole('overlay')}</SelectItem>
                                        </SelectContent>
                                      </Select>
                                    </div>
                                    <div className="space-y-2">
                                      <Label>Tags</Label>
                                      <p className="text-xs text-muted-foreground">Comma-separated words that help with search and filtering.</p>
                                      <Input
                                        value={(item.tags || []).join(', ')}
                                        onChange={(event) => updateManifestDraft((draft) => {
                                          draft.items[section][index].tags = event.target.value
                                            .split(',')
                                            .map((tag) => tag.trim())
                                            .filter(Boolean);
                                        })}
                                      />
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-sm">
                                      <Checkbox
                                        checked={item.required !== false}
                                        onCheckedChange={(value) => updateManifestDraft((draft) => {
                                          draft.items[section][index].required = value === true;
                                        })}
                                      />
                                      Always install this part
                                    </label>
                                    <label className="flex items-center gap-2 text-sm">
                                      <Checkbox
                                        checked={item.enabledByDefault !== false}
                                        onCheckedChange={(value) => updateManifestDraft((draft) => {
                                          draft.items[section][index].enabledByDefault = value === true;
                                        })}
                                      />
                                      Select this part by default
                                    </label>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                    The advanced JSON draft is invalid, so the structured editor is unavailable until it parses again.
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="json">
              <Textarea
                value={manifestDraft}
                onChange={(event) => setManifestDraft(event.target.value)}
                className="min-h-[520px] font-mono text-xs"
              />
            </TabsContent>
          </Tabs>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManifestPackage(null)} disabled={manifestSaving}>
              Cancel
            </Button>
            <Button onClick={() => void saveManifestEditor()} disabled={manifestSaving}>
              {manifestSaving ? 'Saving...' : 'Save Details'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(sandboxPackage)} onOpenChange={(open) => !open && setSandboxPackage(null)}>
        <DialogContent className="max-w-4xl border-border/70 bg-card/95">
          <DialogHeader>
            <DialogTitle>Try This Feature</DialogTitle>
            <DialogDescription>
              Run this feature against fake chat input and inspect the preview before installing it or debugging it live.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="text-sm font-medium">{sandboxPackage?.name}</div>
                <div className="mt-1 text-xs text-muted-foreground">{sandboxPackage?.packageId}</div>
              </div>
              <div className="space-y-3 rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Trigger to test</div>
                  <select
                    value={sandboxCommandKey}
                    onChange={(event) => setSandboxCommandKey(event.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {(sandboxPackage?.commands || []).map((command) => {
                      const key = getCommandKey(command);
                      return (
                        <option key={key} value={key}>
                          {command.command || command.name}
                        </option>
                      );
                    })}
                    {(sandboxPackage?.commands || []).length === 0 ? <option value="">No commands</option> : null}
                  </select>
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Viewer name</div>
                  <Input value={sandboxUserName} onChange={(event) => setSandboxUserName(event.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Message text after the command</div>
                  <Input value={sandboxRawInput} onChange={(event) => setSandboxRawInput(event.target.value)} placeholder="example: @raider" />
                </div>
                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground">Platform</div>
                  <Input value={sandboxPlatform} onChange={(event) => setSandboxPlatform(event.target.value)} />
                </div>
                <Button onClick={() => void runSandbox()} disabled={sandboxRunning || !sandboxPackage}>
                  {sandboxRunning ? 'Building preview...' : 'Run Preview'}
                </Button>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="text-sm font-medium">Preview results</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Chat replies, OBS changes, variable updates, and warnings appear here.
                </div>
              </div>

              {sandboxResult ? (
                <Tabs defaultValue="chat" className="space-y-4">
                  <TabsList>
                    <TabsTrigger value="chat">Chat Preview</TabsTrigger>
                    <TabsTrigger value="events">Step List</TabsTrigger>
                    <TabsTrigger value="obs">OBS Preview</TabsTrigger>
                    <TabsTrigger value="vars">Variables</TabsTrigger>
                    <TabsTrigger value="warnings">
                      Warnings{sandboxResult.warnings.length > 0 ? ` (${sandboxResult.warnings.length})` : ''}
                    </TabsTrigger>
                  </TabsList>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{sandboxResult.executedActions.length} actions walked</Badge>
                    <Badge variant="outline">{sandboxResult.events.length} simulated events</Badge>
                    <Badge variant={sandboxResult.warnings.length > 0 ? 'destructive' : 'outline'}>
                      {sandboxResult.warnings.length} warnings
                    </Badge>
                  </div>

                  {sandboxResult.warnings.length > 0 ? (
                    <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
                      <div className="text-sm font-medium text-destructive">Preview needs attention</div>
                      <div className="mt-2 space-y-2">
                        {sandboxResult.warnings.map((warning) => (
                          <div key={warning} className="rounded-xl border border-destructive/30 bg-background/70 p-3 text-sm">
                            {warning}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <TabsContent value="events">
                    <div className="space-y-2 rounded-2xl border border-border/70 bg-background/40 p-4">
                      {sandboxResult.events.length > 0 ? sandboxResult.events.map((event, index) => (
                        <div key={`${event.type}-${index}`} className="rounded-xl border border-border/60 bg-background/60 p-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{formatTag(event.type)}</Badge>
                            <div className="text-sm font-medium">{event.label}</div>
                          </div>
                          {event.detail ? <div className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{event.detail}</div> : null}
                        </div>
                      )) : (
                        <div className="text-sm text-muted-foreground">No preview steps yet.</div>
                      )}
                    </div>
                  </TabsContent>

                  <TabsContent value="chat">
                    <div className="space-y-2 rounded-2xl border border-border/70 bg-background/40 p-4">
                      {sandboxResult.chatTranscript.map((entry, index) => (
                        <div key={`${entry.speaker}-${index}`} className="rounded-xl border border-border/60 bg-background/60 p-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">{entry.speaker === 'viewer' ? 'Viewer' : entry.speaker === 'bot' ? 'Bot' : 'Discord'}</Badge>
                          </div>
                          <div className="mt-2 text-sm">{entry.message}</div>
                        </div>
                      ))}
                    </div>
                  </TabsContent>

                  <TabsContent value="obs">
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-background/40 p-4">
                      <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Current scene</div>
                        <div className="mt-1 text-sm font-medium">{sandboxResult.obsState.currentScene || 'None'}</div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Sources</div>
                        <div className="mt-2 space-y-1">
                          {Object.entries(sandboxResult.obsState.sources).length > 0 ? Object.entries(sandboxResult.obsState.sources).map(([source, state]) => (
                            <div key={source} className="text-xs text-muted-foreground">
                              {source}: {state.visible ? 'visible' : 'hidden'}{state.scene ? ` in ${state.scene}` : ''}
                            </div>
                          )) : <div className="text-xs text-muted-foreground">No source changes.</div>}
                        </div>
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/60 p-3">
                        <div className="text-xs text-muted-foreground">Text sources</div>
                        <div className="mt-2 space-y-1">
                          {Object.entries(sandboxResult.obsState.textSources).length > 0 ? Object.entries(sandboxResult.obsState.textSources).map(([source, value]) => (
                            <div key={source} className="text-xs text-muted-foreground">
                              {source}: {value}
                            </div>
                          )) : <div className="text-xs text-muted-foreground">No text updates.</div>}
                        </div>
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="vars">
                    <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                      <div className="mb-2 text-sm font-medium">Preview variables</div>
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{JSON.stringify(sandboxResult.variables, null, 2)}</pre>
                    </div>
                  </TabsContent>

                  <TabsContent value="warnings">
                    <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                      <div className="text-sm font-medium">Things to watch</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        These notes explain why a preview may not match what you expected.
                      </div>
                      <div className="mt-3 space-y-2">
                        {sandboxResult.warnings.length > 0 ? sandboxResult.warnings.map((warning) => (
                          <div key={warning} className="rounded-xl border border-border/60 bg-background/60 p-3 text-sm">{warning}</div>
                        )) : <div className="text-sm text-muted-foreground">No warnings for this preview.</div>}
                      </div>
                    </div>
                  </TabsContent>

                  <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
                    <div className="text-sm font-medium">Quick diagnosis</div>
                    <div className="mt-2 space-y-1">
                      {sandboxResult.warnings.length > 0 ? sandboxResult.warnings.map((warning) => (
                        <div key={warning} className="text-xs text-muted-foreground">{warning}</div>
                      )) : <div className="text-xs text-muted-foreground">No warnings for this preview.</div>}
                    </div>
                  </div>
                </Tabs>
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/40 p-6 text-sm text-muted-foreground">
                  Run the preview to see how this feature responds before you use it live.
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSandboxPackage(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
