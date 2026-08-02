/** Brand-profile facade; encrypted assets and native file selection remain in Rust. */
import { invoke } from "@tauri-apps/api/core";

export type BrandTypeface = "geist" | "geist_mono" | "source_serif4";
export type BrandAssetRole = "logo" | "compact_mark" | "cover_artwork";

export interface BrandProfileInput {
  name: string;
  organizationName: string;
  contact: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  textColor: string;
  backgroundColor: string;
  headingTypeface: BrandTypeface;
  bodyTypeface: BrandTypeface;
  monoTypeface: BrandTypeface;
  defaultPaperSize: "a4" | "letter";
  defaultOrientation: "portrait" | "landscape";
  coverTreatment: "minimal" | "editorial" | "artwork";
  density: "compact" | "comfortable" | "spacious";
  tableTreatment: "grid" | "banded" | "minimal";
  sectionTreatment: "rule" | "band" | "plain";
  pageFurniture: {
    header: boolean;
    footer: boolean;
    marking: boolean;
    page_numbers: boolean;
  };
}

export interface BrandProfile {
  schema_version: 1;
  id: string;
  revision: number;
  name: string;
  organization: { name: string; contact: string | null };
  assets: {
    logo_id: string | null;
    compact_mark_id: string | null;
    cover_artwork_id: string | null;
  };
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    text: string;
    background: string;
  };
  typography: { heading: BrandTypeface; body: BrandTypeface; mono: BrandTypeface };
  default_paper_size: "a4" | "letter";
  default_orientation: "portrait" | "landscape";
  cover_treatment: "minimal" | "editorial" | "artwork";
  density: "compact" | "comfortable" | "spacious";
  table_treatment: "grid" | "banded" | "minimal";
  section_treatment: "rule" | "band" | "plain";
  page_furniture: BrandProfileInput["pageFurniture"];
  created_at_unix_ms: number;
  updated_at_unix_ms: number;
}

export interface BrandAssetMetadata {
  id: string;
  profile_id: string;
  role: BrandAssetRole;
  media_type: "image/png" | "image/jpeg" | "image/webp";
  file_name: string;
  byte_len: number;
}

export interface BrandAssetSelection {
  profile: BrandProfile;
  asset: BrandAssetMetadata;
}

export function defaultBrandProfileInput(organizationName: string): BrandProfileInput {
  return {
    name: `${organizationName} Default`,
    organizationName,
    contact: null,
    primaryColor: "#133C55",
    secondaryColor: "#386FA4",
    accentColor: "#59A5D8",
    textColor: "#111827",
    backgroundColor: "#FFFFFF",
    headingTypeface: "geist",
    bodyTypeface: "source_serif4",
    monoTypeface: "geist_mono",
    defaultPaperSize: "a4",
    defaultOrientation: "portrait",
    coverTreatment: "editorial",
    density: "comfortable",
    tableTreatment: "grid",
    sectionTreatment: "band",
    pageFurniture: { header: true, footer: true, marking: true, page_numbers: true },
  };
}

export function brandProfileInput(profile: BrandProfile): BrandProfileInput {
  return {
    name: profile.name,
    organizationName: profile.organization.name,
    contact: profile.organization.contact,
    primaryColor: profile.colors.primary,
    secondaryColor: profile.colors.secondary,
    accentColor: profile.colors.accent,
    textColor: profile.colors.text,
    backgroundColor: profile.colors.background,
    headingTypeface: profile.typography.heading,
    bodyTypeface: profile.typography.body,
    monoTypeface: profile.typography.mono,
    defaultPaperSize: profile.default_paper_size,
    defaultOrientation: profile.default_orientation,
    coverTreatment: profile.cover_treatment,
    density: profile.density,
    tableTreatment: profile.table_treatment,
    sectionTreatment: profile.section_treatment,
    pageFurniture: profile.page_furniture,
  };
}

export function listBrandProfiles(projectId: string): Promise<BrandProfile[]> {
  return invoke<BrandProfile[]>("list_brand_profiles", { projectId });
}

export function createBrandProfile(
  projectId: string,
  input: BrandProfileInput,
): Promise<BrandProfile> {
  return invoke<BrandProfile>("create_brand_profile", { projectId, input });
}

export function updateBrandProfile(
  projectId: string,
  profileId: string,
  expectedRevision: number,
  input: BrandProfileInput,
): Promise<BrandProfile> {
  return invoke<BrandProfile>("update_brand_profile", {
    projectId,
    profileId,
    expectedRevision,
    input,
  });
}

export function pickBrandAsset(
  projectId: string,
  profileId: string,
  expectedRevision: number,
  role: BrandAssetRole,
): Promise<BrandAssetSelection | null> {
  return invoke<BrandAssetSelection | null>("pick_brand_asset", {
    projectId,
    profileId,
    expectedRevision,
    role,
  });
}

export function loadBrandAsset(
  projectId: string,
  profileId: string,
  assetId: string,
): Promise<ArrayBuffer> {
  return invoke<ArrayBuffer>("load_brand_asset", { projectId, profileId, assetId });
}
