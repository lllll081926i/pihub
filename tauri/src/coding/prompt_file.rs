use std::fs;
use std::path::Path;

pub fn write_prompt_content_file(
    path: &Path,
    prompt_content: Option<&str>,
    product_name: &str,
) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| {
                format!("Failed to create {} prompt directory: {}", product_name, e)
            })?;
        }
    }

    let content = prompt_content
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");

    fs::write(path, content)
        .map_err(|e| format!("Failed to write {} prompt file: {}", product_name, e))?;

    Ok(())
}
