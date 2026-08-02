import { Button } from "@base-ui/react/button";
import { Switch } from "@base-ui/react/switch";
import { IconPhotoPlus, IconPlus } from "@tabler/icons-react";
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  type BrandProfile,
  type BrandProfileInput,
  brandProfileInput,
  createBrandProfile,
  defaultBrandProfileInput,
  listBrandProfiles,
  loadBrandAsset,
  pickBrandAsset,
  updateBrandProfile,
} from "../lib/brand-profiles";
import { SelectField, type SelectFieldOption } from "./SelectField";
import { useVaultNotices } from "./VaultNotices";

interface BrandStudioProps {
  projectId: string;
  projectName: string;
}

const typefaceOptions: readonly SelectFieldOption[] = [
  { value: "geist", label: "Geist", secondary: "Sans variable" },
  { value: "source_serif4", label: "Source Serif 4", secondary: "Serif variable" },
  { value: "geist_mono", label: "Geist Mono", secondary: "Monospace variable" },
];

const paperOptions: readonly SelectFieldOption[] = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
];

const orientationOptions: readonly SelectFieldOption[] = [
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

const coverOptions: readonly SelectFieldOption[] = [
  { value: "minimal", label: "Minimal" },
  { value: "editorial", label: "Editorial gradient" },
  { value: "artwork", label: "Cover artwork" },
];

export function BrandStudio({ projectId, projectName }: BrandStudioProps) {
  const notices = useVaultNotices();
  const [profiles, setProfiles] = useState<BrandProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [input, setInput] = useState<BrandProfileInput>(() =>
    defaultBrandProfileInput(projectName),
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assetPreview, setAssetPreview] = useState<{
    profileId: string;
    urls: Partial<Record<"logo" | "compact_mark" | "cover_artwork", string>>;
  } | null>(null);
  const selected = profiles.find((profile) => profile.id === selectedId) ?? null;
  const assetUrls =
    assetPreview && selected && assetPreview.profileId === selected.id ? assetPreview.urls : {};

  useEffect(() => {
    let active = true;
    listBrandProfiles(projectId)
      .then((items) => {
        if (!active) return;
        setProfiles(items);
        const first = items[0];
        if (first) {
          setSelectedId(first.id);
          setInput(brandProfileInput(first));
        }
      })
      .catch(() => {
        if (active) {
          notices.add({
            title: "Brand Profiles not loaded",
            description: "The encrypted project data could not be read.",
            type: "info",
          });
        }
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [notices, projectId]);

  useEffect(() => {
    let active = true;
    const urls: string[] = [];
    if (!selected) return () => undefined;
    const assets = [
      ["logo", selected.assets.logo_id],
      ["compact_mark", selected.assets.compact_mark_id],
      ["cover_artwork", selected.assets.cover_artwork_id],
    ] as const;
    void Promise.all(
      assets.map(async ([role, assetId]) => {
        if (!assetId) return null;
        const bytes = await loadBrandAsset(projectId, selected.id, assetId);
        const url = URL.createObjectURL(new Blob([bytes]));
        urls.push(url);
        return [role, url] as const;
      }),
    )
      .then((loaded) => {
        if (!active) return;
        setAssetPreview({
          profileId: selected.id,
          urls: Object.fromEntries(loaded.filter((asset) => asset !== null)),
        });
      })
      .catch(() => {
        if (active) {
          notices.add({
            title: "Brand image not previewed",
            description: "One or more encrypted brand images could not be opened.",
            type: "info",
          });
        }
      });
    return () => {
      active = false;
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, [notices, projectId, selected]);

  const profileOptions = useMemo<readonly SelectFieldOption[]>(
    () =>
      profiles.map((profile) => ({
        value: profile.id,
        label: profile.name,
        secondary: `r${profile.revision}`,
      })),
    [profiles],
  );

  const createProfile = async () => {
    setSaving(true);
    try {
      const created = await notices.promise(
        () =>
          createBrandProfile(projectId, {
            ...defaultBrandProfileInput(projectName),
            name:
              profiles.length === 0
                ? `${projectName} Default`
                : `${projectName} Profile ${profiles.length + 1}`,
          }),
        {
          loading: { title: "Creating Brand Profile", type: "info" },
          success: {
            title: "Brand Profile created",
            description: "Publication defaults are ready to customize.",
            type: "success",
          },
          error: {
            title: "Brand Profile not created",
            description: "Check the profile details and try again.",
            type: "info",
          },
        },
      );
      setProfiles((current) => [...current, created]);
      setSelectedId(created.id);
      setInput(brandProfileInput(created));
    } catch {
      // The toast reports the failure while preserving the current form.
    } finally {
      setSaving(false);
    }
  };

  const saveProfile = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const saved = await notices.promise(
        () => updateBrandProfile(projectId, selected.id, selected.revision, input),
        {
          loading: { title: "Saving Brand Profile", type: "info" },
          success: {
            title: "Brand Profile saved",
            description: "New publications can use this revision.",
            type: "success",
          },
          error: {
            title: "Brand Profile not saved",
            description: "Reload the profile if another revision was saved first.",
            type: "info",
          },
        },
      );
      setProfiles((current) =>
        current.map((profile) => (profile.id === saved.id ? saved : profile)),
      );
    } catch {
      // The toast reports the failure while preserving the current form.
    } finally {
      setSaving(false);
    }
  };

  const chooseAsset = async (role: "logo" | "compact_mark" | "cover_artwork") => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await pickBrandAsset(projectId, selected.id, selected.revision, role);
      if (!result) return;
      setProfiles((current) =>
        current.map((profile) => (profile.id === result.profile.id ? result.profile : profile)),
      );
      notices.add({
        title: `${assetLabel(role)} attached`,
        description: "The image is encrypted inside this project.",
        type: "success",
      });
    } catch {
      notices.add({
        title: "Brand image not attached",
        description: "Use PNG, JPEG, or WebP up to 10 MiB.",
        type: "info",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="list-message">Loading Brand Studio…</p>;

  return (
    <div className="grid gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold">Brand Studio</h2>
          <p className="mt-2 mb-0 max-w-2xl text-copy-muted text-sm leading-6">
            Project-local publication identity, imagery, typography, and page defaults. Profiles do
            not alter canonical report content.
          </p>
        </div>
        <Button
          className="control-button"
          type="button"
          disabled={saving}
          onClick={() => void createProfile()}
        >
          <IconPlus size={14} stroke={1.7} aria-hidden="true" />
          New profile
        </Button>
      </header>

      {profiles.length === 0 ? (
        <div className="rounded-sm border border-dashed border-panel-border p-6 text-center">
          <p className="m-0 text-copy-muted text-sm">No Brand Profiles yet.</p>
          <Button
            className="primary-button mt-3"
            type="button"
            disabled={saving}
            onClick={() => void createProfile()}
          >
            Create default profile
          </Button>
        </div>
      ) : (
        <>
          <SelectField
            ariaLabel="Brand Profile"
            label="Brand Profile"
            onChange={(id) => {
              const profile = profiles.find((item) => item.id === id);
              if (!profile) return;
              setSelectedId(id);
              setInput(brandProfileInput(profile));
            }}
            options={profileOptions}
            placeholder="Choose profile"
            value={selectedId}
          />

          <section className="grid gap-4 rounded-sm border border-panel-border bg-panel-base p-4">
            <h3 className="m-0 text-sm font-semibold">Identity</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField
                label="Profile name"
                value={input.name}
                onChange={(name) => setInput((current) => ({ ...current, name }))}
              />
              <TextField
                label="Organization name"
                value={input.organizationName}
                onChange={(organizationName) =>
                  setInput((current) => ({ ...current, organizationName }))
                }
              />
            </div>
            <TextField
              label="Contact details"
              value={input.contact ?? ""}
              onChange={(contact) =>
                setInput((current) => ({ ...current, contact: contact || null }))
              }
            />
          </section>

          <section className="grid gap-4 rounded-sm border border-panel-border bg-panel-base p-4">
            <h3 className="m-0 text-sm font-semibold">Logos and cover imagery</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <AssetCard
                label="Primary logo"
                url={assetUrls.logo}
                onChoose={() => void chooseAsset("logo")}
                disabled={saving}
              />
              <AssetCard
                label="Compact mark"
                url={assetUrls.compact_mark}
                onChoose={() => void chooseAsset("compact_mark")}
                disabled={saving}
              />
              <AssetCard
                label="Cover/banner artwork"
                url={assetUrls.cover_artwork}
                onChoose={() => void chooseAsset("cover_artwork")}
                disabled={saving}
              />
            </div>
          </section>

          <section className="grid gap-4 rounded-sm border border-panel-border bg-panel-base p-4">
            <h3 className="m-0 text-sm font-semibold">Colors and typography</h3>
            <div className="grid gap-3 sm:grid-cols-5">
              {(
                [
                  ["Primary", "primaryColor"],
                  ["Secondary", "secondaryColor"],
                  ["Accent", "accentColor"],
                  ["Text", "textColor"],
                  ["Background", "backgroundColor"],
                ] as const
              ).map(([label, key]) => (
                <ColorField
                  key={key}
                  label={label}
                  value={input[key]}
                  onChange={(value) => setInput((current) => ({ ...current, [key]: value }))}
                />
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <TypefaceField
                label="Headings"
                value={input.headingTypeface}
                onChange={(headingTypeface) =>
                  setInput((current) => ({ ...current, headingTypeface }))
                }
              />
              <TypefaceField
                label="Body"
                value={input.bodyTypeface}
                onChange={(bodyTypeface) => setInput((current) => ({ ...current, bodyTypeface }))}
              />
              <TypefaceField
                label="Monospace"
                value={input.monoTypeface}
                onChange={(monoTypeface) => setInput((current) => ({ ...current, monoTypeface }))}
              />
            </div>
            <p className="m-0 text-copy-faint text-xs leading-5">
              Bundled variable fonts include regular, medium, semibold, and bold weights and remain
              fully offline.
            </p>
          </section>

          <section className="grid gap-4 rounded-sm border border-panel-border bg-panel-base p-4">
            <h3 className="m-0 text-sm font-semibold">Publication defaults</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                ariaLabel="Default paper size"
                label="Paper size"
                onChange={(value) =>
                  (value === "a4" || value === "letter") &&
                  setInput((current) => ({ ...current, defaultPaperSize: value }))
                }
                options={paperOptions}
                placeholder="Paper size"
                value={input.defaultPaperSize}
              />
              <SelectField
                ariaLabel="Default orientation"
                label="Orientation"
                onChange={(value) =>
                  (value === "portrait" || value === "landscape") &&
                  setInput((current) => ({ ...current, defaultOrientation: value }))
                }
                options={orientationOptions}
                placeholder="Orientation"
                value={input.defaultOrientation}
              />
              <SelectField
                ariaLabel="Cover treatment"
                label="Cover"
                onChange={(value) =>
                  (value === "minimal" || value === "editorial" || value === "artwork") &&
                  setInput((current) => ({ ...current, coverTreatment: value }))
                }
                options={coverOptions}
                placeholder="Cover"
                value={input.coverTreatment}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["header", "footer", "marking", "page_numbers"] as const).map((key) => (
                <FurnitureSwitch
                  key={key}
                  label={key === "page_numbers" ? "Page numbers" : capitalize(key)}
                  checked={input.pageFurniture[key]}
                  onChange={(checked) =>
                    setInput((current) => ({
                      ...current,
                      pageFurniture: { ...current.pageFurniture, [key]: checked },
                    }))
                  }
                />
              ))}
            </div>
          </section>

          <BrandPreview input={input} logoUrl={assetUrls.logo} coverUrl={assetUrls.cover_artwork} />

          <div className="flex justify-end border-panel-border border-t pt-4">
            <Button
              className="primary-button"
              type="button"
              disabled={saving}
              onClick={() => void saveProfile()}
            >
              {saving ? "Saving…" : "Save Brand Profile"}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-copy-secondary text-xs">
      {label}
      <input
        className="h-9 rounded-sm border border-panel-border bg-panel-deep px-2.5 text-copy-primary text-sm outline-none focus:border-accent"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1.5 text-copy-secondary text-xs">
      {label}
      <span className="flex h-9 items-center gap-2 rounded-sm border border-panel-border bg-panel-deep px-2">
        <input
          className="size-5 border-0 bg-transparent p-0"
          type="color"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value.toUpperCase())}
        />
        <span>{value}</span>
      </span>
    </label>
  );
}

function TypefaceField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: BrandProfileInput["headingTypeface"];
  onChange: (value: BrandProfileInput["headingTypeface"]) => void;
}) {
  return (
    <SelectField
      ariaLabel={`${label} typeface`}
      label={label}
      onChange={(next) =>
        (next === "geist" || next === "geist_mono" || next === "source_serif4") && onChange(next)
      }
      options={typefaceOptions}
      placeholder="Typeface"
      value={value}
    />
  );
}

function AssetCard({
  label,
  url,
  onChoose,
  disabled,
}: {
  label: string;
  url?: string;
  onChoose: () => void;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-sm border border-panel-border bg-panel-deep p-3">
      <div className="grid h-28 place-items-center overflow-hidden rounded-sm bg-panel-base">
        {url ? (
          <img
            className="max-h-full max-w-full object-contain"
            src={url}
            alt={`${label} preview`}
          />
        ) : (
          <span className="text-copy-faint text-xs">No image</span>
        )}
      </div>
      <Button className="control-button" type="button" disabled={disabled} onClick={onChoose}>
        <IconPhotoPlus size={14} stroke={1.7} aria-hidden="true" />
        Choose {label.toLocaleLowerCase()}
      </Button>
    </div>
  );
}

function FurnitureSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-sm border border-panel-border bg-panel-deep px-3 py-2">
      <span className="text-copy-secondary text-xs">{label}</span>
      <Switch.Root
        nativeButton
        render={<button type="button" />}
        checked={checked}
        onCheckedChange={onChange}
        className="settings-switch"
      >
        <Switch.Thumb className="settings-switch-thumb" />
      </Switch.Root>
    </div>
  );
}

function BrandPreview({
  input,
  logoUrl,
  coverUrl,
}: {
  input: BrandProfileInput;
  logoUrl?: string;
  coverUrl?: string;
}) {
  const style = {
    "--preview-primary": input.primaryColor,
    "--preview-secondary": input.secondaryColor,
  } as CSSProperties;
  return (
    <section className="grid gap-3" aria-labelledby="brand-preview-title">
      <h3 className="m-0 text-sm font-semibold" id="brand-preview-title">
        Live cover preview
      </h3>
      <div
        className="relative min-h-80 overflow-hidden rounded-sm border border-panel-border bg-[linear-gradient(112deg,var(--preview-primary),var(--preview-secondary))] p-6 text-white"
        style={style}
      >
        {input.coverTreatment === "artwork" && coverUrl ? (
          <img
            className="absolute inset-0 size-full object-cover opacity-45"
            src={coverUrl}
            alt=""
          />
        ) : null}
        <div className="relative flex items-start justify-between gap-4">
          {logoUrl ? (
            <img
              className="max-h-12 max-w-48 object-contain"
              src={logoUrl}
              alt={`${input.organizationName} logo`}
            />
          ) : (
            <strong className="text-sm uppercase tracking-wider">{input.organizationName}</strong>
          )}
          <span className="rounded-sm bg-black px-2 py-1 font-semibold text-[#FFC000] text-xs">
            TLP:AMBER
          </span>
        </div>
        <div className="relative mt-20 grid grid-cols-[1fr_1.2fr] gap-8">
          <p className="m-0 text-4xl font-bold leading-none">CAMPAIGN REPORT</p>
          <div>
            <h4 className="m-0 text-2xl font-semibold">Representative report title</h4>
            <p className="mt-5 text-sm">31 July 2026</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function capitalize(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function assetLabel(role: "logo" | "compact_mark" | "cover_artwork"): string {
  if (role === "compact_mark") return "Compact mark";
  if (role === "cover_artwork") return "Cover artwork";
  return "Logo";
}
