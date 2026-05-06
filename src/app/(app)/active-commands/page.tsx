"use client";

import { Suspense, useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, MoreHorizontal, Play, BarChart2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useActionsData } from "@/hooks/use-actions-data";
import { useCommandsData } from "@/hooks/use-commands-data";
import type { SubAction } from "@/services/automation/types";
import { SubActionType, TriggerType } from "@/services/automation/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { updateActionClient } from "@/lib/client-actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const AutomationAIChat = dynamic(() => import("@/components/automation/AutomationAIChat"), { ssr: false });

function ActiveCommandsPageClient() {
  const { actions, isLoading, error, refresh } = useActionsData();
  const { commands, isLoading: commandsLoading, error: commandsError } = useCommandsData();
  const { toast } = useToast();

  const searchParams = useSearchParams();

  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);

  const [draftActionId, setDraftActionId] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState(false);
  const [draftTriggers, setDraftTriggers] = useState<any[]>([]);
  const [draftSubActions, setDraftSubActions] = useState<SubAction[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const [newTriggerType, setNewTriggerType] = useState<number>(TriggerType.COMMAND);
  const [newTriggerCommandId, setNewTriggerCommandId] = useState<string | null>(null);
  const [newTriggerRewardId, setNewTriggerRewardId] = useState<string>("");
  const [newTriggerMin, setNewTriggerMin] = useState<string>("");
  const [newTriggerMax, setNewTriggerMax] = useState<string>("");
  const [newTriggerTiers, setNewTriggerTiers] = useState<string>("");

  const [isTriggerJsonOpen, setIsTriggerJsonOpen] = useState(false);
  const [editingTriggerId, setEditingTriggerId] = useState<string | null>(null);
  const [triggerJsonDraft, setTriggerJsonDraft] = useState<string>("");
  const [triggerJsonError, setTriggerJsonError] = useState<string | null>(null);

  const [isEditSubActionOpen, setIsEditSubActionOpen] = useState(false);
  const [editingPath, setEditingPath] = useState<number[] | null>(null);
  const [subActionDraft, setSubActionDraft] = useState<any | null>(null);

  const [isSubActionJsonOpen, setIsSubActionJsonOpen] = useState(false);
  const [subActionJsonDraft, setSubActionJsonDraft] = useState<string>("");
  const [subActionJsonError, setSubActionJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load active commands",
        description: error,
      });
    }
  }, [error, toast]);

  useEffect(() => {
    if (commandsError) {
      toast({
        variant: "destructive",
        title: "Failed to load commands",
        description: commandsError,
      });
    }
  }, [commandsError, toast]);

  useEffect(() => {
    const fromQuery = searchParams.get("actionId");
    if (fromQuery && fromQuery !== selectedActionId) {
      setSelectedActionId(fromQuery);
    }
    // Intentionally only respond to URL param changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const activeCommandRows = useMemo(() => {
    const cmdById = new Map(commands.map((c) => [c.id, c]));
    return actions
      .filter((a) => a.enabled)
      .flatMap((a) => {
        const cmdTriggers = (a.triggers ?? []).filter((t) => Number(t.type) === TriggerType.COMMAND);
        if (cmdTriggers.length === 0) return [];
        return cmdTriggers.map((t: any) => {
          const cmd = t.commandId ? cmdById.get(String(t.commandId)) : undefined;
          return {
            actionId: a.id,
            actionName: a.name,
            commandId: String(t.commandId || ""),
            commandLabel: (cmd?.command ?? cmd?.name ?? t.commandId ?? "—").toString(),
            trigger: "On Chat Command",
            platform: "Twitch",
            status: "Enabled",
          };
        });
      });
  }, [actions, commands]);

  const selectedAction = useMemo(() => actions.find((a) => a.id === selectedActionId) ?? null, [actions, selectedActionId]);

  useEffect(() => {
    if (!selectedAction) return;
    setDraftActionId(selectedAction.id);
    setDraftEnabled(!!selectedAction.enabled);
    setDraftTriggers(Array.isArray(selectedAction.triggers) ? (selectedAction.triggers as any[]) : []);
    setDraftSubActions(Array.isArray(selectedAction.subActions) ? (selectedAction.subActions as any) : []);
  }, [selectedAction?.id]);

  const handleRunCommand = (commandName: string) => {
    toast({
      title: "Command Triggered",
      description: `The command "${commandName}" is being executed.`,
    });
  };

  const addCommandTriggerToDraft = () => {
    if (!selectedCommandId) return;
    const already = draftTriggers.some((t: any) => Number(t.type) === TriggerType.COMMAND && String(t.commandId) === selectedCommandId);
    if (already) return;
    setDraftTriggers([
      ...draftTriggers,
      {
        id: crypto.randomUUID(),
        type: TriggerType.COMMAND,
        enabled: true,
        exclusions: [],
        commandId: selectedCommandId,
      },
    ]);
    setDraftEnabled(true);
  };

  const labelForTriggerType = (t: number): string => {
    if (t === TriggerType.COMMAND) return "Chat Command";
    if (t === TriggerType.FOLLOW) return "Follow";
    if (t === TriggerType.CHEER) return "Cheer";
    if (t === TriggerType.SUBSCRIBE) return "Subscribe";
    if (t === TriggerType.RESUB) return "Resub";
    if (t === TriggerType.GIFT_SUB) return "Gift Sub";
    if (t === TriggerType.GIFT_BOMB) return "Gift Bomb";
    if (t === TriggerType.RAID) return "Raid";
    if (t === TriggerType.CHANNEL_POINT_REWARD) return "Channel Point Reward";
    return `Trigger ${String(t)}`;
  };

  const parseNumberOrUndefined = (value: string): number | undefined => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : undefined;
  };

  const parseExclusions = (text: string): string[] => {
    return text
      .split(/[,\n]/g)
      .map((s) => s.trim())
      .filter(Boolean);
  };

  const addNewTriggerToDraft = () => {
    if (!selectedAction) return;
    const t = Number(newTriggerType);

    if (t === TriggerType.COMMAND) {
      if (!newTriggerCommandId) return;
      const already = draftTriggers.some(
        (x: any) => Number(x.type) === TriggerType.COMMAND && String(x.commandId) === String(newTriggerCommandId)
      );
      if (already) return;
    }

    const next: any = {
      id: crypto.randomUUID(),
      type: t,
      enabled: true,
      exclusions: [],
    };

    if (t === TriggerType.COMMAND) next.commandId = newTriggerCommandId;
    if (t === TriggerType.CHANNEL_POINT_REWARD) next.rewardId = newTriggerRewardId.trim() || undefined;

    const min = parseNumberOrUndefined(newTriggerMin);
    const max = parseNumberOrUndefined(newTriggerMax);
    const tiers = parseNumberOrUndefined(newTriggerTiers);
    if (min != null) next.min = min;
    if (max != null) next.max = max;
    if (tiers != null) next.tiers = tiers;

    setDraftTriggers((prev) => [...prev, next]);
    setDraftEnabled(true);
  };

  const openTriggerJsonEditor = (trigger: any) => {
    setTriggerJsonError(null);
    setEditingTriggerId(String(trigger?.id ?? ""));
    setTriggerJsonDraft(JSON.stringify(trigger ?? {}, null, 2));
    setIsTriggerJsonOpen(true);
  };

  const saveTriggerJsonEditor = () => {
    if (!editingTriggerId) return;
    try {
      const parsed = JSON.parse(triggerJsonDraft);
      if (!parsed || typeof parsed !== "object") {
        setTriggerJsonError("Invalid JSON: expected an object");
        return;
      }
      setDraftTriggers((prev) =>
        prev.map((t: any) => (String(t.id) === editingTriggerId ? { ...t, ...parsed, id: t.id } : t))
      );
      setIsTriggerJsonOpen(false);
      setEditingTriggerId(null);
      setTriggerJsonDraft("");
      setTriggerJsonError(null);
    } catch (e: any) {
      setTriggerJsonError(e?.message || "Invalid JSON");
    }
  };

  const saveDraft = async () => {
    if (!draftActionId) return;
    setIsSaving(true);
    try {
      await updateActionClient(
        draftActionId,
        {
          enabled: draftEnabled,
          triggers: draftTriggers as any,
          subActions: draftSubActions as any,
        } as any
      );
      toast({ title: "Saved", description: "Action updated." });
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Save failed", description: e?.message || String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  const openSubActionJsonEditor = () => {
    if (!subActionDraft) return;
    setSubActionJsonError(null);
    setSubActionJsonDraft(JSON.stringify(subActionDraft ?? {}, null, 2));
    setIsSubActionJsonOpen(true);
  };

  const saveSubActionJsonEditor = () => {
    if (!subActionDraft) return;
    try {
      const parsed = JSON.parse(subActionJsonDraft);
      if (!parsed || typeof parsed !== "object") {
        setSubActionJsonError("Invalid JSON: expected an object");
        return;
      }
      setSubActionDraft((d: any) => ({
        ...d,
        ...parsed,
        id: d?.id,
        type: parsed?.type ?? d?.type,
      }));
      setIsSubActionJsonOpen(false);
      setSubActionJsonError(null);
    } catch (e: any) {
      setSubActionJsonError(e?.message || "Invalid JSON");
    }
  };

  function normalizeIndex(list: any[]): any[] {
    return list
      .map((item, i) => ({ ...item, index: typeof item.index === "number" ? item.index : i }))
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
      .map((item, i) => ({ ...item, index: i }));
  }

  function ensureIfElseStructure(sa: any): any {
    if (sa?.type !== SubActionType.IF_ELSE) return sa;
    const blocks = Array.isArray(sa.subActions) ? sa.subActions : [];
    const ifBlock = blocks.find((b: any) => b.type === SubActionType.IF_BLOCK);
    const elseBlock = blocks.find((b: any) => b.type === SubActionType.ELSE_BLOCK);
    const nextBlocks = [
      ifBlock ?? { id: crypto.randomUUID(), type: SubActionType.IF_BLOCK, enabled: true, index: 0, parentId: sa.id, random: false, subActions: [] },
      elseBlock ?? { id: crypto.randomUUID(), type: SubActionType.ELSE_BLOCK, enabled: true, index: 1, parentId: sa.id, random: false, subActions: [] },
    ];
    return { ...sa, subActions: normalizeIndex(nextBlocks) };
  }

  function moveInArray<T>(arr: T[], from: number, to: number): T[] {
    if (from < 0 || from >= arr.length) return arr;
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  }

  const updateSubActionsAtPath = (root: any[], path: number[], nextValue: any): any[] => {
    if (path.length === 0) return root;
    const [head, ...rest] = path;
    const list = [...root];
    const current = list[head];
    if (!current) return root;
    if (rest.length === 0) {
      list[head] = ensureIfElseStructure(nextValue);
      return normalizeIndex(list);
    }
    const children = Array.isArray(current.subActions) ? current.subActions : [];
    const nextChildren = updateSubActionsAtPath(children, rest, nextValue);
    list[head] = ensureIfElseStructure({ ...current, subActions: nextChildren });
    return normalizeIndex(list);
  };

  const deleteSubActionAtPath = (root: any[], path: number[]): any[] => {
    if (path.length === 0) return root;
    const [head, ...rest] = path;
    const list = [...root];
    const current = list[head];
    if (!current) return root;
    if (rest.length === 0) {
      list.splice(head, 1);
      return normalizeIndex(list);
    }
    const children = Array.isArray(current.subActions) ? current.subActions : [];
    const nextChildren = deleteSubActionAtPath(children, rest);
    list[head] = ensureIfElseStructure({ ...current, subActions: nextChildren });
    return normalizeIndex(list);
  };

  const insertSubActionAtPath = (root: any[], parentPath: number[] | null, sa: any): any[] => {
    if (!parentPath || parentPath.length === 0) {
      return normalizeIndex([...root, ensureIfElseStructure(sa)]);
    }
    const [head, ...rest] = parentPath;
    const list = [...root];
    const current = list[head];
    if (!current) return root;
    const children = Array.isArray(current.subActions) ? current.subActions : [];
    const nextChildren = insertSubActionAtPath(children, rest, sa);
    list[head] = ensureIfElseStructure({ ...current, subActions: nextChildren });
    return normalizeIndex(list);
  };

  const moveSubActionAtPath = (root: any[], path: number[], delta: -1 | 1): any[] => {
    if (path.length === 0) return root;
    const [head, ...rest] = path;
    const list = [...root];
    const current = list[head];
    if (!current) return root;
    if (rest.length === 0) {
      return normalizeIndex(moveInArray(list, head, head + delta));
    }
    const children = Array.isArray(current.subActions) ? current.subActions : [];
    const nextChildren = moveSubActionAtPath(children, rest, delta);
    list[head] = ensureIfElseStructure({ ...current, subActions: nextChildren });
    return normalizeIndex(list);
  };

  const labelForSubActionType = (value?: number) => {
    if (value === SubActionType.SEND_MESSAGE) return "Send Chat Message";
    if (value === SubActionType.RUN_ACTION) return "Run Action";
    if (value === SubActionType.GET_USER_INFO) return "Get User Info";
    if (value === SubActionType.IF_ELSE) return "If / Else";
    if (value === SubActionType.IF_BLOCK) return "IF Block";
    if (value === SubActionType.ELSE_BLOCK) return "ELSE Block";
    if (value === SubActionType.BREAK) return "Break";
    if (value === SubActionType.WAIT) return "Wait";
    if (value === SubActionType.COMMENT) return "Comment";
    return String(value ?? "Unknown");
  };

  const previewForSubAction = (sa: any): string => {
    if (!sa) return "";
    if (sa.type === SubActionType.SEND_MESSAGE) return String(sa.text || "");
    if (sa.type === SubActionType.RUN_ACTION) return `actionId=${String(sa.actionId || "")}`;
    if (sa.type === SubActionType.GET_USER_INFO) return `user=${String(sa.userLogin || "")}`;
    if (sa.type === SubActionType.IF_ELSE) return `${String(sa.input || "")} op=${String(sa.operation ?? "")} ${String(sa.value ?? "")}`;
    return "";
  };

  const currentWorkflowForAI = useMemo(
    () => ({
      name: selectedAction?.name ?? "",
      triggers: draftTriggers ?? [],
      subActions: draftSubActions ?? [],
    }),
    [selectedAction?.name, draftTriggers, draftSubActions]
  );

  const applyAutomationFromAI = (automation: any) => {
    if (!automation || typeof automation !== "object") return;

    if (Array.isArray((automation as any).triggers)) {
      setDraftTriggers((automation as any).triggers as any[]);
    }
    if (Array.isArray((automation as any).subActions)) {
      setDraftSubActions((automation as any).subActions as any);
    }

    setDraftEnabled(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Active Commands</CardTitle>
          <CardDescription>Link a command to an action as a trigger, then enable it.</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="space-y-2">
            <div className="text-sm font-medium">Choose Action</div>
            <Select value={selectedActionId ?? ""} onValueChange={(v) => setSelectedActionId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select an action" />
              </SelectTrigger>
              <SelectContent>
                {actions.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="text-sm font-medium">Choose Command</div>
            <Select value={selectedCommandId ?? ""} onValueChange={(v) => setSelectedCommandId(v)}>
              <SelectTrigger>
                <SelectValue placeholder={commandsLoading ? "Loading commands..." : "Select a command"} />
              </SelectTrigger>
              <SelectContent>
                {commands.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {(c.command ?? '').trim() || c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2 lg:col-span-2">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Enable Action</div>
              <div className="text-xs text-muted-foreground">Required for the command to be live.</div>
            </div>
            <Switch
              checked={draftEnabled}
              disabled={!selectedAction}
              onCheckedChange={setDraftEnabled}
            />
          </div>

          <div className="lg:col-span-2">
            <div className="flex items-center gap-2">
              <Button onClick={addCommandTriggerToDraft} disabled={!selectedAction || !selectedCommandId}>
              Add Command As Trigger + Enable
              </Button>
              <Button onClick={saveDraft} disabled={!selectedAction || isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </Button>
            </div>
          </div>
        </div>

        {selectedAction ? (
          <div className="mb-8 space-y-4">
            <div className="rounded-md border p-4">
              <div className="text-sm font-medium mb-2">Triggers</div>
              <div className="space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-md border p-3">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Add Trigger Type</div>
                    <Select value={String(newTriggerType)} onValueChange={(v) => setNewTriggerType(Number(v))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select trigger type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={String(TriggerType.COMMAND)}>{labelForTriggerType(TriggerType.COMMAND)}</SelectItem>
                        <SelectItem value={String(TriggerType.FOLLOW)}>{labelForTriggerType(TriggerType.FOLLOW)}</SelectItem>
                        <SelectItem value={String(TriggerType.CHEER)}>{labelForTriggerType(TriggerType.CHEER)}</SelectItem>
                        <SelectItem value={String(TriggerType.SUBSCRIBE)}>{labelForTriggerType(TriggerType.SUBSCRIBE)}</SelectItem>
                        <SelectItem value={String(TriggerType.RESUB)}>{labelForTriggerType(TriggerType.RESUB)}</SelectItem>
                        <SelectItem value={String(TriggerType.GIFT_SUB)}>{labelForTriggerType(TriggerType.GIFT_SUB)}</SelectItem>
                        <SelectItem value={String(TriggerType.GIFT_BOMB)}>{labelForTriggerType(TriggerType.GIFT_BOMB)}</SelectItem>
                        <SelectItem value={String(TriggerType.RAID)}>{labelForTriggerType(TriggerType.RAID)}</SelectItem>
                        <SelectItem value={String(TriggerType.CHANNEL_POINT_REWARD)}>{labelForTriggerType(TriggerType.CHANNEL_POINT_REWARD)}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {Number(newTriggerType) === TriggerType.COMMAND ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Command</div>
                      <Select value={newTriggerCommandId ?? ""} onValueChange={(v) => setNewTriggerCommandId(v)}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a command" />
                        </SelectTrigger>
                        <SelectContent>
                          {commands.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {(c.command ?? "").trim() || c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {Number(newTriggerType) === TriggerType.CHANNEL_POINT_REWARD ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Reward ID</div>
                      <Input value={newTriggerRewardId} onChange={(e) => setNewTriggerRewardId(e.target.value)} placeholder="rewardId" />
                    </div>
                  ) : null}

                  {Number(newTriggerType) !== TriggerType.COMMAND && Number(newTriggerType) !== TriggerType.CHANNEL_POINT_REWARD ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Optional Filters</div>
                      <div className="grid grid-cols-3 gap-2">
                        <Input value={newTriggerMin} onChange={(e) => setNewTriggerMin(e.target.value)} placeholder="min" />
                        <Input value={newTriggerMax} onChange={(e) => setNewTriggerMax(e.target.value)} placeholder="max" />
                        <Input value={newTriggerTiers} onChange={(e) => setNewTriggerTiers(e.target.value)} placeholder="tiers" />
                      </div>
                    </div>
                  ) : null}

                  <div className="md:col-span-3 flex items-center gap-2">
                    <Button onClick={addNewTriggerToDraft} disabled={!selectedAction}>
                      Add Trigger + Enable
                    </Button>
                    <Button onClick={saveDraft} disabled={!selectedAction || isSaving}>
                      {isSaving ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>

                {draftTriggers.map((t: any) => {
                  const isCommand = Number(t.type) === TriggerType.COMMAND;
                  const isReward = Number(t.type) === TriggerType.CHANNEL_POINT_REWARD;
                  const cmd = isCommand ? commands.find((c) => c.id === String(t.commandId)) : undefined;
                  const label =
                    isCommand ? (cmd?.command ?? cmd?.name ?? t.commandId ?? "—").toString() : labelForTriggerType(Number(t.type));

                  const exclusionsText = Array.isArray(t.exclusions) ? (t.exclusions as any[]).join("\n") : "";

                  return (
                    <div key={t.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            type={String(t.type)} id={String(t.id)}
                            {isCommand ? ` commandId=${String(t.commandId || "")}` : ""}
                            {isReward ? ` rewardId=${String(t.rewardId || "")}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="secondary" onClick={() => openTriggerJsonEditor(t)}>
                            JSON
                          </Button>
                          <Switch
                            checked={t.enabled !== false}
                            onCheckedChange={(checked) => {
                              setDraftTriggers((prev) => prev.map((x: any) => (x.id === t.id ? { ...x, enabled: checked } : x)));
                            }}
                          />
                          <Button variant="destructive" onClick={() => setDraftTriggers((prev) => prev.filter((x: any) => x.id !== t.id))}>
                            Remove
                          </Button>
                        </div>
                      </div>

                      {isCommand ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Command</div>
                            <Select
                              value={String(t.commandId || "")}
                              onValueChange={(v) =>
                                setDraftTriggers((prev) => prev.map((x: any) => (x.id === t.id ? { ...x, commandId: v } : x)))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a command" />
                              </SelectTrigger>
                              <SelectContent>
                                {commands.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {(c.command ?? "").trim() || c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      ) : null}

                      {isReward ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Reward ID</div>
                            <Input
                              value={String(t.rewardId || "")}
                              onChange={(e) =>
                                setDraftTriggers((prev) => prev.map((x: any) => (x.id === t.id ? { ...x, rewardId: e.target.value } : x)))
                              }
                            />
                          </div>
                        </div>
                      ) : null}

                      {!isCommand && !isReward ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Min</div>
                            <Input
                              value={t.min == null ? "" : String(t.min)}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) =>
                                    x.id === t.id ? { ...x, min: parseNumberOrUndefined(e.target.value) } : x
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Max</div>
                            <Input
                              value={t.max == null ? "" : String(t.max)}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) =>
                                    x.id === t.id ? { ...x, max: parseNumberOrUndefined(e.target.value) } : x
                                  )
                                )
                              }
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Tiers</div>
                            <Input
                              value={t.tiers == null ? "" : String(t.tiers)}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) =>
                                    x.id === t.id ? { ...x, tiers: parseNumberOrUndefined(e.target.value) } : x
                                  )
                                )
                              }
                            />
                          </div>
                        </div>
                      ) : null}

                      <div className="space-y-2">
                        <div className="text-sm font-medium">Exclusions</div>
                        <Textarea
                          rows={2}
                          value={exclusionsText}
                          onChange={(e) => {
                            const next = parseExclusions(e.target.value);
                            setDraftTriggers((prev) => prev.map((x: any) => (x.id === t.id ? { ...x, exclusions: next } : x)));
                          }}
                          placeholder="One per line (usernames, etc.)"
                        />
                      </div>
                    </div>
                  );
                })}

                {draftTriggers.length === 0 ? <div className="text-sm text-muted-foreground">No triggers yet.</div> : null}
              </div>
            </div>

            <div className="rounded-md border p-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <div className="text-sm font-medium">Flow Editor</div>
                  <div className="text-xs text-muted-foreground">Build the full sub-action flow for this action.</div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const next = ensureIfElseStructure({
                      id: crypto.randomUUID(),
                      type: SubActionType.SEND_MESSAGE,
                      enabled: true,
                      weight: 0,
                      index: draftSubActions.length,
                      parentId: null,
                      text: "",
                      useBot: true,
                    });
                    setEditingPath([]);
                    setSubActionDraft(next);
                    setIsEditSubActionOpen(true);
                  }}
                >
                  Add Step
                </Button>
              </div>

              <SubActionTree
                subActions={normalizeIndex(draftSubActions as any)}
                depth={0}
                onEdit={(path, sa) => {
                  setEditingPath(path);
                  setSubActionDraft(ensureIfElseStructure(sa));
                  setIsEditSubActionOpen(true);
                }}
                onToggleEnabled={(path, enabled) => {
                  setDraftSubActions((prev: any) => updateSubActionsAtPath(normalizeIndex(prev), path, { ...getAtPath(normalizeIndex(prev), path), enabled }));
                }}
                onDelete={(path) => setDraftSubActions((prev: any) => deleteSubActionAtPath(normalizeIndex(prev), path))}
                onMove={(path, delta) => setDraftSubActions((prev: any) => moveSubActionAtPath(normalizeIndex(prev), path, delta))}
                onAddChild={(parentPath) => {
                  const next = ensureIfElseStructure({
                    id: crypto.randomUUID(),
                    type: SubActionType.SEND_MESSAGE,
                    enabled: true,
                    weight: 0,
                    index: 0,
                    parentId: null,
                    text: "",
                    useBot: true,
                  });
                  setEditingPath(parentPath);
                  setSubActionDraft(next);
                  setIsEditSubActionOpen(true);
                }}
                labelForType={labelForSubActionType}
                previewFor={previewForSubAction}
              />

              <div className="mt-3">
                <Button onClick={saveDraft} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Flow"}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Command</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading active commands...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && activeCommandRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  No active commands. Activate an action to see it here.
                </TableCell>
              </TableRow>
            )}
            {activeCommandRows.map((row) => (
              <TableRow key={`${row.actionId}:${row.commandId}`}> 
                <TableCell className="font-medium">{row.commandLabel}</TableCell>
                <TableCell>{row.trigger}</TableCell>
                <TableCell>
                  <Badge variant="outline">{row.platform}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="default" className="bg-green-600">
                    {row.status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button aria-haspopup="true" size="icon" variant="ghost">
                        <MoreHorizontal className="h-4 w-4" />
                        <span className="sr-only">Toggle menu</span>
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => handleRunCommand(row.commandLabel)}>
                        <Play className="mr-2 h-4 w-4" />
                        Run
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled>
                        <BarChart2 className="mr-2 h-4 w-4" />
                        Track
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem asChild>
                        <Link href={`/active-commands?actionId=${encodeURIComponent(row.actionId)}`}>Edit Action</Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                      <DropdownMenuItem className="text-destructive focus:text-destructive" disabled>
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <div className="mt-6">
          <AutomationAIChat
            currentWorkflow={currentWorkflowForAI}
            onAutomationGenerated={applyAutomationFromAI}
          />
        </div>
      </CardContent>

      <Dialog open={isEditSubActionOpen} onOpenChange={setIsEditSubActionOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Edit Step</DialogTitle>
            <DialogDescription>Configure a sub-action step.</DialogDescription>
          </DialogHeader>

          {subActionDraft ? (
            <div className="grid gap-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Type</div>
                  <Select
                    value={String(subActionDraft.type ?? SubActionType.SEND_MESSAGE)}
                    onValueChange={(v) => setSubActionDraft((d: any) => ensureIfElseStructure({ ...d, type: Number(v) }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={String(SubActionType.SEND_MESSAGE)}>Send Chat Message</SelectItem>
                      <SelectItem value={String(SubActionType.RUN_ACTION)}>Run Action</SelectItem>
                      <SelectItem value={String(SubActionType.GET_USER_INFO)}>Get User Info</SelectItem>
                      <SelectItem value={String(SubActionType.IF_ELSE)}>If / Else</SelectItem>
                      <SelectItem value={String(SubActionType.BREAK)}>Break</SelectItem>
                      <SelectItem value={String(SubActionType.WAIT)}>Wait</SelectItem>
                      <SelectItem value={String(SubActionType.COMMENT)}>Comment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Enabled</div>
                    <div className="text-xs text-muted-foreground">Whether this step runs.</div>
                  </div>
                  <Switch
                    checked={subActionDraft.enabled !== false}
                    onCheckedChange={(checked) => setSubActionDraft((d: any) => ({ ...d, enabled: checked }))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="space-y-0.5">
                  <div className="text-sm font-medium">Advanced JSON</div>
                  <div className="text-xs text-muted-foreground">Escape hatch for raw fields.</div>
                </div>
                <Button variant="secondary" onClick={openSubActionJsonEditor}>
                  Edit JSON
                </Button>
              </div>

              {Number(subActionDraft.type) === SubActionType.SEND_MESSAGE ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Message</div>
                  <Textarea
                    rows={4}
                    value={String(subActionDraft.text || "")}
                    onChange={(e) => setSubActionDraft((d: any) => ({ ...d, text: e.target.value }))}
                    placeholder="Use %targetUser% etc"
                  />
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <div className="space-y-0.5">
                      <div className="text-sm font-medium">Use Bot</div>
                      <div className="text-xs text-muted-foreground">Send as bot account when possible.</div>
                    </div>
                    <Switch
                      checked={subActionDraft.useBot !== false}
                      onCheckedChange={(checked) => setSubActionDraft((d: any) => ({ ...d, useBot: checked }))}
                    />
                  </div>
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.RUN_ACTION ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Action</div>
                  <Select
                    value={String(subActionDraft.actionId || "")}
                    onValueChange={(v) => setSubActionDraft((d: any) => ({ ...d, actionId: v }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select action to run" />
                    </SelectTrigger>
                    <SelectContent>
                      {actions.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.GET_USER_INFO ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">User Login</div>
                  <Input
                    value={String(subActionDraft.userLogin || "")}
                    onChange={(e) => setSubActionDraft((d: any) => ({ ...d, userLogin: e.target.value }))}
                    placeholder="%input0%"
                  />
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.IF_ELSE ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Input</div>
                    <Input
                      value={String(subActionDraft.input || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ensureIfElseStructure({ ...d, input: e.target.value }))}
                      placeholder="targetUser"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Operation</div>
                    <Select
                      value={String(subActionDraft.operation ?? 0)}
                      onValueChange={(v) => setSubActionDraft((d: any) => ensureIfElseStructure({ ...d, operation: Number(v) }))}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Operation" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Equals</SelectItem>
                        <SelectItem value="1">Not Equals</SelectItem>
                        <SelectItem value="2">Contains</SelectItem>
                        <SelectItem value="6">Is Empty</SelectItem>
                        <SelectItem value="7">Is Not Empty</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Value</div>
                    <Input
                      value={String(subActionDraft.value ?? "")}
                      onChange={(e) => setSubActionDraft((d: any) => ensureIfElseStructure({ ...d, value: e.target.value }))}
                    />
                  </div>
                  <div className="md:col-span-3 text-xs text-muted-foreground">
                    Add child steps under IF/ELSE in the flow list.
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsEditSubActionOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!subActionDraft) return;
                const root = normalizeIndex(draftSubActions as any);
                const path = editingPath ?? [];
                if (path.length === 0) {
                  setDraftSubActions(insertSubActionAtPath(root, null, subActionDraft) as any);
                } else {
                  // If path points to existing item update, else insert as child.
                  const current = getAtPath(root, path);
                  if (current) {
                    setDraftSubActions(updateSubActionsAtPath(root, path, subActionDraft) as any);
                  } else {
                    setDraftSubActions(insertSubActionAtPath(root, path, subActionDraft) as any);
                  }
                }
                setIsEditSubActionOpen(false);
              }}
            >
              Save Step
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isSubActionJsonOpen} onOpenChange={setIsSubActionJsonOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Edit Step (JSON)</DialogTitle>
            <DialogDescription>Advanced editor. Changes apply to the current step draft.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea rows={14} value={subActionJsonDraft} onChange={(e) => setSubActionJsonDraft(e.target.value)} />
            {subActionJsonError ? <div className="text-sm text-destructive">{subActionJsonError}</div> : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsSubActionJsonOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveSubActionJsonEditor}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isTriggerJsonOpen} onOpenChange={setIsTriggerJsonOpen}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Edit Trigger (JSON)</DialogTitle>
            <DialogDescription>Advanced editor. Changes apply to the selected trigger.</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Textarea rows={14} value={triggerJsonDraft} onChange={(e) => setTriggerJsonDraft(e.target.value)} />
            {triggerJsonError ? <div className="text-sm text-destructive">{triggerJsonError}</div> : null}
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsTriggerJsonOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveTriggerJsonEditor}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export default function ActiveCommandsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      }
    >
      <ActiveCommandsPageClient />
    </Suspense>
  );
}

function getAtPath(root: any[], path: number[]): any | null {
  let list: any[] = root;
  for (let i = 0; i < path.length; i++) {
    const idx = path[i];
    const item = list[idx];
    if (!item) return null;
    if (i === path.length - 1) return item;
    list = Array.isArray(item.subActions) ? item.subActions : [];
  }
  return null;
}

function SubActionTree({
  subActions,
  depth,
  onEdit,
  onToggleEnabled,
  onDelete,
  onMove,
  onAddChild,
  labelForType,
  previewFor,
  pathPrefix = [],
}: {
  subActions: any[];
  depth: number;
  onEdit: (path: number[], sa: any) => void;
  onToggleEnabled: (path: number[], enabled: boolean) => void;
  onDelete: (path: number[]) => void;
  onMove: (path: number[], delta: -1 | 1) => void;
  onAddChild: (parentPath: number[]) => void;
  labelForType: (t?: number) => string;
  previewFor: (sa: any) => string;
  pathPrefix?: number[];
}) {
  const list = Array.isArray(subActions) ? subActions : [];
  const depthIndentClass =
    depth <= 0
      ? ""
      : depth === 1
        ? "ml-4"
        : depth === 2
          ? "ml-8"
          : depth === 3
            ? "ml-12"
            : depth === 4
              ? "ml-16"
              : "ml-20";

  return (
    <div className="space-y-2">
      {list.map((sa: any, index: number) => {
        const path = [...pathPrefix, index];
        const canHaveChildren =
          sa.type === SubActionType.IF_ELSE || sa.type === SubActionType.IF_BLOCK || sa.type === SubActionType.ELSE_BLOCK;
        const children = Array.isArray(sa.subActions) ? sa.subActions : [];

        return (
          <div key={sa.id || path.join("-")} className={`rounded-md border px-3 py-2 ${depthIndentClass}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{labelForType(sa.type)}</div>
                <div className="text-xs text-muted-foreground truncate">{previewFor(sa)}</div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="secondary" onClick={() => onMove(path, -1)} disabled={index === 0}>
                  Up
                </Button>
                <Button variant="secondary" onClick={() => onMove(path, 1)} disabled={index === list.length - 1}>
                  Down
                </Button>
                <Switch checked={sa.enabled !== false} onCheckedChange={(checked) => onToggleEnabled(path, checked)} />
                <Button variant="secondary" onClick={() => onEdit(path, sa)}>
                  Edit
                </Button>
                <Button variant="destructive" onClick={() => onDelete(path)}>
                  Delete
                </Button>
              </div>
            </div>

            {canHaveChildren ? (
              <div className="mt-3 flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Children: {children.length}</div>
                <Button variant="secondary" onClick={() => onAddChild(path)}>
                  Add Child Step
                </Button>
              </div>
            ) : null}

            {canHaveChildren && children.length > 0 ? (
              <div className="mt-3">
                <SubActionTree
                  subActions={children}
                  depth={depth + 1}
                  onEdit={onEdit}
                  onToggleEnabled={onToggleEnabled}
                  onDelete={onDelete}
                  onMove={onMove}
                  onAddChild={onAddChild}
                  labelForType={labelForType}
                  previewFor={previewFor}
                  pathPrefix={path}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
