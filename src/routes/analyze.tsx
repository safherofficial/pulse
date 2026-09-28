import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { runEditor, optimizationStatus } from "@/lib/xpulse/api";
import type { ContentKind } from "@/lib/xpulse/content-score";
import { baselineContent } from "@/lib/xpulse/optimize/baseline";
import {
  EDITOR_HANDOFF_KEY,
  parseEditorHandoff,
  runEditorPipeline,
  type EditorDossier,
  type EditorHandoff,
  type EditorMode,
  type NamedScore,
} from "@/lib/xpulse/editor/pipeline";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: () => <AnalyzePage initialMode="ANALYZE" title="Analyze" active="/analyze" />,
});

mport { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { WorkspaceShell } from "@/components/intel/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { runEditor, optimizationStatus } from "@/lib/xpulse/api";
import type { ContentKind } from "@/lib/xpulse/content-score";
import { baselineContent } from "@/lib/xpulse/optimize/baseline";
import {
  EDITOR_HANDOFF_KEY,
  parseEditorHandoff,
  runEditorPipeline,
  type EditorDossier,
  type EditorHandoff,
  type EditorMode,
  type NamedScore,
} from "@/lib/xpulse/editor/pipeline";

export const Route = createFileRoute("/analyze")({
  head: () => ({ meta: [{ title: "Analyze · XPulse" }] }),
  component: () => <AnalyzePage initialMode="ANALYZE" title="Analyze" active="/analyze" />,
});

const MODES: Array<{ id: EditorMode; label: string }> = [
  { id: "ANALYZE", label: "Analyze" },
];
