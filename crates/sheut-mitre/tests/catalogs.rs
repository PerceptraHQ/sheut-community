use sheut_core::{MitreCatalog, MitreTechniqueReference};
use sheut_mitre::{catalog, validate_reference};

#[test]
fn pinned_catalogs_load_with_expected_versions_and_counts() {
    let enterprise = catalog(MitreCatalog::AttackEnterprise).unwrap();
    let atlas = catalog(MitreCatalog::Atlas).unwrap();

    assert_eq!(enterprise.version(), "19.1");
    assert_eq!(enterprise.tactics().len(), 15);
    assert_eq!(enterprise.techniques().len(), 697);
    assert_eq!(
        enterprise
            .tactics()
            .iter()
            .map(|tactic| tactic.name())
            .collect::<Vec<_>>(),
        vec![
            "Reconnaissance",
            "Resource Development",
            "Initial Access",
            "Execution",
            "Persistence",
            "Privilege Escalation",
            "Stealth",
            "Defense Impairment",
            "Credential Access",
            "Discovery",
            "Lateral Movement",
            "Collection",
            "Command and Control",
            "Exfiltration",
            "Impact",
        ]
    );
    assert_eq!(atlas.version(), "2026.06");
    assert_eq!(atlas.tactics().len(), 16);
    assert_eq!(atlas.techniques().len(), 173);
    assert_eq!(enterprise.source().sha256().len(), 64);
    assert_eq!(atlas.source().sha256().len(), 64);
}

#[test]
fn references_are_validated_inside_their_source_catalog() {
    let enterprise = MitreTechniqueReference::new(
        MitreCatalog::AttackEnterprise,
        "19.1",
        "T1059.001",
        Some("TA0002"),
    )
    .unwrap();
    let atlas = MitreTechniqueReference::new(
        MitreCatalog::Atlas,
        "2026.06",
        "AML.T0000",
        Some("AML.TA0002"),
    )
    .unwrap();

    validate_reference(&enterprise).unwrap();
    validate_reference(&atlas).unwrap();
    let wrong_version = MitreTechniqueReference::new(
        MitreCatalog::AttackEnterprise,
        "18.1",
        "T1059.001",
        Some("TA0002"),
    )
    .unwrap();
    assert!(validate_reference(&wrong_version).is_err());
}
