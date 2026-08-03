# Illicit Ecosystem Report guide

Use the **Illicit Ecosystem Report** for investigations that connect people,
accounts, sites, infrastructure, monetisation, malware exposure, and preserved
evidence. Piracy and illicit streaming are common uses, but the structure also
fits fraud and other linked online ecosystems.

The report is a human-readable assessment. STIX remains an interchange format:
inserting project data into a report does not create a STIX object or
Relationship, and a visual Graph link is never silently converted into one.

| Section | Function |
| --- | --- |
| Executive Summary | BLUF: threat, impact, significance, and action for the recipient |
| Key Findings | Principal supported intelligence judgments |
| Assessment | Analytical reasoning, assumptions, alternatives, and implications |
| Key Intelligence Gaps | Material unknowns that prevent stronger judgments |
| Intelligence Requirements | Answerable questions for further collection |
| Recommended Actions | Preservation, investigative, defensive, or collection steps |

## Before writing

1. Import reusable intelligence or create local drafts in **Intelligence**.
2. Create an explicit STIX Relationship only when a relationship has been
   validated and should be exchanged as STIX.
3. Record applicable ATT&CK observations in **MITRE** with the technique ID,
   name, and an explanation tied to the facts.
4. Import screenshots, videos, documents, archives, and other files into
   **Evidence**. Files remain encrypted in the project.
5. Create the report from **Documents > New guided report > Illicit Ecosystem
   Report** and give it a precise title.

You may also enter a human-readable value manually. A report row never requires
a STIX object merely to record an analyst observation.

## Write prose first

- Start in the large narrative canvas for the section. Open **Help** when you
  need the section-specific guidance.
- Use **Edit details** for compact scalar metadata. Changes are applied only
  when you save the dialog; **Cancel** leaves the section unchanged.
- Use **Add to section** to reveal optional narratives, structured records, or
  project references. A blank optional addition can be dismissed.
- Structured information is shown as readable summary cards. **Add** or
  **Edit** opens one wide dialog for one record, and **Cancel** makes no change.
- Add project references through the explicit picker. A reference supplements
  the reader-facing prose or record; it does not replace the explanation.
- The navigator uses **Empty**, **In progress**, **Ready**, and **Not
  applicable**. These describe editorial readiness, not publication locks.

## How publication works

- The title above the editor becomes the cover and administration title.
- **Version** and **handling marking** are selected in Publish and stored in the
  immutable publication snapshot. They are not ordinary report fields.
- Drafts autosave and remain readable before publication.
- Recommended content is advisory. Publish lists missing recommendations by
  section and lets you return to the report or continue. An empty title or an
  invalid supplied date, choice, confidence value, or oversized value remains
  a hard error that must be corrected.
- Whitespace-only fields, all-blank table rows, empty project references, and
  the resulting empty sections do not appear in Publish, the table of contents,
  HTML, DOCX, or PDF.
- Publication keeps short, genuinely comparable data in tables. It removes
  columns that are empty across every record and publishes dense intelligence
  records as labelled field/value cards instead of shrinking a wide schema to
  unreadable text. The three-field ATT&CK mapping remains a concise table.
- An Evidence project reference or evidence image selected in any published
  section remains next to the relevant analysis and is also listed once under
  **Evidence index**, together with every section that cites it.
- Section headings are not numbered. PDF and DOCX tables of contents show page
  numbers; HTML uses accessible links because screen pages are fluid.
- Empty optional sections are normal. Do not add filler text merely to make a
  heading appear.

## Field-by-field workflow

### Report Administration

- **Report ID:** Sheut assigns the next project-local identifier when the
  report is created, for example `IER-0001`. Deleted identifiers are not reused.
  Keep it unless an external case-numbering policy requires an override.
- **Report date:** the issue date for this version, for example `2026-08-02`.
- **Authors:** the responsible author or authors, for example `Alex Morgan;
  Jordan Lee`.
- **Producing organisation:** the accountable team or organisation when it is
  responsible for producing the report. Keep it separate from the people named
  as authors.
- **Investigation period:** the activity window, including uncertainty, for
  example `2026-01-15 to 2026-07-31; earlier activity may exist`.
- **Overall confidence:** choose the report-level analytical confidence.
- **Confidence terminology:** define the scale used in the report, for example
  `High: multiple independent sources; Moderate: credible but incomplete;
  Low: limited or uncorroborated reporting.`
- **Geographic scope:** name relevant jurisdictions without implying a legal
  conclusion.
- **Investigation or project identifiers:** add reader-facing case references,
  never internal database identifiers.
- **Report scope:** state the subject, jurisdictions, questions, and exclusions.
- **Additional metadata:** add a label/value row only for metadata that does not
  fit the defined fields.

Do not put the report title, TLP marking, release version, or publication status
into narrative fields. The cover and immutable publication snapshot supply
those values consistently to HTML, DOCX, and PDF.

### Executive Summary

Write a three-paragraph bottom line up front:

1. what the ecosystem is and why the reader should care;
2. the strongest supported assessment and its evidence basis;
3. the principal uncertainty and the action required next.

Do not introduce a stronger attribution here than the evidence sections can
support.

### Key Findings

Use short, defensible findings. Separate observed fact from assessment, for
example: `Observed: five domains reused the same advertising identifier.
Assessment: this is moderately likely to indicate common administration.`
For each structured finding, record **Finding**, **Assessment confidence**,
**Basis or source type**, **Corroboration status**, **Project-data references**,
and **Evidence references**.

### Scope, Methodology and Source Handling

- In the primary narrative, state the decision this report supports and its
  boundaries. The exported report uses the section title rather than adding a
  redundant “Purpose and scope” subheading.
- **OSINT collection:** public sources, collection dates, and preservation.
- **Technical observations:** DNS, certificate, redirect, account, or device
  observations and the tools or constraints relevant to them.
- **HUMINT collection:** how source reporting was obtained and protected;
  exclude source-identifying detail that the audience must not receive.
- **Evidence-preservation methods:** original files, hashes, exports, captures,
  and collection timestamps.
- **Source reporting and independently corroborated facts:** explicitly state
  which claims are source-reported and which were verified independently.
- **Limitations:** unavailable records, incomplete time ranges, and collection
  blind spots.
- **Confidence definitions:** expand the administration terminology when the
  report needs more detail.

Use evidentiary terms consistently:

- a **fact** is directly established by the available evidence;
- **source reporting** is what a source stated, without implying independent
  verification;
- **corroboration** is independent information that supports or contradicts a
  reported claim;
- an **assessment** is the analyst's reasoned judgment from facts and reporting;
- an **intelligence gap** is a material unknown;
- an **intelligence requirement** is an answerable collection question; and
- a **recommendation** is an action to take, not a claim about present reality.

### Assessment

Write the principal analysis in the primary narrative. The exported report
uses the section title rather than adding a redundant “Overall assessment”
subheading. Record overall confidence in Report Administration and use the
optional analytical subfields only when evidence supports them:

- ecosystem operating model;
- roles and responsibilities;
- traffic-generation model;
- advertising monetisation;
- malicious advertising and malware exposure;
- Australian operational nexus;
- possible government-employment nexus;
- knowledge, consent, and intent;
- financial involvement;
- alternative explanations.

Keep an employment match, identity claim, or financial hypothesis separate
from a proven identity or transaction. Explain the alternative explanation that
would most seriously weaken the assessment.

### Key Intelligence Gaps

Each row contains **Gap ID**, **Unknown**, **Why it matters**, **Status**, and
**Related finding**. Example: `GAP-01 | Whether the named person and the public
employment record refer to the same individual | Changes attribution | Open |
KF-02`.

### Intelligence Requirements

Each row contains **Requirement ID**, **Priority**, **Question**, **Rationale**,
**Related intelligence gap**, **Required data or collection source**, **Status**,
**Answer or resolution**, and **Related evidence**. Example: `IR-01 | High |
Determine whether the source-named person is the OSINT match | Resolves
attribution | GAP-01 | employment records and independent identity data | Open
| | EVD-003`.

### Timeline of Activity

Each row contains **Date and time**, **Timezone**, **Precision or certainty**,
**Event**, **Event type**, **Provenance**, **Related entities**, **Related
infrastructure**, **Source references**, and **Evidence references**. Use values
such as `Exact`, `Approximate`, `Source-reported`, or `Analyst-observed` instead
of presenting every timestamp as equally certain.

### Ecosystem and Actor Overview

Use the narrative for the operating picture. The entity table contains
**Entity**, **Entity type**, **Known or alleged role**, **Known relationships**,
**Assessment basis**, **Confidence**, and **Evidence**.

The relationship-diagram field accepts a narrative and an inserted evidence
image. It does not read from or modify the STIX Graph. Explain every important
edge in text or in Relationships and Supporting Evidence.

### Identities and Roles

Use **Name, alias or identifier**, **Identity type**, **Alleged, observed or
assessed role**, **Source of attribution**, **Confidence**, **Corroboration
status**, associated accounts/sites/infrastructure, **Relationships**,
**Jurisdiction**, **Possible employment or organisation**, **Evidence
references**, and **Unresolved questions**. Leave a possible real-name or
employment match blank unless supported. Never collapse a source allegation and
a possible OSINT match into one fact.

### Social Profiles

Use **Platform**, **Handle**, **Profile URL or platform identifier**, **First
observed**, **Last observed**, **Observed purpose**, **Linked identities**,
**Linked websites**, **Relevant posts or comments**, **Control or ownership
confidence**, **Current status**, **Preservation status**, and **Evidence
references**.
Example preservation status: `Profile HTML, screenshot, and relevant video saved
as Evidence SOC-0042`.

### Site Inventory

Use **Domain or URL**, **Title or label**, **Purpose**, **First observed**, **Last
observed**, **Current status**, **Linked identities**, **Linked profiles**,
**Hosting and DNS**, **Advertising or analytics identifiers**, **Redirect
behaviour**, **Observed harmful or deceptive content**, **Confidence**, and
**Evidence references**. Defang live URLs where appropriate.

### Infrastructure and Certificates

Infrastructure rows contain **IP address or host**, **ASN**, **Hosting provider**,
**DNS or passive DNS**, **Redirector**, **Remote-access infrastructure**,
**Analytics or advertising identifier**, **Shared infrastructure**, **First
observed**, **Last observed**, **Current status**, **Migration notes**, **Related
sites and identities**, and **Evidence references**.

Certificate rows contain **Fingerprint**, **Subject**, **Subject alternative
names**, **Issuer**, **Valid from**, **Valid until**, **First observed**, **Last
observed**, **Linked domains or IP addresses**, **Shared-certificate pivots**,
**Analytical relevance**, and **Evidence references**. State the fingerprint
algorithm, for example `SHA-256 91:4A:…:7C`.

### Relationships and Supporting Evidence

Use **Source entity**, **Relationship type**, **Target entity**, **Direction**,
**Relationship status**, **Basis**, **Confidence**, first/last observed,
source-reporting and technical references, documentary evidence, and an analyst
narrative. Basis should distinguish
`Directly observed`, `Source-reported`, `Technically inferred`,
`OSINT-correlated`, and `Unconfirmed`. Use a separate explicit STIX Relationship
draft only when the link is validated for interchange.

### Media and File Evidence

Use **Evidence ID**, **Title**, **Type**, **Original filename**, **SHA-256**,
**Collection date**, **Source description or link**, **Preservation status**, and
**Analyst notes**.
Then insert the encrypted project Evidence reference. A source URL or video link
is useful provenance, but it does not replace the preserved file when the file
is available.

SHA-256 is an integrity digest used to show whether the preserved bytes changed;
it does not establish who created the content or whether a claim is true.

### Indicators and Observables

Use **Value**, **Type**, **Category**, **Confidence**, **First observed**, **Last
observed**, **Context**, **Current status**, **Related entities**, and **Evidence
references**. Classify a piracy domain, social
account, or advertising ID as an investigative observable unless it satisfies a
defensible indicator definition. Insert reusable STIX observables from project
data where appropriate.

### MITRE ATT&CK Mapping — conditional

Rows contain only **Technique ID**, **Technique name**, and **Explanation**.
Map behavior such as malware delivery, drive-by compromise, user execution,
phishing, command and control, credential theft, or abusive remote access when
the evidence supports it. Do not map copyright infringement, monetisation,
promotion, or general criminal association just to fill the section.

For remote access, distinguish legitimate owner-authorized use, abuse of remote
access software, and post-compromise access. Insert the project ATT&CK
observation, then explain its factual application.

### Detections and Signatures — conditional

Use **Detection type**, **Name**, **Rule or logic**, **Data source**, **Validation
status**, and **Reference** for a defensible YARA, Sigma, Suricata/Snort, DNS,
proxy, account-monitoring, certificate, or infrastructure query. If none exist,
leave the section empty; it will not be published.

### Recommended Actions

Group recommendations by evidence track, such as device/platform,
operator/monetisation, and identity/associate. Make clear that obtaining records
or examining finances is a recommendation, not a current finding.
Each row contains **Action**, **Priority**, **Intended recipient**, **Rationale**,
**Related finding**, **Related intelligence requirement**, **Dependencies**,
**Status**, and **Evidence track**.

### Evidence Appendix

Sheut builds **Evidence index** from the encrypted Evidence records and images
cited throughout the report. Use **Evidence analysis and explanatory figures**
for extracts, analyst notes, methodology, image captions, and an exported STIX
graph view that helps explain the assessment. A graph figure illustrates the
analytical model; visual links do not become STIX Relationships and the
underlying claims still need linked evidence. Add chain-of-custody notes when
transfer, extraction, or handling details matter.

Each indexed item includes the useful non-empty Evidence metadata available at
publication time: media type, description, source, capture date, SHA-256,
clearly labelled analyst notes, and the sections that cite it. Image evidence
linked from a structured record is reproduced in the appendix; documents,
video, and archives remain metadata-backed references rather than fake images.

Images preserve their aspect ratio and are bounded to the printable page so
they do not overlap headers or footers. Give each image a useful caption and
evidence reference. Video and archives remain project Evidence; the document
can cite the evidence item and a safe source or backup link rather than trying
to embed playback.

## STIX insertion rules

- Insert reader-facing values such as `203.0.113[.]42`, `AS64500 Example
  Networks`, `T1219 Remote Access Software`, or `@example_handle`; do not expose
  internal STIX IDs in prose or table cells.
- Use Domain Name, URL, IPv4/IPv6 Address, Autonomous System, X.509 Certificate,
  Identity/User Account, Infrastructure, File, Artifact, and other matching
  object types only when the intelligence is reusable.
- Create an Indicator only when there is an actual detection pattern and
  validity context. Not every observable is an IoC.
- Creating or inserting an object never invents a relationship. Create and
  validate a separate Relationship when STIX interchange requires the link.
- Report-only status, role, confidence, dates, caveats, and analysis remain
  human-readable report context.

## Publish the final version

1. Resolve any exact hard-error toast and the focused invalid control.
2. Open **Publish**. If recommended content is missing, choose **Return to
   report** or **Continue to Publish** from the readiness confirmation.
3. Choose HTML, DOCX, or PDF, then select A4 or Letter, orientation, Brand Profile and revision, TLP marking,
   page furniture, included non-empty sections, appendices, release version,
   filename, and destination.
4. Review the output, then retain the immutable publication record. Reproducing
   a historical publication uses its stored snapshot rather than current brand
   defaults.

Use version `1.0` for the initial issue. Later releases may use `1.1`, `2.0`, and
so on. Publication history records what was produced; it does not alter the
canonical report content.

Reports created with an earlier Illicit Ecosystem template continue to open
against that exact immutable revision. New reports use revision 4. Reports on
revisions 1–3 show an explicit upgrade action; Sheut never upgrades them merely
because they were opened.

After confirmation, upgrading creates a new encrypted report revision while
keeping every historical revision available for restoration and publication
reproduction. Stable-key content, project references, evidence references, and
applicable section dispositions are preserved. Known legacy labels are mapped
to their revision 4 equivalents. Values that cannot be classified safely are
retained as labelled legacy metadata. Analyst-authored prose is never rewritten.
