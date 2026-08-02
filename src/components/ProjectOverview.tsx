import { Button } from "@base-ui/react/button";
import {
  IconArrowRight,
  IconBrandDatabricks,
  IconFiles,
  IconGitFork,
  IconPhoto,
  IconShieldLock,
  IconTopologyStar3,
} from "@tabler/icons-react";
import { type ReactNode, useEffect, useState } from "react";
import { listBrandProfiles } from "../lib/brand-profiles";
import { listDocuments } from "../lib/documents";
import { listGraphWorkspaces } from "../lib/graph";
import {
  type EvidenceFileMetadata,
  listEvidenceFiles,
  listGuidedReports,
} from "../lib/guided-reports";
import type { SearchDestination } from "../lib/projectSearch";
import type { ProjectSummary } from "../lib/projects";
import { listStixDrafts, listStixObjects } from "../lib/stix";
import { TlpBadge } from "./TlpBadge";
import { WorkspaceLoadingState } from "./WorkspaceState";

interface ProjectOverviewProps {
  onNavigate: (destination: SearchDestination) => void;
  project: ProjectSummary;
}

interface OverviewData {
  documents: number;
  reports: number;
  evidence: EvidenceFileMetadata[];
  intelligence: number;
  graphs: number;
  brands: number;
  partial: boolean;
}

export function ProjectOverview({ onNavigate, project }: ProjectOverviewProps) {
  const [data, setData] = useState<OverviewData | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      listDocuments(project.id),
      listGuidedReports(project.id),
      listEvidenceFiles(project.id),
      listStixObjects(project.id),
      listStixDrafts(project.id),
      listGraphWorkspaces(project.id),
      listBrandProfiles(project.id),
    ]).then((results) => {
      if (!active) return;
      const [documents, reports, evidence, objects, drafts, graphs, brands] = results;
      setData({
        documents: documents.status === "fulfilled" ? documents.value.length : 0,
        reports: reports.status === "fulfilled" ? reports.value.length : 0,
        evidence: evidence.status === "fulfilled" ? evidence.value : [],
        intelligence:
          (objects.status === "fulfilled" ? objects.value.length : 0) +
          (drafts.status === "fulfilled" ? drafts.value.length : 0),
        graphs: graphs.status === "fulfilled" ? graphs.value.length : 0,
        brands: brands.status === "fulfilled" ? brands.value.length : 0,
        partial: results.some((result) => result.status === "rejected"),
      });
    });
    return () => {
      active = false;
    };
  }, [project.id]);

  if (!data) {
    return (
      <WorkspaceLoadingState
        icon={<IconShieldLock size={26} aria-hidden="true" />}
        title="Loading project overview"
        description="Summarizing encrypted local project data."
      />
    );
  }

  const evidenceBytes = data.evidence.reduce((total, file) => total + file.byteLen, 0);
  const recentEvidence = data.evidence.slice(0, 3);
  const tlp = project.defaultTlpMarking ?? "clear";

  return (
    <section
      className="mx-auto grid w-full max-w-6xl gap-5 px-6 py-6"
      aria-labelledby="project-title"
    >
      <header className="flex flex-wrap items-start justify-between gap-4 rounded-sm border border-panel-border bg-panel-base p-5">
        <div>
          <p className="m-0 text-[11px] text-copy-faint uppercase tracking-[0.12em]">
            Encrypted local project
          </p>
          <h1 className="mt-1 mb-0 text-xl font-semibold" id="project-title">
            {project.name ?? "Local project"}
          </h1>
          <p className="mt-2 mb-0 text-copy-muted text-xs">
            Offline during ordinary use ·{" "}
            {project.unlockMethod === "passphrase" ? "Passphrase" : "Device credential"} protected
          </p>
        </div>
        <TlpBadge marking={tlp} />
      </header>

      {data.partial ? (
        <p
          className="m-0 rounded-sm border border-warning/40 bg-warning/10 px-3 py-2 text-copy-secondary text-xs"
          role="status"
        >
          Some dashboard totals could not be refreshed. Project data remains unchanged.
        </p>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <OverviewCard
          icon={<IconFiles size={18} aria-hidden="true" />}
          label={`${data.reports} guided ${data.reports === 1 ? "report" : "reports"}`}
          detail={`${data.documents} freeform ${data.documents === 1 ? "document" : "documents"}`}
          actionLabel="Open Documents"
          onOpen={() => onNavigate("investigations")}
        />
        <OverviewCard
          icon={<IconPhoto size={18} aria-hidden="true" />}
          label={`${data.evidence.length} evidence ${data.evidence.length === 1 ? "file" : "files"}`}
          detail={formatBytes(evidenceBytes)}
          actionLabel="Open Evidence"
          onOpen={() => onNavigate("evidence")}
        />
        <OverviewCard
          icon={<IconGitFork size={18} aria-hidden="true" />}
          label={`${data.intelligence} intelligence ${data.intelligence === 1 ? "item" : "items"}`}
          detail="Validated objects and local drafts"
          actionLabel="Open Intelligence"
          onOpen={() => onNavigate("intelligence")}
        />
        <OverviewCard
          icon={<IconTopologyStar3 size={18} aria-hidden="true" />}
          label={`${data.graphs} graph ${data.graphs === 1 ? "workspace" : "workspaces"}`}
          detail={`${data.brands} Brand ${data.brands === 1 ? "Profile" : "Profiles"}`}
          actionLabel="Open Graph"
          onOpen={() => onNavigate("graph")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <section
          className="rounded-sm border border-panel-border bg-panel-base"
          aria-labelledby="recent-evidence-title"
        >
          <header className="flex items-center justify-between border-panel-border border-b px-4 py-3">
            <h2 className="m-0 text-sm font-semibold" id="recent-evidence-title">
              Recent evidence
            </h2>
            <Button className="control-button" type="button" onClick={() => onNavigate("evidence")}>
              View all
              <IconArrowRight size={14} aria-hidden="true" />
            </Button>
          </header>
          {recentEvidence.length > 0 ? (
            <ul className="m-0 grid list-none p-0">
              {recentEvidence.map((file) => (
                <li
                  className="grid grid-cols-[1fr_auto] gap-4 border-panel-border border-b px-4 py-3 last:border-b-0"
                  key={file.id}
                >
                  <span className="min-w-0 truncate text-copy-primary text-xs">{file.title}</span>
                  <span className="text-[10px] text-copy-faint uppercase tracking-wide">
                    {formatBytes(file.byteLen)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 px-4 py-6 text-copy-faint text-xs">No Evidence files imported yet.</p>
          )}
        </section>

        <section
          className="rounded-sm border border-panel-border bg-panel-base p-4"
          aria-labelledby="project-posture-title"
        >
          <div className="flex items-center gap-2">
            <IconBrandDatabricks size={18} className="text-accent" aria-hidden="true" />
            <h2 className="m-0 text-sm font-semibold" id="project-posture-title">
              Project posture
            </h2>
          </div>
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-xs">
            <dt className="text-copy-faint">Network</dt>
            <dd className="m-0 text-copy-secondary">Local-first, ordinary use offline</dd>
            <dt className="text-copy-faint">Encryption</dt>
            <dd className="m-0 text-copy-secondary">Encrypted project database</dd>
            <dt className="text-copy-faint">Default marking</dt>
            <dd className="m-0 text-copy-secondary">{tlp.replace("_", "+").toUpperCase()}</dd>
            <dt className="text-copy-faint">Brand profiles</dt>
            <dd className="m-0 text-copy-secondary">{data.brands}</dd>
          </dl>
          <Button
            className="control-button mt-5"
            type="button"
            onClick={() => onNavigate("settings")}
          >
            Open project settings
          </Button>
        </section>
      </div>
    </section>
  );
}

function OverviewCard({
  actionLabel,
  detail,
  icon,
  label,
  onOpen,
}: {
  actionLabel: string;
  detail: string;
  icon: ReactNode;
  label: string;
  onOpen: () => void;
}) {
  return (
    <article className="grid min-h-32 content-between gap-4 rounded-sm border border-panel-border bg-panel-base p-4">
      <div>
        <span className="text-accent">{icon}</span>
        <p className="mt-2 mb-0 font-semibold text-copy-primary text-sm">{label}</p>
        <p className="mt-1 mb-0 text-copy-faint text-[11px]">{detail}</p>
      </div>
      <Button
        className="control-button justify-between"
        type="button"
        onClick={onOpen}
        aria-label={actionLabel}
      >
        {actionLabel}
        <IconArrowRight size={14} aria-hidden="true" />
      </Button>
    </article>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}
