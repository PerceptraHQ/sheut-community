const URL_OR_DOMAIN =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,63}(?:\/[^\s<>"']*)?/gi;

const TRAILING_PUNCTUATION = /[),.;:!?]+$/;

/** Converts shareable indicators without treating arbitrary prose as a URL. */
export function defangUrls(value: string): string {
  return value.replace(URL_OR_DOMAIN, (candidate) => {
    const punctuation = candidate.match(TRAILING_PUNCTUATION)?.[0] ?? "";
    const indicator = punctuation ? candidate.slice(0, -punctuation.length) : candidate;
    const defanged = indicator
      .replace(/^https:/i, "hxxps:")
      .replace(/^http:/i, "hxxp:")
      .replaceAll(".", "[.]");
    return `${defanged}${punctuation}`;
  });
}
