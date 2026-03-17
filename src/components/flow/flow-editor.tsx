"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2, Plus, Sparkles, Loader2 } from "lucide-react";
import type { FlowGraph, FlowNode, FlowEdge, FlowNodeKind } from "@/types/flows";
import { createEmptyFlow } from "@/types/flows";
import { useToast } from "@/hooks/use-toast";

type FlowEditorProps = {
  flow: FlowGraph | null;
  onChange: (flow: FlowGraph | null) => void;
};

const nodeTypeOptions: { label: string; value: FlowNodeKind; subtypes: string[] }[] = [
  { label: "Trigger", value: "trigger", subtypes: ["start"] },
  {
    label: "Action",
    value: "action",
    subtypes: ["send-chat", "send-discord", "ai-response", "tts-broadcast", "plugin-command", "play-sound", "update-points", "custom-script"],
  },
  { label: "Logic", value: "logic", subtypes: ["set-variable", "delay"] },
  { label: "Condition", value: "condition", subtypes: ["text-includes", "compare"] },
];

const defaultDataBySubtype: Record<string, Record<string, any>> = {
  "send-chat": { message: "Hello, {{tags['display-name'] || 'Commander'}}", as: "broadcaster" },
  "send-discord": { message: "Log entry", channelId: "" },
  "ai-response": { input: "{{lastOutput}}", saveAs: "aiResponse" },
  "tts-broadcast": { text: "{{vars.aiResponse}}", voice: "Algieba" },
  "plugin-command": { pluginId: "apollo-station", command: "setScene", payload: { scene: "Starting Soon" } },
  "play-sound": { pluginId: "apollo-station", soundId: "airhorn", command: "playSound" },
  "update-points": { user: "{{tags['display-name'] || 'Commander'}}", amount: 10, operation: "add", saveVar: "pointsTotal" },
  "custom-script": { code: "// context.vars, context.services, context.args, and context.tags are available\nreturn 'success';" },
  "set-variable": { key: "aiResponse", value: "{{lastOutput}}" },
  "delay": { seconds: "60" },
  "text-includes": { source: "{{lastOutput}}", value: "hello" },
  "compare": { left: "{{vars.result}}", operator: "==", right: "win" },
  start: {},
};

function generateId(prefix = "node") {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function rebuildEdges(nodes: FlowNode[]): FlowEdge[] {
  const edges: FlowEdge[] = [];
  for (let i = 0; i < nodes.length - 1; i++) {
    edges.push({
      id: `edge-${i}`,
      source: nodes[i].id,
      target: nodes[i + 1].id,
    });
  }
  return edges;
}

export function FlowEditor({ flow, onChange }: FlowEditorProps) {
  const [jsonValue, setJsonValue] = useState("");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [newNode, setNewNode] = useState<{ label: string; type: FlowNodeKind; subtype: string }>({
    label: "New Node",
    type: "action",
    subtype: "send-chat",
  });
  const [aiDescription, setAiDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { toast } = useToast();

  const currentFlow = useMemo<FlowGraph>(() => flow ?? createEmptyFlow(), [flow]);

  useEffect(() => {
    setJsonValue(JSON.stringify(currentFlow, null, 2));
  }, [currentFlow]);

  const appendNode = (node: Omit<FlowNode, 'position'> & Partial<Pick<FlowNode, 'position'>>) => {
    const completeNode: FlowNode = {
      ...node,
      position: node.position ?? { x: 0, y: currentFlow.nodes.length * 80 },
    } as FlowNode;
    const nodes = [...currentFlow.nodes, completeNode];
    const edges = rebuildEdges(nodes);
    onChange({ ...currentFlow, nodes, edges });
  };

  const handleAddNode = () => {
    const defaultData = defaultDataBySubtype[newNode.subtype] ?? {};
    appendNode({
      id: generateId(),
      type: newNode.type,
      subtype: newNode.subtype,
      label: newNode.label || newNode.subtype,
      data: defaultData,
    } as FlowNode);
  };

  const handleGenerateNode = async () => {
    if (!aiDescription.trim()) {
      toast({
        variant: "destructive",
        title: "Add a description",
        description: "Tell the AI what kind of step you want to build.",
      });
      return;
    }
    try {
      setIsGenerating(true);
      const response = await fetch("/api/flow/generate-node", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiDescription.trim() }),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({}));
        throw new Error(errorBody?.error || "Failed to generate node.");
      }
      const aiNode = await response.json();
      appendNode({
        id: generateId(),
        type: aiNode.type,
        subtype: aiNode.subtype,
        label: aiNode.label,
        data: aiNode.data ?? {},
      } as FlowNode);
      toast({
        title: "Node added",
        description: aiNode.label,
      });
      setAiDescription("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "AI generation failed",
        description: error?.message || "Unable to build node.",
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRemoveNode = (id: string) => {
    const nodes = currentFlow.nodes.filter((n) => n.id !== id);
    const edges = rebuildEdges(nodes);
    onChange({ ...currentFlow, nodes, edges });
  };

  const handleNodeDataChange = (id: string, data: Record<string, any>) => {
    const nodes = currentFlow.nodes.map((node) =>
      node.id === id ? { ...node, data } : node
    );
    onChange({ ...currentFlow, nodes });
  };

  const handleJsonSave = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonValue);
      if (!parsed.version) {
        throw new Error("Flow JSON requires a version.");
      }
      onChange(parsed);
      setJsonError(null);
    } catch (error: any) {
      setJsonError(error.message || "Invalid JSON");
    }
  }, [jsonValue, onChange]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Flow Builder</CardTitle>
        <CardDescription>Create a step-by-step automation for this action.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="space-y-2">
            <Label>Node Label</Label>
            <Input
              value={newNode.label}
              onChange={(e) => setNewNode((prev) => ({ ...prev, label: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Node Type</Label>
            <Select
              value={newNode.type}
              onValueChange={(value: FlowNodeKind) =>
                setNewNode((prev) => ({
                  ...prev,
                  type: value,
                  subtype: nodeTypeOptions.find((opt) => opt.value === value)?.subtypes[0] || prev.subtype,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {nodeTypeOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Subtype</Label>
            <Select
              value={newNode.subtype}
              onValueChange={(value) =>
                setNewNode((prev) => ({
                  ...prev,
                  subtype: value,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select subtype" />
              </SelectTrigger>
              <SelectContent>
                {(nodeTypeOptions.find((opt) => opt.value === newNode.type)?.subtypes ?? []).map((subtype) => (
                  <SelectItem key={subtype} value={subtype}>
                    {subtype}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <Button type="button" onClick={handleAddNode} className="inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Node
        </Button>
        <div className="space-y-2">
          <Label>Describe a node for the AI</Label>
          <Textarea
            placeholder="Example: Send a Discord alert when the AI response contains the word raid."
            value={aiDescription}
            onChange={(e) => setAiDescription(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            disabled={isGenerating}
            onClick={handleGenerateNode}
            className="inline-flex items-center gap-2"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {isGenerating ? "Designing..." : "Generate with AI"}
          </Button>
        </div>

        <div className="space-y-4">
          {currentFlow.nodes.length === 0 && (
            <p className="text-sm text-muted-foreground">No nodes yet. Add your first step above.</p>
          )}
          {currentFlow.nodes.map((node, index) => (
            <Card key={node.id} className="border border-dashed">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{index + 1}. {node.label}</CardTitle>
                  <CardDescription>{node.type}{node.subtype ? ` / ${node.subtype}` : ""}</CardDescription>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => handleRemoveNode(node.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <Label>Node Data (JSON)</Label>
                <Textarea
                  className="font-mono text-sm"
                  value={JSON.stringify(node.data, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      handleNodeDataChange(node.id, parsed);
                    } catch {
                      // ignore typing errors
                    }
                  }}
                />
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Flow JSON (advanced)</Label>
            <Button variant="outline" size="sm" onClick={handleJsonSave}>
              Save JSON
            </Button>
          </div>
          <Textarea
            className="font-mono text-xs h-64"
            value={jsonValue}
            onChange={(e) => setJsonValue(e.target.value)}
          />
          {jsonError && <p className="text-sm text-destructive">{jsonError}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
