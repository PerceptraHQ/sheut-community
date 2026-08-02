import { Autocomplete } from "@base-ui/react/autocomplete";
import { IconSearch } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { listDocuments } from "../lib/documents";
import { listGraphWorkspaces } from "../lib/graph";
import { buildProjectSearchResults, type ProjectSearchResult } from "../lib/projectSearch";
import { listStixDrafts, listStixObjects } from "../lib/stix";

interface ProjectTitleSearchProps {
  disabled: boolean;
  projectId: string | null;
  onOpenResult: (result: ProjectSearchResult) => void;
}

const MAX_SUGGESTIONS = 50;

export function ProjectTitleSearch({ disabled, projectId, onOpenResult }: ProjectTitleSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProjectSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [partialFailure, setPartialFailure] = useState(false);
  const requestId = useRef(0);
  const { contains } = Autocomplete.useFilter();

  useEffect(() => {
    return () => {
      requestId.current += 1;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!projectId || disabled) return;
    const currentRequest = ++requestId.current;
    setLoading(true);

    const settled = await Promise.allSettled([
      listDocuments(projectId),
      listStixObjects(projectId),
      listStixDrafts(projectId),
      listGraphWorkspaces(projectId),
    ]);
    if (requestId.current !== currentRequest) return;

    const [documents, objects, drafts, workspaces] = settled;
    setResults(
      buildProjectSearchResults({
        documents: documents.status === "fulfilled" ? documents.value : [],
        objects: objects.status === "fulfilled" ? objects.value : [],
        drafts: drafts.status === "fulfilled" ? drafts.value : [],
        workspaces: workspaces.status === "fulfilled" ? workspaces.value : [],
      }),
    );
    setPartialFailure(settled.some((result) => result.status === "rejected"));
    setLoading(false);
  }, [disabled, projectId]);

  const normalizedQuery = query.trim();
  const suggestions = useMemo(() => {
    if (!normalizedQuery) return [];
    return results
      .filter((result) =>
        contains(
          `${result.label} ${result.description} ${result.keywords.join(" ")}`,
          normalizedQuery,
        ),
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [contains, normalizedQuery, results]);

  const searchDisabled = disabled || !projectId;

  return (
    <Autocomplete.Root
      autoHighlight
      disabled={searchDisabled}
      filter={null}
      items={suggestions}
      itemToStringValue={(item) => item.label}
      onValueChange={setQuery}
      value={query}
    >
      <div className="relative min-w-0">
        <IconSearch
          className="pointer-events-none absolute top-1/2 left-2.5 z-10 -translate-y-1/2 text-copy-faint"
          size={13}
          stroke={1.8}
          aria-hidden="true"
        />
        <Autocomplete.Input
          aria-label="Search project data"
          className="h-7 w-full min-w-0 rounded-sm border border-panel-border bg-panel-base pr-3 pl-8 text-copy-primary text-xs outline-none placeholder:text-copy-faint hover:border-copy-faint focus:border-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={searchDisabled}
          onFocus={() => void refresh()}
          placeholder={projectId ? "Search project data…" : "Open a project to search"}
        />
      </div>

      <Autocomplete.Portal>
        <Autocomplete.Positioner className="z-80 outline-none" align="center" sideOffset={5}>
          <Autocomplete.Popup className="w-[var(--anchor-width)] min-w-72 max-w-[min(34rem,var(--available-width))] overflow-hidden rounded-sm border border-panel-border bg-panel-raised text-copy-primary shadow-xl ring-1 ring-white/5 outline-none">
            <Autocomplete.Status className="text-copy-muted text-xs">
              {loading ? (
                <div className="px-3 py-2">Indexing local project data…</div>
              ) : partialFailure ? (
                <div className="border-panel-border border-b px-3 py-2">
                  Some local project data could not be indexed.
                </div>
              ) : null}
            </Autocomplete.Status>
            <Autocomplete.Empty className="text-copy-muted text-xs">
              {!loading && normalizedQuery ? (
                <div className="px-3 py-5 text-center">No matching project data.</div>
              ) : null}
            </Autocomplete.Empty>
            <Autocomplete.List className="max-h-[min(24rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 outline-none">
              {(result: ProjectSearchResult) => (
                <Autocomplete.Item
                  className="grid cursor-default grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-2.5 py-2 text-copy-secondary outline-none data-highlighted:bg-panel-hover data-highlighted:text-copy-primary"
                  key={result.id}
                  value={result}
                  onClick={() => {
                    setQuery("");
                    onOpenResult(result);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold">{result.label}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-copy-faint">
                      {result.description}
                    </span>
                  </span>
                  <span className="text-[11px] text-copy-faint" aria-hidden="true">
                    ↵
                  </span>
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  );
}
