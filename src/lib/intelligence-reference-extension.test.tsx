import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { expect, it, vi } from "vitest";
import {
  createIntelligenceReferenceExtensions,
  type GraphSnapshotAttributes,
  type MitreSnapshotAttributes,
  type ProjectReferenceAttributes,
} from "./intelligence-reference-extension";

interface HarnessProps {
  content: Record<string, unknown>;
  onRefreshProject?: (
    attributes: ProjectReferenceAttributes,
  ) => Promise<ProjectReferenceAttributes>;
  onRefreshMitre?: (attributes: MitreSnapshotAttributes) => Promise<MitreSnapshotAttributes>;
  onRefreshGraph?: (attributes: GraphSnapshotAttributes) => Promise<GraphSnapshotAttributes>;
  loadGraphImage?: (attachmentId: string) => Promise<ArrayBuffer>;
}

function Harness({
  content,
  onRefreshProject = (attributes) => Promise.resolve(attributes),
  onRefreshMitre = (attributes) => Promise.resolve(attributes),
  onRefreshGraph = (attributes) => Promise.resolve(attributes),
  loadGraphImage = () => Promise.resolve(new ArrayBuffer(0)),
}: HarnessProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      ...createIntelligenceReferenceExtensions({
        onRefreshProject,
        onRefreshMitre,
        onRefreshGraph,
        loadGraphImage,
      }),
    ],
    content,
    immediatelyRender: false,
  });

  return editor ? <EditorContent editor={editor} /> : null;
}

it("keeps frozen project text when its upstream record was deleted and can remove the node", async () => {
  const user = userEvent.setup();
  const onRefreshProject = vi.fn().mockRejectedValue(new Error("deleted"));
  const { container } = render(
    <Harness
      content={{
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "projectReference",
                attrs: {
                  sourceKind: "intelligence",
                  sourceId: "e7c44850-9f67-4d26-b7e3-0d4ee82339ef",
                  sourceVersion: "r4",
                  display: "inline",
                  label: "Frozen domain snapshot",
                  snapshot: { value: "example.test" },
                },
              },
            ],
          },
        ],
      }}
      onRefreshProject={onRefreshProject}
    />,
  );

  const reference = await screen.findByText("Frozen domain snapshot");
  const node = reference.closest(".editor-project-reference");
  expect(node).not.toBeNull();
  await user.click(within(node as HTMLElement).getByRole("button", { name: "Refresh" }));

  expect(onRefreshProject).toHaveBeenCalledOnce();
  expect(await within(node as HTMLElement).findByRole("status")).toHaveTextContent(
    "Source unavailable; frozen text retained.",
  );
  expect(reference).toHaveTextContent("Frozen domain snapshot");

  await user.click(within(node as HTMLElement).getByRole("button", { name: "Remove" }));
  await waitFor(() =>
    expect(container.querySelector(".editor-project-reference")).not.toBeInTheDocument(),
  );
});

it("refreshes a MITRE snapshot only after the analyst explicitly asks", async () => {
  const user = userEvent.setup();
  const refreshed: MitreSnapshotAttributes = {
    observations: [
      {
        observationId: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
        revision: 4,
        catalog: "attack_enterprise",
        catalogVersion: "19.1",
        techniqueId: "T1059",
        techniqueName: "Command and Scripting Interpreter",
        explanation: "Updated analyst explanation.",
      },
    ],
  };
  const onRefreshMitre = vi.fn().mockResolvedValue(refreshed);
  render(
    <Harness
      content={{
        type: "doc",
        content: [
          {
            type: "mitreSnapshot",
            attrs: {
              observations: [
                {
                  observationId: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
                  revision: 3,
                  catalog: "attack_enterprise",
                  catalogVersion: "18.1",
                  techniqueId: "T1059",
                  techniqueName: "Command and Scripting Interpreter",
                  explanation: "Original frozen explanation.",
                },
              ],
            },
          },
        ],
      }}
      onRefreshMitre={onRefreshMitre}
    />,
  );

  expect(await screen.findByText("Original frozen explanation.")).toBeVisible();
  expect(screen.queryByText("Updated analyst explanation.")).not.toBeInTheDocument();
  expect(onRefreshMitre).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "Refresh" }));

  expect(onRefreshMitre).toHaveBeenCalledOnce();
  expect(await screen.findByText("Updated analyst explanation.")).toBeVisible();
  expect(screen.queryByText("Original frozen explanation.")).not.toBeInTheDocument();
});

it("retains a frozen graph node when its encrypted attachment and workspace are unavailable", async () => {
  const user = userEvent.setup();
  const loadGraphImage = vi.fn().mockRejectedValue(new Error("missing attachment"));
  const onRefreshGraph = vi.fn().mockRejectedValue(new Error("deleted workspace"));
  const { container } = render(
    <Harness
      content={{
        type: "doc",
        content: [
          {
            type: "graphSnapshot",
            attrs: {
              attachmentId: "22a415a0-61b2-4b50-904d-d5f180bfc505",
              workspaceId: "4f3d8e34-7c64-4d41-8b68-d7a334e1a884",
              workspaceRevision: 7,
              workspaceName: "Infrastructure map",
              placement: "appendix",
              alt: "Analytical graph snapshot: Infrastructure map",
              title: "Infrastructure map · revision 7",
            },
          },
        ],
      }}
      loadGraphImage={loadGraphImage}
      onRefreshGraph={onRefreshGraph}
    />,
  );

  expect(await screen.findByText("Frozen graph image is unavailable.")).toBeVisible();
  expect(screen.getByText("Infrastructure map · revision 7")).toBeVisible();
  expect(loadGraphImage).toHaveBeenCalledWith("22a415a0-61b2-4b50-904d-d5f180bfc505");

  await user.click(screen.getByRole("button", { name: "Refresh" }));

  expect(onRefreshGraph).toHaveBeenCalledOnce();
  expect(
    await screen.findByText("Graph workspace is unavailable; the frozen snapshot was retained."),
  ).toBeVisible();
  expect(container.querySelector(".editor-graph-snapshot")).toBeInTheDocument();
});
