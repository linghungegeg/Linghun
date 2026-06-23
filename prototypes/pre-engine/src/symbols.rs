use std::collections::HashSet;
use std::path::Path;
use tree_sitter::{Node, Tree};

use crate::language::Lang;

#[derive(Debug, Clone)]
pub struct Definition {
    pub name: String,
    pub file: String,
    pub line: usize,
    pub signature: String,
    pub kind: SymbolKind,
}

#[derive(Debug, Clone)]
pub struct Reference {
    pub name: String,
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolKind {
    Function,
    Method,
    Class,
    Struct,
    Interface,
    Enum,
    Type,
    Variable,
    Constant,
}

pub fn extract_definitions(tree: &Tree, source: &str, path: &Path, lang: Lang) -> Vec<Definition> {
    let mut defs = Vec::new();
    let root = tree.root_node();
    collect_definitions(root, source, path, lang, &mut defs);
    defs
}

pub fn extract_references(tree: &Tree, source: &str, path: &Path, symbol: &str) -> Vec<Reference> {
    let mut refs = Vec::new();
    let root = tree.root_node();
    collect_references(root, source, path, symbol, &mut refs);
    refs
}

fn collect_definitions(node: Node, source: &str, path: &Path, lang: Lang, defs: &mut Vec<Definition>) {
    let def = match lang {
        Lang::TypeScript | Lang::Tsx => match_ts_definition(node, source, path),
        Lang::Rust => match_rust_definition(node, source, path),
        Lang::Python => match_python_definition(node, source, path),
        Lang::Go => match_go_definition(node, source, path),
        Lang::Java => match_java_definition(node, source, path),
    };
    if let Some(d) = def {
        defs.push(d);
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_definitions(cursor.node(), source, path, lang, defs);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn collect_references(node: Node, source: &str, path: &Path, symbol: &str, refs: &mut Vec<Reference>) {
    if node.kind() == "identifier" || node.kind() == "property_identifier" || node.kind() == "type_identifier" {
        let text = node_text(node, source);
        if text == symbol {
            refs.push(Reference {
                name: text.to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
            });
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_references(cursor.node(), source, path, symbol, refs);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn node_text<'a>(node: Node, source: &'a str) -> &'a str {
    &source[node.byte_range()]
}

fn match_ts_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    let kind = node.kind();
    match kind {
        "function_declaration" | "generator_function_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Function,
            })
        }
        "method_definition" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Method,
            })
        }
        "class_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Class,
            })
        }
        "interface_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Interface,
            })
        }
        "type_alias_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Type,
            })
        }
        "lexical_declaration" | "variable_declaration" => {
            let declarator = node.child_by_field_name("declarator")
                .or_else(|| find_child_by_kind(node, "variable_declarator"))?;
            let name_node = declarator.child_by_field_name("name")?;
            let text = node_text(name_node, source);
            if text.chars().next().map_or(false, |c| c.is_uppercase()) || is_arrow_or_func_value(declarator, source) {
                Some(Definition {
                    name: text.to_string(),
                    file: path.to_string_lossy().to_string(),
                    line: node.start_position().row + 1,
                    signature: extract_signature(node, source),
                    kind: if text.chars().next().map_or(false, |c| c.is_uppercase()) {
                        SymbolKind::Constant
                    } else {
                        SymbolKind::Function
                    },
                })
            } else {
                None
            }
        }
        "export_statement" => None,
        "enum_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Enum,
            })
        }
        _ => None,
    }
}

fn match_rust_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    match node.kind() {
        "function_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Function,
            })
        }
        "struct_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Struct,
            })
        }
        "enum_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Enum,
            })
        }
        "trait_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Interface,
            })
        }
        "impl_item" => None,
        "type_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Type,
            })
        }
        "const_item" | "static_item" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Constant,
            })
        }
        _ => None,
    }
}

fn match_python_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    match node.kind() {
        "function_definition" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Function,
            })
        }
        "class_definition" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Class,
            })
        }
        _ => None,
    }
}

fn match_go_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    match node.kind() {
        "function_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Function,
            })
        }
        "method_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Method,
            })
        }
        "type_declaration" => {
            let child = find_child_by_kind(node, "type_spec")?;
            let name_node = child.child_by_field_name("name")?;
            let type_node = child.child_by_field_name("type")?;
            let sk = if type_node.kind() == "struct_type" {
                SymbolKind::Struct
            } else if type_node.kind() == "interface_type" {
                SymbolKind::Interface
            } else {
                SymbolKind::Type
            };
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: child.start_position().row + 1,
                signature: extract_signature(child, source),
                kind: sk,
            })
        }
        _ => None,
    }
}

fn match_java_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    match node.kind() {
        "method_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Method,
            })
        }
        "class_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Class,
            })
        }
        "interface_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Interface,
            })
        }
        "enum_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Enum,
            })
        }
        _ => None,
    }
}

fn extract_signature(node: Node, source: &str) -> String {
    let start = node.start_byte();
    let text = &source[start..];
    if let Some(brace) = text.find('{') {
        text[..brace].trim().to_string()
    } else {
        let end = text.find('\n').unwrap_or(text.len().min(200));
        text[..end].trim().to_string()
    }
}

fn find_child_by_kind<'a>(node: Node<'a>, kind: &str) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            if cursor.node().kind() == kind {
                return Some(cursor.node());
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    None
}

fn is_arrow_or_func_value(declarator: Node, _source: &str) -> bool {
    if let Some(value) = declarator.child_by_field_name("value") {
        let kind = value.kind();
        kind == "arrow_function" || kind == "function_expression" || kind == "function"
    } else {
        false
    }
}

#[derive(Debug, Clone)]
pub struct Callee {
    pub name: String,
    pub file: String,
    pub line: usize,
    pub is_member: bool,
}

pub fn extract_callees(tree: &Tree, source: &str, path: &Path, symbol: &str, lang: Lang) -> Vec<Callee> {
    let root = tree.root_node();
    let body = find_function_body(root, source, symbol, lang);
    let mut callees = Vec::new();
    if let Some(body_node) = body {
        collect_callees(body_node, source, path, &mut callees);
    }
    dedup_callees(&mut callees);
    callees
}

pub fn extract_callers(
    tree: &Tree,
    source: &str,
    path: &Path,
    symbol: &str,
    lang: Lang,
) -> Vec<Callee> {
    let root = tree.root_node();
    let mut callers = Vec::new();
    collect_callers(root, source, path, symbol, lang, &mut callers);
    callers
}

fn find_function_body<'a>(node: Node<'a>, source: &str, symbol: &str, lang: Lang) -> Option<Node<'a>> {
    let is_target = match lang {
        Lang::TypeScript | Lang::Tsx => matches!(node.kind(), "function_declaration" | "method_definition" | "lexical_declaration" | "variable_declaration"),
        Lang::Rust => node.kind() == "function_item",
        Lang::Python => node.kind() == "function_definition",
        Lang::Go => matches!(node.kind(), "function_declaration" | "method_declaration"),
        Lang::Java => node.kind() == "method_declaration",
    };
    if is_target {
        let name = get_def_name(node, source, lang);
        if name.as_deref() == Some(symbol) {
            return node.child_by_field_name("body");
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            if let Some(found) = find_function_body(cursor.node(), source, symbol, lang) {
                return Some(found);
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    None
}

fn get_def_name(node: Node, source: &str, lang: Lang) -> Option<String> {
    match lang {
        Lang::TypeScript | Lang::Tsx => {
            if matches!(node.kind(), "lexical_declaration" | "variable_declaration") {
                let declarator = node.child_by_field_name("declarator")
                    .or_else(|| find_child_by_kind(node, "variable_declarator"))?;
                let name_node = declarator.child_by_field_name("name")?;
                Some(node_text(name_node, source).to_string())
            } else {
                let name_node = node.child_by_field_name("name")?;
                Some(node_text(name_node, source).to_string())
            }
        }
        _ => {
            let name_node = node.child_by_field_name("name")?;
            Some(node_text(name_node, source).to_string())
        }
    }
}

fn collect_callees(node: Node, source: &str, path: &Path, callees: &mut Vec<Callee>) {
    if node.kind() == "call_expression" || node.kind() == "macro_invocation" {
        let func_node = node.child_by_field_name("function")
            .or_else(|| node.child_by_field_name("macro"));
        let is_member = func_node.map_or(false, |f| {
            matches!(f.kind(), "member_expression" | "field_expression" | "scoped_identifier")
        });
        let is_optional_ident_call = !is_member
            && func_node.map_or(false, |f| f.kind() == "identifier")
            && node.child_by_field_name("optional_chain").is_some();
        if let Some(name) = extract_call_name(node, source) {
            callees.push(Callee {
                name,
                is_member: is_member || is_optional_ident_call,
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
            });
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_callees(cursor.node(), source, path, callees);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn extract_call_name(node: Node, source: &str) -> Option<String> {
    let func_node = node.child_by_field_name("function")
        .or_else(|| node.child_by_field_name("macro"))?;
    match func_node.kind() {
        "identifier" | "type_identifier" => Some(node_text(func_node, source).to_string()),
        "member_expression" | "field_expression" | "scoped_identifier" => {
            if let Some(prop) = func_node.child_by_field_name("name")
                .or_else(|| func_node.child_by_field_name("field"))
                .or_else(|| func_node.child_by_field_name("property"))
            {
                Some(node_text(prop, source).to_string())
            } else {
                Some(node_text(func_node, source).to_string())
            }
        }
        _ => Some(node_text(func_node, source).to_string()),
    }
}

fn collect_callers(node: Node, source: &str, path: &Path, target: &str, lang: Lang, callers: &mut Vec<Callee>) {
    let is_func = matches!(node.kind(),
        "function_declaration" | "method_definition" | "function_item" |
        "function_definition" | "method_declaration" | "lexical_declaration" | "variable_declaration"
    );
    if is_func {
        if let Some(caller_name) = get_def_name(node, source, lang) {
            if caller_name != target {
                if let Some(body) = node.child_by_field_name("body") {
                    if body_calls_symbol(body, source, target) {
                        callers.push(Callee {
                            name: caller_name,
                            is_member: false,
                            file: path.to_string_lossy().to_string(),
                            line: node.start_position().row + 1,
                        });
                    }
                }
            }
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_callers(cursor.node(), source, path, target, lang, callers);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn body_calls_symbol(node: Node, source: &str, target: &str) -> bool {
    if node.kind() == "call_expression" || node.kind() == "macro_invocation" {
        if let Some(name) = extract_call_name(node, source) {
            if name == target {
                return true;
            }
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            if body_calls_symbol(cursor.node(), source, target) {
                return true;
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    false
}

fn dedup_callees(callees: &mut Vec<Callee>) {
    let mut seen = std::collections::HashSet::new();
    callees.retain(|c| seen.insert(c.name.clone()));
}

pub fn extract_imports(tree: &Tree, source: &str, lang: Lang) -> HashSet<String> {
    let mut names = HashSet::new();
    if !matches!(lang, Lang::TypeScript | Lang::Tsx) {
        return names;
    }
    collect_import_names(tree.root_node(), source, &mut names);
    names
}

fn collect_import_names(node: Node, source: &str, names: &mut HashSet<String>) {
    if node.kind() == "import_statement" {
        collect_identifiers_under(node, source, names);
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_import_names(cursor.node(), source, names);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

fn collect_identifiers_under(node: Node, source: &str, names: &mut HashSet<String>) {
    if node.kind() == "identifier" || node.kind() == "property_identifier" {
        names.insert(node_text(node, source).to_string());
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_identifiers_under(cursor.node(), source, names);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}
