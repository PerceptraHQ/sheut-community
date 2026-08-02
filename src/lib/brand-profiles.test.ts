import { invoke } from "@tauri-apps/api/core";
import { beforeEach, expect, it, vi } from "vitest";
import {
  createBrandProfile,
  defaultBrandProfileInput,
  listBrandProfiles,
  loadBrandAsset,
  pickBrandAsset,
  updateBrandProfile,
} from "./brand-profiles";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const PROJECT_ID = "019b0dc2-34c8-7c31-a2e5-c447222ce0b9";
const PROFILE_ID = "110b83fb-9fdb-4133-a29b-e75725bb6d0c";
const ASSET_ID = "ec6ed71e-a754-4b32-b692-50f03f00154f";

beforeEach(() => vi.mocked(invoke).mockReset().mockResolvedValue({}));

it("uses project-scoped typed Brand Studio commands", async () => {
  const input = defaultBrandProfileInput("Northwind");
  await listBrandProfiles(PROJECT_ID);
  await createBrandProfile(PROJECT_ID, input);
  await updateBrandProfile(PROJECT_ID, PROFILE_ID, 2, input);
  await pickBrandAsset(PROJECT_ID, PROFILE_ID, 3, "cover_artwork");
  await loadBrandAsset(PROJECT_ID, PROFILE_ID, ASSET_ID);

  expect(invoke).toHaveBeenNthCalledWith(1, "list_brand_profiles", { projectId: PROJECT_ID });
  expect(invoke).toHaveBeenNthCalledWith(2, "create_brand_profile", {
    projectId: PROJECT_ID,
    input,
  });
  expect(invoke).toHaveBeenNthCalledWith(3, "update_brand_profile", {
    projectId: PROJECT_ID,
    profileId: PROFILE_ID,
    expectedRevision: 2,
    input,
  });
  expect(invoke).toHaveBeenNthCalledWith(4, "pick_brand_asset", {
    projectId: PROJECT_ID,
    profileId: PROFILE_ID,
    expectedRevision: 3,
    role: "cover_artwork",
  });
  expect(invoke).toHaveBeenNthCalledWith(5, "load_brand_asset", {
    projectId: PROJECT_ID,
    profileId: PROFILE_ID,
    assetId: ASSET_ID,
  });
});
