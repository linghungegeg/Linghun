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
    pub param_count: usize,
}

#[derive(Debug, Clone)]
pub struct Reference {
    pub name: String,
    pub qualified_name: Option<String>,
    pub file: String,
    pub line: usize,
}

#[derive(Debug, Clone)]
pub struct PythonTokenPosition {
    pub name: String,
    pub line: usize,
    pub character: usize,
    pub specifier: Option<String>,
}

#[derive(Debug, Clone)]
pub struct RustTokenPosition {
    pub name: String,
    pub line: usize,
    pub character: usize,
    pub specifier: Option<String>,
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

pub fn extract_python_symbol_positions(
    tree: &Tree,
    source: &str,
    symbols: &HashSet<String>,
) -> Vec<PythonTokenPosition> {
    let mut positions = Vec::new();
    collect_python_token_positions(
        tree.root_node(),
        source,
        symbols,
        None,
        &mut positions,
    );
    positions
}

pub fn extract_python_import_tokens(tree: &Tree, source: &str) -> Vec<PythonTokenPosition> {
    let mut positions = Vec::new();
    collect_python_import_tokens(tree.root_node(), source, &mut positions);
    positions
}

pub fn extract_rust_symbol_positions(
    tree: &Tree,
    source: &str,
    symbols: &HashSet<String>,
) -> Vec<RustTokenPosition> {
    let mut positions = Vec::new();
    collect_rust_token_positions(tree.root_node(), source, symbols, None, &mut positions);
    positions
}

pub fn extract_rust_import_tokens(tree: &Tree, source: &str) -> Vec<RustTokenPosition> {
    let mut positions = Vec::new();
    collect_rust_import_tokens(tree.root_node(), source, &mut positions);
    positions
}

fn collect_rust_import_tokens(node: Node, source: &str, positions: &mut Vec<RustTokenPosition>) {
    if node.kind() == "use_declaration" {
        collect_rust_token_positions(
            node, source, &HashSet::new(), Some(node_text(node, source).trim().to_string()), positions,
        );
        return;
    }
    if node.kind() == "mod_item" {
        if node.child_by_field_name("body").is_none() {
            if let Some(name) = node.child_by_field_name("name") {
                collect_rust_token_positions(
                    name, source, &HashSet::new(), Some(node_text(node, source).trim().to_string()), positions,
                );
            }
        } else if let Some(body) = node.child_by_field_name("body") {
            collect_rust_import_tokens(body, source, positions);
        }
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_rust_import_tokens(cursor.node(), source, positions);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

fn collect_rust_token_positions(
    node: Node,
    source: &str,
    symbols: &HashSet<String>,
    specifier: Option<String>,
    positions: &mut Vec<RustTokenPosition>,
) {
    if matches!(node.kind(), "identifier" | "type_identifier" | "field_identifier") {
        let name = node_text(node, source);
        if symbols.is_empty() || symbols.contains(name) {
            positions.push(RustTokenPosition {
                name: name.to_string(), line: node.start_position().row,
                character: lsp_character(source, node.start_byte()), specifier: specifier.clone(),
            });
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_rust_token_positions(cursor.node(), source, symbols, specifier.clone(), positions);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

fn collect_python_import_tokens(
    node: Node,
    source: &str,
    positions: &mut Vec<PythonTokenPosition>,
) {
    if matches!(node.kind(), "import_statement" | "import_from_statement") {
        let symbols = HashSet::new();
        collect_python_token_positions(
            node,
            source,
            &symbols,
            Some(node_text(node, source).trim().to_string()),
            positions,
        );
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_python_import_tokens(cursor.node(), source, positions);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn collect_python_token_positions(
    node: Node,
    source: &str,
    symbols: &HashSet<String>,
    specifier: Option<String>,
    positions: &mut Vec<PythonTokenPosition>,
) {
    if node.kind() == "identifier" {
        let name = node_text(node, source);
        if symbols.is_empty() || symbols.contains(name) {
            positions.push(PythonTokenPosition {
                name: name.to_string(),
                line: node.start_position().row,
                character: lsp_character(source, node.start_byte()),
                specifier: specifier.clone(),
            });
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_python_token_positions(
                cursor.node(),
                source,
                symbols,
                specifier.clone(),
                positions,
            );
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn lsp_character(source: &str, byte_offset: usize) -> usize {
    let line_start = source[..byte_offset]
        .rfind('\n')
        .map_or(0, |offset| offset + 1);
    source[line_start..byte_offset].encode_utf16().count()
}

fn collect_definitions(node: Node, source: &str, path: &Path, lang: Lang, defs: &mut Vec<Definition>) {
    let def = match lang {
        Lang::TypeScript | Lang::Tsx => match_ts_definition(node, source, path, lang),
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
    if matches!(
        node.kind(),
        "identifier" | "property_identifier" | "type_identifier" | "field_identifier"
    ) {
        let text = node_text(node, source);
        if text == symbol && !is_ignored_jsx_reference(node, source) {
            refs.push(Reference {
                name: text.to_string(),
                qualified_name: jsx_qualified_name(node, source),
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

fn match_ts_definition(node: Node, source: &str, path: &Path, lang: Lang) -> Option<Definition> {
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
                param_count: count_params(node),
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
                param_count: count_params(node),
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
            })
        }
        "lexical_declaration" | "variable_declaration" => {
            let declarator = node.child_by_field_name("declarator")
                .or_else(|| find_child_by_kind(node, "variable_declarator"))?;
            let name_node = declarator.child_by_field_name("name")?;
            let text = node_text(name_node, source);
            let is_uppercase = text.chars().next().is_some_and(char::is_uppercase);
            let is_function_value = is_arrow_or_func_value(declarator, source);
            let is_wrapped_component = lang == Lang::Tsx
                && declarator
                    .child_by_field_name("value")
                    .is_some_and(|value| is_component_wrapper_call(value, source));
            if is_uppercase || is_function_value {
                let pc = declarator.child_by_field_name("value")
                    .map(|v| count_params(v))
                    .unwrap_or(0);
                Some(Definition {
                    name: text.to_string(),
                    file: path.to_string_lossy().to_string(),
                    line: node.start_position().row + 1,
                    signature: extract_signature(node, source),
                    kind: if is_function_value && (!is_uppercase || lang == Lang::Tsx)
                        || is_wrapped_component
                    {
                        SymbolKind::Function
                    } else {
                        SymbolKind::Constant
                    },
                    param_count: pc,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
            })
        }
        "type_spec" => {
            let name_node = node.child_by_field_name("name")?;
            let type_node = node.child_by_field_name("type")?;
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
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: sk,
                param_count: 0,
            })
        }
        _ => None,
    }
}

fn match_java_definition(node: Node, source: &str, path: &Path) -> Option<Definition> {
    match node.kind() {
        "method_declaration" | "constructor_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Method,
                param_count: 0,
            })
        }
        "class_declaration" | "record_declaration" => {
            let name_node = node.child_by_field_name("name")?;
            Some(Definition {
                name: node_text(name_node, source).to_string(),
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                signature: extract_signature(node, source),
                kind: SymbolKind::Class,
                param_count: 0,
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
                param_count: 0,
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
                param_count: 0,
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

fn is_component_wrapper_call(node: Node, source: &str) -> bool {
    node.kind() == "call_expression"
        && extract_call_name(node, source)
            .is_some_and(|name| matches!(name.as_str(), "memo" | "forwardRef"))
}

#[derive(Debug, Clone)]
pub struct Callee {
    pub name: String,
    pub qualified_name: Option<String>,
    pub file: String,
    pub line: usize,
    pub is_member: bool,
    pub arg_count: usize,
}

pub fn extract_callees(tree: &Tree, source: &str, path: &Path, symbol: &str, lang: Lang) -> Vec<Callee> {
    let root = tree.root_node();
    let body = find_function_body(root, source, symbol, lang);
    let mut callees = Vec::new();
    if let Some(body_node) = body {
        collect_callees(body_node, source, path, lang, &mut callees);
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
        Lang::TypeScript => matches!(node.kind(), "function_declaration" | "method_definition" | "lexical_declaration" | "variable_declaration"),
        Lang::Tsx => matches!(node.kind(), "function_declaration" | "method_definition" | "lexical_declaration" | "variable_declaration" | "class_declaration"),
        Lang::Rust => node.kind() == "function_item",
        Lang::Python => node.kind() == "function_definition",
        Lang::Go => matches!(node.kind(), "function_declaration" | "method_declaration"),
        Lang::Java => matches!(node.kind(), "method_declaration" | "constructor_declaration"),
    };
    if is_target {
        let name = get_def_name(node, source, lang);
        if name.as_deref() == Some(symbol) {
            return definition_body(node, source, lang);
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

fn definition_body<'a>(node: Node<'a>, source: &str, lang: Lang) -> Option<Node<'a>> {
    if lang != Lang::Tsx {
        return node.child_by_field_name("body");
    }
    match node.kind() {
        "lexical_declaration" | "variable_declaration" => {
            let declarator = node
                .child_by_field_name("declarator")
                .or_else(|| find_child_by_kind(node, "variable_declarator"))?;
            let value = declarator.child_by_field_name("value")?;
            value.child_by_field_name("body").or(Some(value))
        }
        "class_declaration" => find_class_render_body(node, source),
        _ => node.child_by_field_name("body"),
    }
}

fn find_class_render_body<'a>(node: Node<'a>, source: &str) -> Option<Node<'a>> {
    let class_body = node.child_by_field_name("body")?;
    let mut cursor = class_body.walk();
    if cursor.goto_first_child() {
        loop {
            let child = cursor.node();
            if child.kind() == "method_definition"
                && child
                    .child_by_field_name("name")
                    .is_some_and(|name| node_text(name, source) == "render")
            {
                return child.child_by_field_name("body");
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

fn collect_callees(node: Node, source: &str, path: &Path, lang: Lang, callees: &mut Vec<Callee>) {
    if is_call_node(node, lang) {
        let func_node = call_target_node(node);
        let is_member = node.kind() == "method_invocation"
            && node.child_by_field_name("object").is_some()
            || func_node.is_some_and(|function| {
                matches!(
                    function.kind(),
                    "member_expression"
                        | "field_expression"
                        | "scoped_identifier"
                        | "attribute"
                        | "selector_expression"
                )
            });
        let is_optional_ident_call = !is_member
            && func_node.map_or(false, |f| f.kind() == "identifier")
            && node.child_by_field_name("optional_chain").is_some();
        if let Some(name) = extract_call_name(node, source) {
            callees.push(Callee {
                name,
                qualified_name: None,
                is_member: is_member || is_optional_ident_call,
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                arg_count: count_call_args(node),
            });
        }
        if lang == Lang::Tsx {
            if let Some((name, is_member, qualified_name)) = extract_wrapped_component_name(node, source) {
                callees.push(Callee {
                    name,
                    qualified_name,
                    is_member,
                    file: path.to_string_lossy().to_string(),
                    line: node.start_position().row + 1,
                    arg_count: 0,
                });
            }
        }
    } else if lang == Lang::Tsx {
        if let Some((name, is_member, qualified_name)) = extract_jsx_component_name(node, source) {
            callees.push(Callee {
                name,
                qualified_name,
                is_member,
                file: path.to_string_lossy().to_string(),
                line: node.start_position().row + 1,
                arg_count: 0,
            });
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_callees(cursor.node(), source, path, lang, callees);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn extract_jsx_component_name(node: Node, source: &str) -> Option<(String, bool, Option<String>)> {
    if !matches!(node.kind(), "jsx_opening_element" | "jsx_self_closing_element") {
        return None;
    }
    let name = node.child_by_field_name("name")?;
    component_name(name, source, true)
}

fn extract_wrapped_component_name(node: Node, source: &str) -> Option<(String, bool, Option<String>)> {
    if !is_component_wrapper_call(node, source) {
        return None;
    }
    let arguments = node.child_by_field_name("arguments")?;
    let mut cursor = arguments.walk();
    if cursor.goto_first_child() {
        loop {
            let argument = cursor.node();
            if argument.is_named() {
                if let Some(name) = component_name(argument, source, true) {
                    return Some(name);
                }
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    None
}

fn component_name(
    node: Node,
    source: &str,
    require_uppercase: bool,
) -> Option<(String, bool, Option<String>)> {
    match node.kind() {
        "identifier" => {
            let name = node_text(node, source);
            if require_uppercase && !name.chars().next().is_some_and(char::is_uppercase) {
                return None;
            }
            Some((name.to_string(), false, None))
        }
        "member_expression" => {
            let qualified_name = node_text(node, source);
            if require_uppercase
                && !qualified_name
                    .chars()
                    .next()
                    .is_some_and(char::is_uppercase)
            {
                return None;
            }
            let property = node.child_by_field_name("property")?;
            Some((
                node_text(property, source).to_string(),
                true,
                Some(qualified_name.to_string()),
            ))
        }
        _ => None,
    }
}

fn extract_call_name(node: Node, source: &str) -> Option<String> {
    let func_node = call_target_node(node)?;
    match func_node.kind() {
        "identifier" | "type_identifier" => Some(node_text(func_node, source).to_string()),
        "member_expression"
        | "field_expression"
        | "scoped_identifier"
        | "attribute"
        | "selector_expression" => {
            if let Some(prop) = func_node.child_by_field_name("name")
                .or_else(|| func_node.child_by_field_name("field"))
                .or_else(|| func_node.child_by_field_name("property"))
                .or_else(|| func_node.child_by_field_name("attribute"))
            {
                Some(node_text(prop, source).to_string())
            } else {
                Some(node_text(func_node, source).to_string())
            }
        }
        _ => Some(node_text(func_node, source).to_string()),
    }
}

fn call_target_node(node: Node) -> Option<Node> {
    match node.kind() {
        "method_invocation" => node.child_by_field_name("name"),
        "object_creation_expression" => node.child_by_field_name("type"),
        _ => node
            .child_by_field_name("function")
            .or_else(|| node.child_by_field_name("macro")),
    }
}

fn is_call_node(node: Node, lang: Lang) -> bool {
    match lang {
        Lang::Python => node.kind() == "call",
        Lang::Java => matches!(node.kind(), "method_invocation" | "object_creation_expression"),
        _ => matches!(node.kind(), "call_expression" | "macro_invocation"),
    }
}

fn collect_callers(node: Node, source: &str, path: &Path, target: &str, lang: Lang, callers: &mut Vec<Callee>) {
    let is_func = matches!(node.kind(),
        "function_declaration" | "method_definition" | "function_item" |
        "function_definition" | "method_declaration" | "constructor_declaration" |
        "lexical_declaration" | "variable_declaration"
    ) || lang == Lang::Tsx && node.kind() == "class_declaration";
    if is_func {
        if let Some(caller_name) = get_def_name(node, source, lang) {
            if caller_name != target && !is_tsx_class_render_method(node, source, lang) {
                if let Some(body) = definition_body(node, source, lang) {
                    if body_calls_symbol(body, source, target, lang) {
                        callers.push(Callee {
                            name: caller_name,
                            qualified_name: None,
                            is_member: false,
                            file: path.to_string_lossy().to_string(),
                            line: node.start_position().row + 1,
                            arg_count: 0,
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

fn body_calls_symbol(node: Node, source: &str, target: &str, lang: Lang) -> bool {
    if is_call_node(node, lang) {
        if let Some(name) = extract_call_name(node, source) {
            if name == target {
                return true;
            }
        }
    }
    if lang == Lang::Tsx {
        if extract_jsx_component_name(node, source).is_some_and(|(name, _, _)| name == target)
            || extract_wrapped_component_name(node, source)
                .is_some_and(|(name, _, _)| name == target)
        {
            return true;
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            if body_calls_symbol(cursor.node(), source, target, lang) {
                return true;
            }
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
    false
}

fn is_tsx_class_render_method(node: Node, source: &str, lang: Lang) -> bool {
    lang == Lang::Tsx
        && node.kind() == "method_definition"
        && node
            .child_by_field_name("name")
            .is_some_and(|name| node_text(name, source) == "render")
        && node
            .parent()
            .and_then(|class_body| class_body.parent())
            .is_some_and(|parent| parent.kind() == "class_declaration")
}

fn dedup_callees(callees: &mut Vec<Callee>) {
    let mut seen = std::collections::HashSet::new();
    callees.retain(|callee| {
        let identity = callee
            .qualified_name
            .clone()
            .unwrap_or_else(|| callee.name.clone());
        seen.insert((identity, callee.is_member))
    });
}

fn count_params(node: Node) -> usize {
    let params = node.child_by_field_name("parameters")
        .or_else(|| node.child_by_field_name("params"));
    params.map_or(0, |p| {
        let mut cursor = p.walk();
        let mut count = 0;
        if cursor.goto_first_child() {
            loop {
                let k = cursor.node().kind();
                if k != "," && k != "(" && k != ")" {
                    count += 1;
                }
                if !cursor.goto_next_sibling() { break; }
            }
        }
        count
    })
}

fn count_call_args(node: Node) -> usize {
    let args = node.child_by_field_name("arguments");
    args.map_or(0, |a| {
        let mut cursor = a.walk();
        let mut count = 0;
        if cursor.goto_first_child() {
            loop {
                let k = cursor.node().kind();
                if k != "," && k != "(" && k != ")" {
                    count += 1;
                }
                if !cursor.goto_next_sibling() { break; }
            }
        }
        count
    })
}

pub fn extract_imports(tree: &Tree, source: &str, lang: Lang) -> HashSet<String> {
    let mut names = HashSet::new();
    collect_import_names(tree.root_node(), source, lang, &mut names);
    names
}

#[cfg(test)]
pub fn extract_typescript_module_specifiers_for_symbol(
    tree: &Tree,
    source: &str,
    lang: Lang,
    symbol: &str,
) -> HashSet<String> {
    let mut specifiers = HashSet::new();
    if matches!(lang, Lang::TypeScript | Lang::Tsx) {
        collect_typescript_module_specifiers(
            tree.root_node(),
            source,
            symbol,
            &mut specifiers,
        );
    }
    specifiers
}

#[cfg(test)]
fn collect_typescript_module_specifiers(
    node: Node,
    source: &str,
    symbol: &str,
    specifiers: &mut HashSet<String>,
) {
    if matches!(node.kind(), "import_statement" | "export_statement") {
        let mut names = HashSet::new();
        collect_identifiers_under(node, source, &mut names);
        if names.contains(symbol) {
            let source_node = node
                .child_by_field_name("source")
                .or_else(|| find_child_by_kind(node, "string"));
            if let Some(source_node) = source_node {
                let specifier = node_text(source_node, source)
                    .trim_matches(|character| character == '\'' || character == '"')
                    .to_string();
                if !specifier.is_empty() {
                    specifiers.insert(specifier);
                }
            }
        }
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_typescript_module_specifiers(cursor.node(), source, symbol, specifiers);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn collect_import_names(node: Node, source: &str, lang: Lang, names: &mut HashSet<String>) {
    if lang == Lang::Rust && node.kind() == "mod_item" {
        if let Some(name) = node.child_by_field_name("name") {
            names.insert(node_text(name, source).to_string());
        }
    }
    let is_import = match lang {
        Lang::TypeScript | Lang::Tsx => node.kind() == "import_statement",
        Lang::Python => matches!(node.kind(), "import_statement" | "import_from_statement"),
        Lang::Go => matches!(node.kind(), "import_declaration" | "package_clause"),
        Lang::Rust => matches!(node.kind(), "use_declaration" | "extern_crate_declaration"),
        Lang::Java => matches!(node.kind(), "import_declaration" | "package_declaration"),
    };
    if is_import {
        collect_identifiers_under(node, source, names);
        if lang == Lang::Go {
            collect_import_path_names(node, source, names);
        }
        return;
    }
    if matches!(lang, Lang::TypeScript | Lang::Tsx) && node.kind() == "export_statement" {
        let mut cursor = node.walk();
        if cursor.goto_first_child() {
            loop {
                if cursor.node().kind() == "export_clause" {
                    collect_identifiers_under(cursor.node(), source, names);
                }
                if !cursor.goto_next_sibling() { break; }
            }
        }
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_import_names(cursor.node(), source, lang, names);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

fn collect_identifiers_under(node: Node, source: &str, names: &mut HashSet<String>) {
    if matches!(
        node.kind(),
        "identifier"
            | "property_identifier"
            | "field_identifier"
            | "type_identifier"
            | "package_identifier"
    ) {
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

pub fn extract_local_bindings(tree: &Tree, source: &str) -> HashSet<String> {
    let mut names = HashSet::new();
    collect_bindings(tree.root_node(), source, &mut names);
    names
}

fn collect_bindings(node: Node, source: &str, names: &mut HashSet<String>) {
    if matches!(node.kind(), "required_parameter" | "optional_parameter" | "rest_parameter") {
        let mut c = node.walk();
        if c.goto_first_child() {
            loop {
                if c.node().kind() == "identifier" {
                    names.insert(node_text(c.node(), source).to_string());
                    break;
                }
                if !c.goto_next_sibling() { break; }
            }
        }
        return;
    }
    if node.kind() == "variable_declarator" {
        if let Some(n) = node.child_by_field_name("name").filter(|n| n.kind() == "identifier") {
            names.insert(node_text(n, source).to_string());
        }
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_bindings(cursor.node(), source, names);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

pub fn extract_all_callees_grouped(tree: &Tree, source: &str, path: &Path, lang: Lang) -> Vec<(String, Vec<Callee>)> {
    let mut result = Vec::new();
    collect_functions_and_callees(tree.root_node(), source, path, lang, &mut result);
    for (_, callees) in &mut result {
        dedup_callees(callees);
    }
    result
}

fn collect_functions_and_callees(node: Node, source: &str, path: &Path, lang: Lang, out: &mut Vec<(String, Vec<Callee>)>) {
    let is_fn = match lang {
        Lang::TypeScript => matches!(node.kind(), "function_declaration" | "method_definition" | "lexical_declaration" | "variable_declaration"),
        Lang::Tsx => matches!(node.kind(), "function_declaration" | "method_definition" | "lexical_declaration" | "variable_declaration" | "class_declaration"),
        Lang::Rust => node.kind() == "function_item",
        Lang::Python => node.kind() == "function_definition",
        Lang::Go => matches!(node.kind(), "function_declaration" | "method_declaration"),
        Lang::Java => matches!(node.kind(), "method_declaration" | "constructor_declaration"),
    };
    if is_fn {
        if let Some(name) = get_def_name(node, source, lang) {
            if !is_tsx_class_render_method(node, source, lang) {
                if let Some(body) = definition_body(node, source, lang) {
                    let mut callees = Vec::new();
                    collect_callees(body, source, path, lang, &mut callees);
                    out.push((name, callees));
                }
            }
        }
        if lang != Lang::Tsx || node.kind() != "class_declaration" {
            return;
        }
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_functions_and_callees(cursor.node(), source, path, lang, out);
            if !cursor.goto_next_sibling() { break; }
        }
    }
}

fn is_ignored_jsx_reference(node: Node, source: &str) -> bool {
    let Some((tag, name)) = jsx_tag_name(node) else {
        return false;
    };
    if tag.kind() == "jsx_closing_element" {
        return true;
    }
    if !matches!(tag.kind(), "jsx_opening_element" | "jsx_self_closing_element") {
        return false;
    }
    match name.kind() {
        "identifier" => node_text(name, source)
            .chars()
            .next()
            .is_some_and(char::is_lowercase),
        "jsx_namespace_name" => true,
        _ => false,
    }
}

fn collect_import_path_names(node: Node, source: &str, names: &mut HashSet<String>) {
    if matches!(
        node.kind(),
        "interpreted_string_literal" | "raw_string_literal" | "string_literal" | "string"
    ) {
        let path = node_text(node, source).trim_matches(['"', '\'', '`']);
        if let Some(name) = path.rsplit('/').next().filter(|name| !name.is_empty()) {
            names.insert(name.to_string());
        }
        return;
    }
    let mut cursor = node.walk();
    if cursor.goto_first_child() {
        loop {
            collect_import_path_names(cursor.node(), source, names);
            if !cursor.goto_next_sibling() {
                break;
            }
        }
    }
}

fn jsx_qualified_name(node: Node, source: &str) -> Option<String> {
    let (tag, name) = jsx_tag_name(node)?;
    if tag.kind() == "jsx_closing_element" || name.kind() != "member_expression" {
        return None;
    }
    Some(node_text(name, source).to_string())
}

fn jsx_tag_name<'a>(node: Node<'a>) -> Option<(Node<'a>, Node<'a>)> {
    let mut name = node;
    while name
        .parent()
        .is_some_and(|parent| parent.kind() == "member_expression")
    {
        name = name.parent()?;
    }
    let tag = name.parent()?;
    if !matches!(
        tag.kind(),
        "jsx_opening_element" | "jsx_self_closing_element" | "jsx_closing_element"
    ) {
        return None;
    }
    let tag_name = tag.child_by_field_name("name")?;
    (tag_name.byte_range() == name.byte_range()).then_some((tag, tag_name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tree_sitter::Parser;

    const TSX_COMPONENTS: &str = include_str!("../fixtures/tsx/components.tsx");
    const SHARED_PROPS: &str = include_str!("../fixtures/tsx/shared-props.ts");
    const SHARED_BUTTON: &str = include_str!("../fixtures/tsx/shared-button.tsx");
    const BARREL: &str = include_str!("../fixtures/tsx/barrel.ts");
    const DASHBOARD: &str = include_str!("../fixtures/tsx/dashboard.tsx");
    const ALIAS_DASHBOARD: &str = include_str!("../fixtures/tsx/alias-dashboard.tsx");
    const PYTHON_SHARED: &str = include_str!("../fixtures/structural-languages/python/shared.py");
    const PYTHON_CONSUMER: &str = include_str!("../fixtures/structural-languages/python/consumer.py");
    const GO_SHARED: &str = include_str!("../fixtures/structural-languages/go/shared.go");
    const GO_CONSUMER: &str = include_str!("../fixtures/structural-languages/go/consumer.go");
    const RUST_SHARED: &str = include_str!("../fixtures/structural-languages/rust/shared.rs");
    const RUST_CONSUMER: &str = include_str!("../fixtures/structural-languages/rust/consumer.rs");
    const JAVA_SHARED: &str = include_str!("../fixtures/structural-languages/java/SharedService.java");
    const JAVA_CONSUMER: &str = include_str!("../fixtures/structural-languages/java/Consumer.java");

    fn parse_tsx() -> Tree {
        let mut parser = Parser::new();
        parser
            .set_language(&Lang::Tsx.tree_sitter_language())
            .expect("TSX grammar must load");
        parser.parse(TSX_COMPONENTS, None).expect("fixture must parse")
    }

    fn parse_fixture(lang: Lang, source: &str) -> Tree {
        let mut parser = Parser::new();
        parser
            .set_language(&lang.tree_sitter_language())
            .expect("language grammar must load");
        let tree = parser.parse(source, None).expect("fixture must parse");
        assert!(!tree.root_node().has_error(), "{lang:?} fixture must parse cleanly");
        tree
    }

    #[test]
    fn extracts_tsx_component_definitions() {
        let tree = parse_tsx();
        assert!(!tree.root_node().has_error());
        let definitions = extract_definitions(
            &tree,
            TSX_COMPONENTS,
            Path::new("fixtures/tsx/components.tsx"),
            Lang::Tsx,
        );

        for (name, kind) in [
            ("Button", SymbolKind::Function),
            ("Card", SymbolKind::Function),
            ("LegacyPanel", SymbolKind::Class),
            ("MemoButton", SymbolKind::Function),
            ("ForwardInput", SymbolKind::Function),
            ("ButtonProps", SymbolKind::Interface),
            ("CardProps", SymbolKind::Type),
        ] {
            assert!(
                definitions.iter().any(|definition| definition.name == name && definition.kind == kind),
                "missing {name:?} definition with kind {kind:?}"
            );
        }
    }

    #[test]
    fn extracts_jsx_component_render_relationships() {
        let tree = parse_tsx();
        let path = Path::new("fixtures/tsx/components.tsx");

        let card = extract_callees(&tree, TSX_COMPONENTS, path, "Card", Lang::Tsx);
        assert!(card.iter().any(|callee| callee.name == "Button" && !callee.is_member));
        assert!(!card.iter().any(|callee| callee.name == "article"));

        let screen = extract_callees(&tree, TSX_COMPONENTS, path, "Screen", Lang::Tsx);
        for name in ["MemoButton", "Item", "Card", "ForwardInput"] {
            assert!(screen.iter().any(|callee| callee.name == name), "missing {name:?} JSX callee");
        }
        assert!(screen.iter().any(|callee| {
            callee.name == "Item"
                && callee.is_member
                && callee.qualified_name.as_deref() == Some("Menu.Item")
        }));
        assert!(!screen.iter().any(|callee| matches!(callee.name.as_str(), "main" | "input")));

        let legacy = extract_callees(&tree, TSX_COMPONENTS, path, "LegacyPanel", Lang::Tsx);
        assert!(legacy.iter().any(|callee| callee.name == "Button"));
        assert!(legacy.iter().any(|callee| {
            callee.name == "Item"
                && callee.is_member
                && callee.qualified_name.as_deref() == Some("Menu.Item")
        }));
        assert!(!legacy.iter().any(|callee| callee.name == "trackInteraction"));

        let handler = extract_callees(&tree, TSX_COMPONENTS, path, "handleAction", Lang::Tsx);
        assert!(handler.iter().any(|callee| callee.name == "trackInteraction"));
        let track_callers = extract_callers(&tree, TSX_COMPONENTS, path, "trackInteraction", Lang::Tsx);
        assert!(track_callers.iter().any(|caller| caller.name == "handleAction"));
        assert!(!track_callers.iter().any(|caller| caller.name == "LegacyPanel"));

        let grouped = extract_all_callees_grouped(&tree, TSX_COMPONENTS, path, Lang::Tsx);
        assert!(grouped.iter().any(|(name, callees)| {
            name == "LegacyPanel" && callees.iter().any(|callee| callee.name == "Button")
        }));
        assert!(grouped.iter().any(|(name, callees)| {
            name == "handleAction" && callees.iter().any(|callee| callee.name == "trackInteraction")
        }));
        assert!(!grouped.iter().any(|(name, _)| name == "render"));
    }

    #[test]
    fn tracks_safe_memo_and_forward_ref_wrappers() {
        let tree = parse_tsx();
        let path = Path::new("fixtures/tsx/components.tsx");

        let memo = extract_callees(&tree, TSX_COMPONENTS, path, "MemoButton", Lang::Tsx);
        assert!(memo.iter().any(|callee| callee.name == "memo"));
        assert!(memo.iter().any(|callee| callee.name == "Button"));

        let forward_ref = extract_callees(&tree, TSX_COMPONENTS, path, "ForwardInput", Lang::Tsx);
        assert!(forward_ref.iter().any(|callee| callee.name == "forwardRef"));
        assert!(!forward_ref.iter().any(|callee| callee.name == "input"));

        let button_callers = extract_callers(&tree, TSX_COMPONENTS, path, "Button", Lang::Tsx);
        for name in ["Card", "LegacyPanel", "MemoButton"] {
            assert!(button_callers.iter().any(|caller| caller.name == name), "missing {name:?} caller");
        }
        let memo_callers = extract_callers(&tree, TSX_COMPONENTS, path, "MemoButton", Lang::Tsx);
        assert!(memo_callers.iter().any(|caller| caller.name == "Screen"));
    }

    #[test]
    fn excludes_intrinsic_tags_from_component_references() {
        let tree = parse_tsx();
        let path = Path::new("fixtures/tsx/components.tsx");

        assert!(extract_references(&tree, TSX_COMPONENTS, path, "main").is_empty());
        assert!(extract_references(&tree, TSX_COMPONENTS, path, "article").is_empty());

        let button_refs = extract_references(&tree, TSX_COMPONENTS, path, "Button");
        assert!(button_refs.iter().any(|reference| reference.line > 1));
        let item_refs = extract_references(&tree, TSX_COMPONENTS, path, "Item");
        assert!(item_refs.iter().any(|reference| {
            reference.qualified_name.as_deref() == Some("Menu.Item")
        }));
    }

    #[test]
    fn deduplicates_repeated_jsx_uses_without_merging_member_components() {
        let tree = parse_tsx();
        let callees = extract_callees(
            &tree,
            TSX_COMPONENTS,
            Path::new("fixtures/tsx/components.tsx"),
            "MixedComponents",
            Lang::Tsx,
        );
        let item_uses: Vec<&Callee> = callees
            .iter()
            .filter(|callee| callee.name == "Item")
            .collect();

        assert_eq!(item_uses.len(), 2);
        assert!(item_uses.iter().any(|callee| {
            !callee.is_member && callee.qualified_name.is_none()
        }));
        assert!(item_uses.iter().any(|callee| {
            callee.is_member && callee.qualified_name.as_deref() == Some("Menu.Item")
        }));

        let mixed_start = TSX_COMPONENTS
            .lines()
            .position(|line| line.contains("function MixedComponents"))
            .expect("fixture must contain MixedComponents")
            + 1;
        let item_refs: Vec<Reference> = extract_references(
            &tree,
            TSX_COMPONENTS,
            Path::new("fixtures/tsx/components.tsx"),
            "Item",
        )
        .into_iter()
        .filter(|reference| reference.line > mixed_start)
        .collect();
        assert_eq!(item_refs.len(), 4);
        assert_eq!(
            item_refs
                .iter()
                .filter(|reference| reference.qualified_name.is_none())
                .count(),
            2
        );
        assert_eq!(
            item_refs
                .iter()
                .filter(|reference| reference.qualified_name.as_deref() == Some("Menu.Item"))
                .count(),
            2
        );
    }

    #[test]
    fn extracts_cross_file_tsx_fixture_evidence() {
        let mut parser = Parser::new();
        parser
            .set_language(&Lang::TypeScript.tree_sitter_language())
            .expect("TypeScript grammar must load");
        let props_tree = parser.parse(SHARED_PROPS, None).expect("props fixture must parse");
        assert!(!props_tree.root_node().has_error());
        let props_definitions = extract_definitions(
            &props_tree,
            SHARED_PROPS,
            Path::new("fixtures/tsx/shared-props.ts"),
            Lang::TypeScript,
        );
        assert!(props_definitions.iter().any(|definition| {
            definition.name == "SharedButtonProps" && definition.kind == SymbolKind::Interface
        }));

        parser
            .set_language(&Lang::Tsx.tree_sitter_language())
            .expect("TSX grammar must load");
        let component_tree = parser
            .parse(SHARED_BUTTON, None)
            .expect("component fixture must parse");
        assert!(!component_tree.root_node().has_error());
        let component_definitions = extract_definitions(
            &component_tree,
            SHARED_BUTTON,
            Path::new("fixtures/tsx/shared-button.tsx"),
            Lang::Tsx,
        );
        assert!(component_definitions.iter().any(|definition| {
            definition.name == "SharedButton" && definition.kind == SymbolKind::Function
        }));
        assert!(component_definitions.iter().any(|definition| {
            definition.name == "ButtonCaption" && definition.kind == SymbolKind::Constant
        }));
        assert!(extract_references(
            &component_tree,
            SHARED_BUTTON,
            Path::new("fixtures/tsx/shared-button.tsx"),
            "SharedButtonProps",
        )
        .len()
            >= 2);

        parser
            .set_language(&Lang::TypeScript.tree_sitter_language())
            .expect("TypeScript grammar must load");
        let barrel_tree = parser.parse(BARREL, None).expect("barrel fixture must parse");
        assert!(!barrel_tree.root_node().has_error());
        let barrel_names = extract_imports(&barrel_tree, BARREL, Lang::TypeScript);
        for name in ["SharedButton", "ButtonCaption", "SharedButtonProps"] {
            assert!(barrel_names.contains(name), "missing barrel export name {name:?}");
        }
        assert_eq!(
            extract_typescript_module_specifiers_for_symbol(
                &barrel_tree,
                BARREL,
                Lang::TypeScript,
                "SharedButton",
            ),
            HashSet::from(["./shared-button".to_string()])
        );
        let declaration_export = "export function Leaky(param: ParamType) { const localOnly = helper(param); return localOnly; }";
        let declaration_tree = parser
            .parse(declaration_export, None)
            .expect("export declaration must parse");
        let declaration_names = extract_imports(
            &declaration_tree,
            declaration_export,
            Lang::TypeScript,
        );
        for name in ["Leaky", "param", "ParamType", "localOnly", "helper"] {
            assert!(
                !declaration_names.contains(name),
                "export declaration leaked candidate name {name:?}"
            );
        }

        parser
            .set_language(&Lang::Tsx.tree_sitter_language())
            .expect("TSX grammar must load");
        let dashboard_tree = parser
            .parse(DASHBOARD, None)
            .expect("consumer fixture must parse");
        assert!(!dashboard_tree.root_node().has_error());
        let dashboard_callees = extract_callees(
            &dashboard_tree,
            DASHBOARD,
            Path::new("fixtures/tsx/dashboard.tsx"),
            "Dashboard",
            Lang::Tsx,
        );
        assert!(dashboard_callees.iter().any(|callee| {
            callee.name == "SharedButton"
                && !callee.is_member
                && callee.qualified_name.is_none()
        }));
        let imports = extract_imports(&dashboard_tree, DASHBOARD, Lang::Tsx);
        assert!(imports.contains("SharedButton"));
        assert!(imports.contains("ButtonCaption"));
        assert!(imports.contains("SharedButtonProps"));

        let alias_tree = parser
            .parse(ALIAS_DASHBOARD, None)
            .expect("alias consumer fixture must parse");
        assert!(!alias_tree.root_node().has_error());
        let alias_imports = extract_imports(&alias_tree, ALIAS_DASHBOARD, Lang::Tsx);
        assert!(alias_imports.contains("SharedButton"));
        assert!(alias_imports.contains("SharedButtonProps"));
        assert_eq!(
            extract_typescript_module_specifiers_for_symbol(
                &alias_tree,
                ALIAS_DASHBOARD,
                Lang::Tsx,
                "SharedButton",
            ),
            HashSet::from(["@/shared-button".to_string()])
        );
        let alias_callees = extract_callees(
            &alias_tree,
            ALIAS_DASHBOARD,
            Path::new("fixtures/tsx/alias-dashboard.tsx"),
            "AliasDashboard",
            Lang::Tsx,
        );
        assert!(alias_callees.iter().any(|callee| callee.name == "SharedButton"));
    }

    #[test]
    fn extracts_python_cross_file_structure() {
        let shared_tree = parse_fixture(Lang::Python, PYTHON_SHARED);
        let shared_path = Path::new("fixtures/structural-languages/python/shared.py");
        let definitions = extract_definitions(&shared_tree, PYTHON_SHARED, shared_path, Lang::Python);
        for (name, kind) in [
            ("MessageBuilder", SymbolKind::Class),
            ("build", SymbolKind::Function),
            ("format_message", SymbolKind::Function),
        ] {
            assert!(definitions.iter().any(|definition| {
                definition.name == name && definition.kind == kind
            }));
        }

        let consumer_tree = parse_fixture(Lang::Python, PYTHON_CONSUMER);
        let consumer_path = Path::new("fixtures/structural-languages/python/consumer.py");
        let imports = extract_imports(&consumer_tree, PYTHON_CONSUMER, Lang::Python);
        for name in ["shared", "MessageBuilder", "format_message"] {
            assert!(imports.contains(name), "missing Python import name {name:?}");
        }
        let callees = extract_callees(
            &consumer_tree,
            PYTHON_CONSUMER,
            consumer_path,
            "render_message",
            Lang::Python,
        );
        assert!(callees.iter().any(|callee| {
            callee.name == "MessageBuilder" && !callee.is_member
        }));
        assert!(callees.iter().any(|callee| {
            callee.name == "build" && callee.is_member
        }));
        assert!(callees.iter().any(|callee| {
            callee.name == "format_message" && !callee.is_member
        }));
        let callers = extract_callers(
            &consumer_tree,
            PYTHON_CONSUMER,
            consumer_path,
            "format_message",
            Lang::Python,
        );
        assert!(callers.iter().any(|caller| caller.name == "render_message"));
        assert!(extract_references(
            &consumer_tree,
            PYTHON_CONSUMER,
            consumer_path,
            "format_message",
        )
        .len()
            >= 2);
    }

    #[test]
    fn extracts_go_cross_file_structure() {
        let shared_tree = parse_fixture(Lang::Go, GO_SHARED);
        let shared_path = Path::new("fixtures/structural-languages/go/shared.go");
        let definitions = extract_definitions(&shared_tree, GO_SHARED, shared_path, Lang::Go);
        for (name, kind) in [
            ("Message", SymbolKind::Struct),
            ("Formatter", SymbolKind::Interface),
            ("BuildMessage", SymbolKind::Function),
            ("Label", SymbolKind::Method),
        ] {
            assert!(definitions.iter().any(|definition| {
                definition.name == name && definition.kind == kind
            }));
        }
        assert!(extract_imports(&shared_tree, GO_SHARED, Lang::Go).contains("shared"));

        let consumer_tree = parse_fixture(Lang::Go, GO_CONSUMER);
        let consumer_path = Path::new("fixtures/structural-languages/go/consumer.go");
        let imports = extract_imports(&consumer_tree, GO_CONSUMER, Lang::Go);
        assert!(imports.contains("consumer"));
        assert!(imports.contains("shared"));
        let callees = extract_callees(
            &consumer_tree,
            GO_CONSUMER,
            consumer_path,
            "Render",
            Lang::Go,
        );
        for name in ["BuildMessage", "Label"] {
            assert!(callees.iter().any(|callee| {
                callee.name == name && callee.is_member
            }), "missing Go selector call {name:?}");
        }
        let callers = extract_callers(
            &consumer_tree,
            GO_CONSUMER,
            consumer_path,
            "BuildMessage",
            Lang::Go,
        );
        assert!(callers.iter().any(|caller| caller.name == "Render"));
        assert!(extract_references(
            &consumer_tree,
            GO_CONSUMER,
            consumer_path,
            "BuildMessage",
        )
        .iter()
        .any(|reference| reference.line > 1));
    }

    #[test]
    fn extracts_rust_cross_file_structure() {
        let shared_tree = parse_fixture(Lang::Rust, RUST_SHARED);
        let shared_path = Path::new("fixtures/structural-languages/rust/shared.rs");
        let definitions = extract_definitions(&shared_tree, RUST_SHARED, shared_path, Lang::Rust);
        for (name, kind) in [
            ("Message", SymbolKind::Struct),
            ("Formatter", SymbolKind::Interface),
            ("build_message", SymbolKind::Function),
        ] {
            assert!(definitions.iter().any(|definition| {
                definition.name == name && definition.kind == kind
            }));
        }

        let consumer_tree = parse_fixture(Lang::Rust, RUST_CONSUMER);
        let consumer_path = Path::new("fixtures/structural-languages/rust/consumer.rs");
        let imports = extract_imports(&consumer_tree, RUST_CONSUMER, Lang::Rust);
        for name in ["shared", "build_message", "Message"] {
            assert!(imports.contains(name), "missing Rust module/import name {name:?}");
        }
        let callees = extract_callees(
            &consumer_tree,
            RUST_CONSUMER,
            consumer_path,
            "render_message",
            Lang::Rust,
        );
        assert!(callees.iter().any(|callee| {
            callee.name == "build_message" && !callee.is_member
        }));
        let callers = extract_callers(
            &consumer_tree,
            RUST_CONSUMER,
            consumer_path,
            "build_message",
            Lang::Rust,
        );
        assert!(callers.iter().any(|caller| caller.name == "render_message"));
        assert!(extract_references(
            &consumer_tree,
            RUST_CONSUMER,
            consumer_path,
            "build_message",
        )
        .len()
            >= 2);
    }

    #[test]
    fn rust_import_tokens_skip_inline_module_body_identifiers() {
        let source = "mod external;\nmod inline {\n    use crate::shared::Thing;\n    fn body_identifier() { ordinary_identifier(); }\n}\n";
        let tree = parse_fixture(Lang::Rust, source);
        let tokens = extract_rust_import_tokens(&tree, source);
        let names: HashSet<&str> = tokens.iter().map(|token| token.name.as_str()).collect();

        for expected in ["external", "shared", "Thing"] {
            assert!(names.contains(expected), "missing dependency token {expected}");
        }
        for body_name in ["inline", "body_identifier", "ordinary_identifier"] {
            assert!(!names.contains(body_name), "inline module body leaked token {body_name}");
        }
        assert!(tokens.iter().all(|token| {
            token.specifier.as_deref() == Some("mod external;")
                || token.specifier.as_deref() == Some("use crate::shared::Thing;")
        }));
    }

    #[test]
    fn extracts_java_cross_file_structure() {
        let shared_tree = parse_fixture(Lang::Java, JAVA_SHARED);
        let shared_path = Path::new("fixtures/structural-languages/java/SharedService.java");
        let definitions = extract_definitions(&shared_tree, JAVA_SHARED, shared_path, Lang::Java);
        for (name, kind) in [
            ("SharedService", SymbolKind::Class),
            ("SharedService", SymbolKind::Method),
            ("buildMessage", SymbolKind::Method),
            ("Formatter", SymbolKind::Interface),
        ] {
            assert!(definitions.iter().any(|definition| {
                definition.name == name && definition.kind == kind
            }));
        }
        let package_names = extract_imports(&shared_tree, JAVA_SHARED, Lang::Java);
        assert!(package_names.contains("fixtures"));
        assert!(package_names.contains("shared"));

        let consumer_tree = parse_fixture(Lang::Java, JAVA_CONSUMER);
        let consumer_path = Path::new("fixtures/structural-languages/java/Consumer.java");
        let imports = extract_imports(&consumer_tree, JAVA_CONSUMER, Lang::Java);
        assert!(imports.contains("SharedService"));
        assert!(imports.contains("consumer"));
        let callees = extract_callees(
            &consumer_tree,
            JAVA_CONSUMER,
            consumer_path,
            "renderMessage",
            Lang::Java,
        );
        assert!(callees.iter().any(|callee| {
            callee.name == "SharedService" && !callee.is_member
        }));
        assert!(callees.iter().any(|callee| {
            callee.name == "buildMessage" && callee.is_member
        }));
        for target in ["SharedService", "buildMessage"] {
            let callers = extract_callers(
                &consumer_tree,
                JAVA_CONSUMER,
                consumer_path,
                target,
                Lang::Java,
            );
            assert!(callers.iter().any(|caller| caller.name == "renderMessage"));
        }
        assert!(extract_references(
            &consumer_tree,
            JAVA_CONSUMER,
            consumer_path,
            "SharedService",
        )
        .len()
            >= 3);
    }

    #[test]
    fn preserves_non_tsx_call_extraction() {
        for (lang, source, path) in [
            (Lang::TypeScript, "function caller() { target(); }", "fixture.ts"),
            (Lang::Rust, "fn caller() { target(); }", "fixture.rs"),
            (Lang::Go, "package fixture\nfunc caller() { target() }\n", "fixture.go"),
        ] {
            let mut parser = Parser::new();
            parser
                .set_language(&lang.tree_sitter_language())
                .expect("language grammar must load");
            let tree = parser.parse(source, None).expect("fixture must parse");
            assert!(!tree.root_node().has_error(), "{lang:?} fixture must parse cleanly");

            let callees = extract_callees(&tree, source, Path::new(path), "caller", lang);
            assert!(
                callees.iter().any(|callee| callee.name == "target" && !callee.is_member),
                "missing direct call for {lang:?}"
            );
        }

        let source = "const Component = () => null;";
        let mut parser = Parser::new();
        parser
            .set_language(&Lang::TypeScript.tree_sitter_language())
            .expect("TypeScript grammar must load");
        let tree = parser.parse(source, None).expect("fixture must parse");
        let definitions = extract_definitions(&tree, source, Path::new("fixture.ts"), Lang::TypeScript);
        assert!(definitions.iter().any(|definition| {
            definition.name == "Component" && definition.kind == SymbolKind::Constant
        }));

        for (lang, source, path, expected_kind) in [
            (Lang::Python, "def caller():\n    pass\n", "fixture.py", SymbolKind::Function),
            (Lang::Java, "class Fixture { void caller() {} }", "Fixture.java", SymbolKind::Method),
        ] {
            let mut parser = Parser::new();
            parser
                .set_language(&lang.tree_sitter_language())
                .expect("language grammar must load");
            let tree = parser.parse(source, None).expect("fixture must parse");
            let definitions = extract_definitions(&tree, source, Path::new(path), lang);
            assert!(definitions.iter().any(|definition| {
                definition.name == "caller" && definition.kind == expected_kind
            }));
        }
    }

    #[test]
    fn extracts_python_lsp_token_positions_without_semantic_resolution() {
        let source = "from shared import MessageBuilder as Builder\n变量 = Builder()\n";
        let mut parser = Parser::new();
        parser
            .set_language(&Lang::Python.tree_sitter_language())
            .expect("Python grammar must load");
        let tree = parser.parse(source, None).expect("fixture must parse");
        let symbols = HashSet::from(["Builder".to_string()]);

        let positions = extract_python_symbol_positions(&tree, source, &symbols);
        assert_eq!(positions.len(), 2);
        assert_eq!(positions[0].line, 0);
        assert_eq!(positions[0].character, 37);
        assert_eq!(positions[1].line, 1);
        assert_eq!(positions[1].character, "变量 = ".encode_utf16().count());

        let imports = extract_python_import_tokens(&tree, source);
        assert!(imports.iter().any(|token| {
            token.name == "Builder"
                && token.line == 0
                && token.specifier.as_deref()
                    == Some("from shared import MessageBuilder as Builder")
        }));
    }
}
