import { Dialog } from "@base-ui/react/dialog";
import { Command } from "cmdk";
import { useEffect, useState } from "react";
import type { DocumentEnvelope } from "../lib/documents";
import { listDocuments } from "../lib/documents";
import { listGraphWorkspaces } from "../lib/graph";
import {
  buildProjectSearchResults,
  type ProjectSearchResult,
  type SearchDestination,
} from "../lib/projectSearch";
import { listStixDrafts, listStixObjects } from "../lib/stix";
import { DialogFrame } from "./DialogFrame";

interface ProjectCommandPaletteProps {
  open: boolean;
  projectId: string | null;
  onOpenChange: (open: boolean) => void;
  onNavigate: (destination: SearchDestination) => void;
  onOpenDocument: (document: DocumentEnvelope) => void;
}

const navigationCommands: ReadonlyArray<{
  destination: SearchDestination;
  label: string;
  description: string;
  requiresProject: boolean;
}> = [
  {
    destination: "overview",
    label: "Project overview",
    description: "Go to project status and recovery",
    requiresProject: true,
  },
  {
    destination: "investigations",
    label: "Documents",
    description: "Go to investigations, analyst notes, and reports",
    requiresProject: true,
  },
  {
    destination: "intelligence",
    label: "Intelligence",
    description: "Go to STIX objects and local drafts",
    requiresProject: true,
  },
  {
    destination: "evidence",
    label: "Evidence",
    description: "Open encrypted project files and sources",
    requiresProject: true,
  },
  {
    destination: "mitre",
    label: "MITRE ATT&CK",
    description: "Go to local ATT&CK and ATLAS catalogs",
    requiresProject: true,
  },
  {
    destination: "graph",
    label: "Graph workspace",
    description: "Go to visual investigations",
    requiresProject: true,
  },
  {
    destination: "settings",
    label: "Settings",
    description: "Open appearance, local data, and third-party notices",
    requiresProject: false,
  },
];

export function ProjectCommandPalette({
  open,
  projectId,
  onOpenChange,
  onNavigate,
  onOpenDocument,
}: ProjectCommandPaletteProps) {
  const [index, setIndex] = useState<{
    projectId: string | null;
    results: ProjectSearchResult[];
    partialFailure: boolean;
  }>({ projectId: null, results: [], partialFailure: false });

  useEffect(() => {
    if (!open || !projectId) return;

    let active = true;
    void Promise.allSettled([
      listDocuments(projectId),
      listStixObjects(projectId),
      listStixDrafts(projectId),
      listGraphWorkspaces(projectId),
    ]).then((settled) => {
      if (!active) return;
      const [documents, objects, drafts, workspaces] = settled;
      setIndex({
        projectId,
        partialFailure: settled.some((result) => result.status === "rejected"),
        results: buildProjectSearchResults({
          documents: documents.status === "fulfilled" ? documents.value : [],
          objects: objects.status === "fulfilled" ? objects.value : [],
          drafts: drafts.status === "fulfilled" ? drafts.value : [],
          workspaces: workspaces.status === "fulfilled" ? workspaces.value : [],
        }),
      });
    });

    return () => {
      active = false;
    };
  }, [open, projectId]);

  const results = index.projectId === projectId ? index.results : [];
  const loading = Boolean(projectId && index.projectId !== projectId);
  const partialFailure = index.projectId === projectId && index.partialFailure;

  const closeAndNavigate = (destination: SearchDestination) => {
    onOpenChange(false);
    onNavigate(destination);
  };

  const openResult = (result: ProjectSearchResult) => {
    onOpenChange(false);
    if (result.document) {
      onOpenDocument(result.document);
      return;
    }
    onNavigate(result.destination);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <DialogFrame width="command">
        <Dialog.Title className="sr-only">Search project and commands</Dialog.Title>
        <Dialog.Description className="sr-only">
          Search local project content or move to another workspace.
        </Dialog.Description>
        <Command
          className="overflow-hidden rounded-[inherit] bg-panel-raised text-copy-primary"
          label="Search project and commands"
          loop
        >
          <div className="flex items-center gap-2 border-panel-border border-b px-3">
            <span className="select-none text-copy-faint" aria-hidden="true">
              /
            </span>
            <Command.Input
              autoFocus
              className="h-11 min-w-0 flex-1 border-0 bg-transparent text-sm text-copy-primary outline-none placeholder:text-copy-faint"
              aria-label="Search project and commands"
              placeholder="Search project or type a command…"
            />
            <kbd className="rounded-sm border border-panel-border bg-panel-deep px-1.5 py-0.5 text-[11px] text-copy-faint">
              Esc
            </kbd>
          </div>
          <Command.List
            className="max-h-[min(28rem,65vh)] overflow-y-auto overscroll-contain p-1.5"
            label="Project results and commands"
          >
            {loading ? (
              <Command.Loading className="px-3 py-6 text-center text-copy-muted text-xs">
                Indexing unlocked project data…
              </Command.Loading>
            ) : null}
            <Command.Empty className="px-3 py-8 text-center text-copy-muted text-xs">
              No matching project data or command.
            </Command.Empty>
            <Command.Group
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-copy-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
              heading="Go to"
            >
              {navigationCommands
                .filter((command) => !command.requiresProject || projectId)
                .map((command) => (
                  <PaletteItem
                    key={command.destination}
                    label={command.label}
                    description={command.description}
                    value={`navigate:${command.destination} ${command.label}`}
                    keywords={[command.destination, command.description]}
                    onSelect={() => closeAndNavigate(command.destination)}
                  />
                ))}
            </Command.Group>
            {results.length ? <Command.Separator className="my-1 h-px bg-panel-border" /> : null}
            {results.length ? (
              <Command.Group
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:text-copy-faint [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                heading="Project data"
              >
                {results.map((result) => (
                  <PaletteItem
                    key={result.id}
                    label={result.label}
                    description={result.description}
                    value={`${result.id} ${result.label}`}
                    keywords={result.keywords}
                    onSelect={() => openResult(result)}
                  />
                ))}
              </Command.Group>
            ) : null}
          </Command.List>
          <footer className="flex min-h-8 items-center justify-between border-panel-border border-t bg-panel-deep px-3 text-[11px] text-copy-faint">
            <span>
              {partialFailure ? "Some local project data could not be indexed." : "Local only"}
            </span>
            <span>↑↓ navigate · Enter open</span>
          </footer>
        </Command>
      </DialogFrame>
    </Dialog.Root>
  );
}

function PaletteItem({
  label,
  description,
  ...props
}: {
  label: string;
  description: string;
  value: string;
  keywords: string[];
  onSelect: () => void;
}) {
  return (
    <Command.Item
      className="grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 text-copy-secondary outline-none data-[selected=true]:bg-panel-hover data-[selected=true]:text-copy-primary"
      {...props}
    >
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-copy-faint">{description}</span>
      </span>
      <span className="text-[11px] text-copy-faint" aria-hidden="true">
        ↵
      </span>
    </Command.Item>
  );
}
