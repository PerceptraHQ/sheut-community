const SOURCE_SIZE = 2334;
const SOURCE_BACKGROUND = '<rect width="2334" height="2334" fill="#000000"/>';

export const DESKTOP_ICON_PROFILES = Object.freeze({
  linux: Object.freeze({ inset: 160, radius: 420 }),
  macos: Object.freeze({ inset: 105, radius: 510 }),
  windows: Object.freeze({ inset: 235, radius: 370 }),
});

export function buildPlatformIconSvg(source, platform) {
  const profile = DESKTOP_ICON_PROFILES[platform];
  if (!profile) throw new Error(`Unknown desktop icon platform: ${platform}`);
  if (!source.includes(SOURCE_BACKGROUND)) {
    throw new Error("The canonical logo background could not be found");
  }

  const size = SOURCE_SIZE - profile.inset * 2;
  const clippedBackground = [
    `<defs><clipPath id="platform-icon-mask">`,
    `<rect x="${profile.inset}" y="${profile.inset}" width="${size}" height="${size}" rx="${profile.radius}"/>`,
    "</clipPath></defs>",
    `<g data-platform="${platform}" clip-path="url(#platform-icon-mask)">`,
    SOURCE_BACKGROUND,
  ].join("");

  return source.replace(SOURCE_BACKGROUND, clippedBackground).replace("</svg>", "</g></svg>");
}
