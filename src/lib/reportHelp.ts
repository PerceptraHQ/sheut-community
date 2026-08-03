import type { ReportHelpTopicId } from "./reportHelpIds";

export {
  DEFAULT_REPORT_HELP_TOPIC,
  isReportHelpTopicId,
  REPORT_HELP_TOPIC_IDS,
  type ReportHelpTopicId,
} from "./reportHelpIds";

export interface ReportHelpTopic {
  id: ReportHelpTopicId;
  title: string;
  summary: string;
  useWhen: string;
  workflow: readonly string[];
  fieldGuidance: readonly string[];
  fieldExamples: readonly ReportHelpFieldExample[];
}

export interface ReportHelpFieldExample {
  field: string;
  guidance: string;
  example: string;
}

const commonNarrativeExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "Executive summary",
    guidance:
      "State the most important judgment, scope, and why it matters in a short reader-first summary.",
    example:
      "A coordinated network of streaming sites redirected visitors through the same advertising and malware-delivery infrastructure during July 2026.",
  },
  {
    field: "Key points",
    guidance:
      "List the few findings a reader must retain; make each point independently understandable.",
    example:
      "Three domains reused the same TLS certificate and analytics identifier; two also resolved to the same hosting ASN.",
  },
  {
    field: "Confidence",
    guidance:
      "Choose Low, Moderate, or High for the overall assessment and support it in the assessment narrative.",
    example: "High",
  },
  {
    field: "Assessment",
    guidance:
      "Explain what the evidence supports, what is inferred, and the reasoning behind the confidence level.",
    example:
      "We assess with high confidence that the sites are operated as one cluster because they share registration patterns, infrastructure, and monetization accounts.",
  },
];

const attackFieldExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "ATT&CK procedures — Attribution",
    guidance:
      "Name the actor, campaign, intrusion, or evidence cluster to which the behavior is attributed.",
    example: "Midnight Echo campaign",
  },
  {
    field: "ATT&CK procedures — Tactic",
    guidance: "Use the ATT&CK tactic name that describes the adversary goal.",
    example: "Initial Access",
  },
  {
    field: "ATT&CK procedures — Technique",
    guidance: "Use the ATT&CK technique ID and name, not an internal object ID.",
    example: "T1189 — Drive-by Compromise",
  },
  {
    field: "ATT&CK procedures — Sub-technique",
    guidance:
      "Add the sub-technique ID and name only when the observed behavior supports that precision.",
    example: "T1566.002 — Spearphishing Link",
  },
  {
    field: "ATT&CK procedures — Procedure",
    guidance: "Explain in plain language how the technique was observed in this report.",
    example: "Victims were redirected from a fake download button to a credential-harvesting page.",
  },
  {
    field: "ATT&CK procedures — Defense",
    guidance: "Describe the defensive outcome that would prevent, detect, or contain the behavior.",
    example: "Block newly registered redirect domains at the secure web gateway.",
  },
  {
    field: "ATT&CK procedures — Control",
    guidance: "Name the concrete control, rule, or owner that implements the defense.",
    example: "DNS policy CTI-REDIRECT-04",
  },
  {
    field: "Techniques and project references",
    guidance:
      "Insert the supporting MITRE catalog or project objects; readers see human-readable labels.",
    example: "T1189 — Drive-by Compromise",
  },
];

const indicatorFieldExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "Malware and host artifacts — Name",
    guidance: "Use the malware family, tool, file, process, or artifact name.",
    example: "FakePlayer installer",
  },
  {
    field: "Malware and host artifacts — Type",
    guidance: "State the artifact type in reader-facing language.",
    example: "SHA-256 file hash",
  },
  {
    field: "Malware and host artifacts — Value",
    guidance: "Enter the observable value exactly, defanged when appropriate for safe reading.",
    example: "4f8c…9b21",
  },
  {
    field: "Malware and host artifacts — Description",
    guidance: "Explain where the artifact appeared and why it matters.",
    example: "Hash of the installer offered after the second redirect.",
  },
  {
    field: "Malware and host artifacts — First reported",
    guidance: "Enter the earliest sourced report date.",
    example: "2026-07-04",
  },
  {
    field: "Malware and host artifacts — Last reported",
    guidance: "Enter the latest sourced report date.",
    example: "2026-07-29",
  },
  {
    field: "Network indicators — Attribution",
    guidance: "Name the activity cluster associated with the network observable.",
    example: "Midnight Echo redirect chain",
  },
  {
    field: "Network indicators — Artifact",
    guidance: "Enter the domain, IP address, URL, email address, or other network observable.",
    example: "cdn-update[.]example",
  },
  {
    field: "Network indicators — Details",
    guidance: "Explain the observable's role and any relevant port, path, or resolution detail.",
    example: "Redirect host resolving to 203.0.113.42 on 2026-07-18.",
  },
  {
    field: "Network indicators — Intrusion phase",
    guidance: "Describe where the observable appears in the observed activity flow.",
    example: "Payload delivery",
  },
  {
    field: "Network indicators — First reported",
    guidance: "Enter the earliest reliable observation date.",
    example: "2026-07-18",
  },
  {
    field: "Network indicators — Last reported",
    guidance: "Enter the latest reliable observation date.",
    example: "2026-07-31",
  },
  {
    field: "Vulnerabilities — CVE",
    guidance: "Enter the official CVE identifier.",
    example: "CVE-2026-12345",
  },
  {
    field: "Vulnerabilities — CVSS",
    guidance: "Enter the sourced score and version when known.",
    example: "8.8 (CVSS 3.1)",
  },
  {
    field: "Vulnerabilities — Patch available",
    guidance:
      "State whether a vendor fix exists and cite the relevant advisory in the data sources.",
    example: "Yes — vendor update 4.2.1",
  },
  {
    field: "Vulnerabilities — Patch applied",
    guidance: "State the known remediation status for the affected scope.",
    example: "Partial — 18 of 24 hosts",
  },
  {
    field: "Vulnerabilities — Remediation",
    guidance: "Give the concrete remediation action.",
    example: "Upgrade exposed gateways to 4.2.1 and rotate administrative credentials.",
  },
];

const supportingFieldExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "Detections and signatures — Name",
    guidance: "Use the rule, query, signature, or analytic name.",
    example: "Suspicious streaming redirect chain",
  },
  {
    field: "Detections and signatures — Type",
    guidance: "State the detection format or platform.",
    example: "Sigma",
  },
  {
    field: "Detections and signatures — Description",
    guidance: "Explain what the detection finds and its important limitations.",
    example: "Matches browser processes contacting two known redirect hosts within 30 seconds.",
  },
  {
    field: "Detections and signatures — Source",
    guidance: "Name or link the rule source and revision.",
    example: "Internal detection DET-2026-014 v2",
  },
  {
    field: "Intelligence requirements — Requirement",
    guidance: "Write the answerable intelligence question.",
    example: "Which payment accounts are reused across the identified sites?",
  },
  {
    field: "Intelligence requirements — Status",
    guidance: "State whether the question is open, in progress, answered, or blocked.",
    example: "In progress",
  },
  {
    field: "Intelligence requirements — Priority",
    guidance: "Use the project's agreed priority wording.",
    example: "High",
  },
  {
    field: "Intelligence requirements — Owner",
    guidance: "Name the responsible analyst or team.",
    example: "Digital Risk team",
  },
  {
    field: "Data sources — Source",
    guidance: "Name the provider, collection, interview, capture, or evidence item.",
    example: "Passive DNS snapshot",
  },
  {
    field: "Data sources — Type",
    guidance: "Describe how the information was obtained.",
    example: "Commercial passive DNS",
  },
  {
    field: "Data sources — Reference",
    guidance: "Give a stable human-readable citation or evidence link.",
    example: "Evidence: pDNS-export-2026-07-31.csv",
  },
  {
    field: "Data sources — Accessed",
    guidance: "Enter the date the source was accessed or captured.",
    example: "2026-07-31",
  },
];

const reportMetadataExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "Report ID",
    guidance:
      "Sheut generates the next project-local ID when the report is created. Keep it unless an external numbering policy requires an override.",
    example: "CR-0001",
  },
  {
    field: "Publication date",
    guidance: "Choose the date this version is issued, not the activity timeframe.",
    example: "2026-08-01",
  },
  {
    field: "Authors",
    guidance: "Enter one author as a name or multiple authors separated clearly by semicolons.",
    example: "Alex Morgan, Threat Intelligence; Sheut Labs",
  },
  {
    field: "Version",
    guidance: "Use the release version shown on the cover and in publication history.",
    example: "1.1",
  },
  {
    field: "Criticality",
    guidance: "Use the organization's audience-facing severity or priority scale.",
    example: "High",
  },
];

const campaignFieldExamples: readonly ReportHelpFieldExample[] = [
  ...commonNarrativeExamples,
  {
    field: "Intelligence gaps",
    guidance: "List unanswered questions that could materially change the assessment.",
    example: "The operator behind the shared payment account remains unidentified.",
  },
  ...attackFieldExamples,
  {
    field: "Campaign timeline — Date",
    guidance: "Enter the event date or a bounded date range.",
    example: "2026-07-18",
  },
  {
    field: "Campaign timeline — Activity",
    guidance: "Describe the observed event without adding unsupported intent.",
    example: "Three sites began redirecting download traffic to cdn-update[.]example.",
  },
  {
    field: "Campaign timeline — Location",
    guidance: "Enter the relevant country, region, network, or affected environment.",
    example: "Norway and Sweden",
  },
  {
    field: "Campaign timeline — Source",
    guidance: "Cite the evidence item or collection that supports the event.",
    example: "Evidence: browser-capture-2026-07-18.har",
  },
  ...indicatorFieldExamples,
  ...supportingFieldExamples,
  {
    field: "Campaign name",
    guidance: "Use a stable human-readable campaign or cluster name.",
    example: "Midnight Echo",
  },
  ...reportMetadataExamples,
  {
    field: "Timeframe",
    guidance: "State the bounded period covered by the reported activity.",
    example: "2026-06-12 to 2026-07-31",
  },
  {
    field: "Attribution assessment",
    guidance:
      "Name the attributed actor or state that attribution is unknown, then qualify uncertainty.",
    example: "Unknown criminal cluster; no reliable link to a named group.",
  },
];

const illicitEcosystemFieldExamples: readonly ReportHelpFieldExample[] = [
  {
    field: "Report ID",
    guidance:
      "Sheut generates the next IER identifier inside this encrypted project; deleted identifiers are not reused.",
    example: "IER-0001",
  },
  {
    field: "Report date",
    guidance: "Use the date this report version is issued, not an activity date.",
    example: "2026-08-02",
  },
  {
    field: "Authors",
    guidance: "List the responsible author or authors; separate multiple authors consistently.",
    example: "Alex Morgan; Jordan Lee",
  },
  {
    field: "Producing organisation",
    guidance:
      "Name the accountable team or organisation separately from the people who authored the report.",
    example: "Digital Risk Intelligence Unit",
  },
  {
    field: "Investigation period",
    guidance: "State the bounded activity window and identify uncertainty.",
    example: "2026-01-15 to 2026-07-31; earlier activity may exist.",
  },
  {
    field: "Confidence terminology",
    guidance: "Define the confidence scale used throughout this report.",
    example:
      "High: independently corroborated; Moderate: credible but incomplete; Low: limited reporting.",
  },
  {
    field: "Overall confidence",
    guidance: "Choose the report-level confidence supported by the evidence and limitations.",
    example: "Moderate",
  },
  {
    field: "Report scope",
    guidance: "Define the subject, questions, jurisdictions, time range, and exclusions.",
    example:
      "Assess the operation and Australian nexus of the observed streaming ecosystem; payment ownership is outside the available evidence.",
  },
  {
    field: "Executive summary",
    guidance:
      "Give the bottom line, strongest evidence, principal uncertainty, and required action.",
    example:
      "The observed ecosystem uses linked sites and social accounts to generate traffic. Shared identifiers support common administration with moderate confidence. Platform and payout records are required to resolve ownership.",
  },
  {
    field: "Key findings",
    guidance: "Separate observed facts from analytical judgments.",
    example:
      "Observed: five domains reused one advertising identifier. Assessment: this moderately supports common administration.",
  },
  {
    field: "Scope, Methodology and Source Handling",
    guidance:
      "In the primary narrative, explain the decision this report supports and the methods and sources included.",
    example:
      "This report supports evidence-preservation and investigative-priority decisions using OSINT, technical observations, source reporting, and preserved files.",
  },
  {
    field: "Assessment",
    guidance:
      "Connect the people, accounts, sites, infrastructure, and evidence without overstating attribution.",
    example:
      "The sites and accounts are likely coordinated, but the available evidence does not establish that the possible employment match is the person named by the source.",
  },
  {
    field: "Key intelligence gaps — Unknown",
    guidance: "State a question whose answer could materially change the assessment.",
    example:
      "Whether the named person and the public employment record refer to the same individual.",
  },
  {
    field: "Intelligence requirements — Question",
    guidance: "Turn a linked gap into a specific, answerable collection requirement.",
    example:
      "Confirm the identity and current or historical employment of the person named by the source.",
  },
  {
    field: "Timeline of activity — Provenance",
    guidance:
      "Distinguish analyst-observed, source-reported, and independently corroborated events.",
    example: "Source-reported; not independently corroborated",
  },
  {
    field: "Actors and ecosystem entities — Entity",
    guidance: "Use a human-readable person, handle, site, provider, or cluster name.",
    example: "@example_handle",
  },
  {
    field: "Identities and roles — Name, alias or identifier",
    guidance:
      "Enter the supported identifier; keep an alleged identity and a possible OSINT match separate.",
    example: "@example_handle; possible real-name match remains unconfirmed",
  },
  {
    field: "Social profiles — Profile URL or platform identifier",
    guidance: "Enter a safe or defanged profile URL or the platform's stable identifier.",
    example: "hxxps://social.example/@example_handle",
  },
  {
    field: "Site inventory — Domain or URL",
    guidance:
      "Enter a reader-facing, preferably defanged domain; insert a STIX Domain Name when reusable.",
    example: "stream-hub[.]example",
  },
  {
    field: "Infrastructure — IP address or host",
    guidance: "Enter the defanged address or host and keep hosting attribution in its own column.",
    example: "203.0.113[.]42",
  },
  {
    field: "Certificates — Fingerprint",
    guidance: "Enter the complete fingerprint and identify its hash algorithm.",
    example: "SHA-256 91:4A:2F:…:7C",
  },
  {
    field: "Relationships and supporting evidence — Basis",
    guidance:
      "State whether the relationship was directly observed, source-reported, inferred, correlated, or unconfirmed.",
    example: "Directly observed in preserved profile post",
  },
  {
    field: "Media and file evidence — SHA-256",
    guidance:
      "Use the digest of the preserved bytes to detect later changes; it does not prove authorship.",
    example: "6e9f…d771",
  },
  {
    field: "Indicators and observables — Category",
    guidance: "Distinguish an investigative observable from a validated indicator of compromise.",
    example: "Investigative observable",
  },
  {
    field: "MITRE ATT&CK mapping — Technique ID",
    guidance: "Use a technique only for behavior that factually maps to ATT&CK.",
    example: "T1219",
  },
  {
    field: "MITRE ATT&CK mapping — Technique name",
    guidance: "Use the official human-readable technique name.",
    example: "Remote Access Software",
  },
  {
    field: "MITRE ATT&CK mapping — Explanation",
    guidance:
      "Explain how the observed facts satisfy the technique; do not map ordinary promotion or monetisation.",
    example:
      "Apply only if the evidence shows remote-access software was abused, not merely installed with the owner's permission.",
  },
  {
    field: "Recommended actions — Action",
    guidance: "Separate collection or preservation recommendations from current findings.",
    example:
      "Obtain platform session records to determine which accounts were accessed from the preserved device.",
  },
  {
    field: "Evidence index — Appendix reference",
    guidance: "Use Appendix A through Z, then AA, AB, and so on.",
    example: "Appendix A",
  },
  {
    field: "Referenced project evidence",
    guidance:
      "Insert the encrypted Evidence item; a source or video link does not replace a preserved file when one is available.",
    example: "SOC-0042 — preserved profile video",
  },
];

export const REPORT_HELP_TOPICS: readonly ReportHelpTopic[] = [
  {
    id: "investigations-and-analyst-notes",
    title: "Investigations and analyst notes",
    summary:
      "Use freeform documents for working analysis, source notes, hypotheses, timelines, and material that does not fit a fixed report structure.",
    useWhen:
      "Choose an Investigation for an evolving case record. Choose an Analyst Note for a focused observation or assessment that may later feed a guided report.",
    workflow: [
      "Create the document from Documents and give it a human-readable title.",
      "Use headings, lists, quotes, bold, italics, links, and defanged URLs to structure the narrative.",
      "Insert encrypted Evidence references where a claim needs supporting material.",
      "Save the draft, review revisions, then Publish when a distributable HTML, DOCX, or PDF is needed.",
    ],
    fieldGuidance: [
      "Freeform documents do not require guided fields or tables.",
      "Keep conclusions separate from raw observations and identify the source of important claims.",
      "Use a guided template once the audience and expected report structure are known.",
    ],
    fieldExamples: [
      {
        field: "Document title",
        guidance:
          "Use a precise title that lets another analyst identify the subject without opening it.",
        example: "Streaming ecosystem infrastructure notes — July 2026",
      },
      {
        field: "Narrative",
        guidance:
          "Organize observations, analysis, sources, and open questions with headings and rich text.",
        example:
          "Observation: three sites resolved to AS64500. Assessment: shared hosting alone does not prove common control.",
      },
      {
        field: "Evidence image or link",
        guidance:
          "Insert an encrypted Evidence reference with a descriptive caption or human-readable link label.",
        example: "Figure A. Archived storefront showing the shared payment handle.",
      },
    ],
  },
  {
    id: "threat-actor-profile",
    title: "Threat Actor Profile",
    summary:
      "Build a reusable assessment of an actor, group, cluster, or suspected operator without turning uncertain attribution into fact.",
    useWhen:
      "Use this template when the primary subject is who is operating, what they want, how they work, and which infrastructure or behaviors support the assessment.",
    workflow: [
      "Set the actor or cluster name, report date, authors, version, and TLP marking.",
      "Summarize the assessment and key judgments before adding detailed behavior and infrastructure.",
      "Insert human-readable STIX objects and MITRE ATT&CK techniques from project data where they support the narrative.",
      "Add evidence references, review readiness recommendations, and decide whether the draft is ready to publish.",
    ],
    fieldGuidance: [
      "Separate confirmed identity from aliases, vendor names, and internal cluster labels.",
      "For MITRE ATT&CK, show the technique ID, technique name, and a plain-language explanation.",
      "State attribution confidence and explain the evidence behind it.",
    ],
    fieldExamples: [
      ...commonNarrativeExamples,
      {
        field: "Actor name",
        guidance:
          "Use the stable actor, cluster, or internal analytic name used throughout the report.",
        example: "Silver Kestrel",
      },
      {
        field: "Aliases — Alias",
        guidance: "Enter a public vendor name, historical name, or observed alias.",
        example: "Vendor A: Grey Falcon",
      },
      {
        field: "Aliases — Source",
        guidance: "Cite who uses the alias or where it was observed.",
        example: "Vendor A report dated 2026-06-12",
      },
      {
        field: "Attribution",
        guidance:
          "State the attributed organization, state, or unknown status without overstating certainty.",
        example: "Suspected financially motivated cluster; operator identity unknown.",
      },
      {
        field: "Motivation",
        guidance: "Describe the assessed objective supported by observed behavior.",
        example: "Financial gain through fraudulent subscriptions and malware distribution.",
      },
      {
        field: "Actor summary",
        guidance:
          "Describe the actor's identity, capabilities, operating pattern, targeting, and important uncertainty.",
        example:
          "Silver Kestrel operates disposable media sites and reuses payment and hosting infrastructure across short-lived domains.",
      },
      {
        field: "Timeline — Date",
        guidance: "Enter the activity date or bounded range.",
        example: "2026-07-18",
      },
      {
        field: "Timeline — Activity",
        guidance: "Describe the sourced actor activity.",
        example: "Registered three replacement domains using the same contact email.",
      },
      {
        field: "Timeline — Location",
        guidance: "Enter the relevant target region, infrastructure location, or environment.",
        example: "Western Balkans target set",
      },
      {
        field: "Timeline — Source",
        guidance: "Cite the supporting evidence or intelligence source.",
        example: "WHOIS capture REG-0031",
      },
      {
        field: "Intelligence gaps",
        guidance: "List unanswered questions that would change attribution or risk judgments.",
        example: "Whether the payment recipient controls the hosting accounts remains unknown.",
      },
      ...attackFieldExamples,
      {
        field: "Victims — Victim",
        guidance: "Name the affected organization, group, or anonymized victim label.",
        example: "Regional broadcaster A",
      },
      {
        field: "Victims — Sector",
        guidance: "Use a reader-facing sector name.",
        example: "Media and entertainment",
      },
      {
        field: "Victims — Location",
        guidance: "Enter the relevant country or region.",
        example: "Norway",
      },
      {
        field: "Victims — First seen",
        guidance: "Enter the first sourced date of targeting or impact.",
        example: "2026-07-03",
      },
      {
        field: "Victims — Source",
        guidance: "Cite the evidence or reporting that supports inclusion.",
        example: "Incident IR-2026-044",
      },
      ...indicatorFieldExamples,
      ...supportingFieldExamples,
      ...reportMetadataExamples,
    ],
  },
  {
    id: "intrusion-analysis",
    title: "Intrusion Analysis",
    summary:
      "Explain a specific intrusion or incident from initial access through observed impact, including evidence, indicators, and defensive implications.",
    useWhen:
      "Use this template when the report is centered on one intrusion, compromise, or incident timeline rather than a long-running actor or campaign.",
    workflow: [
      "Define the incident scope and timeframe using confirmed first-seen and last-seen dates.",
      "Write the executive summary, then document the timeline, affected assets, techniques, and indicators.",
      "Insert project STIX and MITRE data into the matching narrative or table columns.",
      "Attach supporting images as Evidence and review their caption and appendix placement.",
    ],
    fieldGuidance: [
      "Timeframe means the bounded period in which the reported activity was observed, not the publication date.",
      "Distinguish observed behavior from inferred attacker intent.",
      "Keep indicators human-readable and retain their source and observation dates.",
    ],
    fieldExamples: [
      {
        field: "Intrusion name",
        guidance: "Use a stable incident or intrusion name understood by the response team.",
        example: "July VPN compromise",
      },
      ...commonNarrativeExamples.slice(0, 2),
      {
        field: "Indicator analysis",
        guidance:
          "Explain how indicators were derived, their role, reliability, and expiration concerns.",
        example:
          "The redirect domain was captured in two independent browser sessions and remained active for 11 days.",
      },
      ...attackFieldExamples,
      ...indicatorFieldExamples,
      ...supportingFieldExamples,
      ...reportMetadataExamples,
      {
        field: "Incident timeline — Time",
        guidance: "Enter a timestamp with timezone, or a date when exact time is unknown.",
        example: "2026-07-18 09:42 UTC",
      },
      {
        field: "Incident timeline — Event",
        guidance: "Describe the verified event in sequence.",
        example: "VPN account authenticated from a previously unseen address.",
      },
      {
        field: "Incident timeline — Evidence",
        guidance: "Cite the log, capture, or Evidence item supporting the event.",
        example: "VPN log export EVD-0188",
      },
      {
        field: "Referenced project data",
        guidance:
          "Insert the STIX objects, Evidence, or documents directly supporting the intrusion analysis.",
        example: "IPv4 address 203.0.113.42; Incident IR-2026-044",
      },
    ],
  },
  {
    id: "campaign-report",
    title: "Campaign Report",
    summary:
      "Describe connected malicious or illicit activity that spans multiple events, targets, sites, identities, or infrastructure over time.",
    useWhen:
      "Use this template when a coherent operation or ecosystem is the subject and the activity is broader than one incident.",
    workflow: [
      "Name the campaign plainly and define its scope and timeframe.",
      "Lead with key judgments, then cover activity, targeting, infrastructure, techniques, and implications.",
      "Use repeatable tables for comparable entities and project-data insertion for existing intelligence.",
      "Add appendices for evidence, indicators, and methodology before publication.",
    ],
    fieldGuidance: [
      "A campaign may cover crime rings, piracy distribution, malware delivery, influence activity, or other connected operations.",
      "Use names and explanations in reader-facing tables; do not expose internal object identifiers.",
      "Explain why events belong to the same campaign and how confident that linkage is.",
    ],
    fieldExamples: campaignFieldExamples,
  },
  {
    id: "executive-report",
    title: "Executive Report",
    summary:
      "Deliver concise decision support for leaders who need material risk, impact, confidence, and recommended actions without analyst-level detail.",
    useWhen:
      "Use this template when the audience needs a short strategic briefing or decision document rather than a full technical investigation.",
    workflow: [
      "Write the decision-relevant conclusion first.",
      "Summarize business impact, affected scope, confidence, and prioritized actions.",
      "Move technical evidence and detailed indicators to appendices or a companion report.",
      "Review the cover, TLP marking, authors, version, and publication choices before export.",
    ],
    fieldGuidance: [
      "Avoid unexplained acronyms and internal object IDs.",
      "Quantify scope when evidence supports it and label estimates as estimates.",
      "Keep recommendations specific, owned, and prioritized.",
    ],
    fieldExamples: [
      {
        field: "Report title",
        guidance: "Use a decision-oriented title that identifies the subject and scope.",
        example: "Business risk from the Midnight Echo piracy ecosystem",
      },
      ...reportMetadataExamples,
      ...commonNarrativeExamples,
      {
        field: "Outlook",
        guidance: "State the most likely near-term development and the assumptions behind it.",
        example:
          "The operators are likely to replace suspended domains within days while the payment channel remains active.",
      },
      {
        field: "Intelligence gaps",
        guidance: "Name missing information that affects a leadership decision.",
        example:
          "Potential customer exposure cannot yet be quantified because payment-processor data is unavailable.",
      },
      ...supportingFieldExamples.slice(4),
    ],
  },
  {
    id: "blank-guided-report",
    title: "Blank Guided Report",
    summary:
      "Start with guided report metadata and publication controls when none of the opinionated templates matches the subject.",
    useWhen:
      "Use this template for a one-off structured deliverable, or as the starting point for a project-local custom report template.",
    workflow: [
      "Set a precise report title, then begin with the primary narrative in each section.",
      "Add the narrative and table content needed by the audience.",
      "Use project-data insertion only in fields where the referenced object supports the report.",
      "Review advisory readiness guidance, save the draft, and publish through the same branded pipeline as other reports.",
    ],
    fieldGuidance: [
      "Prefer an existing template when its semantics match the report.",
      "Use human-readable field labels and table columns in custom structures.",
      "Empty optional content should not be included merely to fill space.",
    ],
    fieldExamples: [
      {
        field: "Report ID",
        guidance:
          "Sheut generates the next project-local RPT identifier. Blank and custom templates share this sequence.",
        example: "RPT-0001",
      },
      {
        field: "Report title",
        guidance: "Use a precise title that identifies the subject and intended scope.",
        example: "Assessment of fraudulent streaming subscription activity",
      },
      {
        field: "Publication date",
        guidance: "Choose the date this report version is issued.",
        example: "2026-08-01",
      },
      {
        field: "Authors",
        guidance: "List the responsible author or authors.",
        example: "Alex Morgan; Digital Risk team",
      },
      {
        field: "Version",
        guidance: "Enter the report release version.",
        example: "1.0",
      },
      {
        field: "Narrative",
        guidance: "Write the report using clear headings, sourced claims, and explicit judgments.",
        example:
          "Assessment: the observed sites share infrastructure but evidence of common ownership remains incomplete.",
      },
    ],
  },
  {
    id: "illicit-ecosystem-report",
    title: "Illicit Ecosystem Report",
    summary:
      "Map connected sites, infrastructure, certificates, identities, providers, social profiles, and evidence in piracy or other illicit ecosystems.",
    useWhen:
      "Use this template when repeatable entity inventories and relationships are central to the investigation, especially for piracy networks and delivery ecosystems.",
    workflow: [
      "Start each section in the narrative canvas. Use Edit details for compact metadata and Add to section for optional narratives, records, or project references.",
      "Turn unanswered questions into linked intelligence gaps and requirements, then build the timeline and ecosystem overview.",
      "Add identity, social-profile, site, infrastructure, certificate, relationship, media, and observable records one at a time; Cancel leaves the report unchanged.",
      "Insert existing STIX objects, ATT&CK observations, and encrypted Evidence where they add reusable project context; leave unsupported optional sections empty.",
      "Evidence selected in a structured record or inserted as an image is indexed once under Evidence index, with source metadata, analyst notes, citing sections, and the image itself when applicable.",
      "Review Empty, In progress, Ready, and Not applicable states, then publish with the release version and TLP handling marking. Empty content disappears from the output and table of contents.",
    ],
    fieldGuidance: [
      "Administration: Sheut generates the project-local Report ID; authors are people and Producing organisation is the accountable team. The cover and publication snapshot control title, release version, TLP marking, and publication status.",
      "Methodology: distinguish facts, source reporting, independent corroboration, technical observations, evidence preservation, limitations, and confidence definitions.",
      "Analysis: keep assessment, intelligence gaps, requirements, and recommendations distinct. Do not merge an alleged identity with an OSINT match or a recommended financial inquiry with a current finding.",
      "Relationships: state source, relationship, target, basis, confidence, corroboration, and evidence. Graph links remain visual unless explicitly validated as STIX relationships.",
      "Evidence appendix: use Evidence analysis and explanatory figures for analyst-authored context, image captions, or an exported STIX graph view. The graph explains the model but does not prove a relationship; cite the supporting Evidence separately.",
      "Publication: empty structured columns disappear; short comparable records remain tables, while dense intelligence records become readable labelled cards instead of tiny wide tables.",
      "ATT&CK and detections are conditional and may be marked Not applicable. Leave them empty unless the behavior or rule is defensible; no empty heading is published.",
      "Readiness recommendations are advisory. Publishing lists missing recommended content for confirmation, while malformed supplied values and an empty title remain hard errors.",
    ],
    fieldExamples: illicitEcosystemFieldExamples,
  },
];

export function reportFieldProjectSource(field: string): string {
  const value = field.toLocaleLowerCase("en");
  if (value.includes("attack") || value.includes("technique")) {
    return "MITRE ATT&CK: record the technique observation and explanation in MITRE, then use Insert project data. Sheut inserts the technique ID, name, and explanation.";
  }
  if (
    value.startsWith("sites — domain") ||
    value.startsWith("site inventory — domain") ||
    value.includes("profile link") ||
    value.includes("url or platform identifier")
  ) {
    return "Create in Intelligence as Domain Name or URL, save the local STIX draft, then use Insert project data in this table cell.";
  }
  if (value.startsWith("infrastructure — ip") || value.includes("ip address or host")) {
    return "Create the observable in Intelligence as IPv4 Address, IPv6 Address, or Domain Name; use Infrastructure for the hosting resource when needed.";
  }
  if (value.includes("— asn")) {
    return "Create in Intelligence as Autonomous System, including the ASN and organization name, then insert it into the cell.";
  }
  if (value.startsWith("infrastructure — cloud") || value.endsWith("— provider")) {
    return "Create the hosting resource as Infrastructure and the provider organization as Identity when both matter; relationships require a separate explicit STIX Relationship draft.";
  }
  if (value.startsWith("infrastructure — country") || value.endsWith("— location")) {
    return "Create a Location object only when the location is reusable intelligence; otherwise enter the sourced location manually.";
  }
  if (value.includes("certificate")) {
    return "Create in Intelligence as X.509 Certificate. Insert its fingerprint or human-readable name; do not paste the internal STIX ID into the report.";
  }
  if (
    value.startsWith("identities — name") ||
    value.startsWith("identities and roles — identifier") ||
    value.startsWith("identities and roles — name") ||
    value.startsWith("social profiles — handle")
  ) {
    return "Create in Intelligence as Identity or User Account. Use Threat Actor only for an assessed malicious actor, not every online handle.";
  }
  if (value.startsWith("identities — linked") || value.startsWith("social profiles — linked")) {
    return "Create each entity first in Intelligence. If interchange needs the link, create and validate an explicit STIX Relationship; a graph line alone is not STIX.";
  }
  if (
    value.startsWith("relationships and evidence") ||
    value.startsWith("relationships and supporting evidence")
  ) {
    return "Create the source and target objects in Intelligence. Keep the report row human-readable; create a STIX Relationship draft separately only when the relationship is validated for interchange.";
  }
  if (
    value.startsWith("media and file evidence") ||
    value.startsWith("evidence index") ||
    value === "evidence notes" ||
    value === "referenced project evidence" ||
    value.endsWith("— evidence") ||
    value === "evidence image or link"
  ) {
    return "Import or select the encrypted file in Evidence, then insert its project reference. A file is not automatically a STIX Artifact; create Artifact or File only when STIX interchange requires it.";
  }
  if (value.startsWith("malware and host artifacts — name")) {
    return "Create Malware or Tool for named software; use File, Artifact, Process, or another observable for the concrete host artifact.";
  }
  if (value.startsWith("malware and host artifacts")) {
    return "Create the matching STIX observable in Intelligence, such as File, Artifact, Process, Mutex, Directory, or Windows Registry Key, then insert the readable value.";
  }
  if (value.startsWith("network indicators")) {
    return "Create the underlying Domain Name, URL, IPv4/IPv6 Address, Email Address, or Network Traffic observable. Create an Indicator only when you have a detection pattern and validity period.";
  }
  if (value.startsWith("vulnerabilities")) {
    return "Create a Vulnerability draft in Intelligence with the CVE and description; keep patch status and local remediation as report context.";
  }
  if (value.startsWith("detections and signatures")) {
    return "Create an Indicator when the rule has a STIX, Sigma, Snort, Suricata, YARA, or supported pattern. Otherwise cite the detection as Evidence or a Note.";
  }
  if (value === "actor name" || value === "attribution" || value.startsWith("aliases —")) {
    return "Create a Threat Actor or Intrusion Set draft in Intelligence, fill its name and aliases, then insert the human-readable label where appropriate.";
  }
  if (value === "campaign name") {
    return "Create a Campaign draft in Intelligence when the campaign is reusable project intelligence; otherwise keep the name local to this report.";
  }
  if (value === "intrusion name") {
    return "Create an Incident draft in Intelligence when the intrusion should be exchanged as STIX; otherwise keep the incident name as report metadata.";
  }
  if (value.startsWith("victims — victim")) {
    return "Create the victim as Identity when it is appropriate to retain and exchange it. Use an anonymized report label when identity disclosure is unnecessary.";
  }
  if (value === "referenced project data") {
    return "Use Insert project data to select existing STIX objects, local STIX drafts, Evidence, documents, or MITRE observations.";
  }
  if (value.startsWith("data sources —")) {
    return "Cite the source manually or insert an Evidence item, Report, Note, or Identity from project data when one already represents the source.";
  }
  if (value.endsWith("— source")) {
    return "Cite the Evidence, Report, Note, Identity, or source document that supports the row; create STIX only when the source itself is reusable intelligence.";
  }
  if (
    value.includes("first seen") ||
    value.includes("last seen") ||
    value.includes("first reported") ||
    value.includes("last reported") ||
    value.includes("valid from") ||
    value.includes("valid until") ||
    value.includes("captured at") ||
    value.endsWith("— date") ||
    value.endsWith("— time")
  ) {
    return "Use the sourced timestamp from the entity, Observed Data, Sighting, or Evidence capture. Do not create a separate STIX object only for this date.";
  }
  if (
    value.endsWith("— status") ||
    value.endsWith("— category") ||
    value.endsWith("— role") ||
    value.includes("intrusion phase") ||
    value.includes("patch available") ||
    value.includes("patch applied") ||
    value.endsWith("— remediation")
  ) {
    return "Report-specific context: enter manually from the cited evidence. Do not create a STIX object solely to fill this cell.";
  }
  if (value === "document title" || value === "report title" || value === "report number") {
    return "Report metadata: enter manually. It is not a STIX object ID.";
  }
  if (
    value === "publication date" ||
    value === "authors" ||
    value === "version" ||
    value === "criticality" ||
    value === "timeframe" ||
    value.includes("confidence")
  ) {
    return "Report metadata or assessment: enter manually. It remains canonical report content rather than a STIX object.";
  }
  return "Enter report prose or a reader-facing value manually. Use Insert project data only when an existing STIX object, draft, Evidence item, document, or MITRE observation supports the field.";
}
