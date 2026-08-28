import type {
  HarnessRunStatus,
  WorkPlanItem,
  Evidence
} from "@factory/shared";

export type HarnessView = {
  id: string;
  objective: string;
  status: HarnessRunStatus;
  stopReason: string | null;
  plan: WorkPlanItem[];
  tools: Array<{
    toolCallId: string;
    toolName: string;
    permission: string;
    status: string;
    summary: string | null;
    startedAt: string;
  }>;
  artifacts: Array<{
    id: string;
    kind: string;
    sha256: string;
    size: number;
    status: string;
  }>;
  evidence: Evidence[];
};
