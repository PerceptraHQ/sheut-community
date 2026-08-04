import { Button } from "@base-ui/react/button";
import { mergeAttributes, Node } from "@tiptap/core";
import { type NodeViewProps, NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { useEffect, useState } from "react";

export interface ProjectReferenceAttributes {
  sourceKind: "intelligence" | "evidence" | "document";
  sourceId: string;
  sourceVersion: string | null;
  display: "inline" | "block";
  label: string;
  snapshot: Record<string, string>;
}

export interface MitreObservationSnapshot {
  observationId: string;
  revision: number;
  catalog: string;
  catalogVersion: string;
  techniqueId: string;
  techniqueName: string;
  explanation: string;
}

export interface MitreSnapshotAttributes {
  observations: MitreObservationSnapshot[];
}

export interface GraphSnapshotAttributes {
  attachmentId: string;
  workspaceId: string;
  workspaceRevision: number;
  workspaceName: string;
  placement: "inline" | "appendix";
  alt: string;
  title: string;
}

interface IntelligenceReferenceOptions {
  onRefreshProject: (attributes: ProjectReferenceAttributes) => Promise<ProjectReferenceAttributes>;
  onRefreshMitre: (attributes: MitreSnapshotAttributes) => Promise<MitreSnapshotAttributes>;
  onRefreshGraph: (attributes: GraphSnapshotAttributes) => Promise<GraphSnapshotAttributes>;
  loadGraphImage: (attachmentId: string) => Promise<ArrayBuffer>;
}

const ProjectReferenceView = (props: NodeViewProps) => {
  const attributes = props.node.attrs as ProjectReferenceAttributes;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = props.extension.options as IntelligenceReferenceOptions;
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      props.updateAttributes(await options.onRefreshProject(attributes));
    } catch {
      setError("Source unavailable; frozen text retained.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeViewWrapper
      as="span"
      className="editor-project-reference"
      data-display={attributes.display}
      data-source-kind={attributes.sourceKind}
    >
      <span className="editor-project-reference-label">{attributes.label}</span>
      <span className="editor-reference-actions" contentEditable={false}>
        <Button type="button" disabled={busy} onClick={() => void refresh()}>
          {busy ? "Refreshing…" : "Refresh"}
        </Button>
        <Button type="button" onClick={() => props.deleteNode()}>
          Remove
        </Button>
      </span>
      {error ? (
        <span className="editor-reference-error" role="status" contentEditable={false}>
          {error}
        </span>
      ) : null}
    </NodeViewWrapper>
  );
};

const GraphSnapshotView = (props: NodeViewProps) => {
  const attributes = props.node.attrs as GraphSnapshotAttributes;
  const [busy, setBusy] = useState(false);
  const [imageError, setImageError] = useState<{
    attachmentId: string;
    message: string;
  } | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [loadedImage, setLoadedImage] = useState<{
    attachmentId: string;
    source: string;
  } | null>(null);
  const options = props.extension.options as IntelligenceReferenceOptions;
  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void options
      .loadGraphImage(attributes.attachmentId)
      .then((bytes) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
        setImageError(null);
        setLoadedImage({ attachmentId: attributes.attachmentId, source: objectUrl });
      })
      .catch(() => {
        if (active) {
          setImageError({
            attachmentId: attributes.attachmentId,
            message: "Frozen graph image is unavailable.",
          });
        }
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attributes.attachmentId, options]);
  const refresh = async () => {
    setBusy(true);
    setRefreshError(null);
    try {
      props.updateAttributes(await options.onRefreshGraph(attributes));
    } catch {
      setRefreshError("Graph workspace is unavailable; the frozen snapshot was retained.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeViewWrapper
      as="figure"
      className="editor-graph-snapshot"
      data-placement={attributes.placement}
    >
      <div className="editor-graph-snapshot-header" contentEditable={false}>
        <span>
          {attributes.workspaceName} · r{attributes.workspaceRevision}
        </span>
        <span className="editor-reference-actions">
          <Button type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
          <Button type="button" onClick={() => props.deleteNode()}>
            Remove
          </Button>
        </span>
      </div>
      {loadedImage?.attachmentId === attributes.attachmentId ? (
        <img src={loadedImage.source} alt={attributes.alt} draggable={false} />
      ) : (
        <p className="editor-reference-status" role="status" contentEditable={false}>
          Decrypting frozen graph snapshot…
        </p>
      )}
      <figcaption contentEditable={false}>{attributes.title}</figcaption>
      {imageError?.attachmentId === attributes.attachmentId ? (
        <p className="editor-reference-error" role="status" contentEditable={false}>
          {imageError.message}
        </p>
      ) : null}
      {refreshError ? (
        <p className="editor-reference-error" role="status" contentEditable={false}>
          {refreshError}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
};

const MitreSnapshotView = (props: NodeViewProps) => {
  const attributes = props.node.attrs as MitreSnapshotAttributes;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = props.extension.options as IntelligenceReferenceOptions;
  const refresh = async () => {
    setBusy(true);
    setError(null);
    try {
      props.updateAttributes(await options.onRefreshMitre(attributes));
    } catch {
      setError("One or more observations are unavailable; the frozen snapshot was retained.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <NodeViewWrapper className="editor-mitre-snapshot">
      <div className="editor-mitre-snapshot-header" contentEditable={false}>
        <strong>MITRE ATT&amp;CK observations</strong>
        <span className="editor-reference-actions">
          <Button type="button" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
          <Button type="button" onClick={() => props.deleteNode()}>
            Remove
          </Button>
        </span>
      </div>
      <div className="editor-mitre-grid" contentEditable={false}>
        <strong>Technique ID</strong>
        <strong>Technique</strong>
        <strong>Explanation</strong>
        {attributes.observations.flatMap((observation) => [
          <span key={`${observation.observationId}:id`}>{observation.techniqueId}</span>,
          <span key={`${observation.observationId}:name`}>{observation.techniqueName}</span>,
          <span key={`${observation.observationId}:explanation`}>
            {observation.explanation || "No analyst explanation recorded."}
          </span>,
        ])}
      </div>
      {error ? (
        <p className="editor-reference-error" role="status" contentEditable={false}>
          {error}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
};

export function createIntelligenceReferenceExtensions(options: IntelligenceReferenceOptions) {
  const ProjectReference = Node.create<IntelligenceReferenceOptions>({
    name: "projectReference",
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    addOptions: () => options,
    addAttributes() {
      return {
        sourceKind: { default: "intelligence" },
        sourceId: { default: null },
        sourceVersion: { default: null },
        display: { default: "inline" },
        label: { default: "Project reference" },
        snapshot: { default: {} },
      };
    },
    parseHTML: () => [{ tag: "span[data-project-reference]" }],
    renderHTML: ({ HTMLAttributes }) => [
      "span",
      mergeAttributes(HTMLAttributes, { "data-project-reference": "" }),
    ],
    addNodeView: () => ReactNodeViewRenderer(ProjectReferenceView),
  });

  const MitreSnapshot = Node.create<IntelligenceReferenceOptions>({
    name: "mitreSnapshot",
    group: "block",
    atom: true,
    selectable: true,
    addOptions: () => options,
    addAttributes() {
      return { observations: { default: [] } };
    },
    parseHTML: () => [{ tag: "div[data-mitre-snapshot]" }],
    renderHTML: ({ HTMLAttributes }) => [
      "div",
      mergeAttributes(HTMLAttributes, { "data-mitre-snapshot": "" }),
    ],
    addNodeView: () => ReactNodeViewRenderer(MitreSnapshotView),
  });

  const GraphSnapshot = Node.create<IntelligenceReferenceOptions>({
    name: "graphSnapshot",
    group: "block",
    atom: true,
    selectable: true,
    addOptions: () => options,
    addAttributes() {
      return {
        attachmentId: { default: null },
        workspaceId: { default: null },
        workspaceRevision: { default: 1 },
        workspaceName: { default: "Analytical graph" },
        placement: { default: "inline" },
        alt: { default: "Analytical graph snapshot" },
        title: { default: "Analytical graph snapshot" },
      };
    },
    parseHTML: () => [{ tag: "figure[data-graph-snapshot]" }],
    renderHTML: ({ HTMLAttributes }) => [
      "figure",
      mergeAttributes(HTMLAttributes, { "data-graph-snapshot": "" }),
    ],
    addNodeView: () => ReactNodeViewRenderer(GraphSnapshotView),
  });

  return [ProjectReference, MitreSnapshot, GraphSnapshot];
}
