use std::collections::{BTreeMap, HashSet};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{
    DomainError, DomainErrorCode, ImageMediaType, LocalId, MAX_EVIDENCE_FILE_BYTES,
    MAX_IMAGE_ATTACHMENT_BYTES, Revision, bounded_text, is_supported_evidence_media_type,
};

const CONTRACT_SCHEMA_VERSION: u16 = 1;
const MAX_REPORT_TITLE_CHARS: usize = 200;
const MAX_FIELD_TEXT_CHARS: usize = 100_000;
const MAX_REPORT_FIELDS: usize = 256;
const MAX_REPEATABLE_ROWS: usize = 2_000;
const MAX_INCLUDED_ITEMS: usize = 256;
const MAX_BRAND_TEXT_CHARS: usize = 500;
const MAX_EVIDENCE_FILE_NAME_CHARS: usize = 255;
const MAX_EVIDENCE_TITLE_CHARS: usize = 200;
const MAX_EVIDENCE_SOURCE_CHARS: usize = 500;
const MAX_EVIDENCE_URL_CHARS: usize = 4_096;
const MAX_EVIDENCE_TAGS: usize = 32;
const MAX_EVIDENCE_TAG_CHARS: usize = 64;
const MAX_OUTPUT_FILE_NAME_CHARS: usize = 255;
const MAX_OUTPUT_LOCATION_CHARS: usize = 4_096;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BuiltinReportTemplate {
    ThreatActorProfile,
    IntrusionAnalysis,
    CampaignReport,
    ExecutiveReport,
    BlankGuidedReport,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportFieldKind {
    ShortText,
    LongText,
    Narrative,
    Date,
    Confidence,
    Choice,
    ProjectReferences,
    RepeatableRows,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportTemplateField {
    key: String,
    label: String,
    help_text: Option<String>,
    kind: ReportFieldKind,
    required: bool,
    columns: Vec<String>,
    #[serde(default)]
    options: Vec<String>,
}

impl ReportTemplateField {
    fn new(
        key: &str,
        label: &str,
        kind: ReportFieldKind,
        required: bool,
        columns: &[&str],
    ) -> Self {
        Self {
            key: key.to_owned(),
            label: label.to_owned(),
            help_text: None,
            kind,
            required,
            columns: columns.iter().map(|column| (*column).to_owned()).collect(),
            options: Vec::new(),
        }
    }

    fn with_help_text(mut self, help_text: &str) -> Self {
        self.help_text = Some(help_text.to_owned());
        self
    }

    fn with_options(mut self, options: &[&str]) -> Self {
        self.options = options.iter().map(|option| (*option).to_owned()).collect();
        self
    }

    #[must_use]
    pub fn key(&self) -> &str {
        &self.key
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }

    #[must_use]
    pub const fn kind(&self) -> ReportFieldKind {
        self.kind
    }

    #[must_use]
    pub const fn required(&self) -> bool {
        self.required
    }

    #[must_use]
    pub fn columns(&self) -> &[String] {
        &self.columns
    }

    #[must_use]
    pub fn help_text(&self) -> Option<&str> {
        self.help_text.as_deref()
    }

    #[must_use]
    pub fn options(&self) -> &[String] {
        &self.options
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReportTemplateSection {
    key: String,
    title: String,
    optional: bool,
    #[serde(default)]
    guidance: Option<String>,
    fields: Vec<ReportTemplateField>,
}

impl ReportTemplateSection {
    fn new(key: &str, title: &str, optional: bool, fields: Vec<ReportTemplateField>) -> Self {
        Self {
            key: key.to_owned(),
            title: title.to_owned(),
            optional,
            guidance: None,
            fields,
        }
    }

    fn with_guidance(mut self, guidance: &str) -> Self {
        self.guidance = Some(guidance.to_owned());
        self
    }

    #[must_use]
    pub fn key(&self) -> &str {
        &self.key
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub const fn optional(&self) -> bool {
        self.optional
    }

    #[must_use]
    pub fn guidance(&self) -> Option<&str> {
        self.guidance.as_deref()
    }

    #[must_use]
    pub fn fields(&self) -> &[ReportTemplateField] {
        &self.fields
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReportTemplateDefinition {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    builtin: Option<BuiltinReportTemplate>,
    name: String,
    description: String,
    sections: Vec<ReportTemplateSection>,
}

#[derive(Deserialize)]
struct ReportTemplateDefinitionWire {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    builtin: Option<BuiltinReportTemplate>,
    name: String,
    description: String,
    sections: Vec<ReportTemplateSection>,
}

impl<'de> Deserialize<'de> for ReportTemplateDefinition {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = ReportTemplateDefinitionWire::deserialize(deserializer)?;
        Self::restore(
            wire.schema_version,
            wire.id,
            wire.revision,
            wire.builtin,
            wire.name,
            wire.description,
            wire.sections,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl ReportTemplateDefinition {
    pub fn new_custom(
        id: LocalId,
        revision: Revision,
        name: impl AsRef<str>,
        description: impl AsRef<str>,
        sections: Vec<ReportTemplateSection>,
    ) -> Result<Self, DomainError> {
        Self::restore(
            CONTRACT_SCHEMA_VERSION,
            id,
            revision,
            None,
            name.as_ref().to_owned(),
            description.as_ref().to_owned(),
            sections,
        )
    }

    fn restore(
        schema_version: u16,
        id: LocalId,
        revision: Revision,
        builtin: Option<BuiltinReportTemplate>,
        name: String,
        description: String,
        sections: Vec<ReportTemplateSection>,
    ) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidReportTemplate;
        if schema_version != CONTRACT_SCHEMA_VERSION || sections.is_empty() || sections.len() > 64 {
            return Err(DomainError::new(code));
        }
        let name = bounded_text(&name, 120, code)?;
        let description = bounded_text(&description, 500, code)?;
        let mut section_keys = HashSet::new();
        let mut field_keys = HashSet::new();
        let mut field_count = 0usize;
        for section in &sections {
            validate_key(&section.key, code)?;
            bounded_text(&section.title, 120, code)?;
            if let Some(guidance) = &section.guidance {
                bounded_text(guidance, 2_000, code)?;
            }
            if !section_keys.insert(section.key.as_str()) || section.fields.is_empty() {
                return Err(DomainError::new(code));
            }
            field_count = field_count.saturating_add(section.fields.len());
            for field in &section.fields {
                validate_key(&field.key, code)?;
                bounded_text(&field.label, 120, code)?;
                if let Some(help_text) = &field.help_text {
                    bounded_text(help_text, 2_000, code)?;
                }
                if !field_keys.insert(field.key.as_str())
                    || (field.kind == ReportFieldKind::RepeatableRows && field.columns.is_empty())
                    || (field.kind != ReportFieldKind::RepeatableRows && !field.columns.is_empty())
                    || (field.kind == ReportFieldKind::Choice && field.options.is_empty())
                    || (field.kind != ReportFieldKind::Choice && !field.options.is_empty())
                {
                    return Err(DomainError::new(code));
                }
                for column in &field.columns {
                    bounded_text(column, 80, code)?;
                }
                let mut options = HashSet::new();
                for option in &field.options {
                    bounded_text(option, 80, code)?;
                    if !options.insert(option.as_str()) {
                        return Err(DomainError::new(code));
                    }
                }
            }
        }
        if field_count > MAX_REPORT_FIELDS {
            return Err(DomainError::new(code));
        }
        Ok(Self {
            schema_version,
            id,
            revision,
            builtin,
            name,
            description,
            sections,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub const fn builtin(&self) -> Option<BuiltinReportTemplate> {
        self.builtin
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub fn description(&self) -> &str {
        &self.description
    }

    #[must_use]
    pub fn sections(&self) -> &[ReportTemplateSection] {
        &self.sections
    }
}

#[must_use]
pub fn built_in_report_templates() -> Vec<ReportTemplateDefinition> {
    [
        BuiltinReportTemplate::ThreatActorProfile,
        BuiltinReportTemplate::IntrusionAnalysis,
        BuiltinReportTemplate::CampaignReport,
        BuiltinReportTemplate::ExecutiveReport,
        BuiltinReportTemplate::BlankGuidedReport,
    ]
    .into_iter()
    .map(built_in_template)
    .collect()
}

#[must_use]
pub fn report_template_catalog() -> Vec<ReportTemplateDefinition> {
    let mut templates = built_in_report_templates();
    templates.push(illicit_ecosystem_template_v4());
    templates
}

#[must_use]
pub fn report_template_revision(
    template_id: LocalId,
    revision: Revision,
) -> Option<ReportTemplateDefinition> {
    built_in_report_templates()
        .into_iter()
        .chain([
            illicit_ecosystem_template_v1(),
            illicit_ecosystem_template_v2(),
            illicit_ecosystem_template_v3(),
            illicit_ecosystem_template_v4(),
        ])
        .find(|template| template.id() == template_id && template.revision() == revision)
}

fn illicit_ecosystem_template_v1() -> ReportTemplateDefinition {
    let campaign = built_in_template(BuiltinReportTemplate::CampaignReport);
    let mut sections = campaign.sections;
    let insert_at = sections
        .iter()
        .position(|section| section.key == "campaign_metadata")
        .unwrap_or(sections.len());
    sections.splice(
        insert_at..insert_at,
        [
            section(
                "site_inventory",
                "Site inventory",
                true,
                vec![rows(
                    "site_inventory",
                    "Sites",
                    &[
                        "Domain or site",
                        "Category",
                        "First seen",
                        "Last seen",
                        "Status",
                        "Linked identity",
                        "Provider",
                    ],
                )],
            ),
            section(
                "infrastructure",
                "Infrastructure",
                true,
                vec![rows(
                    "infrastructure",
                    "Infrastructure",
                    &[
                        "IP or host",
                        "ASN",
                        "Cloud or hosting provider",
                        "Country",
                        "Certificate",
                        "First seen",
                        "Last seen",
                    ],
                )],
            ),
            section(
                "certificates",
                "Certificates",
                true,
                vec![rows(
                    "certificates",
                    "Certificates",
                    &[
                        "Fingerprint",
                        "Issuer",
                        "Common name and SANs",
                        "Valid from",
                        "Valid until",
                        "Reused sites",
                    ],
                )],
            ),
            section(
                "identities",
                "Identities",
                true,
                vec![rows(
                    "identities",
                    "Identities",
                    &[
                        "Name or handle",
                        "Role",
                        "Linked sites",
                        "Confidence",
                        "Source",
                    ],
                )],
            ),
            section(
                "social_profiles",
                "Social profiles",
                true,
                vec![rows(
                    "social_profiles",
                    "Social profiles",
                    &[
                        "Platform",
                        "Handle or display name",
                        "Profile link",
                        "Role",
                        "Linked identities or sites",
                        "Status",
                        "Confidence",
                        "Source",
                    ],
                )],
            ),
            section(
                "media_evidence",
                "Media and file evidence",
                true,
                vec![rows(
                    "media_evidence",
                    "Media and file evidence",
                    &[
                        "Evidence title",
                        "Type",
                        "Description",
                        "Source",
                        "Captured at",
                        "Evidence link",
                        "Backup file",
                        "SHA-256",
                    ],
                )],
            ),
            section(
                "relationships_evidence",
                "Relationships and evidence",
                true,
                vec![rows(
                    "relationships_evidence",
                    "Relationships and evidence",
                    &["Source", "Relationship", "Target", "Confidence", "Evidence"],
                )],
            ),
            section(
                "evidence_appendix",
                "Evidence appendix",
                true,
                vec![
                    narrative("evidence_notes", "Evidence notes", false),
                    references("evidence_references", "Referenced project evidence"),
                ],
            ),
        ],
    );
    ReportTemplateDefinition::new_custom(
        LocalId::parse("6fba43e4-fcac-5b12-b37a-17aa0d4e99ca")
            .expect("starter template id is valid"),
        Revision::new(1).expect("starter template revision is valid"),
        "Illicit Ecosystem Report",
        "Track piracy sites, identities, infrastructure, certificates and service providers.",
        sections,
    )
    .expect("illicit ecosystem starter template is valid")
}

fn illicit_ecosystem_template_v2() -> ReportTemplateDefinition {
    let previous = illicit_ecosystem_template_v1();
    ReportTemplateDefinition::new_custom(
        previous.id(),
        Revision::new(2).expect("illicit ecosystem revision is valid"),
        previous.name(),
        "Investigate connected illicit sites, actors, infrastructure, monetisation and evidence.",
        vec![
            section(
                "report_administration",
                "Report Administration",
                false,
                vec![
                    date("publication_date", "Report date", true),
                    long("authors", "Authors", true),
                    long("investigation_period", "Investigation period", true),
                    long("confidence_terminology", "Confidence terminology", true),
                    narrative("report_scope", "Report scope", true),
                ],
            ),
            section(
                "executive_summary",
                "Executive Summary",
                false,
                vec![narrative("executive_summary", "Executive summary", true)],
            ),
            section(
                "key_findings",
                "Key Findings",
                false,
                vec![narrative("key_findings", "Key findings", true)],
            ),
            section(
                "scope_methodology_source_handling",
                "Scope, Methodology and Source Handling",
                false,
                vec![
                    narrative("purpose_scope", "Purpose and scope", true),
                    narrative("osint_collection", "OSINT collection", false),
                    narrative("technical_observations", "Technical observations", false),
                    narrative("humint_collection", "HUMINT collection", false),
                    narrative(
                        "evidence_preservation",
                        "Evidence-preservation methods",
                        false,
                    ),
                    narrative(
                        "source_corroboration",
                        "Source reporting and independently corroborated facts",
                        false,
                    ),
                    narrative("limitations", "Limitations", false),
                    narrative("confidence_definitions", "Confidence definitions", false),
                ],
            ),
            section(
                "assessment",
                "Assessment",
                false,
                vec![
                    narrative("overall_assessment", "Overall assessment", true),
                    narrative(
                        "ecosystem_operating_model",
                        "Ecosystem operating model",
                        false,
                    ),
                    narrative(
                        "roles_responsibilities",
                        "Roles and responsibilities",
                        false,
                    ),
                    narrative(
                        "traffic_generation_model",
                        "Traffic-generation model",
                        false,
                    ),
                    narrative(
                        "advertising_monetisation",
                        "Advertising monetisation",
                        false,
                    ),
                    narrative(
                        "malicious_advertising_exposure",
                        "Malicious advertising and malware exposure",
                        false,
                    ),
                    narrative(
                        "australian_operational_nexus",
                        "Australian operational nexus",
                        false,
                    ),
                    narrative(
                        "government_employment_nexus",
                        "Possible government-employment nexus",
                        false,
                    ),
                    narrative(
                        "knowledge_consent_intent",
                        "Knowledge, consent and intent",
                        false,
                    ),
                    narrative("financial_involvement", "Financial involvement", false),
                    confidence("overall_confidence", "Overall confidence", true),
                    narrative(
                        "alternative_explanations",
                        "Alternative explanations",
                        false,
                    ),
                ],
            ),
            section(
                "intelligence_gaps",
                "Key Intelligence Gaps",
                true,
                vec![rows(
                    "intelligence_gaps",
                    "Key intelligence gaps",
                    &["Gap ID", "Intelligence gap", "Why it matters", "Status"],
                )],
            ),
            section(
                "intelligence_requirements",
                "Intelligence Requirements",
                true,
                vec![rows(
                    "intelligence_requirements",
                    "Intelligence requirements",
                    &[
                        "Requirement ID",
                        "Requirement",
                        "Linked gap",
                        "Priority",
                        "Status",
                        "Owner",
                    ],
                )],
            ),
            section(
                "timeline",
                "Timeline of Activity",
                true,
                vec![rows(
                    "timeline",
                    "Timeline of activity",
                    &[
                        "Date or time",
                        "Date precision",
                        "Provenance",
                        "Event",
                        "Source or evidence",
                    ],
                )],
            ),
            section(
                "ecosystem_actor_overview",
                "Ecosystem and Actor Overview",
                true,
                vec![
                    narrative(
                        "ecosystem_actor_overview",
                        "Ecosystem and actor overview",
                        false,
                    ),
                    rows(
                        "ecosystem_entities",
                        "Entities and assessed roles",
                        &[
                            "Entity",
                            "Entity type",
                            "Known or alleged role",
                            "Known relationships",
                            "Assessment basis",
                            "Confidence",
                            "Evidence",
                        ],
                    ),
                    narrative(
                        "ecosystem_relationship_diagram",
                        "Relationship diagram and explanation",
                        false,
                    ),
                ],
            ),
            section(
                "identities_roles",
                "Identities and Roles",
                true,
                vec![rows(
                    "identities_roles",
                    "Identities and roles",
                    &[
                        "Identifier or pseudonym",
                        "Supported real name",
                        "Reported role",
                        "Observed role",
                        "Attribution source",
                        "Confidence",
                        "Corroboration",
                        "Known relationships",
                        "Unresolved questions",
                    ],
                )],
            ),
            section(
                "social_profiles",
                "Social Profiles",
                true,
                vec![rows(
                    "social_profiles",
                    "Social profiles",
                    &[
                        "Platform",
                        "Handle",
                        "URL or platform identifier",
                        "First observed",
                        "Last observed",
                        "Purpose",
                        "Linked websites",
                        "Linked identities",
                        "Relevant activity",
                        "Preservation status",
                        "Common-control confidence",
                    ],
                )],
            ),
            section(
                "site_inventory",
                "Site Inventory",
                true,
                vec![rows(
                    "site_inventory",
                    "Site inventory",
                    &[
                        "Domain",
                        "Observed purpose",
                        "First observed",
                        "Last observed",
                        "Current status",
                        "Registrant information",
                        "Hosting",
                        "Advertising services",
                        "Redirect behaviour",
                        "Linked profiles",
                        "Malicious or deceptive activity",
                        "Evidence references",
                    ],
                )],
            ),
            section(
                "infrastructure_certificates",
                "Infrastructure and Certificates",
                true,
                vec![
                    rows(
                        "infrastructure",
                        "Infrastructure",
                        &[
                            "IP address or host",
                            "ASN",
                            "Hosting provider",
                            "DNS or passive DNS",
                            "Redirector",
                            "Analytics or advertising ID",
                            "Shared infrastructure",
                            "First seen",
                            "Last seen",
                            "Migration notes",
                        ],
                    ),
                    rows(
                        "certificates",
                        "Certificates",
                        &[
                            "Fingerprint",
                            "Subject and SANs",
                            "Issuer",
                            "Valid from",
                            "Valid until",
                            "Shared certificates",
                            "Infrastructure pivots",
                            "Evidentiary relevance",
                        ],
                    ),
                ],
            ),
            section(
                "relationships_supporting_evidence",
                "Relationships and Supporting Evidence",
                true,
                vec![rows(
                    "relationships_supporting_evidence",
                    "Relationships and supporting evidence",
                    &[
                        "Source",
                        "Relationship",
                        "Target",
                        "Basis",
                        "Confidence",
                        "Corroboration status",
                        "Supporting evidence",
                    ],
                )],
            ),
            section(
                "media_file_evidence",
                "Media and File Evidence",
                true,
                vec![
                    rows(
                        "media_file_evidence",
                        "Media and file evidence",
                        &[
                            "Evidence ID",
                            "Title",
                            "Type",
                            "Original filename",
                            "Collection date",
                            "Preservation status",
                            "SHA-256",
                            "Source or link",
                            "Notes",
                        ],
                    ),
                    references("media_evidence_references", "Referenced project evidence"),
                ],
            ),
            section(
                "indicators_observables",
                "Indicators and Observables",
                true,
                vec![
                    rows(
                        "indicators_observables",
                        "Indicators and observables",
                        &[
                            "Type",
                            "Value",
                            "Classification",
                            "Context",
                            "First observed",
                            "Last observed",
                            "Status",
                            "Evidence",
                        ],
                    ),
                    references("observable_references", "Referenced project observables"),
                ],
            ),
            section(
                "attack_mappings",
                "MITRE ATT&CK Mapping",
                true,
                vec![
                    rows(
                        "attack_mappings",
                        "MITRE ATT&CK mapping",
                        &["Technique ID", "Technique name", "Explanation"],
                    ),
                    references("technique_references", "Referenced ATT&CK techniques"),
                ],
            ),
            section(
                "detections",
                "Detections and Signatures",
                true,
                vec![rows(
                    "detections",
                    "Detections and signatures",
                    &[
                        "Detection type",
                        "Name",
                        "Rule or logic",
                        "Data source",
                        "Validation status",
                        "Reference",
                    ],
                )],
            ),
            section(
                "recommended_actions",
                "Recommended Actions",
                false,
                vec![narrative(
                    "recommended_actions",
                    "Recommended actions",
                    true,
                )],
            ),
            section(
                "evidence_appendix",
                "Evidence Appendix",
                true,
                vec![
                    rows(
                        "evidence_index",
                        "Evidence index",
                        &[
                            "Evidence ID",
                            "Description",
                            "Source",
                            "Collected",
                            "SHA-256",
                            "Appendix reference",
                        ],
                    ),
                    narrative("chain_of_custody", "Chain-of-custody notes", false),
                    references(
                        "appendix_evidence_references",
                        "Referenced project evidence",
                    ),
                ],
            ),
        ],
    )
    .expect("illicit ecosystem investigation template is valid")
}

fn illicit_ecosystem_template_v3() -> ReportTemplateDefinition {
    let previous = illicit_ecosystem_template_v2();
    ReportTemplateDefinition::new_custom(
        previous.id(),
        Revision::new(3).expect("illicit ecosystem revision is valid"),
        previous.name(),
        "Assess complex illicit ecosystems using source-aware analysis, structured entities, infrastructure and preserved evidence.",
        vec![
            guided_section(
                "report_administration",
                "Report Administration",
                false,
                "Record the scope and accountability metadata for this investigation. The cover title, release version and handling marking are controlled by the report title and publication snapshot, not repeated narrative.",
                vec![
                    helped(
                        short("report_number", "Report ID", true),
                        "A project-local identifier generated when the report is created, for example IER-0001. Change it only when an external numbering policy requires a different identifier.",
                    ),
                    date("publication_date", "Report date", true),
                    long("authors", "Authors or producing organisation", true),
                    long("producing_organization", "Producing organisation", false),
                    helped(
                        choice(
                            "report_status",
                            "Report status",
                            true,
                            &["Draft", "For review", "Final", "Superseded"],
                        ),
                        "The analytical lifecycle state of this report; publication status remains an immutable publication choice.",
                    ),
                    long("investigation_period", "Investigation period", true),
                    confidence("overall_confidence", "Overall confidence", true),
                    long("confidence_terminology", "Confidence terminology", true),
                    long("geographic_scope", "Geographic scope", false),
                    long("project_identifiers", "Investigation or project identifiers", false),
                    helped(
                        narrative("report_scope", "Report scope", true),
                        "State the subject, questions, jurisdictions, collection boundaries and explicit exclusions.",
                    ),
                    rows(
                        "additional_metadata",
                        "Additional metadata",
                        &["Label", "Value"],
                    ),
                ],
            ),
            guided_section(
                "executive_summary",
                "Executive Summary",
                false,
                "Write a two- or three-paragraph BLUF covering what is happening, why it matters, who or what is affected, the primary caveat and the action the recipient should consider. Do not reproduce inventories or source histories.",
                vec![helped(
                    narrative("executive_summary", "Executive Summary", true),
                    "Answer what is happening, why it matters, who or what is affected and what action the recipient should consider.",
                )],
            ),
            guided_section(
                "key_findings",
                "Key Findings",
                false,
                "State concise supported judgments. Separate observations, source reporting, corroborated facts and analysis; do not present an intelligence gap, recommendation or unsupported allegation as a finding.",
                vec![
                    narrative("key_findings", "Key Findings", true),
                    rows(
                        "finding_items",
                        "Structured findings",
                        &[
                            "Finding",
                            "Assessment confidence",
                            "Basis or source type",
                            "Corroboration status",
                            "Project-data references",
                            "Evidence references",
                        ],
                    ),
                ],
            ),
            guided_section(
                "scope_methodology_source_handling",
                "Scope, Methodology and Source Handling",
                false,
                "Explain the purpose, collection period, methods, preservation, analytical standards, limitations and source protections. A source statement remains source reporting even when the source claims direct access or participation.",
                vec![
                    narrative(
                        "purpose_scope",
                        "Scope, Methodology and Source Handling",
                        true,
                    ),
                    narrative("osint_collection", "OSINT collection", false),
                    narrative("technical_observations", "Technical observations", false),
                    narrative("humint_collection", "HUMINT or human-source reporting", false),
                    narrative("documentary_evidence", "Documentary and digital evidence", false),
                    narrative("evidence_preservation", "Evidence-preservation methods", false),
                    narrative(
                        "source_corroboration",
                        "Source handling and corroboration",
                        false,
                    ),
                    narrative("limitations", "Limitations", false),
                    narrative("confidence_definitions", "Confidence definitions", false),
                    narrative("analytical_standards", "Analytical standards", false),
                    rows(
                        "data_sources",
                        "Structured source records",
                        &[
                            "Source",
                            "Source type",
                            "Reference",
                            "Collected or accessed",
                            "Reporting status",
                            "Corroboration",
                            "Limitations",
                        ],
                    ),
                    references("methodology_references", "Methodology and source references"),
                ],
            ),
            guided_section(
                "assessment",
                "Assessment",
                false,
                "Connect the evidence into reasoned judgments and implications. Identify assumptions, incomplete information and competing explanations; do not merely repeat Key Findings.",
                vec![
                    narrative("overall_assessment", "Assessment", true),
                    narrative("ecosystem_operating_model", "Ecosystem operating model", false),
                    narrative("roles_responsibilities", "Actor roles", false),
                    narrative("traffic_generation_model", "Traffic-generation methods", false),
                    narrative("advertising_monetisation", "Monetisation", false),
                    narrative(
                        "malicious_advertising_exposure",
                        "Malicious advertising or malware exposure",
                        false,
                    ),
                    narrative(
                        "australian_operational_nexus",
                        "Jurisdictional and operational nexuses",
                        false,
                    ),
                    narrative(
                        "government_employment_nexus",
                        "Possible employment or organisation nexus",
                        false,
                    ),
                    narrative("knowledge_consent_intent", "Knowledge and intent", false),
                    narrative("financial_involvement", "Financial relationships", false),
                    narrative(
                        "infrastructure_resilience",
                        "Infrastructure resilience and migration",
                        false,
                    ),
                    narrative("alternative_explanations", "Competing explanations", false),
                    narrative("assessment_implications", "Implications", false),
                ],
            ),
            guided_section(
                "intelligence_gaps",
                "Key Intelligence Gaps",
                true,
                "Record material unknowns that prevent stronger judgments. Write each gap as an unknown, not as an instruction or recommendation.",
                vec![
                    narrative(
                        "legacy_intelligence_gaps",
                        "Legacy intelligence gaps narrative",
                        false,
                    ),
                    rows(
                        "intelligence_gaps",
                        "Intelligence gaps",
                        &["Gap ID", "Unknown", "Why it matters", "Status", "Related finding"],
                    ),
                ],
            ),
            guided_section(
                "intelligence_requirements",
                "Intelligence Requirements",
                true,
                "Turn gaps into specific, answerable collection questions. A requirement is not an established finding.",
                vec![rows(
                    "intelligence_requirements",
                    "Intelligence requirements",
                    &[
                        "Requirement ID",
                        "Priority",
                        "Question",
                        "Rationale",
                        "Related intelligence gap",
                        "Required data or collection source",
                        "Status",
                        "Answer or resolution",
                        "Related evidence",
                    ],
                )],
            ),
            guided_section(
                "timeline",
                "Timeline of Activity",
                true,
                "Record events chronologically and distinguish exact, approximate, analyst-observed and source-reported dates. Do not present uncertain timing as exact.",
                vec![rows(
                    "timeline",
                    "Timeline",
                    &[
                        "Date and time",
                        "Timezone",
                        "Precision or certainty",
                        "Event",
                        "Event type",
                        "Provenance",
                        "Related entities",
                        "Related infrastructure",
                        "Source references",
                        "Evidence references",
                    ],
                )],
            ),
            guided_section(
                "ecosystem_actor_overview",
                "Ecosystem and Actor Overview",
                true,
                "Orient the reader before detailed inventories by summarising central actors, collaborators, facilitators, sites, services, infrastructure and significant jurisdictional links. Association does not establish control.",
                vec![
                    narrative("ecosystem_actor_overview", "Ecosystem and Actor Overview", false),
                    rows(
                        "ecosystem_entities",
                        "Actors and ecosystem entities",
                        &[
                            "Entity",
                            "Entity type",
                            "Known, alleged or assessed role",
                            "Relationships",
                            "Jurisdictional links",
                            "Assessment basis",
                            "Confidence",
                            "Evidence",
                        ],
                    ),
                    references("ecosystem_project_references", "Ecosystem project-data references"),
                    narrative(
                        "ecosystem_relationship_diagram",
                        "Relationship diagram and explanation",
                        false,
                    ),
                ],
            ),
            guided_section(
                "identities_roles",
                "Identities and Roles",
                true,
                "Keep alleged, observed and assessed identities or roles distinct. A possible OSINT match must not silently become a confirmed identity.",
                vec![rows(
                    "identities_roles",
                    "Identities and roles",
                    &[
                        "Name, alias or identifier",
                        "Identity type",
                        "Alleged, observed or assessed role",
                        "Source of attribution",
                        "Confidence",
                        "Corroboration status",
                        "Associated accounts",
                        "Associated websites",
                        "Associated infrastructure",
                        "Relationships",
                        "Jurisdiction",
                        "Possible employment or organisation",
                        "Evidence references",
                        "Unresolved questions",
                    ],
                )],
            ),
            guided_section(
                "social_profiles",
                "Social Profiles",
                true,
                "Record observed accounts and preservation status. Common promotion can establish common purpose without establishing common ownership or control.",
                vec![rows(
                    "social_profiles",
                    "Social profiles",
                    &[
                        "Platform",
                        "Handle",
                        "Profile URL or platform identifier",
                        "First observed",
                        "Last observed",
                        "Observed purpose",
                        "Linked identities",
                        "Linked websites",
                        "Relevant posts or comments",
                        "Control or ownership confidence",
                        "Current status",
                        "Preservation status",
                        "Evidence references",
                    ],
                )],
            ),
            guided_section(
                "site_inventory",
                "Site Inventory",
                true,
                "Catalogue sites and observed behaviour. Use neutral descriptions and support harmful, deceptive or control assessments with evidence.",
                vec![rows(
                    "site_inventory",
                    "Sites",
                    &[
                        "Domain or URL",
                        "Title or label",
                        "Purpose",
                        "First observed",
                        "Last observed",
                        "Current status",
                        "Linked identities",
                        "Linked profiles",
                        "Hosting and DNS",
                        "Advertising or analytics identifiers",
                        "Redirect behaviour",
                        "Observed harmful or deceptive content",
                        "Confidence",
                        "Evidence references",
                    ],
                )],
            ),
            guided_section(
                "infrastructure",
                "Infrastructure",
                true,
                "Document technical infrastructure and migrations. Shared hosting, DNS or identifiers are pivots and do not by themselves prove common control.",
                vec![rows(
                    "infrastructure",
                    "Infrastructure",
                    &[
                        "IP address or host",
                        "ASN",
                        "Hosting provider",
                        "DNS or passive DNS",
                        "Redirector",
                        "Remote-access infrastructure",
                        "Analytics or advertising identifier",
                        "Shared infrastructure",
                        "First observed",
                        "Last observed",
                        "Current status",
                        "Migration notes",
                        "Related sites and identities",
                        "Evidence references",
                    ],
                )],
            ),
            guided_section(
                "certificates",
                "Certificates",
                true,
                "Record certificate pivots and their analytical relevance. Reuse may support an association but does not automatically establish ownership.",
                vec![rows(
                    "certificates",
                    "Certificates",
                    &[
                        "Fingerprint",
                        "Subject",
                        "Subject alternative names",
                        "Issuer",
                        "Valid from",
                        "Valid until",
                        "First observed",
                        "Last observed",
                        "Linked domains or IP addresses",
                        "Shared-certificate pivots",
                        "Analytical relevance",
                        "Evidence references",
                    ],
                )],
            ),
            guided_section(
                "relationships_supporting_evidence",
                "Relationships and Supporting Evidence",
                true,
                "Explain why each relationship is asserted and distinguish observation, reporting, inference, correlation, allegation and dispute. Do not convert correlation into ownership, control, knowledge, intent or responsibility.",
                vec![rows(
                    "relationships_supporting_evidence",
                    "Relationships",
                    &[
                        "Source entity",
                        "Relationship type",
                        "Target entity",
                        "Direction",
                        "Relationship status",
                        "Basis",
                        "Confidence",
                        "First observed",
                        "Last observed",
                        "Source-reporting references",
                        "Technical references",
                        "Documentary evidence",
                        "Analyst narrative",
                    ],
                )],
            ),
            guided_section(
                "media_file_evidence",
                "Media and File Evidence",
                true,
                "Catalogue preserved screenshots, videos, messages, documents, archives and technical outputs. A source link is provenance; preserve the file when it is available.",
                vec![
                    rows(
                        "media_file_evidence",
                        "Media and file evidence",
                        &[
                            "Evidence ID",
                            "Title",
                            "Type",
                            "Original filename",
                            "SHA-256",
                            "Collection date",
                            "Source description or link",
                            "Preservation status",
                            "Analyst notes",
                        ],
                    ),
                    references("media_evidence_references", "Referenced project evidence"),
                ],
            ),
            guided_section(
                "indicators_observables",
                "Indicators and Observables",
                true,
                "Classify investigative observables separately from suspicious or malicious indicators. A piracy domain, account or advertising identifier is not automatically an indicator of compromise.",
                vec![
                    rows(
                        "indicators_observables",
                        "Indicators and observables",
                        &[
                            "Value",
                            "Type",
                            "Category",
                            "Confidence",
                            "First observed",
                            "Last observed",
                            "Context",
                            "Current status",
                            "Related entities",
                            "Evidence references",
                        ],
                    ),
                    references("observable_references", "Referenced project observables"),
                ],
            ),
            guided_section(
                "attack_mappings",
                "MITRE ATT&CK Mapping",
                true,
                "Map only behaviour that meaningfully corresponds to ATT&CK. Do not map general illicit activity, monetisation or association. The presence of remote-access software alone does not establish compromise.",
                vec![
                    rows(
                        "attack_mappings",
                        "ATT&CK mappings",
                        &["Technique ID", "Technique name", "Explanation"],
                    ),
                    references("technique_references", "Referenced ATT&CK or ATLAS observations"),
                ],
            ),
            guided_section(
                "detections",
                "Detections and Signatures",
                true,
                "Include only defensible and validated rules, signatures or hunting logic. A primarily investigative report may leave this section empty or mark it not applicable.",
                vec![rows(
                    "detections",
                    "Detections and signatures",
                    &[
                        "Detection type",
                        "Name",
                        "Rule, query or logic",
                        "Data source",
                        "Detection limitations",
                        "Validation status",
                        "Reference",
                    ],
                )],
            ),
            guided_section(
                "recommended_actions",
                "Recommended Actions",
                false,
                "Separate preservation, investigative, collection and defensive actions from findings. Requesting examination of an account, device or financial record does not imply that relevant activity is already established.",
                vec![
                    narrative("recommended_actions", "Recommended Actions", true),
                    rows(
                        "recommended_action_items",
                        "Structured recommendations",
                        &[
                            "Evidence track or target",
                            "Action",
                            "Priority",
                            "Intended recipient",
                            "Rationale",
                            "Related finding",
                            "Related intelligence requirement",
                            "Dependencies",
                            "Status",
                        ],
                    ),
                ],
            ),
            guided_section(
                "evidence_appendix",
                "Evidence Appendix",
                true,
                "Index supporting extracts, captures and technical records without duplicating full project evidence unnecessarily. Preserve deterministic appendix labels and chain-of-custody information.",
                vec![
                    rows(
                        "evidence_index",
                        "Evidence index",
                        &[
                            "Evidence ID",
                            "Description",
                            "Source",
                            "Collected",
                            "SHA-256",
                            "Preservation information",
                            "Appendix reference",
                        ],
                    ),
                    narrative("evidence_notes", "Evidence extracts and methodology details", false),
                    narrative("chain_of_custody", "Chain-of-custody notes", false),
                    references("appendix_evidence_references", "Referenced project evidence"),
                ],
            ),
        ],
    )
    .expect("illicit ecosystem report revision three is valid")
}

fn illicit_ecosystem_template_v4() -> ReportTemplateDefinition {
    let previous = illicit_ecosystem_template_v3();
    let id = previous.id;
    let name = previous.name;
    let mut sections = previous.sections;
    let administration = sections
        .iter_mut()
        .find(|section| section.key == "report_administration")
        .expect("revision three contains report administration");
    administration.guidance = Some(
        "Record accountable authorship, producing organisation, issue date, investigation scope and analytical confidence. The cover title, release version, handling marking and publication status are controlled by the report and immutable publication snapshot."
            .to_owned(),
    );
    administration
        .fields
        .retain(|field| field.key != "report_status");
    let authors = administration
        .fields
        .iter_mut()
        .find(|field| field.key == "authors")
        .expect("revision three contains authors");
    authors.label = "Authors".to_owned();
    authors.help_text = Some(
        "List the people responsible for the analysis; do not combine the organisation name into this field."
            .to_owned(),
    );
    let producing_organisation = administration
        .fields
        .iter_mut()
        .find(|field| field.key == "producing_organization")
        .expect("revision three contains producing organisation");
    producing_organisation.help_text = Some(
        "Name the accountable team or organisation separately from the individual authors."
            .to_owned(),
    );
    let evidence_notes = sections
        .iter_mut()
        .find(|section| section.key == "evidence_appendix")
        .and_then(|section| {
            section
                .fields
                .iter_mut()
                .find(|field| field.key == "evidence_notes")
        })
        .expect("revision three contains evidence notes");
    evidence_notes.label = "Evidence analysis and explanatory figures".to_owned();
    evidence_notes.help_text = Some(
        "Explain what an extract, image or graph shows and how it supports the assessment. The automatic Evidence index separately records the linked project evidence."
            .to_owned(),
    );

    ReportTemplateDefinition::new_custom(
        id,
        Revision::new(4).expect("illicit ecosystem revision is valid"),
        &name,
        "Assess complex illicit ecosystems with prose-first analysis, source-aware structured records and preserved evidence.",
        sections,
    )
    .expect("illicit ecosystem report revision four is valid")
}

fn built_in_template(kind: BuiltinReportTemplate) -> ReportTemplateDefinition {
    let (id, name, description, sections) = match kind {
        BuiltinReportTemplate::ThreatActorProfile => (
            "baf698fd-0ef2-5c93-93ec-b9ccf192341d",
            "Threat Actor Profile",
            "Describe an actor, its observed capabilities, targeting and confidence.",
            vec![
                section(
                    "executive_summary",
                    "Executive summary",
                    false,
                    vec![narrative("executive_summary", "Executive summary", true)],
                ),
                section(
                    "key_points",
                    "Key points",
                    false,
                    vec![narrative("key_points", "Key points", true)],
                ),
                section(
                    "assessment",
                    "Assessment",
                    false,
                    vec![
                        confidence("confidence", "Confidence", true),
                        narrative("assessment", "Assessment", true),
                    ],
                ),
                section(
                    "actor_summary",
                    "Threat actor summary",
                    false,
                    vec![
                        short("actor_name", "Actor name", true),
                        rows("aliases", "Aliases", &["Alias", "Source"]),
                        short("attribution", "Attribution", false),
                        short("motivation", "Motivation", false),
                        narrative("actor_summary", "Actor summary", true),
                    ],
                ),
                section(
                    "timeline",
                    "Timeline of activity",
                    true,
                    vec![rows(
                        "timeline",
                        "Timeline",
                        &["Date", "Activity", "Location", "Source"],
                    )],
                ),
                section(
                    "intelligence_gaps",
                    "Key intelligence gaps",
                    true,
                    vec![narrative("intelligence_gaps", "Intelligence gaps", false)],
                ),
                attack_mapping_section(),
                section(
                    "victims",
                    "Victims and targeting",
                    true,
                    vec![rows(
                        "victims",
                        "Victims",
                        &["Victim", "Sector", "Location", "First seen", "Source"],
                    )],
                ),
                indicators_section(),
                detections_section(),
                intelligence_requirements_section(),
                data_sources_section(),
                section(
                    "actor_metadata",
                    "Threat actor metadata",
                    false,
                    vec![
                        short("report_number", "Report ID", false),
                        date("publication_date", "Publication date", false),
                        short("authors", "Authors", false),
                        short("report_version", "Version", false),
                        short("criticality", "Criticality", false),
                    ],
                ),
            ],
        ),
        BuiltinReportTemplate::IntrusionAnalysis => (
            "ee1c45ea-bb58-5c03-af08-e7982ed854c5",
            "Intrusion Analysis",
            "Record the evidence, timeline, findings and scope of an intrusion.",
            vec![
                section(
                    "executive_summary",
                    "Executive summary",
                    false,
                    vec![
                        short("intrusion_name", "Intrusion name", true),
                        narrative("executive_summary", "Executive summary", true),
                    ],
                ),
                section(
                    "key_points",
                    "Key points",
                    false,
                    vec![narrative("key_points", "Key points", true)],
                ),
                section(
                    "indicator_analysis",
                    "Indicator analysis",
                    false,
                    vec![narrative("indicator_analysis", "Indicator analysis", true)],
                ),
                attack_mapping_section(),
                indicators_section(),
                detections_section(),
                intelligence_requirements_section(),
                data_sources_section(),
                section(
                    "incident_metadata",
                    "Incident metadata",
                    false,
                    vec![
                        short("report_number", "Report ID", false),
                        date("publication_date", "Publication date", false),
                        short("authors", "Authors", false),
                        short("report_version", "Version", false),
                        short("criticality", "Criticality", false),
                        rows(
                            "timeline",
                            "Incident timeline",
                            &["Time", "Event", "Evidence"],
                        ),
                        references("observables", "Referenced project data"),
                    ],
                ),
            ],
        ),
        BuiltinReportTemplate::CampaignReport => (
            "4c8680ad-3f8c-53df-b94d-405cb3dc231f",
            "Campaign Report",
            "Explain how a campaign changed over time and what defenders should do next.",
            vec![
                section(
                    "executive_summary",
                    "Executive summary",
                    false,
                    vec![narrative("executive_summary", "Executive summary", true)],
                ),
                section(
                    "key_points",
                    "Key points",
                    false,
                    vec![narrative("key_points", "Key points", true)],
                ),
                section(
                    "assessment",
                    "Assessment",
                    false,
                    vec![
                        confidence("confidence", "Confidence", true),
                        narrative("assessment", "Assessment", true),
                    ],
                ),
                section(
                    "intelligence_gaps",
                    "Key intelligence gaps",
                    true,
                    vec![narrative("intelligence_gaps", "Intelligence gaps", false)],
                ),
                attack_mapping_section(),
                section(
                    "timeline",
                    "Timeline of activity",
                    true,
                    vec![rows(
                        "timeline",
                        "Campaign timeline",
                        &["Date", "Activity", "Location", "Source"],
                    )],
                ),
                indicators_section(),
                detections_section(),
                intelligence_requirements_section(),
                data_sources_section(),
                section(
                    "campaign_metadata",
                    "Campaign metadata",
                    false,
                    vec![
                        short("campaign_name", "Campaign name", true),
                        short("report_number", "Report ID", false),
                        date("publication_date", "Publication date", false),
                        short("authors", "Authors", false),
                        short("report_version", "Version", false),
                        short("timeframe", "Timeframe", true),
                        short("attribution", "Attribution assessment", false),
                        short("criticality", "Criticality", false),
                    ],
                ),
            ],
        ),
        BuiltinReportTemplate::ExecutiveReport => (
            "8c3d3086-661a-52ee-94ad-1abf821a31b7",
            "Executive Report",
            "Communicate key judgements, business impact and decisions for leaders.",
            vec![
                section(
                    "executive_summary",
                    "Executive summary",
                    false,
                    vec![
                        short("report_title", "Report title", true),
                        short("report_number", "Report ID", false),
                        date("publication_date", "Publication date", false),
                        short("authors", "Authors", false),
                        short("report_version", "Version", false),
                        short("criticality", "Criticality", false),
                        narrative("executive_summary", "Executive summary", true),
                    ],
                ),
                section(
                    "key_points",
                    "Key points",
                    false,
                    vec![narrative("key_points", "Key points", true)],
                ),
                section(
                    "assessment",
                    "Assessment",
                    false,
                    vec![
                        confidence("confidence", "Confidence", true),
                        narrative("assessment", "Assessment", true),
                    ],
                ),
                section(
                    "outlook",
                    "Outlook",
                    true,
                    vec![narrative("outlook", "Outlook", false)],
                ),
                section(
                    "intelligence_gaps",
                    "Key intelligence gaps",
                    true,
                    vec![narrative("intelligence_gaps", "Intelligence gaps", false)],
                ),
                intelligence_requirements_section(),
                data_sources_section(),
            ],
        ),
        BuiltinReportTemplate::BlankGuidedReport => (
            "fd36ac41-e156-5996-a93a-989dafb94313",
            "Blank Guided Report",
            "Start with a title and a guided narrative section.",
            vec![section(
                "report",
                "Report",
                false,
                vec![
                    short("report_title", "Report title", true),
                    short("report_number", "Report ID", false),
                    date("publication_date", "Publication date", false),
                    short("authors", "Authors", false),
                    short("report_version", "Version", false),
                    narrative("content", "Narrative", true),
                ],
            )],
        ),
    };
    ReportTemplateDefinition::restore(
        CONTRACT_SCHEMA_VERSION,
        LocalId::parse(id).expect("built-in template id is valid"),
        Revision::new(1).expect("built-in revision is valid"),
        Some(kind),
        name.to_owned(),
        description.to_owned(),
        sections,
    )
    .expect("built-in template definition is valid")
}

fn section(
    key: &str,
    title: &str,
    optional: bool,
    fields: Vec<ReportTemplateField>,
) -> ReportTemplateSection {
    ReportTemplateSection::new(key, title, optional, fields)
}

fn guided_section(
    key: &str,
    title: &str,
    optional: bool,
    guidance: &str,
    fields: Vec<ReportTemplateField>,
) -> ReportTemplateSection {
    section(key, title, optional, fields).with_guidance(guidance)
}

fn field(key: &str, label: &str, kind: ReportFieldKind, required: bool) -> ReportTemplateField {
    ReportTemplateField::new(key, label, kind, required, &[])
}

fn short(key: &str, label: &str, required: bool) -> ReportTemplateField {
    field(key, label, ReportFieldKind::ShortText, required)
}

fn long(key: &str, label: &str, required: bool) -> ReportTemplateField {
    field(key, label, ReportFieldKind::LongText, required)
}

fn narrative(key: &str, label: &str, required: bool) -> ReportTemplateField {
    field(key, label, ReportFieldKind::Narrative, required)
}

fn date(key: &str, label: &str, required: bool) -> ReportTemplateField {
    field(key, label, ReportFieldKind::Date, required)
}

fn confidence(key: &str, label: &str, required: bool) -> ReportTemplateField {
    field(key, label, ReportFieldKind::Confidence, required)
}

fn choice(key: &str, label: &str, required: bool, options: &[&str]) -> ReportTemplateField {
    field(key, label, ReportFieldKind::Choice, required).with_options(options)
}

fn helped(field: ReportTemplateField, help_text: &str) -> ReportTemplateField {
    field.with_help_text(help_text)
}

fn references(key: &str, label: &str) -> ReportTemplateField {
    field(key, label, ReportFieldKind::ProjectReferences, false)
}

fn rows(key: &str, label: &str, columns: &[&str]) -> ReportTemplateField {
    ReportTemplateField::new(key, label, ReportFieldKind::RepeatableRows, false, columns)
}

fn attack_mapping_section() -> ReportTemplateSection {
    section(
        "attack_mappings",
        "MITRE ATT&CK mappings",
        true,
        vec![
            rows(
                "attack_mappings",
                "ATT&CK procedures",
                &[
                    "Attribution",
                    "Tactic",
                    "Technique",
                    "Sub-technique",
                    "Procedure",
                    "Defense",
                    "Control",
                ],
            ),
            references("techniques", "Techniques and project references"),
        ],
    )
}

fn indicators_section() -> ReportTemplateSection {
    section(
        "indicators",
        "Indicators of compromise",
        true,
        vec![
            rows(
                "malware_indicators",
                "Malware and host artifacts",
                &[
                    "Name",
                    "Type",
                    "Value",
                    "Description",
                    "First reported",
                    "Last reported",
                ],
            ),
            rows(
                "network_indicators",
                "Network indicators",
                &[
                    "Attribution",
                    "Artifact",
                    "Details",
                    "Intrusion phase",
                    "First reported",
                    "Last reported",
                ],
            ),
            rows(
                "vulnerabilities",
                "Vulnerabilities",
                &[
                    "CVE",
                    "CVSS",
                    "Patch available",
                    "Patch applied",
                    "Remediation",
                ],
            ),
        ],
    )
}

fn detections_section() -> ReportTemplateSection {
    section(
        "detections",
        "Detections and signatures",
        true,
        vec![rows(
            "detections",
            "Detections and signatures",
            &["Name", "Type", "Description", "Source"],
        )],
    )
}

fn intelligence_requirements_section() -> ReportTemplateSection {
    section(
        "intelligence_requirements",
        "Intelligence requirements",
        true,
        vec![rows(
            "intelligence_requirements",
            "Intelligence requirements",
            &["Requirement", "Status", "Priority", "Owner"],
        )],
    )
}

fn data_sources_section() -> ReportTemplateSection {
    section(
        "data_sources",
        "Data sources",
        false,
        vec![rows(
            "data_sources",
            "Data sources and citations",
            &["Source", "Type", "Reference", "Accessed"],
        )],
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectDataReferenceKind {
    Intelligence,
    Evidence,
    Document,
    CatalogReference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceFileMetadata {
    id: LocalId,
    revision: Revision,
    media_type: String,
    file_name: String,
    byte_len: u64,
    sha256: String,
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EvidenceMetadataInput {
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EvidenceFileMetadataWire {
    id: LocalId,
    revision: Revision,
    media_type: String,
    file_name: String,
    byte_len: u64,
    sha256: String,
    title: String,
    description: String,
    source: String,
    captured_at: Option<String>,
    source_url: String,
    tags: Vec<String>,
    analyst_notes: String,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for EvidenceFileMetadata {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = EvidenceFileMetadataWire::deserialize(deserializer)?;
        Self::from_parts(
            wire.id,
            wire.revision,
            wire.media_type,
            wire.file_name,
            wire.byte_len,
            wire.sha256,
            EvidenceMetadataInput {
                title: wire.title,
                description: wire.description,
                source: wire.source,
                captured_at: wire.captured_at,
                source_url: wire.source_url,
                tags: wire.tags,
                analyst_notes: wire.analyst_notes,
            },
            wire.created_at_unix_ms,
            wire.updated_at_unix_ms,
        )
        .map_err(serde::de::Error::custom)
    }
}

impl EvidenceFileMetadata {
    pub fn new(
        id: LocalId,
        media_type: impl AsRef<str>,
        file_name: impl AsRef<str>,
        byte_len: u64,
        sha256: impl AsRef<str>,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let title = file_name.as_ref().to_owned();
        Self::from_parts(
            id,
            Revision::new(1)?,
            media_type,
            file_name,
            byte_len,
            sha256,
            EvidenceMetadataInput {
                title,
                description: String::new(),
                source: String::new(),
                captured_at: None,
                source_url: String::new(),
                tags: Vec::new(),
                analyst_notes: String::new(),
            },
            created_at_unix_ms,
            created_at_unix_ms,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn from_parts(
        id: LocalId,
        revision: Revision,
        media_type: impl AsRef<str>,
        file_name: impl AsRef<str>,
        byte_len: u64,
        sha256: impl AsRef<str>,
        metadata: EvidenceMetadataInput,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let media_type = media_type.as_ref();
        let file_name = bounded_text(
            file_name.as_ref(),
            MAX_EVIDENCE_FILE_NAME_CHARS,
            DomainErrorCode::InvalidAttachment,
        )?;
        let sha256 = sha256.as_ref();
        if file_name == "."
            || file_name == ".."
            || file_name
                .chars()
                .any(|character| matches!(character, '/' | '\\'))
            || !is_supported_evidence_media_type(media_type)
            || !(1..=MAX_EVIDENCE_FILE_BYTES).contains(&byte_len)
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
            || created_at_unix_ms < 0
            || updated_at_unix_ms < created_at_unix_ms
        {
            return Err(DomainError::new(DomainErrorCode::InvalidAttachment));
        }
        let metadata = metadata.normalized()?;
        Ok(Self {
            id,
            revision,
            media_type: media_type.to_owned(),
            file_name,
            byte_len,
            sha256: sha256.to_ascii_lowercase(),
            title: metadata.title,
            description: metadata.description,
            source: metadata.source,
            captured_at: metadata.captured_at,
            source_url: metadata.source_url,
            tags: metadata.tags,
            analyst_notes: metadata.analyst_notes,
            created_at_unix_ms,
            updated_at_unix_ms,
        })
    }

    pub fn updated(
        &self,
        expected_revision: Revision,
        metadata: EvidenceMetadataInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidRevision));
        }
        Self::from_parts(
            self.id,
            expected_revision.next()?,
            &self.media_type,
            &self.file_name,
            self.byte_len,
            &self.sha256,
            metadata,
            self.created_at_unix_ms,
            now_unix_ms,
        )
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub fn media_type(&self) -> &str {
        &self.media_type
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub fn description(&self) -> &str {
        &self.description
    }

    #[must_use]
    pub fn source(&self) -> &str {
        &self.source
    }

    #[must_use]
    pub fn captured_at(&self) -> Option<&str> {
        self.captured_at.as_deref()
    }

    #[must_use]
    pub fn source_url(&self) -> &str {
        &self.source_url
    }

    #[must_use]
    pub fn tags(&self) -> &[String] {
        &self.tags
    }

    #[must_use]
    pub fn analyst_notes(&self) -> &str {
        &self.analyst_notes
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }
}

impl EvidenceMetadataInput {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        title: impl Into<String>,
        description: impl Into<String>,
        source: impl Into<String>,
        captured_at: Option<String>,
        source_url: impl Into<String>,
        tags: Vec<String>,
        analyst_notes: impl Into<String>,
    ) -> Result<Self, DomainError> {
        Self {
            title: title.into(),
            description: description.into(),
            source: source.into(),
            captured_at,
            source_url: source_url.into(),
            tags,
            analyst_notes: analyst_notes.into(),
        }
        .normalized()
    }

    fn normalized(self) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidAttachment;
        let title = bounded_text(&self.title, MAX_EVIDENCE_TITLE_CHARS, code)?;
        let description = optional_bounded_text(&self.description, MAX_FIELD_TEXT_CHARS, code)?;
        let source = optional_bounded_text(&self.source, MAX_EVIDENCE_SOURCE_CHARS, code)?;
        let source_url = optional_bounded_text(&self.source_url, MAX_EVIDENCE_URL_CHARS, code)?;
        if !source_url.is_empty()
            && !source_url.starts_with("https://")
            && !source_url.starts_with("http://")
        {
            return Err(DomainError::new(code));
        }
        let captured_at = self
            .captured_at
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if captured_at
            .as_deref()
            .is_some_and(|value| !is_calendar_date(value))
        {
            return Err(DomainError::new(code));
        }
        if self.tags.len() > MAX_EVIDENCE_TAGS {
            return Err(DomainError::new(code));
        }
        let mut tags = Vec::with_capacity(self.tags.len());
        for tag in self.tags {
            let tag = bounded_text(&tag, MAX_EVIDENCE_TAG_CHARS, code)?.to_lowercase();
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        let analyst_notes = optional_bounded_text(&self.analyst_notes, MAX_FIELD_TEXT_CHARS, code)?;
        Ok(Self {
            title,
            description,
            source,
            captured_at,
            source_url,
            tags,
            analyst_notes,
        })
    }
}

fn optional_bounded_text(
    value: &str,
    max_chars: usize,
    code: DomainErrorCode,
) -> Result<String, DomainError> {
    let value = value.trim();
    if value.chars().count() > max_chars
        || value
            .chars()
            .any(|character| character.is_control() && !matches!(character, '\n' | '\r' | '\t'))
    {
        return Err(DomainError::new(code));
    }
    Ok(value.to_owned())
}

fn is_calendar_date(value: &str) -> bool {
    let mut parts = value.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return false;
    };
    if year.len() != 4
        || month.len() != 2
        || day.len() != 2
        || !year.bytes().all(|byte| byte.is_ascii_digit())
        || !month.bytes().all(|byte| byte.is_ascii_digit())
        || !day.bytes().all(|byte| byte.is_ascii_digit())
    {
        return false;
    }
    let (Ok(year), Ok(month), Ok(day)) = (
        year.parse::<u32>(),
        month.parse::<u32>(),
        day.parse::<u32>(),
    ) else {
        return false;
    };
    if year == 0 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let maximum = match month {
        2 if leap => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    };
    (1..=maximum).contains(&day)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectDataReference {
    kind: ProjectDataReferenceKind,
    id: LocalId,
    label: String,
}

impl ProjectDataReference {
    #[must_use]
    pub const fn kind(&self) -> ProjectDataReferenceKind {
        self.kind
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub fn label(&self) -> &str {
        &self.label
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuidedReportRowReference {
    row_index: usize,
    column: String,
    reference: ProjectDataReference,
}

impl GuidedReportRowReference {
    #[must_use]
    pub const fn row_index(&self) -> usize {
        self.row_index
    }

    #[must_use]
    pub fn column(&self) -> &str {
        &self.column
    }

    #[must_use]
    pub const fn reference(&self) -> &ProjectDataReference {
        &self.reference
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GuidedReportLinkedRows {
    rows: Vec<BTreeMap<String, String>>,
    references: Vec<GuidedReportRowReference>,
}

impl GuidedReportLinkedRows {
    #[must_use]
    pub fn rows(&self) -> &[BTreeMap<String, String>] {
        &self.rows
    }

    #[must_use]
    pub fn references(&self) -> &[GuidedReportRowReference] {
        &self.references
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "value", rename_all = "snake_case")]
pub enum GuidedReportFieldValue {
    Text(String),
    Narrative(Value),
    Rows(Vec<BTreeMap<String, String>>),
    LinkedRows(GuidedReportLinkedRows),
    ProjectReferences(Vec<ProjectDataReference>),
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReportSectionDisposition {
    #[default]
    Active,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ReportReadinessWarning {
    section_key: String,
    field_key: String,
    message: String,
}

impl ReportReadinessWarning {
    #[must_use]
    pub fn section_key(&self) -> &str {
        &self.section_key
    }

    #[must_use]
    pub fn field_key(&self) -> &str {
        &self.field_key
    }

    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GuidedReport {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    template_id: LocalId,
    template_revision: Revision,
    title: String,
    included_sections: Vec<String>,
    section_dispositions: BTreeMap<String, ReportSectionDisposition>,
    fields: BTreeMap<String, GuidedReportFieldValue>,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
    deleted_at_unix_ms: Option<i64>,
}

#[derive(Deserialize)]
struct GuidedReportWire {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    template_id: LocalId,
    template_revision: Revision,
    title: String,
    included_sections: Vec<String>,
    #[serde(default)]
    section_dispositions: BTreeMap<String, ReportSectionDisposition>,
    fields: BTreeMap<String, GuidedReportFieldValue>,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
    deleted_at_unix_ms: Option<i64>,
}

impl<'de> Deserialize<'de> for GuidedReport {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = GuidedReportWire::deserialize(deserializer)?;
        Self::restore(wire).map_err(serde::de::Error::custom)
    }
}

impl GuidedReport {
    pub fn new_blank(
        id: LocalId,
        template: &ReportTemplateDefinition,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::new_blank_with_fields(id, template, BTreeMap::new(), now_unix_ms)
    }

    pub fn new_blank_with_fields(
        id: LocalId,
        template: &ReportTemplateDefinition,
        initial_fields: BTreeMap<String, GuidedReportFieldValue>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if now_unix_ms < 0 {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
        let included_sections = template
            .sections
            .iter()
            .map(|section| section.key.clone())
            .collect();
        let template_fields = template
            .sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        let mut fields = template_fields
            .values()
            .map(|field| (field.key.clone(), empty_value(field.kind)))
            .collect::<BTreeMap<_, _>>();
        for (key, value) in initial_fields {
            let Some(field) = template_fields.get(key.as_str()).copied() else {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            };
            if !value_matches_kind(&value, field.kind) {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            }
            validate_field_value(&value)?;
            validate_value_for_template_field(&value, field)?;
            fields.insert(key, value);
        }
        Ok(Self {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            revision: Revision::new(1)?,
            template_id: template.id,
            template_revision: template.revision,
            title: "Untitled guided report".to_owned(),
            included_sections,
            section_dispositions: BTreeMap::new(),
            fields,
            created_at_unix_ms: now_unix_ms,
            updated_at_unix_ms: now_unix_ms,
            deleted_at_unix_ms: None,
        })
    }

    fn restore(wire: GuidedReportWire) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidGuidedReport;
        if wire.schema_version != CONTRACT_SCHEMA_VERSION
            || wire.created_at_unix_ms < 0
            || wire.updated_at_unix_ms < wire.created_at_unix_ms
            || wire
                .deleted_at_unix_ms
                .is_some_and(|deleted| deleted < wire.updated_at_unix_ms)
            || wire.included_sections.len() > MAX_INCLUDED_ITEMS
            || wire.section_dispositions.len() > MAX_INCLUDED_ITEMS
            || wire.fields.len() > MAX_REPORT_FIELDS
        {
            return Err(DomainError::new(code));
        }
        let title = bounded_text(&wire.title, MAX_REPORT_TITLE_CHARS, code)?;
        let mut sections = HashSet::new();
        for section in &wire.included_sections {
            validate_key(section, code)?;
            if !sections.insert(section) {
                return Err(DomainError::new(code));
            }
        }
        for section in wire.section_dispositions.keys() {
            validate_key(section, code)?;
        }
        for (key, value) in &wire.fields {
            validate_key(key, code)?;
            validate_field_value(value)?;
        }
        Ok(Self {
            schema_version: wire.schema_version,
            id: wire.id,
            revision: wire.revision,
            template_id: wire.template_id,
            template_revision: wire.template_revision,
            title,
            included_sections: wire.included_sections,
            section_dispositions: wire.section_dispositions,
            fields: wire.fields,
            created_at_unix_ms: wire.created_at_unix_ms,
            updated_at_unix_ms: wire.updated_at_unix_ms,
            deleted_at_unix_ms: wire.deleted_at_unix_ms,
        })
    }

    pub fn revise_field(
        &self,
        expected_revision: Revision,
        field_key: &str,
        value: GuidedReportFieldValue,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision
            || now_unix_ms < self.updated_at_unix_ms
            || !self.fields.contains_key(field_key)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
        validate_field_value(&value)?;
        let mut revised = self.clone();
        revised.revision = expected_revision.next()?;
        revised.updated_at_unix_ms = now_unix_ms;
        revised.fields.insert(field_key.to_owned(), value.clone());
        if is_title_field(field_key)
            && let GuidedReportFieldValue::Text(title) = value
            && let Ok(title) = bounded_text(
                &title,
                MAX_REPORT_TITLE_CHARS,
                DomainErrorCode::InvalidGuidedReport,
            )
        {
            revised.title = title;
        }
        Ok(revised)
    }

    pub fn revise_fields(
        &self,
        template: &ReportTemplateDefinition,
        expected_revision: Revision,
        title: &str,
        changes: BTreeMap<String, GuidedReportFieldValue>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision
            || self.template_id != template.id
            || self.template_revision != template.revision
            || now_unix_ms < self.updated_at_unix_ms
            || changes.is_empty()
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
        let template_fields = template
            .sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        for (key, value) in &changes {
            let Some(field) = template_fields.get(key.as_str()).copied() else {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            };
            if !self.fields.contains_key(key) || !value_matches_kind(value, field.kind) {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            }
            validate_field_value(value)?;
            validate_value_for_template_field(value, field)?;
        }

        let mut revised = self.clone();
        revised.revision = expected_revision.next()?;
        revised.updated_at_unix_ms = now_unix_ms;
        revised.title = bounded_text(
            title,
            MAX_REPORT_TITLE_CHARS,
            DomainErrorCode::InvalidGuidedReport,
        )?;
        for (key, value) in changes {
            revised.fields.insert(key, value);
        }
        Ok(revised)
    }

    pub fn revise_section_disposition(
        &self,
        template: &ReportTemplateDefinition,
        expected_revision: Revision,
        section_key: &str,
        disposition: ReportSectionDisposition,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let Some(section) = template
            .sections
            .iter()
            .find(|section| section.key == section_key)
        else {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        };
        if self.revision != expected_revision
            || self.template_id != template.id
            || self.template_revision != template.revision
            || now_unix_ms < self.updated_at_unix_ms
            || !self.included_sections.iter().any(|key| key == section_key)
            || (disposition == ReportSectionDisposition::NotApplicable && !section.optional)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
        let mut revised = self.clone();
        revised.revision = expected_revision.next()?;
        revised.updated_at_unix_ms = now_unix_ms;
        match disposition {
            ReportSectionDisposition::Active => {
                revised.section_dispositions.remove(section_key);
            }
            ReportSectionDisposition::NotApplicable => {
                revised
                    .section_dispositions
                    .insert(section_key.to_owned(), disposition);
            }
        }
        Ok(revised)
    }

    pub fn upgrade_illicit_ecosystem_template(
        &self,
        source_template: &ReportTemplateDefinition,
        target_template: &ReportTemplateDefinition,
        generated_report_number: Option<&str>,
        expected_revision: Revision,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        const ILLICIT_ECOSYSTEM_TEMPLATE_ID: &str = "6fba43e4-fcac-5b12-b37a-17aa0d4e99ca";
        if self.revision != expected_revision
            || self.template_id != source_template.id
            || self.template_revision != source_template.revision
            || source_template.id != target_template.id
            || source_template.id.to_string() != ILLICIT_ECOSYSTEM_TEMPLATE_ID
            || !matches!(source_template.revision.get(), 1..=3)
            || target_template.revision.get() != 4
            || now_unix_ms < self.updated_at_unix_ms
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }

        let source_fields = source_template
            .sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        let target_fields = target_template
            .sections
            .iter()
            .flat_map(|section| section.fields.iter())
            .map(|field| (field.key.as_str(), field))
            .collect::<BTreeMap<_, _>>();
        let mut used_source_fields = HashSet::new();
        let mut legacy_metadata = Vec::new();
        let mut upgraded_fields = target_fields
            .values()
            .map(|field| (field.key.clone(), empty_value(field.kind)))
            .collect::<BTreeMap<_, _>>();

        for target_field in target_fields.values() {
            if target_field.key == "additional_metadata"
                || target_field.key == "legacy_intelligence_gaps"
                || (target_field.key == "intelligence_gaps"
                    && matches!(
                        self.fields.get("intelligence_gaps"),
                        Some(GuidedReportFieldValue::Narrative(_))
                    ))
            {
                continue;
            }
            let source_key = legacy_source_key(&target_field.key, &self.fields);
            let Some((source_key, source_value)) =
                source_key.and_then(|key| self.fields.get_key_value(key))
            else {
                continue;
            };
            if value_is_empty(source_value) {
                used_source_fields.insert(source_key.as_str());
                continue;
            }
            let Some(source_field) = source_fields.get(source_key.as_str()) else {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            };
            let migrated = match source_value {
                GuidedReportFieldValue::Rows(rows)
                    if target_field.kind == ReportFieldKind::RepeatableRows =>
                {
                    GuidedReportFieldValue::Rows(migrate_legacy_rows(
                        source_key,
                        rows,
                        &target_field.columns,
                        &mut legacy_metadata,
                    ))
                }
                GuidedReportFieldValue::LinkedRows(rows)
                    if target_field.kind == ReportFieldKind::RepeatableRows =>
                {
                    GuidedReportFieldValue::Rows(migrate_legacy_rows(
                        source_key,
                        rows.rows(),
                        &target_field.columns,
                        &mut legacy_metadata,
                    ))
                }
                value if value_matches_kind(value, target_field.kind) => value.clone(),
                _ => {
                    return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
                }
            };
            validate_value_for_template_field(&migrated, target_field)?;
            upgraded_fields.insert(target_field.key.clone(), migrated);
            used_source_fields.insert(source_field.key.as_str());
        }

        if let Some(GuidedReportFieldValue::Narrative(value)) = self.fields.get("intelligence_gaps")
            && source_fields
                .get("intelligence_gaps")
                .is_some_and(|field| field.kind == ReportFieldKind::Narrative)
        {
            upgraded_fields.insert(
                "legacy_intelligence_gaps".to_owned(),
                GuidedReportFieldValue::Narrative(value.clone()),
            );
            used_source_fields.insert("intelligence_gaps");
        }

        let mut legacy_indicators = Vec::new();
        for key in [
            "malware_indicators",
            "network_indicators",
            "vulnerabilities",
        ] {
            let Some(GuidedReportFieldValue::Rows(rows)) = self.fields.get(key) else {
                continue;
            };
            for row in rows
                .iter()
                .filter(|row| row.values().any(|value| !value.trim().is_empty()))
            {
                let value = first_non_empty(row, &["Value", "Artifact", "CVE", "Name"]);
                let indicator_type = first_non_empty(row, &["Type", "Artifact"]);
                let context = row
                    .iter()
                    .filter(|(_, value)| !value.trim().is_empty())
                    .map(|(column, value)| format!("{column}: {}", value.trim()))
                    .collect::<Vec<_>>()
                    .join("; ");
                legacy_indicators.push(BTreeMap::from([
                    ("Value".to_owned(), value),
                    ("Type".to_owned(), indicator_type),
                    ("Category".to_owned(), "Legacy indicator".to_owned()),
                    ("Context".to_owned(), context),
                ]));
            }
            used_source_fields.insert(key);
        }
        if !legacy_indicators.is_empty() {
            upgraded_fields.insert(
                "indicators_observables".to_owned(),
                GuidedReportFieldValue::Rows(legacy_indicators),
            );
        }

        for (source_key, value) in &self.fields {
            if used_source_fields.contains(source_key.as_str()) || value_is_empty(value) {
                continue;
            }
            preserve_legacy_value(source_key, value, &mut legacy_metadata)?;
        }
        if !legacy_metadata.is_empty() {
            upgraded_fields.insert(
                "additional_metadata".to_owned(),
                GuidedReportFieldValue::Rows(legacy_metadata),
            );
        }
        if upgraded_fields
            .get("report_number")
            .is_none_or(value_is_empty)
            && let Some(report_number) = generated_report_number
        {
            upgraded_fields.insert(
                "report_number".to_owned(),
                GuidedReportFieldValue::Text(report_number.to_owned()),
            );
        }
        for (key, value) in &upgraded_fields {
            let Some(field) = target_fields.get(key.as_str()) else {
                return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
            };
            validate_field_value(value)?;
            validate_value_for_template_field(value, field)?;
        }

        let mut upgraded = self.clone();
        upgraded.revision = expected_revision.next()?;
        upgraded.template_revision = target_template.revision;
        upgraded.included_sections = target_template
            .sections
            .iter()
            .map(|section| section.key.clone())
            .collect();
        upgraded.section_dispositions = self
            .section_dispositions
            .iter()
            .filter_map(|(source_key, disposition)| {
                let target_key = legacy_section_key(source_key);
                target_template
                    .sections
                    .iter()
                    .any(|section| section.key == target_key && section.optional)
                    .then(|| (target_key.to_owned(), *disposition))
            })
            .collect();
        upgraded.fields = upgraded_fields;
        upgraded.updated_at_unix_ms = now_unix_ms;
        Ok(upgraded)
    }

    #[must_use]
    pub fn readiness_warnings(
        &self,
        template: &ReportTemplateDefinition,
    ) -> Vec<ReportReadinessWarning> {
        if self.template_id != template.id || self.template_revision != template.revision {
            return vec![ReportReadinessWarning {
                section_key: "template".to_owned(),
                field_key: "template".to_owned(),
                message: "The report template revision is unavailable.".to_owned(),
            }];
        }
        let included = self.included_sections.iter().collect::<HashSet<_>>();
        template
            .sections
            .iter()
            .filter(|section| included.contains(&section.key))
            .filter(|section| {
                self.section_disposition(&section.key) == ReportSectionDisposition::Active
            })
            .flat_map(|section| {
                section
                    .fields
                    .iter()
                    .filter(|field| field.required)
                    .map(move |field| (section, field))
            })
            .filter_map(|(section, field)| {
                self.fields
                    .get(&field.key)
                    .filter(|value| value_matches_kind(value, field.kind) && !value_is_empty(value))
                    .map(|_| None)
                    .unwrap_or_else(|| {
                        Some(ReportReadinessWarning {
                            section_key: section.key.clone(),
                            field_key: field.key.clone(),
                            message: format!("Add recommended content to {}.", field.label),
                        })
                    })
            })
            .collect()
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub const fn template_id(&self) -> LocalId {
        self.template_id
    }

    #[must_use]
    pub const fn template_revision(&self) -> Revision {
        self.template_revision
    }

    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    #[must_use]
    pub fn included_sections(&self) -> &[String] {
        &self.included_sections
    }

    #[must_use]
    pub fn section_disposition(&self, section_key: &str) -> ReportSectionDisposition {
        self.section_dispositions
            .get(section_key)
            .copied()
            .unwrap_or_default()
    }

    #[must_use]
    pub fn section_dispositions(&self) -> &BTreeMap<String, ReportSectionDisposition> {
        &self.section_dispositions
    }

    #[must_use]
    pub fn fields(&self) -> &BTreeMap<String, GuidedReportFieldValue> {
        &self.fields
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }

    #[must_use]
    pub const fn deleted_at_unix_ms(&self) -> Option<i64> {
        self.deleted_at_unix_ms
    }
}

fn legacy_section_key(source_key: &str) -> &str {
    match source_key {
        "identities" => "identities_roles",
        "media_evidence" => "media_file_evidence",
        "relationships_evidence" => "relationships_supporting_evidence",
        _ => source_key,
    }
}

fn legacy_source_key<'a>(
    target_key: &'a str,
    fields: &'a BTreeMap<String, GuidedReportFieldValue>,
) -> Option<&'a str> {
    if fields.contains_key(target_key) {
        return Some(target_key);
    }
    match target_key {
        "key_findings" => Some("key_points"),
        "overall_assessment" => Some("assessment"),
        "overall_confidence" => Some("confidence"),
        "investigation_period" => Some("timeframe"),
        "identities_roles" => Some("identities"),
        "media_file_evidence" => Some("media_evidence"),
        "relationships_supporting_evidence" => Some("relationships_evidence"),
        "technique_references" => Some("techniques"),
        "appendix_evidence_references" => Some("evidence_references"),
        _ => None,
    }
}

fn migrate_legacy_rows(
    field_key: &str,
    rows: &[BTreeMap<String, String>],
    target_columns: &[String],
    legacy_metadata: &mut Vec<BTreeMap<String, String>>,
) -> Vec<BTreeMap<String, String>> {
    rows.iter()
        .enumerate()
        .filter_map(|(row_index, row)| {
            let mut migrated = BTreeMap::new();
            let mut used_columns = HashSet::new();
            for target in target_columns {
                let source = row.keys().find(|source| {
                    normalized_label(source) == normalized_label(target)
                        || legacy_column_aliases(target)
                            .iter()
                            .any(|alias| normalized_label(source) == normalized_label(alias))
                });
                if let Some(source) = source
                    && let Some(value) = row.get(source)
                    && !value.trim().is_empty()
                {
                    migrated.insert(target.clone(), value.trim().to_owned());
                    used_columns.insert(source.as_str());
                }
            }
            for (column, value) in row {
                if !value.trim().is_empty() && !used_columns.contains(column.as_str()) {
                    legacy_metadata.push(BTreeMap::from([
                        (
                            "Label".to_owned(),
                            format!("Legacy {field_key} row {}: {column}", row_index + 1),
                        ),
                        ("Value".to_owned(), value.trim().to_owned()),
                    ]));
                }
            }
            (!migrated.is_empty()).then_some(migrated)
        })
        .collect()
}

fn normalized_label(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn legacy_column_aliases(target: &str) -> &'static [&'static str] {
    match target {
        "Unknown" => &["Intelligence gap"],
        "Question" => &["Requirement"],
        "Related intelligence gap" => &["Linked gap"],
        "Date and time" => &["Date or time", "Date", "Time"],
        "Precision or certainty" => &["Date precision"],
        "Event" => &["Activity"],
        "Provenance" => &["Directly observed versus source-reported status"],
        "Domain or URL" => &["Domain", "Domain or site"],
        "Purpose" => &["Observed purpose", "Category"],
        "First observed" => &["First seen", "First reported"],
        "Last observed" => &["Last seen", "Last reported"],
        "Current status" => &["Status"],
        "Hosting and DNS" => &["Hosting", "Provider", "Cloud or hosting provider"],
        "Name, alias or identifier" => &["Identifier or pseudonym", "Name or handle"],
        "Alleged, observed or assessed role" => &["Reported role", "Observed role", "Role"],
        "Corroboration status" => &["Corroboration"],
        "Profile URL or platform identifier" => &["URL or platform identifier", "Profile link"],
        "Observed purpose" => &["Purpose", "Role"],
        "Relevant posts or comments" => &["Relevant activity"],
        "Control or ownership confidence" => &["Common-control confidence", "Confidence"],
        "IP address or host" => &["IP or host"],
        "Hosting provider" => &["Cloud or hosting provider"],
        "Subject alternative names" => &["Subject and SANs", "Common name and SANs"],
        "Linked domains or IP addresses" => &["Reused sites"],
        "Source entity" => &["Source"],
        "Relationship type" => &["Relationship"],
        "Target entity" => &["Target"],
        "Documentary evidence" => &["Supporting evidence", "Evidence"],
        "Source description or link" => &["Source or link", "Source", "Evidence link"],
        "Analyst notes" => &["Notes", "Description"],
        "Category" => &["Classification"],
        "Evidence references" => &["Evidence", "Source or evidence", "Source"],
        "Technique ID" => &["Technique", "Sub-technique"],
        "Technique name" => &["Name"],
        "Explanation" => &["Procedure", "Description"],
        "Rule, query or logic" => &["Rule or logic", "Description"],
        "Collected or accessed" => &["Accessed"],
        "Source type" => &["Type"],
        _ => &[],
    }
}

fn first_non_empty(row: &BTreeMap<String, String>, columns: &[&str]) -> String {
    columns
        .iter()
        .find_map(|column| row.get(*column).filter(|value| !value.trim().is_empty()))
        .map(|value| value.trim().to_owned())
        .unwrap_or_default()
}

fn preserve_legacy_value(
    field_key: &str,
    value: &GuidedReportFieldValue,
    legacy_metadata: &mut Vec<BTreeMap<String, String>>,
) -> Result<(), DomainError> {
    match value {
        GuidedReportFieldValue::Text(value) => legacy_metadata.push(BTreeMap::from([
            ("Label".to_owned(), format!("Legacy {field_key}")),
            ("Value".to_owned(), value.trim().to_owned()),
        ])),
        GuidedReportFieldValue::Rows(rows) => {
            for (row_index, row) in rows.iter().enumerate() {
                for (column, value) in row.iter().filter(|(_, value)| !value.trim().is_empty()) {
                    legacy_metadata.push(BTreeMap::from([
                        (
                            "Label".to_owned(),
                            format!("Legacy {field_key} row {}: {column}", row_index + 1),
                        ),
                        ("Value".to_owned(), value.trim().to_owned()),
                    ]));
                }
            }
        }
        GuidedReportFieldValue::LinkedRows(rows) => {
            for (row_index, row) in rows.rows().iter().enumerate() {
                for (column, value) in row.iter().filter(|(_, value)| !value.trim().is_empty()) {
                    legacy_metadata.push(BTreeMap::from([
                        (
                            "Label".to_owned(),
                            format!("Legacy {field_key} row {}: {column}", row_index + 1),
                        ),
                        ("Value".to_owned(), value.trim().to_owned()),
                    ]));
                }
            }
        }
        GuidedReportFieldValue::Narrative(_) | GuidedReportFieldValue::ProjectReferences(_) => {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
    }
    Ok(())
}

fn empty_value(kind: ReportFieldKind) -> GuidedReportFieldValue {
    match kind {
        ReportFieldKind::Narrative => GuidedReportFieldValue::Narrative(json!({
            "type": "doc",
            "content": [{"type": "paragraph"}]
        })),
        ReportFieldKind::RepeatableRows => GuidedReportFieldValue::Rows(Vec::new()),
        ReportFieldKind::ProjectReferences => GuidedReportFieldValue::ProjectReferences(Vec::new()),
        _ => GuidedReportFieldValue::Text(String::new()),
    }
}

fn validate_field_value(value: &GuidedReportFieldValue) -> Result<(), DomainError> {
    let code = DomainErrorCode::InvalidGuidedReport;
    match value {
        GuidedReportFieldValue::Text(value) => {
            if value.chars().count() > MAX_FIELD_TEXT_CHARS
                || value.chars().any(|character| character == '\0')
            {
                return Err(DomainError::new(code));
            }
        }
        GuidedReportFieldValue::Narrative(root) => super::validate_document_root(root)?,
        GuidedReportFieldValue::Rows(rows) => validate_rows(rows, &[], code)?,
        GuidedReportFieldValue::LinkedRows(linked) => {
            validate_rows(linked.rows(), linked.references(), code)?;
        }
        GuidedReportFieldValue::ProjectReferences(references) => {
            validate_project_references(references, code)?;
        }
    }
    Ok(())
}

fn validate_rows(
    rows: &[BTreeMap<String, String>],
    references: &[GuidedReportRowReference],
    code: DomainErrorCode,
) -> Result<(), DomainError> {
    if rows.len() > MAX_REPEATABLE_ROWS {
        return Err(DomainError::new(code));
    }
    for row in rows {
        if row.len() > 32
            || row.iter().any(|(key, value)| {
                bounded_text(key, 80, code).is_err()
                    || value.chars().count() > MAX_FIELD_TEXT_CHARS
                    || value.chars().any(|character| character == '\0')
            })
        {
            return Err(DomainError::new(code));
        }
    }
    if references.len() > MAX_INCLUDED_ITEMS
        || references.iter().any(|reference| {
            reference.row_index >= rows.len()
                || !rows[reference.row_index].contains_key(&reference.column)
                || bounded_text(&reference.column, 80, code).is_err()
                || bounded_text(&reference.reference.label, 200, code).is_err()
        })
    {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn validate_project_references(
    references: &[ProjectDataReference],
    code: DomainErrorCode,
) -> Result<(), DomainError> {
    if references.len() > MAX_INCLUDED_ITEMS
        || references
            .iter()
            .any(|reference| bounded_text(&reference.label, 200, code).is_err())
    {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn validate_value_for_template_field(
    value: &GuidedReportFieldValue,
    field: &ReportTemplateField,
) -> Result<(), DomainError> {
    if field.kind == ReportFieldKind::Date
        && let GuidedReportFieldValue::Text(value) = value
        && !value.trim().is_empty()
        && !is_calendar_date(value)
    {
        return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
    }
    if field.kind == ReportFieldKind::Confidence
        && let GuidedReportFieldValue::Text(value) = value
        && !value.trim().is_empty()
        && !matches!(value.as_str(), "low" | "moderate" | "high")
    {
        return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
    }
    if let Some(rows) = guided_report_rows(value) {
        let allowed_columns = field.columns.iter().collect::<HashSet<_>>();
        if rows
            .iter()
            .flat_map(BTreeMap::keys)
            .any(|column| !allowed_columns.contains(column))
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
        if let GuidedReportFieldValue::LinkedRows(linked) = value
            && linked
                .references()
                .iter()
                .any(|reference| !allowed_columns.contains(&reference.column))
        {
            return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
        }
    }
    if field.kind == ReportFieldKind::Choice
        && let GuidedReportFieldValue::Text(value) = value
        && !value.trim().is_empty()
        && !field.options.iter().any(|option| option == value)
    {
        return Err(DomainError::new(DomainErrorCode::InvalidGuidedReport));
    }
    Ok(())
}

fn value_matches_kind(value: &GuidedReportFieldValue, kind: ReportFieldKind) -> bool {
    matches!(
        (value, kind),
        (
            GuidedReportFieldValue::Text(_),
            ReportFieldKind::ShortText
                | ReportFieldKind::LongText
                | ReportFieldKind::Date
                | ReportFieldKind::Confidence
                | ReportFieldKind::Choice
        ) | (
            GuidedReportFieldValue::Narrative(_),
            ReportFieldKind::Narrative
        ) | (
            GuidedReportFieldValue::Rows(_),
            ReportFieldKind::RepeatableRows
        ) | (
            GuidedReportFieldValue::LinkedRows(_),
            ReportFieldKind::RepeatableRows
        ) | (
            GuidedReportFieldValue::ProjectReferences(_),
            ReportFieldKind::ProjectReferences
        )
    )
}

fn value_is_empty(value: &GuidedReportFieldValue) -> bool {
    match value {
        GuidedReportFieldValue::Text(value) => value.trim().is_empty(),
        GuidedReportFieldValue::Narrative(value) => narrative_is_empty(value),
        GuidedReportFieldValue::Rows(rows) => rows
            .iter()
            .all(|row| row.values().all(|cell| cell.trim().is_empty())),
        GuidedReportFieldValue::LinkedRows(rows) => rows
            .rows()
            .iter()
            .all(|row| row.values().all(|cell| cell.trim().is_empty())),
        GuidedReportFieldValue::ProjectReferences(references) => references.is_empty(),
    }
}

fn guided_report_rows(value: &GuidedReportFieldValue) -> Option<&[BTreeMap<String, String>]> {
    match value {
        GuidedReportFieldValue::Rows(rows) => Some(rows),
        GuidedReportFieldValue::LinkedRows(rows) => Some(rows.rows()),
        _ => None,
    }
}

fn narrative_is_empty(value: &Value) -> bool {
    if value
        .get("text")
        .and_then(Value::as_str)
        .is_some_and(|text| !text.trim().is_empty())
    {
        return false;
    }
    value
        .get("content")
        .and_then(Value::as_array)
        .is_none_or(|children| children.iter().all(narrative_is_empty))
}

fn is_title_field(key: &str) -> bool {
    matches!(
        key,
        "actor_name" | "intrusion_name" | "campaign_name" | "report_title"
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaperSize {
    A4,
    Letter,
}

impl PaperSize {
    #[must_use]
    pub const fn portrait_points(self) -> (f32, f32) {
        match self {
            Self::A4 => (595.2756, 841.8898),
            Self::Letter => (612.0, 792.0),
        }
    }

    #[must_use]
    pub const fn docx_twips(self) -> (u32, u32) {
        match self {
            Self::A4 => (11_906, 16_838),
            Self::Letter => (12_240, 15_840),
        }
    }

    #[must_use]
    pub const fn typst_name(self) -> &'static str {
        match self {
            Self::A4 => "a4",
            Self::Letter => "us-letter",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageOrientation {
    Portrait,
    Landscape,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationFormat {
    Html,
    Pdf,
    Docx,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TlpMarking {
    Clear,
    Green,
    Amber,
    AmberStrict,
    Red,
}

impl TlpMarking {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Clear => "TLP:CLEAR",
            Self::Green => "TLP:GREEN",
            Self::Amber => "TLP:AMBER",
            Self::AmberStrict => "TLP:AMBER+STRICT",
            Self::Red => "TLP:RED",
        }
    }

    #[must_use]
    pub const fn distribution_statement(self) -> &'static str {
        match self {
            Self::Clear => "Recipients may share this information without restriction.",
            Self::Green => {
                "Recipients may share this information within their community, but not publicly."
            }
            Self::Amber => {
                "Recipients may share this information only on a need-to-know basis within their organization and with clients."
            }
            Self::AmberStrict => {
                "Recipients may share this information only within their organization on a need-to-know basis."
            }
            Self::Red => {
                "Recipients may not share this information beyond the specific people receiving it."
            }
        }
    }

    /// FIRST TLP 2.0 foreground color. TLP labels use a black background.
    #[must_use]
    pub const fn foreground_hex(self) -> &'static str {
        match self {
            Self::Red => "#FF2B2B",
            Self::Amber | Self::AmberStrict => "#FFC000",
            Self::Green => "#33FF00",
            Self::Clear => "#FFFFFF",
        }
    }

    /// FIRST TLP 2.0 background color for every label.
    #[must_use]
    pub const fn background_hex(self) -> &'static str {
        "#000000"
    }
}

impl PublicationFormat {
    #[must_use]
    pub const fn extension(self) -> &'static str {
        match self {
            Self::Html => "html",
            Self::Pdf => "pdf",
            Self::Docx => "docx",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrandTypeface {
    Geist,
    GeistMono,
    SourceSerif4,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OrganizationIdentity {
    name: String,
    contact: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct BrandAssets {
    logo_id: Option<LocalId>,
    compact_mark_id: Option<LocalId>,
    cover_artwork_id: Option<LocalId>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BrandAssetRole {
    Logo,
    CompactMark,
    CoverArtwork,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandAssetMetadata {
    id: LocalId,
    profile_id: LocalId,
    role: BrandAssetRole,
    media_type: ImageMediaType,
    file_name: String,
    byte_len: u64,
}

impl BrandAssetMetadata {
    pub fn new(
        id: LocalId,
        profile_id: LocalId,
        role: BrandAssetRole,
        media_type: ImageMediaType,
        file_name: impl AsRef<str>,
        byte_len: u64,
    ) -> Result<Self, DomainError> {
        if byte_len == 0 || byte_len > MAX_IMAGE_ATTACHMENT_BYTES {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        Ok(Self {
            id,
            profile_id,
            role,
            media_type,
            file_name: bounded_text(
                file_name.as_ref(),
                255,
                DomainErrorCode::InvalidBrandProfile,
            )?,
            byte_len,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn profile_id(&self) -> LocalId {
        self.profile_id
    }

    #[must_use]
    pub const fn role(&self) -> BrandAssetRole {
        self.role
    }

    #[must_use]
    pub const fn media_type(&self) -> ImageMediaType {
        self.media_type
    }

    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }
}

impl BrandAssets {
    fn with_asset(mut self, role: BrandAssetRole, asset_id: LocalId) -> Self {
        match role {
            BrandAssetRole::Logo => self.logo_id = Some(asset_id),
            BrandAssetRole::CompactMark => self.compact_mark_id = Some(asset_id),
            BrandAssetRole::CoverArtwork => self.cover_artwork_id = Some(asset_id),
        }
        self
    }

    const fn asset_id(&self, role: BrandAssetRole) -> Option<LocalId> {
        match role {
            BrandAssetRole::Logo => self.logo_id,
            BrandAssetRole::CompactMark => self.compact_mark_id,
            BrandAssetRole::CoverArtwork => self.cover_artwork_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandColors {
    primary: String,
    secondary: String,
    accent: String,
    text: String,
    background: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandTypography {
    heading: BrandTypeface,
    body: BrandTypeface,
    mono: BrandTypeface,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CoverTreatment {
    Minimal,
    Editorial,
    Artwork,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentDensity {
    Compact,
    Comfortable,
    Spacious,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TableTreatment {
    Grid,
    Banded,
    Minimal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SectionTreatment {
    Rule,
    Band,
    Plain,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageFurniture {
    header: bool,
    footer: bool,
    marking: bool,
    page_numbers: bool,
}

impl Default for PageFurniture {
    fn default() -> Self {
        Self {
            header: true,
            footer: true,
            marking: true,
            page_numbers: true,
        }
    }
}

impl PageFurniture {
    #[must_use]
    pub const fn header(self) -> bool {
        self.header
    }

    #[must_use]
    pub const fn footer(self) -> bool {
        self.footer
    }

    #[must_use]
    pub const fn marking(self) -> bool {
        self.marking
    }

    #[must_use]
    pub const fn page_numbers(self) -> bool {
        self.page_numbers
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandProfileInput {
    pub name: String,
    pub organization_name: String,
    pub contact: Option<String>,
    pub primary_color: String,
    pub secondary_color: String,
    pub accent_color: String,
    pub text_color: String,
    pub background_color: String,
    pub heading_typeface: BrandTypeface,
    pub body_typeface: BrandTypeface,
    pub mono_typeface: BrandTypeface,
    pub default_paper_size: PaperSize,
    pub default_orientation: PageOrientation,
    pub cover_treatment: CoverTreatment,
    pub density: ContentDensity,
    pub table_treatment: TableTreatment,
    pub section_treatment: SectionTreatment,
    pub page_furniture: PageFurniture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BrandProfile {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    name: String,
    organization: OrganizationIdentity,
    assets: BrandAssets,
    colors: BrandColors,
    typography: BrandTypography,
    default_paper_size: PaperSize,
    default_orientation: PageOrientation,
    cover_treatment: CoverTreatment,
    density: ContentDensity,
    table_treatment: TableTreatment,
    section_treatment: SectionTreatment,
    page_furniture: PageFurniture,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

#[derive(Deserialize)]
struct BrandProfileWire {
    schema_version: u16,
    id: LocalId,
    revision: Revision,
    name: String,
    organization: OrganizationIdentity,
    assets: BrandAssets,
    colors: BrandColors,
    typography: BrandTypography,
    default_paper_size: PaperSize,
    default_orientation: PageOrientation,
    cover_treatment: CoverTreatment,
    density: ContentDensity,
    table_treatment: TableTreatment,
    section_treatment: SectionTreatment,
    page_furniture: PageFurniture,
    created_at_unix_ms: i64,
    updated_at_unix_ms: i64,
}

impl<'de> Deserialize<'de> for BrandProfile {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = BrandProfileWire::deserialize(deserializer)?;
        Self::restore(wire).map_err(serde::de::Error::custom)
    }
}

impl BrandProfile {
    pub fn new(
        id: LocalId,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::from_input(
            id,
            Revision::new(1)?,
            input,
            BrandAssets::default(),
            now_unix_ms,
            now_unix_ms,
        )
    }

    pub fn project_default(
        id: LocalId,
        organization_name: impl AsRef<str>,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        let organization_name = organization_name.as_ref().to_owned();
        Self::restore(BrandProfileWire {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            revision: Revision::new(1)?,
            name: format!("{organization_name} Default"),
            organization: OrganizationIdentity {
                name: organization_name,
                contact: None,
            },
            assets: BrandAssets::default(),
            colors: BrandColors {
                primary: "#133C55".to_owned(),
                secondary: "#386FA4".to_owned(),
                accent: "#59A5D8".to_owned(),
                text: "#111827".to_owned(),
                background: "#FFFFFF".to_owned(),
            },
            typography: BrandTypography {
                heading: BrandTypeface::Geist,
                body: BrandTypeface::Geist,
                mono: BrandTypeface::GeistMono,
            },
            default_paper_size: PaperSize::A4,
            default_orientation: PageOrientation::Portrait,
            cover_treatment: CoverTreatment::Minimal,
            density: ContentDensity::Comfortable,
            table_treatment: TableTreatment::Grid,
            section_treatment: SectionTreatment::Rule,
            page_furniture: PageFurniture::default(),
            created_at_unix_ms: now_unix_ms,
            updated_at_unix_ms: now_unix_ms,
        })
    }

    pub fn revise(
        &self,
        expected_revision: Revision,
        input: BrandProfileInput,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        Self::from_input(
            self.id,
            expected_revision.next()?,
            input,
            self.assets.clone(),
            self.created_at_unix_ms,
            now_unix_ms,
        )
    }

    pub fn with_asset(
        &self,
        expected_revision: Revision,
        role: BrandAssetRole,
        asset_id: LocalId,
        now_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if self.revision != expected_revision || now_unix_ms < self.updated_at_unix_ms {
            return Err(DomainError::new(DomainErrorCode::InvalidBrandProfile));
        }
        let mut revised = self.clone();
        revised.revision = expected_revision.next()?;
        revised.updated_at_unix_ms = now_unix_ms;
        revised.assets = revised.assets.with_asset(role, asset_id);
        Ok(revised)
    }

    fn from_input(
        id: LocalId,
        revision: Revision,
        input: BrandProfileInput,
        assets: BrandAssets,
        created_at_unix_ms: i64,
        updated_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        Self::restore(BrandProfileWire {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            revision,
            name: input.name,
            organization: OrganizationIdentity {
                name: input.organization_name,
                contact: input.contact,
            },
            assets,
            colors: BrandColors {
                primary: input.primary_color,
                secondary: input.secondary_color,
                accent: input.accent_color,
                text: input.text_color,
                background: input.background_color,
            },
            typography: BrandTypography {
                heading: input.heading_typeface,
                body: input.body_typeface,
                mono: input.mono_typeface,
            },
            default_paper_size: input.default_paper_size,
            default_orientation: input.default_orientation,
            cover_treatment: input.cover_treatment,
            density: input.density,
            table_treatment: input.table_treatment,
            section_treatment: input.section_treatment,
            page_furniture: input.page_furniture,
            created_at_unix_ms,
            updated_at_unix_ms,
        })
    }

    fn restore(wire: BrandProfileWire) -> Result<Self, DomainError> {
        let code = DomainErrorCode::InvalidBrandProfile;
        if wire.schema_version != CONTRACT_SCHEMA_VERSION
            || wire.created_at_unix_ms < 0
            || wire.updated_at_unix_ms < wire.created_at_unix_ms
        {
            return Err(DomainError::new(code));
        }
        let name = bounded_text(&wire.name, 120, code)?;
        let organization_name = bounded_text(&wire.organization.name, 200, code)?;
        let contact = wire
            .organization
            .contact
            .as_deref()
            .map(|contact| bounded_text(contact, MAX_BRAND_TEXT_CHARS, code))
            .transpose()?;
        validate_colors(&wire.colors)?;
        Ok(Self {
            schema_version: wire.schema_version,
            id: wire.id,
            revision: wire.revision,
            name,
            organization: OrganizationIdentity {
                name: organization_name,
                contact,
            },
            assets: wire.assets,
            colors: wire.colors,
            typography: wire.typography,
            default_paper_size: wire.default_paper_size,
            default_orientation: wire.default_orientation,
            cover_treatment: wire.cover_treatment,
            density: wire.density,
            table_treatment: wire.table_treatment,
            section_treatment: wire.section_treatment,
            page_furniture: wire.page_furniture,
            created_at_unix_ms: wire.created_at_unix_ms,
            updated_at_unix_ms: wire.updated_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    #[must_use]
    pub const fn asset_id(&self, role: BrandAssetRole) -> Option<LocalId> {
        self.assets.asset_id(role)
    }

    #[must_use]
    pub const fn default_paper_size(&self) -> PaperSize {
        self.default_paper_size
    }

    #[must_use]
    pub const fn default_orientation(&self) -> PageOrientation {
        self.default_orientation
    }

    #[must_use]
    pub const fn page_furniture(&self) -> PageFurniture {
        self.page_furniture
    }

    #[must_use]
    pub const fn cover_treatment(&self) -> CoverTreatment {
        self.cover_treatment
    }

    #[must_use]
    pub const fn heading_typeface(&self) -> BrandTypeface {
        self.typography.heading
    }

    #[must_use]
    pub const fn body_typeface(&self) -> BrandTypeface {
        self.typography.body
    }

    #[must_use]
    pub const fn mono_typeface(&self) -> BrandTypeface {
        self.typography.mono
    }

    #[must_use]
    pub fn organization_name(&self) -> &str {
        &self.organization.name
    }

    #[must_use]
    pub fn primary_color(&self) -> &str {
        &self.colors.primary
    }

    #[must_use]
    pub fn secondary_color(&self) -> &str {
        &self.colors.secondary
    }

    #[must_use]
    pub fn accent_color(&self) -> &str {
        &self.colors.accent
    }

    #[must_use]
    pub fn text_color(&self) -> &str {
        &self.colors.text
    }

    #[must_use]
    pub fn background_color(&self) -> &str {
        &self.colors.background
    }

    #[must_use]
    pub const fn updated_at_unix_ms(&self) -> i64 {
        self.updated_at_unix_ms
    }
}

fn validate_colors(colors: &BrandColors) -> Result<(), DomainError> {
    let code = DomainErrorCode::InvalidBrandProfile;
    for color in [
        &colors.primary,
        &colors.secondary,
        &colors.accent,
        &colors.text,
        &colors.background,
    ] {
        parse_hex_color(color).ok_or_else(|| DomainError::new(code))?;
    }
    if contrast_ratio(&colors.text, &colors.background).is_none_or(|ratio| ratio < 4.5) {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn parse_hex_color(value: &str) -> Option<[u8; 3]> {
    let value = value.strip_prefix('#')?;
    if value.len() != 6 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some([
        u8::from_str_radix(&value[0..2], 16).ok()?,
        u8::from_str_radix(&value[2..4], 16).ok()?,
        u8::from_str_radix(&value[4..6], 16).ok()?,
    ])
}

fn contrast_ratio(foreground: &str, background: &str) -> Option<f64> {
    let foreground = relative_luminance(parse_hex_color(foreground)?);
    let background = relative_luminance(parse_hex_color(background)?);
    let (lighter, darker) = if foreground > background {
        (foreground, background)
    } else {
        (background, foreground)
    };
    Some((lighter + 0.05) / (darker + 0.05))
}

fn relative_luminance(color: [u8; 3]) -> f64 {
    let channel = |value: u8| {
        let value = f64::from(value) / 255.0;
        if value <= 0.04045 {
            value / 12.92
        } else {
            ((value + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BrandProfileRevisionReference {
    pub profile_id: LocalId,
    pub revision: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PublicationSource {
    FreeformDocument {
        document_id: LocalId,
        revision: Revision,
    },
    GuidedReport {
        report_id: LocalId,
        revision: Revision,
    },
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicationStatus {
    #[default]
    Draft,
    Final,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationReleaseEntry {
    version: String,
    change_note: String,
    published_at_unix_ms: i64,
}

impl PublicationReleaseEntry {
    pub fn new(
        version: impl AsRef<str>,
        change_note: impl AsRef<str>,
        published_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if published_at_unix_ms < 0 {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        Ok(Self {
            version: normalize_release_version(version.as_ref())?,
            change_note: bounded_text(
                change_note.as_ref(),
                2_000,
                DomainErrorCode::InvalidPublication,
            )?,
            published_at_unix_ms,
        })
    }

    #[must_use]
    pub fn version(&self) -> &str {
        &self.version
    }

    #[must_use]
    pub fn change_note(&self) -> &str {
        &self.change_note
    }

    #[must_use]
    pub const fn published_at_unix_ms(&self) -> i64 {
        self.published_at_unix_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationSettings {
    format: PublicationFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    brand_profile_revision: Option<BrandProfileRevisionReference>,
    page_furniture: PageFurniture,
    tlp_marking: Option<TlpMarking>,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    output_file_name: String,
    output_location: Option<String>,
    release_version: String,
    publication_status: PublicationStatus,
    include_release_history: bool,
    release_history: Vec<PublicationReleaseEntry>,
}

impl PublicationSettings {
    #[must_use]
    pub fn from_brand(profile: &BrandProfile, format: PublicationFormat) -> Self {
        Self {
            format,
            paper_size: profile.default_paper_size,
            orientation: profile.default_orientation,
            brand_profile_revision: Some(BrandProfileRevisionReference {
                profile_id: profile.id,
                revision: profile.revision.get(),
            }),
            page_furniture: profile.page_furniture,
            tlp_marking: None,
            included_sections: Vec::new(),
            appendices: Vec::new(),
            output_file_name: format!("Sheut-document.{}", format.extension()),
            output_location: None,
            release_version: default_release_version(),
            publication_status: PublicationStatus::Draft,
            include_release_history: false,
            release_history: Vec::new(),
        }
    }

    #[must_use]
    pub fn from_brand_and_project(
        profile: &BrandProfile,
        project: &crate::ProjectMetadata,
        format: PublicationFormat,
    ) -> Self {
        Self::from_brand(profile, format).with_tlp_marking(Some(project.default_tlp_marking()))
    }

    #[must_use]
    pub const fn with_paper_size(mut self, paper_size: PaperSize) -> Self {
        self.paper_size = paper_size;
        self
    }

    #[must_use]
    pub const fn with_orientation(mut self, orientation: PageOrientation) -> Self {
        self.orientation = orientation;
        self
    }

    #[must_use]
    pub const fn with_tlp_marking(mut self, tlp_marking: Option<TlpMarking>) -> Self {
        self.tlp_marking = tlp_marking;
        self
    }

    #[must_use]
    pub const fn with_page_furniture(mut self, page_furniture: PageFurniture) -> Self {
        self.page_furniture = page_furniture;
        self
    }

    #[must_use]
    pub const fn tlp_marking(&self) -> Option<TlpMarking> {
        self.tlp_marking
    }

    pub fn with_output_file_name(
        mut self,
        file_name: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        self.output_file_name = validate_output_file_name(file_name.as_ref(), self.format)?;
        Ok(self)
    }

    pub fn with_output_location(mut self, location: impl AsRef<str>) -> Result<Self, DomainError> {
        self.output_location = Some(bounded_text(
            location.as_ref(),
            MAX_OUTPUT_LOCATION_CHARS,
            DomainErrorCode::InvalidPublication,
        )?);
        Ok(self)
    }

    #[must_use]
    pub fn with_included_sections(mut self, sections: Vec<String>) -> Self {
        self.included_sections = sections;
        self
    }

    #[must_use]
    pub fn with_appendices(mut self, appendices: Vec<String>) -> Self {
        self.appendices = appendices;
        self
    }

    pub fn with_release(
        mut self,
        version: impl AsRef<str>,
        status: PublicationStatus,
        include_release_history: bool,
        release_history: Vec<PublicationReleaseEntry>,
    ) -> Result<Self, DomainError> {
        self.release_version = normalize_release_version(version.as_ref())?;
        self.publication_status = status;
        self.include_release_history = include_release_history;
        self.release_history = release_history;
        Ok(self)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationSnapshot {
    schema_version: u16,
    id: LocalId,
    source: PublicationSource,
    format: PublicationFormat,
    paper_size: PaperSize,
    orientation: PageOrientation,
    brand_profile_revision: Option<BrandProfileRevisionReference>,
    page_furniture: PageFurniture,
    tlp_marking: Option<TlpMarking>,
    included_sections: Vec<String>,
    appendices: Vec<String>,
    output_file_name: String,
    output_location: Option<String>,
    #[serde(default = "default_release_version")]
    release_version: String,
    #[serde(default)]
    publication_status: PublicationStatus,
    #[serde(default)]
    include_release_history: bool,
    #[serde(default)]
    release_history: Vec<PublicationReleaseEntry>,
    created_at_unix_ms: i64,
}

impl PublicationSnapshot {
    pub fn new(
        id: LocalId,
        source: PublicationSource,
        settings: PublicationSettings,
        created_at_unix_ms: i64,
    ) -> Result<Self, DomainError> {
        if created_at_unix_ms < 0
            || settings.included_sections.len() > MAX_INCLUDED_ITEMS
            || settings.appendices.len() > MAX_INCLUDED_ITEMS
            || settings.release_history.len() > 128
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        let output_file_name =
            validate_output_file_name(&settings.output_file_name, settings.format)?;
        for key in &settings.included_sections {
            validate_key(key, DomainErrorCode::InvalidPublication)?;
        }
        for appendix in &settings.appendices {
            bounded_text(appendix, 200, DomainErrorCode::InvalidPublication)?;
        }
        let release_version = normalize_release_version(&settings.release_version)?;
        validate_release_history(
            &release_version,
            settings.include_release_history,
            &settings.release_history,
        )?;
        Ok(Self {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            source,
            format: settings.format,
            paper_size: settings.paper_size,
            orientation: settings.orientation,
            brand_profile_revision: settings.brand_profile_revision,
            page_furniture: settings.page_furniture,
            tlp_marking: settings.tlp_marking,
            included_sections: settings.included_sections,
            appendices: settings.appendices,
            output_file_name,
            output_location: settings.output_location,
            release_version,
            publication_status: settings.publication_status,
            include_release_history: settings.include_release_history,
            release_history: settings.release_history,
            created_at_unix_ms,
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn source(&self) -> &PublicationSource {
        &self.source
    }

    #[must_use]
    pub const fn format(&self) -> PublicationFormat {
        self.format
    }

    #[must_use]
    pub const fn paper_size(&self) -> PaperSize {
        self.paper_size
    }

    #[must_use]
    pub const fn orientation(&self) -> PageOrientation {
        self.orientation
    }

    #[must_use]
    pub const fn brand_profile_revision(&self) -> Option<BrandProfileRevisionReference> {
        self.brand_profile_revision
    }

    #[must_use]
    pub const fn page_furniture(&self) -> PageFurniture {
        self.page_furniture
    }

    #[must_use]
    pub const fn tlp_marking(&self) -> Option<TlpMarking> {
        self.tlp_marking
    }

    #[must_use]
    pub fn included_sections(&self) -> &[String] {
        &self.included_sections
    }

    #[must_use]
    pub fn appendices(&self) -> &[String] {
        &self.appendices
    }

    #[must_use]
    pub fn output_file_name(&self) -> &str {
        &self.output_file_name
    }

    #[must_use]
    pub fn release_version(&self) -> &str {
        &self.release_version
    }

    #[must_use]
    pub const fn publication_status(&self) -> PublicationStatus {
        self.publication_status
    }

    #[must_use]
    pub const fn include_release_history(&self) -> bool {
        self.include_release_history
    }

    #[must_use]
    pub fn release_history(&self) -> &[PublicationReleaseEntry] {
        &self.release_history
    }

    #[must_use]
    pub const fn created_at_unix_ms(&self) -> i64 {
        self.created_at_unix_ms
    }
}

fn default_release_version() -> String {
    "1.0".to_owned()
}

fn normalize_release_version(value: &str) -> Result<String, DomainError> {
    let value = value
        .trim()
        .strip_prefix(['v', 'V'])
        .unwrap_or(value.trim());
    let parts = value.split('.').collect::<Vec<_>>();
    if !(2..=3).contains(&parts.len())
        || parts.iter().any(|part| {
            part.is_empty() || part.len() > 5 || !part.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(DomainError::new(DomainErrorCode::InvalidPublication));
    }
    let parsed = parts
        .iter()
        .map(|part| part.parse::<u16>())
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| DomainError::new(DomainErrorCode::InvalidPublication))?;
    Ok(parsed
        .iter()
        .map(u16::to_string)
        .collect::<Vec<_>>()
        .join("."))
}

fn validate_release_history(
    release_version: &str,
    included: bool,
    history: &[PublicationReleaseEntry],
) -> Result<(), DomainError> {
    let mut previous: Option<Vec<u16>> = None;
    for entry in history {
        let normalized = normalize_release_version(&entry.version)?;
        let current = normalized
            .split('.')
            .map(|part| part.parse::<u16>().unwrap_or_default())
            .collect::<Vec<_>>();
        if previous
            .as_ref()
            .is_some_and(|previous| previous >= &current)
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        previous = Some(current);
    }
    if history
        .last()
        .is_some_and(|entry| entry.version != release_version)
        || (included && release_version != "1.0" && history.len() < 2)
    {
        return Err(DomainError::new(DomainErrorCode::InvalidPublication));
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PublicationRecord {
    schema_version: u16,
    id: LocalId,
    snapshot: PublicationSnapshot,
    byte_len: u64,
    sha256: String,
}

impl PublicationRecord {
    pub fn new(
        id: LocalId,
        snapshot: PublicationSnapshot,
        byte_len: u64,
        sha256: impl AsRef<str>,
    ) -> Result<Self, DomainError> {
        let sha256 = sha256.as_ref();
        if byte_len == 0
            || sha256.len() != 64
            || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit())
        {
            return Err(DomainError::new(DomainErrorCode::InvalidPublication));
        }
        Ok(Self {
            schema_version: CONTRACT_SCHEMA_VERSION,
            id,
            snapshot,
            byte_len,
            sha256: sha256.to_ascii_lowercase(),
        })
    }

    #[must_use]
    pub const fn id(&self) -> LocalId {
        self.id
    }

    #[must_use]
    pub const fn snapshot(&self) -> &PublicationSnapshot {
        &self.snapshot
    }

    #[must_use]
    pub const fn byte_len(&self) -> u64 {
        self.byte_len
    }

    #[must_use]
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
}

fn validate_key(value: &str, code: DomainErrorCode) -> Result<(), DomainError> {
    if value.is_empty()
        || value.len() > 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_')
    {
        return Err(DomainError::new(code));
    }
    Ok(())
}

fn validate_output_file_name(
    value: &str,
    format: PublicationFormat,
) -> Result<String, DomainError> {
    let code = DomainErrorCode::InvalidPublication;
    let value = bounded_text(value, MAX_OUTPUT_FILE_NAME_CHARS, code)?;
    let expected_extension = format!(".{}", format.extension());
    if value == "."
        || value == ".."
        || value
            .chars()
            .any(|character| matches!(character, '/' | '\\'))
        || !value.to_ascii_lowercase().ends_with(&expected_extension)
    {
        return Err(DomainError::new(code));
    }
    Ok(value)
}
