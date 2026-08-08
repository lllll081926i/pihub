//! Built-in tool configurations
//!
//! Contains static configuration for supported AI coding tools.
//!
//! Path prefix conventions:
//! - `~/` - relative to user's home directory
//! - `%APPDATA%/` - relative to config directory (APPDATA on Windows, ~/.config on Linux/macOS)
//! - No prefix - absolute path

use super::types::BuiltinTool;

/// All built-in tool configurations
/// Each tool can support Skills, MCP, or both
pub const BUILTIN_TOOLS: &[BuiltinTool] = &[
    // Pi - Skills plus MCP config consumed by the pi-mcp-adapter extension.
    BuiltinTool {
        key: "pi",
        display_name: "Pi",
        relative_skills_dir: Some("~/.pi/agent/skills"),
        relative_detect_dir: Some("~/.pi/agent"),
        mcp_config_path: Some("~/.pi/agent/mcp.json"),
        mcp_config_format: Some("json"),
        mcp_field: Some("mcpServers"),
    },
];

/// Find a built-in tool by key
pub fn builtin_tool_by_key(key: &str) -> Option<&'static BuiltinTool> {
    BUILTIN_TOOLS.iter().find(|t| t.key == key)
}
