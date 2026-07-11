use serde::Serialize;
use std::path::Path;
use tree_sitter::Language;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilitySupport {
    Supported,
    NotSupported,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SupportTier {
    AstIndexed,
    VerifyOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifySupport {
    ExternalEnhanced,
    ExternalRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CurrentStatus {
    ProductGrade,
    Partial,
    VerifyOnly,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct LanguageCapability {
    pub language: &'static str,
    pub extensions: &'static [&'static str],
    pub support_tier: SupportTier,
    pub ast_indexed: bool,
    pub context: CapabilitySupport,
    pub plan: CapabilitySupport,
    pub impact: CapabilitySupport,
    pub verify: VerifySupport,
    pub external_tools: &'static [&'static str],
    pub fallback: &'static str,
    pub current_status: CurrentStatus,
    pub confidence: Confidence,
    pub missing: &'static [&'static str],
}

const STRUCTURAL_SUPPORT: CapabilitySupport = CapabilitySupport::Supported;
const NO_STRUCTURAL_SUPPORT: CapabilitySupport = CapabilitySupport::NotSupported;

pub const LANGUAGE_CAPABILITIES: &[LanguageCapability] = &[
    LanguageCapability {
        language: "TypeScript",
        extensions: &["ts", "mts", "cts"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["typescript"],
        fallback: "ast_only",
        current_status: CurrentStatus::ProductGrade,
        confidence: Confidence::High,
        missing: &[],
    },
    LanguageCapability {
        language: "TSX",
        extensions: &["tsx"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["typescript"],
        fallback: "ast_only",
        current_status: CurrentStatus::ProductGrade,
        confidence: Confidence::Medium,
        missing: &[
            "dynamic_imports",
            "runtime_component_resolution",
            "complex_path_alias_resolution",
            "tsconfig_extends_resolution",
            "type_value_namespace_resolution",
        ],
    },
    LanguageCapability {
        language: "Python",
        extensions: &["py"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["pyright"],
        fallback: "none",
        current_status: CurrentStatus::ProductGrade,
        confidence: Confidence::Medium,
        missing: &["dynamic_imports", "runtime_reflection", "complete_type_resolution"],
    },
    LanguageCapability {
        language: "Rust",
        extensions: &["rs"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["rust-analyzer"],
        fallback: "none",
        current_status: CurrentStatus::ProductGrade,
        confidence: Confidence::Medium,
        missing: &["macro_expansion", "complete_trait_resolution", "crate_features"],
    },
    LanguageCapability {
        language: "Go",
        extensions: &["go"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["gopls", "go"],
        fallback: "ast_only",
        current_status: CurrentStatus::Partial,
        confidence: Confidence::Medium,
        missing: &["complete_interface_resolution", "complete_module_resolution"],
    },
    LanguageCapability {
        language: "Java",
        extensions: &["java"],
        support_tier: SupportTier::AstIndexed,
        ast_indexed: true,
        context: STRUCTURAL_SUPPORT,
        plan: STRUCTURAL_SUPPORT,
        impact: STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["jdtls", "javac"],
        fallback: "ast_only",
        current_status: CurrentStatus::Partial,
        confidence: Confidence::Medium,
        missing: &["complete_classpath", "generated_sources", "annotation_processors"],
    },
    LanguageCapability {
        language: "SQL",
        extensions: &["sql"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["sqlfluff"],
        fallback: "syntax_only",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "Shell",
        extensions: &["sh", "bash", "zsh", "ksh"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["shellcheck"],
        fallback: "syntax_only",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "C#",
        extensions: &["cs"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["dotnet"],
        fallback: "syntax_only",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "PHP",
        extensions: &["php"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalEnhanced,
        external_tools: &["php"],
        fallback: "syntax_only",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "Ruby",
        extensions: &["rb"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalRequired,
        external_tools: &["ruby"],
        fallback: "none",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "Kotlin",
        extensions: &["kt", "kts"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalRequired,
        external_tools: &["kotlinc"],
        fallback: "none",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "Dart",
        extensions: &["dart"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalRequired,
        external_tools: &["dart"],
        fallback: "none",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "Swift",
        extensions: &["swift"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalRequired,
        external_tools: &["swiftc", "xcrun"],
        fallback: "none",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
    LanguageCapability {
        language: "C/C++",
        extensions: &["c", "h", "cpp", "cc", "cxx", "hpp", "hh", "hxx"],
        support_tier: SupportTier::VerifyOnly,
        ast_indexed: false,
        context: NO_STRUCTURAL_SUPPORT,
        plan: NO_STRUCTURAL_SUPPORT,
        impact: NO_STRUCTURAL_SUPPORT,
        verify: VerifySupport::ExternalRequired,
        external_tools: &["clang", "gcc", "clang++", "g++"],
        fallback: "none",
        current_status: CurrentStatus::VerifyOnly,
        confidence: Confidence::Low,
        missing: &["structural_analysis"],
    },
];

pub fn capability_for_name(language: &str) -> Option<&'static LanguageCapability> {
    LANGUAGE_CAPABILITIES
        .iter()
        .find(|capability| capability.language == language)
}

pub fn capability_for_path(path: &str) -> Option<&'static LanguageCapability> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    LANGUAGE_CAPABILITIES
        .iter()
        .find(|capability| capability.extensions.contains(&extension.as_str()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Lang {
    TypeScript,
    Tsx,
    Rust,
    Python,
    Go,
    Java,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn separates_ast_indexed_and_verify_only_languages() {
        let typescript = capability_for_name("TypeScript").unwrap();
        let tsx = capability_for_name("TSX").unwrap();
        let rust = capability_for_name("Rust").unwrap();
        let csharp = capability_for_name("C#").unwrap();

        assert_eq!(typescript.support_tier, SupportTier::AstIndexed);
        assert_eq!(typescript.current_status, CurrentStatus::ProductGrade);
        assert_eq!(typescript.confidence, Confidence::High);
        assert!(typescript.missing.is_empty());
        assert_eq!(tsx.current_status, CurrentStatus::ProductGrade);
        assert_eq!(tsx.confidence, Confidence::Medium);
        assert_eq!(
            tsx.missing,
            &[
                "dynamic_imports",
                "runtime_component_resolution",
                "complex_path_alias_resolution",
                "tsconfig_extends_resolution",
                "type_value_namespace_resolution",
            ]
        );
        for covered in [
            "complete_jsx_component_relationships",
            "complete_props_evidence",
            "cross_file_import_export_evidence",
        ] {
            assert!(!tsx.missing.contains(&covered), "covered TSX evidence: {covered}");
        }
        assert_eq!(rust.current_status, CurrentStatus::ProductGrade);
        assert_eq!(rust.external_tools, &["rust-analyzer"]);
        assert_eq!(rust.fallback, "none");
        assert_eq!(csharp.support_tier, SupportTier::VerifyOnly);
        assert_eq!(csharp.context, CapabilitySupport::NotSupported);
    }

    #[test]
    fn external_tools_match_current_deep_layers() {
        let expected = [
            ("TypeScript", &["typescript"][..]),
            ("TSX", &["typescript"][..]),
            ("Python", &["pyright"][..]),
            ("Rust", &["rust-analyzer"][..]),
            ("Go", &["gopls", "go"][..]),
            ("Java", &["jdtls", "javac"][..]),
            ("SQL", &["sqlfluff"][..]),
            ("Shell", &["shellcheck"][..]),
            ("C#", &["dotnet"][..]),
            ("PHP", &["php"][..]),
            ("Ruby", &["ruby"][..]),
            ("Kotlin", &["kotlinc"][..]),
            ("Dart", &["dart"][..]),
            ("Swift", &["swiftc", "xcrun"][..]),
            ("C/C++", &["clang", "gcc", "clang++", "g++"][..]),
        ];

        for (language, tools) in expected {
            assert_eq!(capability_for_name(language).unwrap().external_tools, tools);
        }
    }

    #[test]
    fn maps_every_registered_extension_case_insensitively() {
        let mut registered_extensions = std::collections::HashSet::new();

        for capability in LANGUAGE_CAPABILITIES {
            for extension in capability.extensions {
                assert!(
                    registered_extensions.insert(*extension),
                    "duplicate registered extension: {extension}"
                );

                for candidate in [
                    format!("src/file.{extension}"),
                    format!("src/file.{}", extension.to_ascii_uppercase()),
                ] {
                    let mapped = capability_for_path(&candidate)
                        .unwrap_or_else(|| panic!("unmapped registered path: {candidate}"));
                    assert_eq!(mapped.language, capability.language, "path: {candidate}");
                }
            }
        }
    }

    #[test]
    fn does_not_claim_unregistered_extensions() {
        assert!(capability_for_path("src/view.jsx").is_none());
        assert!(capability_for_path("README").is_none());
    }

    #[test]
    fn indexed_language_mapping_is_case_insensitive() {
        for (path, expected) in [
            ("src/file.TS", Lang::TypeScript),
            ("src/file.MTS", Lang::TypeScript),
            ("src/file.CTS", Lang::TypeScript),
            ("src/file.TSX", Lang::Tsx),
            ("src/file.RS", Lang::Rust),
            ("src/file.PY", Lang::Python),
            ("src/file.GO", Lang::Go),
            ("src/file.JAVA", Lang::Java),
        ] {
            assert_eq!(Lang::from_path(Path::new(path)), Some(expected), "{path}");
            assert!(capability_for_path(path).is_some(), "{path}");
        }
    }
}

impl Lang {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "ts" | "mts" | "cts" => Some(Lang::TypeScript),
            "tsx" => Some(Lang::Tsx),
            "rs" => Some(Lang::Rust),
            "py" => Some(Lang::Python),
            "go" => Some(Lang::Go),
            "java" => Some(Lang::Java),
            _ => None,
        }
    }

    pub fn tree_sitter_language(self) -> Language {
        match self {
            Lang::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
            Lang::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
            Lang::Rust => tree_sitter_rust::LANGUAGE.into(),
            Lang::Python => tree_sitter_python::LANGUAGE.into(),
            Lang::Go => tree_sitter_go::LANGUAGE.into(),
            Lang::Java => tree_sitter_java::LANGUAGE.into(),
        }
    }
}
