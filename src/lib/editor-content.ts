const MAX_LINK_CHARACTERS = 2_048;
const DOMAIN_WITH_OPTIONAL_PATH =
  /^(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}(?:[/:?#]|$)/i;

export function defangIndicatorText(value: string): string {
  return value
    .replace(/\bhttps(?=:\/\/)/gi, "hxxps")
    .replace(/\bhttp(?=:\/\/)/gi, "hxxp")
    .replace(/(^|[^[])@(?!\])/g, "$1[@]")
    .replace(/(^|[^[])\.(?!\])/g, "$1[.]");
}

export function refangIndicatorText(value: string): string {
  return value
    .replace(/\[\.\]/g, ".")
    .replace(/\[@\]/g, "@")
    .replace(/\bhxxps(?=:\/\/)/gi, "https")
    .replace(/\bhxxp(?=:\/\/)/gi, "http");
}

export function normalizeEditorLink(value: string): string | null {
  const trimmed = value.trim();
  if (
    !trimmed ||
    Array.from(trimmed).length > MAX_LINK_CHARACTERS ||
    Array.from(trimmed).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    return null;
  }

  if (trimmed.startsWith("#") || (trimmed.startsWith("/") && !trimmed.startsWith("//"))) {
    return trimmed;
  }

  const candidate = DOMAIN_WITH_OPTIONAL_PATH.test(trimmed) ? `https://${trimmed}` : trimmed;
  try {
    const url = new URL(candidate);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    if (url.protocol === "mailto:" && url.pathname.includes("@")) return url.toString();
  } catch {
    return null;
  }
  return null;
}
