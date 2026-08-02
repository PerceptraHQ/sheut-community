import { expect, it } from "vitest";
import { defangUrls } from "./defang";

it("defangs web indicators while preserving surrounding punctuation", () => {
  expect(
    defangUrls("Visit https://cdn.example.com/dropper.exe, then compare malware.example.org."),
  ).toBe("Visit hxxps://cdn[.]example[.]com/dropper[.]exe, then compare malware[.]example[.]org.");
});

it("does not alter ordinary dotted prose or an already defanged indicator", () => {
  expect(defangUrls("Version 1.2 remains at hxxps://example[.]com.")).toBe(
    "Version 1.2 remains at hxxps://example[.]com.",
  );
});
