import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const securityHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Content-Type-Options": "nosniff",
};
const graphIconModuleNames = new Set([
  "IconArrowDownLeft",
  "IconArrowUpRight",
  "IconArrowsMaximize",
  "IconExternalLink",
  "IconFilePlus",
  "IconFocusCentered",
  "IconFolderPlus",
  "IconFolderSearch",
  "IconGraph",
  "IconLayoutDistributeHorizontal",
  "IconLinkPlus",
  "IconMap2",
  "IconMaximize",
  "IconMinus",
  "IconPin",
  "IconRefresh",
  "IconSparkles",
  "IconStack2",
]);
const lazyWorkspaceIconModuleNames = new Set([
  "IconArchive",
  "IconArrowRight",
  "IconBrandDatabricks",
  "IconCheck",
  "IconChevronRight",
  "IconDownload",
  "IconDatabase",
  "IconEdit",
  "IconFile",
  "IconFileImport",
  "IconFiles",
  "IconLayoutSidebarLeftCollapse",
  "IconNotes",
  "IconPlus",
  "IconTargetArrow",
  "IconUpload",
]);
const windowIconModuleNames = new Set([
  "IconLayoutDashboard",
  "IconWindowMaximize",
  "IconWindowMinimize",
  "IconX",
]);
const editorIconModuleNames = new Set([
  "IconAlignCenter",
  "IconAlignJustified",
  "IconAlignLeft",
  "IconAlignRight",
  "IconArrowBackUp",
  "IconArrowForwardUp",
  "IconBlockquote",
  "IconBold",
  "IconCode",
  "IconCodeDots",
  "IconChevronUp",
  "IconColumnInsertLeft",
  "IconColumnInsertRight",
  "IconColumnRemove",
  "IconFileExport",
  "IconDeviceFloppy",
  "IconH1",
  "IconH2",
  "IconH3",
  "IconHighlight",
  "IconInfoSquareRounded",
  "IconItalic",
  "IconLink",
  "IconList",
  "IconListCheck",
  "IconListNumbers",
  "IconPhotoPlus",
  "IconPilcrow",
  "IconRowInsertBottom",
  "IconRowInsertTop",
  "IconRowRemove",
  "IconSeparatorHorizontal",
  "IconShieldCheck",
  "IconStrikethrough",
  "IconSubscript",
  "IconSuperscript",
  "IconTable",
  "IconTableOff",
  "IconUnderline",
]);

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  build: {
    // Keep the complete official STIX icon set as lazy static assets. Inlining
    // dozens of small PNGs inflated the shared registry chunk by more than
    // 60 KiB gzip while the browser still requested only the icons in use.
    assetsInlineLimit: 0,
    target: "es2022",
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("/@tabler/icons-react/")) {
            const iconModuleName = /\/icons\/(Icon[^/.]+)\.(?:js|mjs|ts)$/.exec(id)?.[1];
            if (iconModuleName && graphIconModuleNames.has(iconModuleName)) {
              return "graph-icons";
            }
            if (iconModuleName && lazyWorkspaceIconModuleNames.has(iconModuleName)) {
              return "workspace-icons";
            }
            if (iconModuleName && windowIconModuleNames.has(iconModuleName)) {
              return "window-icons";
            }
            if (iconModuleName && editorIconModuleNames.has(iconModuleName)) {
              return "editor-icons";
            }
            return "icons";
          }
        },
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    headers: securityHeaders,
  },
  preview: { headers: securityHeaders },
}));
