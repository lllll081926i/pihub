use ai_toolbox_lib::coding::tools::builtin_tool_by_key;

#[test]
fn pi_builtin_tool_uses_pi_agent_paths() {
    let tool = builtin_tool_by_key("pi").expect("pi should exist");

    assert_eq!(tool.relative_skills_dir, Some("~/.pi/agent/skills"));
    assert_eq!(tool.relative_detect_dir, Some("~/.pi/agent"));
    assert_eq!(tool.mcp_config_path, Some("~/.pi/agent/mcp.json"));
    assert_eq!(tool.mcp_config_format, Some("json"));
    assert_eq!(tool.mcp_field, Some("mcpServers"));
}

#[test]
fn pi_is_the_only_builtin_tool() {
    let all_tools = ai_toolbox_lib::coding::tools::BUILTIN_TOOLS;
    assert_eq!(all_tools.len(), 1);
    assert_eq!(all_tools[0].key, "pi");
}
