"use client";

import { Fragment, Suspense, useMemo, useEffect, useState } from "react";
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
import { ChevronRight, Loader2, MoreHorizontal, Play, BarChart2, Search } from "lucide-react";
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
import { createActionClient, deleteActionClient, updateActionClient } from "@/lib/client-actions";
import { createCommandClient, deleteCommandClient, runCommandClient, updateCommandClient } from "@/lib/client-commands";
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
import { DEFAULT_TTS_VOICE, TTS_VOICE_OPTIONS, normalizeTtsVoice } from "@/lib/tts-voices";

const AutomationAIChat = dynamic(() => import("@/components/automation/AutomationAIChat"), { ssr: false });

type FlowSortMode = "workflow" | "command" | "trigger" | "steps";
type AiWorkflowMode = "new" | "edit";

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function ActiveCommandsPageClient() {
  const { actions, isLoading, error, refresh } = useActionsData();
  const { commands, isLoading: commandsLoading, error: commandsError, refresh: refreshCommands } = useCommandsData();
  const { toast } = useToast();

  const searchParams = useSearchParams();

  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(null);
  const [aiWorkflowMode, setAiWorkflowMode] = useState<AiWorkflowMode>("new");
  const [newWorkflowCommandText, setNewWorkflowCommandText] = useState("");

  const [draftActionId, setDraftActionId] = useState<string | null>(null);
  const [draftWorkflowName, setDraftWorkflowName] = useState("");
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
  const [newTriggerPattern, setNewTriggerPattern] = useState<string>("");
  const [newTriggerExcludeBots, setNewTriggerExcludeBots] = useState<boolean>(true);

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
  const [flowSearchQuery, setFlowSearchQuery] = useState("");
  const [flowTriggerFilter, setFlowTriggerFilter] = useState("all");
  const [flowSortMode, setFlowSortMode] = useState<FlowSortMode>("workflow");
  const [openFlowGroups, setOpenFlowGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (error) {
      toast({
        variant: "destructive",
        title: "Failed to load workflows",
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
    const triggerLabel = (type: number): string => {
      if (type === TriggerType.COMMAND) return "On Chat Command";
      if (type === TriggerType.CHAT_MESSAGE) return "On Chat Message";
      if (type === TriggerType.FOLLOW) return "On Follow";
      if (type === TriggerType.CHEER) return "On Cheer";
      if (type === TriggerType.SUBSCRIBE) return "On Subscribe";
      if (type === TriggerType.RESUB) return "On Resub";
      if (type === TriggerType.GIFT_SUB) return "On Gift Sub";
      if (type === TriggerType.GIFT_BOMB) return "On Gift Bomb";
      if (type === TriggerType.RAID) return "On Raid";
      if (type === TriggerType.CHANNEL_POINT_REWARD) return "On Channel Point Reward";
      return `On Trigger ${String(type)}`;
    };
    return actions
      .filter((a) => a.enabled)
      .flatMap((a) => {
        const triggers = Array.isArray(a.triggers) && a.triggers.length > 0 ? a.triggers : [{ id: "no-trigger", type: undefined }];
        return triggers.map((t: any) => {
          const type = Number(t.type);
          const isCommand = type === TriggerType.COMMAND;
          const cmd = isCommand && t.commandId ? cmdById.get(String(t.commandId)) : undefined;
          return {
            actionId: a.id,
            actionName: a.name,
            triggerId: String(t.id || "no-trigger"),
            commandId: String(t.commandId || ""),
            commandLabel: isCommand
              ? (cmd?.command ?? cmd?.name ?? t.command ?? t.commandName ?? t.commandId ?? "—").toString()
              : "—",
            trigger: Number.isFinite(type) ? triggerLabel(type) : "No Trigger",
            steps: Array.isArray(a.subActions) ? a.subActions.length : 0,
            platform: "Twitch",
            status: "Enabled",
          };
        });
      });
  }, [actions, commands]);

  const sortedActionsForSelect = useMemo(
    () => [...actions].sort((a, b) => compareText(a.name || "", b.name || "")),
    [actions]
  );

  const sortedCommandsForSelect = useMemo(
    () =>
      [...commands].sort((a, b) =>
        compareText((a.command ?? "").trim() || a.name || "", (b.command ?? "").trim() || b.name || "")
      ),
    [commands]
  );

  const availableFlowTriggers = useMemo(
    () => Array.from(new Set(activeCommandRows.map((row) => row.trigger))).sort(compareText),
    [activeCommandRows]
  );

  const filteredActiveCommandRows = useMemo(() => {
    const query = flowSearchQuery.trim().toLowerCase();
    return activeCommandRows
      .filter((row) => {
        const haystack = [row.commandLabel, row.actionName, row.trigger, row.platform, row.status].join(" ").toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (flowTriggerFilter !== "all" && row.trigger !== flowTriggerFilter) return false;
        return true;
      })
      .sort((a, b) => {
        if (flowSortMode === "steps") return b.steps - a.steps;
        if (flowSortMode === "command") return compareText(a.commandLabel || "", b.commandLabel || "");
        if (flowSortMode === "trigger") {
          const triggerCompare = compareText(a.trigger || "", b.trigger || "");
          if (triggerCompare !== 0) return triggerCompare;
        }
        return compareText(a.actionName || "", b.actionName || "");
      });
  }, [activeCommandRows, flowSearchQuery, flowTriggerFilter, flowSortMode]);

  const groupedActiveCommandRows = useMemo(
    () =>
      availableFlowTriggers
        .map((trigger) => ({
          trigger,
          rows: filteredActiveCommandRows.filter((row) => row.trigger === trigger),
          total: activeCommandRows.filter((row) => row.trigger === trigger).length,
        }))
        .filter((section) => section.rows.length > 0),
    [activeCommandRows, availableFlowTriggers, filteredActiveCommandRows]
  );

  const selectedAction = useMemo(() => actions.find((a) => a.id === selectedActionId) ?? null, [actions, selectedActionId]);

  useEffect(() => {
    if (!selectedAction) return;
    setAiWorkflowMode("edit");
    setDraftActionId(selectedAction.id);
    setDraftWorkflowName(selectedAction.name || "Untitled Workflow");
    setDraftEnabled(!!selectedAction.enabled);
    setDraftTriggers(Array.isArray(selectedAction.triggers) ? (selectedAction.triggers as any[]) : []);
    setDraftSubActions(Array.isArray(selectedAction.subActions) ? (selectedAction.subActions as any) : []);
  }, [selectedAction?.id]);

  const handleRunCommand = async (commandId: string) => {
    try {
      const result = await runCommandClient(commandId);
      toast({
        title: result.matchedActions > 0 ? "Command ran" : "No action attached",
        description:
          result.matchedActions > 0
            ? `${result.actionsRun} action${result.actionsRun === 1 ? "" : "s"} ran, ${result.actionsFailed} failed.`
            : "Attach this command to an action before testing it.",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Run failed", description: e?.message || String(e) });
    }
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
    if (t === TriggerType.CHAT_MESSAGE) return "Chat Message";
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
    if (t === TriggerType.CHAT_MESSAGE) {
      next.pattern = newTriggerPattern.trim() || undefined;
      next.excludeBots = newTriggerExcludeBots;
    }
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
    if (value === SubActionType.TWITCH_TIMEOUT_USER) return "Timeout User";
    if (value === SubActionType.IF_ELSE) return "If / Else";
    if (value === SubActionType.IF_BLOCK) return "IF Block";
    if (value === SubActionType.ELSE_BLOCK) return "ELSE Block";
    if (value === SubActionType.BREAK) return "Break";
    if (value === SubActionType.WAIT) return "Wait";
    if (value === SubActionType.HTTP_REQUEST) return "HTTP Request";
    if (value === SubActionType.VOICE_REPLY_PROMPT) return "Voice Reply Prompt";
    if (value === SubActionType.EXECUTE_CODE) return "Execute Code";
    if (value === SubActionType.COMMENT) return "Comment";
    return String(value ?? "Unknown");
  };

  const previewForSubAction = (sa: any): string => {
    if (!sa) return "";
    if (sa.type === SubActionType.SEND_MESSAGE) return String(sa.text || "");
    if (sa.type === SubActionType.RUN_ACTION) return `actionId=${String(sa.actionId || "")}`;
    if (sa.type === SubActionType.GET_USER_INFO) return `user=${String(sa.userLogin || "")}`;
    if (sa.type === SubActionType.TWITCH_TIMEOUT_USER) return `user=${String(sa.userName || sa.userLogin || "")} duration=${String(sa.duration || 600)}s`;
    if (sa.type === SubActionType.IF_ELSE) return `${String(sa.input || "")} op=${String(sa.operation ?? "")} ${String(sa.value ?? "")}`;
    if (sa.type === SubActionType.HTTP_REQUEST) return `${String(sa.method || "POST")} ${String(sa.url || "")}`;
    if (sa.type === SubActionType.VOICE_REPLY_PROMPT) return `${String(sa.readbackTemplate || "%userName% said %message%")} -> ${sa.autoSend === false ? "manual" : "auto"}`;
    if (sa.type === SubActionType.EXECUTE_CODE) return `${String(sa.language || "javascript")} ${String(sa.description || "").trim()}`.trim();
    return "";
  };

  const applyNewModeTriggerSetup = () => {
    const t = Number(newTriggerType);
    const next: any = {
      id: crypto.randomUUID(),
      type: t,
      enabled: true,
      exclusions: [],
    };

    if (t === TriggerType.COMMAND) {
      const commandText = normalizeCommandText(newWorkflowCommandText);
      if (!commandText) return;
      next.command = commandText;
    }
    if (t === TriggerType.CHAT_MESSAGE) {
      next.pattern = newTriggerPattern.trim() || undefined;
      next.excludeBots = newTriggerExcludeBots;
    }
    if (t === TriggerType.CHANNEL_POINT_REWARD) next.rewardId = newTriggerRewardId.trim() || undefined;

    const min = parseNumberOrUndefined(newTriggerMin);
    const max = parseNumberOrUndefined(newTriggerMax);
    const tiers = parseNumberOrUndefined(newTriggerTiers);
    if (min != null) next.min = min;
    if (max != null) next.max = max;
    if (tiers != null) next.tiers = tiers;

    setDraftActionId(null);
    setSelectedActionId(null);
    setDraftTriggers([next]);
    setDraftEnabled(true);
    if (!draftWorkflowName.trim() && t === TriggerType.COMMAND) {
      const name = normalizeCommandText(newWorkflowCommandText).replace(/^!+/, "").replace(/[-_]/g, " ");
      setDraftWorkflowName(`${name.charAt(0).toUpperCase()}${name.slice(1)} Workflow`);
    }
  };

  const toggleFlowGroup = (group: string) => {
    setOpenFlowGroups((current) => ({ ...current, [group]: !current[group] }));
  };

  const handleDeleteWorkflow = async (actionId?: string | null) => {
    if (!actionId) return;
    const action = actions.find((item) => item.id === actionId);
    const ok = window.confirm(`Delete workflow "${action?.name || actionId}"? This removes the action and its triggers.`);
    if (!ok) return;
    try {
      await deleteActionClient(actionId);
      toast({ title: "Workflow deleted", description: action?.name || actionId });
      if (selectedActionId === actionId) setSelectedActionId(null);
      if (draftActionId === actionId) {
        setDraftActionId(null);
        setDraftWorkflowName("");
        setDraftEnabled(false);
        setDraftTriggers([]);
        setDraftSubActions([]);
      }
      await refresh();
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete failed", description: e?.message || String(e) });
    }
  };

  const currentWorkflowForAI = useMemo(
    () => ({
      name: draftWorkflowName || selectedAction?.name || "",
      triggers: draftTriggers ?? [],
      subActions: draftSubActions ?? [],
    }),
    [draftWorkflowName, selectedAction?.name, draftTriggers, draftSubActions]
  );

  const hasWorkflowDraft = Boolean(draftActionId || draftWorkflowName.trim() || draftTriggers.length > 0 || draftSubActions.length > 0);

  const normalizeCommandText = (value: unknown): string => {
    const text = String(value || "").trim();
    if (!text) return "";
    return text.startsWith("!") ? text : `!${text.replace(/^!+/, "")}`;
  };

  const findOrCreateCommandForAutomation = async (
    automation: any,
    triggers: any[]
  ): Promise<{ id: string; created: boolean; wasEnabled: boolean } | null> => {
    const commandTrigger = triggers.find((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
    if (aiWorkflowMode === "edit" && selectedCommandId && !commandTrigger?.command && !commandTrigger?.commandName) {
      const selected = commands.find((command) => command.id === selectedCommandId);
      return { id: selectedCommandId, created: false, wasEnabled: selected?.enabled !== false };
    }
    const commandText = normalizeCommandText(
      commandTrigger?.command ||
        commandTrigger?.commandName ||
        automation?.command?.command ||
        automation?.command
    );

    if (!commandText) return null;

    const existing = commands.find((command) => String(command.command || "").trim().toLowerCase() === commandText.toLowerCase());
    if (existing) {
      return { id: existing.id, created: false, wasEnabled: existing.enabled !== false };
    }

    const created: any = await createCommandClient({
      name: String(automation?.command?.name || commandText.replace(/^!/, "") || "AI Command"),
      command: commandText,
      group: "AI Automations",
      // Keep a generated command inert until its action has been saved successfully.
      enabled: false,
    });
    return { id: String(created?.id || ""), created: true, wasEnabled: false };
  };

  const normalizeAutomationTriggers = (automation: any, commandId: string | null): any[] => {
    const sourceTriggers = Array.isArray(automation?.triggers) ? automation.triggers : [];
    const nextTriggers = sourceTriggers.map((trigger: any) => {
      const isCommand = Number(trigger?.type) === TriggerType.COMMAND;
      const { command, commandName, ...rest } = trigger || {};
      return {
        ...rest,
        id: String(trigger?.id || crypto.randomUUID()),
        type: Number(trigger?.type ?? TriggerType.COMMAND),
        enabled: trigger?.enabled ?? true,
        exclusions: Array.isArray(trigger?.exclusions) ? trigger.exclusions : [],
        ...(isCommand && commandId ? { commandId } : {}),
      };
    });

    const hasCommandTrigger = nextTriggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND);
    if (commandId && !hasCommandTrigger) {
      nextTriggers.unshift({
        id: crypto.randomUUID(),
        type: TriggerType.COMMAND,
        enabled: true,
        exclusions: [],
        commandId,
      });
    }

    return nextTriggers;
  };

  const normalizeAutomationSubActions = (automation: any): SubAction[] => {
    const sourceSubActions = Array.isArray(automation?.subActions) ? automation.subActions : [];
    return normalizeIndex(sourceSubActions) as SubAction[];
  };

  const loadAutomationDraftFromAI = async (automation: any) => {
    if (!automation || typeof automation !== "object") return;
    const editCurrentWorkflow = automation?.metadata?.editCurrentWorkflow === true;

    const commandText = normalizeCommandText(
      automation?.triggers?.find((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)?.command ||
        automation?.triggers?.find((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)?.commandName ||
        automation?.command?.command ||
        automation?.command
    );
    const nextTriggers = (Array.isArray(automation.triggers) ? automation.triggers : []).map((trigger: any) => ({
      ...trigger,
      id: String(trigger?.id || crypto.randomUUID()),
      type: Number(trigger?.type ?? TriggerType.COMMAND),
      enabled: trigger?.enabled ?? true,
      exclusions: Array.isArray(trigger?.exclusions) ? trigger.exclusions : [],
    }));

    if (commandText && !nextTriggers.some((trigger: any) => Number(trigger?.type) === TriggerType.COMMAND)) {
      nextTriggers.unshift({
        id: crypto.randomUUID(),
        type: TriggerType.COMMAND,
        enabled: true,
        exclusions: [],
        command: commandText,
      });
    }

    setDraftActionId(editCurrentWorkflow ? selectedAction?.id ?? null : null);
    if (!editCurrentWorkflow) {
      setAiWorkflowMode("new");
      setSelectedActionId(null);
    } else {
      setAiWorkflowMode("edit");
    }
    setDraftWorkflowName(String(automation.name || (editCurrentWorkflow ? selectedAction?.name : "") || "AI Drafted Workflow").trim() || "AI Drafted Workflow");
    setDraftEnabled(true);
    setDraftTriggers(nextTriggers);
    setDraftSubActions(normalizeAutomationSubActions(automation));
    toast({
      title: "Draft loaded",
      description: "Review and edit the workflow below, then save it when it looks right.",
    });
  };

  const saveWorkflowDraft = async () => {
    if (!hasWorkflowDraft) return;

    setIsSaving(true);
    let provisionedCommand: { id: string; created: boolean; wasEnabled: boolean } | null = null;
    let createdActionId: string | null = null;
    let updatedExistingAction = false;
    try {
      const draftAutomation = {
        name: draftWorkflowName,
        triggers: draftTriggers,
        subActions: draftSubActions,
      };
      provisionedCommand = await findOrCreateCommandForAutomation(draftAutomation, draftTriggers);
      const commandId = provisionedCommand?.id || null;
      const nextTriggers = normalizeAutomationTriggers(draftAutomation, commandId);
      const nextSubActions = normalizeAutomationSubActions(draftAutomation);
      const actionName = String(draftWorkflowName || selectedAction?.name || "AI Drafted Workflow").trim() || "AI Drafted Workflow";

      let actionId = draftActionId;
      if (actionId) {
        await updateActionClient(
          actionId,
          {
            name: actionName,
            enabled: draftEnabled,
            triggers: nextTriggers as any,
            subActions: nextSubActions as any,
          } as any
        );
        updatedExistingAction = true;
      } else {
        const created: any = await createActionClient({
          name: actionName,
          group: "AI Automations",
          enabled: draftEnabled,
          triggers: nextTriggers as any,
          subActions: nextSubActions as any,
        } as any);
        actionId = String(created?.id || "");
        createdActionId = actionId;
      }

      if (commandId && draftEnabled && !provisionedCommand?.wasEnabled) {
        await updateCommandClient(commandId, { enabled: true });
      }

      setDraftActionId(actionId);
      setSelectedActionId(actionId);
      if (commandId) setSelectedCommandId(commandId);
      setDraftWorkflowName(actionName);
      setDraftTriggers(nextTriggers);
      setDraftSubActions(nextSubActions);
      setDraftEnabled(draftEnabled);

      await Promise.all([refresh(), refreshCommands()]);
      toast({
        title: "Workflow saved",
        description: commandId
          ? `${actionName} is saved and linked to the command.`
          : `${actionName} is saved.`,
      });
    } catch (e: any) {
      if (createdActionId) {
        await deleteActionClient(createdActionId).catch(() => {});
      } else if (updatedExistingAction && selectedAction) {
        await updateActionClient(selectedAction.id, {
          name: selectedAction.name,
          enabled: selectedAction.enabled,
          triggers: selectedAction.triggers as any,
          subActions: selectedAction.subActions as any,
        } as any).catch(() => {});
      }
      if (provisionedCommand?.created && provisionedCommand.id) {
        await deleteCommandClient(provisionedCommand.id).catch(() => {});
      } else if (provisionedCommand && !provisionedCommand.wasEnabled) {
        await updateCommandClient(provisionedCommand.id, { enabled: false }).catch(() => {});
      }
      toast({ variant: "destructive", title: "Save failed", description: e?.message || String(e) });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Workflows</CardTitle>
          <CardDescription>A workflow is a command or event trigger connected to an action flow.</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-xl border bg-background/50 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-semibold">AI workflow guide</div>
              <div className="text-xs text-muted-foreground">Choose whether the assistant drafts a fresh workflow or edits the selected one.</div>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-lg border bg-muted/30 p-1">
              <Button
                type="button"
                variant={aiWorkflowMode === "new" ? "default" : "ghost"}
                onClick={() => {
                  setAiWorkflowMode("new");
                  setSelectedActionId(null);
                  setDraftActionId(null);
                }}
              >
                New
              </Button>
              <Button type="button" variant={aiWorkflowMode === "edit" ? "default" : "ghost"} onClick={() => setAiWorkflowMode("edit")}>
                Edit
              </Button>
            </div>
          </div>

          {aiWorkflowMode === "new" ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_220px_1fr_auto]">
              <div className="space-y-2">
                <div className="text-sm font-medium">Workflow Name</div>
                <Input value={draftWorkflowName} onChange={(e) => setDraftWorkflowName(e.target.value)} placeholder="Set Timer Workflow" />
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Start Trigger</div>
                <Select value={String(newTriggerType)} onValueChange={(v) => setNewTriggerType(Number(v))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select trigger" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={String(TriggerType.COMMAND)}>{labelForTriggerType(TriggerType.COMMAND)}</SelectItem>
                    <SelectItem value={String(TriggerType.CHAT_MESSAGE)}>{labelForTriggerType(TriggerType.CHAT_MESSAGE)}</SelectItem>
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
                  <div className="text-sm font-medium">Command Text</div>
                  <Input value={newWorkflowCommandText} onChange={(e) => setNewWorkflowCommandText(e.target.value)} placeholder="!settimer" />
                </div>
              ) : Number(newTriggerType) === TriggerType.CHAT_MESSAGE ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Chat Pattern</div>
                  <Input value={newTriggerPattern} onChange={(e) => setNewTriggerPattern(e.target.value)} placeholder="message contains..." />
                </div>
              ) : Number(newTriggerType) === TriggerType.CHANNEL_POINT_REWARD ? (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Reward ID</div>
                  <Input value={newTriggerRewardId} onChange={(e) => setNewTriggerRewardId(e.target.value)} placeholder="rewardId" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm font-medium">Optional Filters</div>
                  <Input value={newTriggerMin} onChange={(e) => setNewTriggerMin(e.target.value)} placeholder="minimum amount, optional" />
                </div>
              )}
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={applyNewModeTriggerSetup}>
                  Use Setup
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-2">
                <div className="text-sm font-medium">Workflow To Edit</div>
                <Select value={selectedActionId ?? ""} onValueChange={(v) => setSelectedActionId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select an existing workflow" />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedActionsForSelect.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <div className="text-sm font-medium">Attach Existing Command</div>
                <Select value={selectedCommandId ?? ""} onValueChange={(v) => setSelectedCommandId(v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={commandsLoading ? "Loading commands..." : "Optional command"} />
                  </SelectTrigger>
                  <SelectContent>
                    {sortedCommandsForSelect.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {(c.command ?? "").trim() || c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end">
                <Button type="button" variant="secondary" onClick={addCommandTriggerToDraft} disabled={!hasWorkflowDraft || !selectedCommandId}>
                  Attach Command
                </Button>
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-4 grid gap-2 md:grid-cols-3">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm"><strong>1. Describe</strong><div className="mt-1 text-xs text-muted-foreground">Start with the idea in your own words. The assistant infers a command when needed.</div></div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm"><strong>2. Review and test</strong><div className="mt-1 text-xs text-muted-foreground">Load the draft below, inspect its trigger and steps, then use Run before going live.</div></div>
              <div className="rounded-lg border bg-muted/30 p-3 text-sm"><strong>3. Save and go live</strong><div className="mt-1 text-xs text-muted-foreground">Save the linked command and action, then turn Live on when the test behaves correctly.</div></div>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <Button asChild type="button" variant="outline" size="sm">
                <Link href="/import/streamerbot">Upload actions or commands</Link>
              </Button>
              <Button asChild type="button" variant="outline" size="sm">
                <Link href="/community">Import or export StreamWeaver flows</Link>
              </Button>
            </div>
            <AutomationAIChat
              currentWorkflow={aiWorkflowMode === "edit" ? currentWorkflowForAI : undefined}
              onAutomationGenerated={loadAutomationDraftFromAI}
              selectedCommandId={aiWorkflowMode === "edit" ? selectedCommandId : null}
              mode={aiWorkflowMode}
            />
          </div>

          <div className="mt-4 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Command arguments you can use in steps:
            <div><code>%input0%</code> = first argument, usually the target user.</div>
            <div><code>%targetUser%</code> = normalized first argument without the leading <code>@</code>.</div>
            <div><code>%rawInput%</code> = everything after the command.</div>
            <div>Example: <code>!timeout @user</code> gives <code>%input0%</code> as <code>@user</code> and <code>%targetUser%</code> as <code>user</code>.</div>
          </div>
        </div>

        {hasWorkflowDraft ? (
          <div className="mb-8 space-y-4">
            <div className="rounded-md border p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
                <div className="space-y-2">
                  <div className="text-sm font-medium">Workflow Name</div>
                  <Input
                    value={draftWorkflowName}
                    onChange={(e) => setDraftWorkflowName(e.target.value)}
                    placeholder="AI Drafted Workflow"
                  />
                </div>
                <div className="flex items-center justify-between gap-4 rounded-md border px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">Live</div>
                    <div className="text-xs text-muted-foreground">Enable after review.</div>
                  </div>
                  <Switch checked={draftEnabled} onCheckedChange={setDraftEnabled} />
                </div>
              </div>
            </div>
            <div className="rounded-md border p-4">
              <div className="text-sm font-medium mb-2">Triggers</div>
              <div className="space-y-2">
                <details className="rounded-md border p-3">
                  <summary className="cursor-pointer text-sm font-medium">Advanced: add another trigger</summary>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Add Trigger Type</div>
                    <Select value={String(newTriggerType)} onValueChange={(v) => setNewTriggerType(Number(v))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select trigger type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={String(TriggerType.COMMAND)}>{labelForTriggerType(TriggerType.COMMAND)}</SelectItem>
                        <SelectItem value={String(TriggerType.CHAT_MESSAGE)}>{labelForTriggerType(TriggerType.CHAT_MESSAGE)}</SelectItem>
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
                          {sortedCommandsForSelect.map((c) => (
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

                  {Number(newTriggerType) === TriggerType.CHAT_MESSAGE ? (
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Pattern</div>
                      <Input
                        value={newTriggerPattern}
                        onChange={(e) => setNewTriggerPattern(e.target.value)}
                        placeholder="^(rock|paper|scissors)$"
                      />
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={newTriggerExcludeBots}
                          onChange={(e) => setNewTriggerExcludeBots(e.target.checked)}
                        />
                        Exclude bot messages
                      </label>
                    </div>
                  ) : null}

                  {Number(newTriggerType) !== TriggerType.COMMAND &&
                  Number(newTriggerType) !== TriggerType.CHANNEL_POINT_REWARD &&
                  Number(newTriggerType) !== TriggerType.CHAT_MESSAGE ? (
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
                    <Button onClick={addNewTriggerToDraft} disabled={!hasWorkflowDraft}>
                      Add Trigger
                    </Button>
                  </div>
                  </div>
                </details>

                {draftTriggers.map((t: any) => {
                  const isCommand = Number(t.type) === TriggerType.COMMAND;
                  const isChat = Number(t.type) === TriggerType.CHAT_MESSAGE;
                  const isReward = Number(t.type) === TriggerType.CHANNEL_POINT_REWARD;
                  const cmd = isCommand ? commands.find((c) => c.id === String(t.commandId)) : undefined;
                  const label =
                    isCommand ? (cmd?.command ?? cmd?.name ?? t.command ?? t.commandName ?? t.commandId ?? "—").toString() : labelForTriggerType(Number(t.type));

                  const exclusionsText = Array.isArray(t.exclusions) ? (t.exclusions as any[]).join("\n") : "";

                  return (
                    <div key={t.id} className="rounded-md border p-3 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{label}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            type={String(t.type)} id={String(t.id)}
                            {isCommand ? ` command=${String(t.command || t.commandName || t.commandId || "")}` : ""}
                            {isChat ? ` pattern=${String(t.pattern || "")}` : ""}
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
                            <div className="text-sm font-medium">Existing Command</div>
                            <Select
                              value={String(t.commandId || "")}
                              onValueChange={(v) =>
                                setDraftTriggers((prev) => prev.map((x: any) => (x.id === t.id ? { ...x, commandId: v, command: undefined, commandName: undefined } : x)))
                              }
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select a command" />
                              </SelectTrigger>
                              <SelectContent>
                                {sortedCommandsForSelect.map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    {(c.command ?? "").trim() || c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <div className="text-sm font-medium">New Command Text</div>
                            <Input
                              value={String(t.command || t.commandName || "")}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) =>
                                    x.id === t.id ? { ...x, command: normalizeCommandText(e.target.value), commandName: undefined, commandId: undefined } : x
                                  )
                                )
                              }
                              placeholder="!mycommand"
                            />
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

                      {isChat ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <div className="text-sm font-medium">Pattern</div>
                            <Input
                              value={String(t.pattern || "")}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) => (x.id === t.id ? { ...x, pattern: e.target.value } : x))
                                )
                              }
                              placeholder="^(rock|paper|scissors)$"
                            />
                          </div>
                          <label className="flex items-center gap-2 self-end text-sm">
                            <input
                              type="checkbox"
                              checked={t.excludeBots !== false}
                              onChange={(e) =>
                                setDraftTriggers((prev) =>
                                  prev.map((x: any) => (x.id === t.id ? { ...x, excludeBots: e.target.checked } : x))
                                )
                              }
                            />
                            Exclude bot messages
                          </label>
                        </div>
                      ) : null}

                      {!isCommand && !isReward && !isChat ? (
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
                  <div className="text-xs text-muted-foreground">Build the full action flow for this workflow.</div>
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

              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={saveWorkflowDraft} disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save Workflow"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void handleDeleteWorkflow(draftActionId || selectedActionId)}
                  disabled={!draftActionId && !selectedActionId}
                >
                  Delete Workflow
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="border-t pt-6">
          <div className="mb-3 flex flex-col gap-1">
            <div className="text-sm font-semibold">Live Flow List</div>
            <div className="text-xs text-muted-foreground">Find existing workflows after you finish drafting or editing.</div>
          </div>
        <div className="mb-4 grid gap-3 rounded-md border bg-background/40 p-3 lg:grid-cols-[1fr_220px_190px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={flowSearchQuery}
              onChange={(event) => setFlowSearchQuery(event.target.value)}
              placeholder="Search live flows by command, workflow, or trigger"
              className="pl-9"
            />
          </div>
          <Select value={flowTriggerFilter} onValueChange={setFlowTriggerFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Trigger" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All triggers</SelectItem>
              {availableFlowTriggers.map((trigger) => (
                <SelectItem key={trigger} value={trigger}>
                  {trigger}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={flowSortMode} onValueChange={(value) => setFlowSortMode(value as FlowSortMode)}>
            <SelectTrigger>
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workflow">Workflow A-Z</SelectItem>
              <SelectItem value="command">Command A-Z</SelectItem>
              <SelectItem value="trigger">Trigger, then workflow</SelectItem>
              <SelectItem value="steps">Most steps first</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Command</TableHead>
              <TableHead>Workflow</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead>Steps</TableHead>
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
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  <div className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading workflows...
                  </div>
                </TableCell>
              </TableRow>
            )}
            {!isLoading && activeCommandRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No active workflows. Draft one with AI, review it, then save it.
                </TableCell>
              </TableRow>
            )}
            {!isLoading && activeCommandRows.length > 0 && filteredActiveCommandRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  No live flows match those filters.
                </TableCell>
              </TableRow>
            )}
            {groupedActiveCommandRows.map((section) => (
              <Fragment key={section.trigger}>
                <TableRow className="bg-muted/35 hover:bg-muted/50">
                  <TableCell colSpan={7} className="py-2">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-3 text-left"
                      onClick={() => toggleFlowGroup(section.trigger)}
                    >
                      <span className="flex items-center gap-2">
                        <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${openFlowGroups[section.trigger] ? "rotate-90" : ""}`} />
                        <span className="font-medium">{section.trigger}</span>
                      </span>
                      <Badge variant="outline">{section.rows.length}/{section.total}</Badge>
                    </button>
                  </TableCell>
                </TableRow>
                {openFlowGroups[section.trigger] ? section.rows.map((row) => (
                  <TableRow key={`${row.actionId}:${row.triggerId}`}>
                    <TableCell className="font-medium">{row.commandLabel}</TableCell>
                    <TableCell>{row.actionName}</TableCell>
                    <TableCell>{row.trigger}</TableCell>
                    <TableCell>{row.steps}</TableCell>
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
                          <DropdownMenuItem onClick={() => handleRunCommand(row.commandId)} disabled={!row.commandId}>
                            <Play className="mr-2 h-4 w-4" />
                            Run
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>
                            <BarChart2 className="mr-2 h-4 w-4" />
                            Track
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem asChild>
                            <Link href={`/active-commands?actionId=${encodeURIComponent(row.actionId)}`}>Edit Workflow</Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => void handleDeleteWorkflow(row.actionId)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )) : null}
              </Fragment>
            ))}
          </TableBody>
        </Table>
        </div>
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
                        <SelectItem value={String(SubActionType.TWITCH_TIMEOUT_USER)}>Timeout User</SelectItem>
                        <SelectItem value={String(SubActionType.IF_ELSE)}>If / Else</SelectItem>
                        <SelectItem value={String(SubActionType.BREAK)}>Break</SelectItem>
                      <SelectItem value={String(SubActionType.WAIT)}>Wait</SelectItem>
                      <SelectItem value={String(SubActionType.HTTP_REQUEST)}>HTTP Request</SelectItem>
                      <SelectItem value={String(SubActionType.VOICE_REPLY_PROMPT)}>Voice Reply Prompt</SelectItem>
                      <SelectItem value={String(SubActionType.EXECUTE_CODE)}>Execute Code</SelectItem>
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
                      {sortedActionsForSelect.map((a) => (
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

              {Number(subActionDraft.type) === SubActionType.VOICE_REPLY_PROMPT ? (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Private Readback</div>
                    <Textarea
                      rows={3}
                      value={String(subActionDraft.readbackTemplate || "%userName% said %message%")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, readbackTemplate: e.target.value }))}
                    />
                    <div className="text-xs text-muted-foreground">Use %userName% and %message% from the chat trigger.</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Wait Before Ding (ms)</div>
                      <Input
                        type="number"
                        min="0"
                        value={String(subActionDraft.waitMs ?? 5000)}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, waitMs: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Record Length (ms)</div>
                      <Input
                        type="number"
                        min="1000"
                        value={String(subActionDraft.recordMs ?? 10000)}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, recordMs: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Voice</div>
                      <Select
                        value={normalizeTtsVoice(String(subActionDraft.voice || DEFAULT_TTS_VOICE))}
                        onValueChange={(voice) => setSubActionDraft((draft: any) => ({ ...draft, voice }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a lifelike Eden voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {TTS_VOICE_OPTIONS.map((voice) => (
                            <SelectItem key={voice.id} value={voice.id}>
                              {voice.label} ({voice.providerLabel})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Automatic Send</div>
                        <div className="text-xs text-muted-foreground">Turn off to approve the transcription manually.</div>
                      </div>
                      <Switch
                        checked={subActionDraft.autoSend !== false}
                        onCheckedChange={(checked) => setSubActionDraft((d: any) => ({ ...d, autoSend: checked }))}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Send as Bot</div>
                        <div className="text-xs text-muted-foreground">Use broadcaster if off.</div>
                      </div>
                      <Switch
                        checked={subActionDraft.useBot !== false}
                        onCheckedChange={(checked) => setSubActionDraft((d: any) => ({ ...d, useBot: checked }))}
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.TWITCH_TIMEOUT_USER ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Target User</div>
                    <Input
                      value={String(subActionDraft.userName || subActionDraft.userLogin || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, userName: e.target.value, userLogin: e.target.value }))}
                      placeholder="%targetUser%"
                    />
                    <div className="text-xs text-muted-foreground">Use %targetUser% or %input0% for commands like !timeout @user.</div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Duration (seconds)</div>
                    <Input
                      type="number"
                      min="1"
                      value={String(subActionDraft.duration ?? 300)}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, duration: Number(e.target.value) }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Reason</div>
                    <Input
                      value={String(subActionDraft.reason || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, reason: e.target.value }))}
                      placeholder="Timed out by chat command"
                    />
                  </div>
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.HTTP_REQUEST ? (
                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <div className="text-sm font-medium">URL</div>
                    <Input
                      value={String(subActionDraft.url || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, url: e.target.value }))}
                      placeholder="https://api.example.com/endpoint"
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Method</div>
                      <Input
                        value={String(subActionDraft.method || "POST")}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, method: e.target.value.toUpperCase() }))}
                        placeholder="POST"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Response Variable</div>
                      <Input
                        value={String(subActionDraft.variableName || "")}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, variableName: e.target.value }))}
                        placeholder="httpResponse"
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border px-3 py-2">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium">Parse JSON</div>
                        <div className="text-xs text-muted-foreground">Attempt to parse JSON response bodies.</div>
                      </div>
                      <Switch
                        checked={subActionDraft.parseAsJson !== false}
                        onCheckedChange={(checked) => setSubActionDraft((d: any) => ({ ...d, parseAsJson: checked }))}
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Body</div>
                    <Textarea
                      rows={4}
                      value={String(subActionDraft.body || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, body: e.target.value }))}
                      placeholder='{"message":"hello"}'
                    />
                  </div>
                </div>
              ) : null}

              {Number(subActionDraft.type) === SubActionType.EXECUTE_CODE ? (
                <div className="grid grid-cols-1 gap-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Language</div>
                      <Input
                        value={String(subActionDraft.language || "javascript")}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, language: e.target.value || "javascript" }))}
                        placeholder="javascript"
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Timeout (ms)</div>
                      <Input
                        type="number"
                        min="100"
                        value={String(subActionDraft.timeoutMs ?? 10000)}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, timeoutMs: Number(e.target.value) }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="text-sm font-medium">Save Result To</div>
                      <Input
                        value={String(subActionDraft.saveToVariable || "")}
                        onChange={(e) => setSubActionDraft((d: any) => ({ ...d, saveToVariable: e.target.value }))}
                        placeholder="resultVariable"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Description</div>
                    <Input
                      value={String(subActionDraft.description || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, description: e.target.value }))}
                      placeholder="Programmable extension block"
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Code</div>
                    <Textarea
                      rows={12}
                      value={String(subActionDraft.code || "")}
                      onChange={(e) => setSubActionDraft((d: any) => ({ ...d, code: e.target.value }))}
                      placeholder={'await reply("Hello chat", { as: "bot" });\nreturn { done: true };'}
                    />
                    <div className="text-xs text-muted-foreground">
                      Helpers: <code>reply</code>, <code>runAction</code>, <code>sleep</code>, <code>http</code>, <code>vars</code>, <code>points</code>, <code>fetch</code>.
                    </div>
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
