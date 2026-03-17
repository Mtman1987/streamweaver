export type FlowNodeKind =
  | 'trigger'
  | 'condition'
  | 'action'
  | 'logic'
  | 'output';

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowNode {
  id: string;
  type: FlowNodeKind;
  subtype?: string;
  label: string;
  position: FlowPosition;
  data: Record<string, any>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  conditions?: Record<string, any>;
}

export interface FlowMetadata {
  createdBy?: string;
  description?: string;
  lastEditedAt?: string;
}

export interface FlowGraph {
  version: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  metadata?: FlowMetadata;
}

export const CURRENT_FLOW_VERSION = '1.0.0';

export function createEmptyFlow(): FlowGraph {
  return {
    version: CURRENT_FLOW_VERSION,
    nodes: [],
    edges: [],
  };
}
