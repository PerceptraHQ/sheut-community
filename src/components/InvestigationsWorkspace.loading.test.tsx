import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import * as documentsApi from "../lib/documents";
import { InvestigationsWorkspace } from "./InvestigationsWorkspace";
import { VaultNoticeProvider } from "./VaultNotices";

vi.mock("../lib/documents", async (importOriginal) => ({
  ...(await importOriginal<typeof documentsApi>()),
  listDocuments: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(documentsApi.listDocuments)
    .mockReset()
    .mockReturnValue(new Promise(() => undefined));
});

it("uses a progress state while encrypted documents load", () => {
  render(
    <VaultNoticeProvider>
      <InvestigationsWorkspace
        projectId="019b0dc2-34c8-7c31-a2e5-c447222ce0b9"
        externalDocument={null}
        onBusyChange={vi.fn()}
        onSelectedDocumentChange={vi.fn()}
      />
    </VaultNoticeProvider>,
  );

  expect(screen.getByRole("progressbar", { name: "Loading documents" })).toBeVisible();
});
