#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
pub enum DbTable {
    Settings,
    AppMigration,
    PiSettingsConfig,
    PiPromptConfig,
    Skill,
    SkillGroup,
    SkillRepo,
    SkillPreferences,
    SkillSettings,
    CustomTool,
    McpServer,
    McpPreferences,
    FavoriteMcp,
    TokenStatsCache,
}

pub const ALL_TABLES: &[DbTable] = &[
    DbTable::Settings,
    DbTable::AppMigration,
    DbTable::PiSettingsConfig,
    DbTable::PiPromptConfig,
    DbTable::Skill,
    DbTable::SkillGroup,
    DbTable::SkillRepo,
    DbTable::SkillPreferences,
    DbTable::SkillSettings,
    DbTable::CustomTool,
    DbTable::McpServer,
    DbTable::McpPreferences,
    DbTable::FavoriteMcp,
    DbTable::TokenStatsCache,
];

impl DbTable {
    pub fn name(self) -> &'static str {
        match self {
            DbTable::Settings => "settings",
            DbTable::AppMigration => "app_migration",
            DbTable::PiSettingsConfig => "pi_settings_config",
            DbTable::PiPromptConfig => "pi_prompt_config",
            DbTable::Skill => "skill",
            DbTable::SkillGroup => "skill_group",
            DbTable::SkillRepo => "skill_repo",
            DbTable::SkillPreferences => "skill_preferences",
            DbTable::SkillSettings => "skill_settings",
            DbTable::CustomTool => "custom_tool",
            DbTable::McpServer => "mcp_server",
            DbTable::McpPreferences => "mcp_preferences",
            DbTable::FavoriteMcp => "favorite_mcp",
            DbTable::TokenStatsCache => "token_stats_cache",
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Hash)]
pub struct JsonFieldPath {
    segments: Vec<String>,
}

impl JsonFieldPath {
    pub fn new(path: &str) -> Result<Self, String> {
        let segments: Vec<String> = path
            .split('.')
            .map(str::trim)
            .filter(|segment| !segment.is_empty())
            .map(|segment| {
                validate_identifier(segment)?;
                Ok(segment.to_string())
            })
            .collect::<Result<_, String>>()?;

        if segments.is_empty() {
            return Err("JSON field path cannot be empty".to_string());
        }

        Ok(Self { segments })
    }

    pub fn from_segments(segments: &[&str]) -> Result<Self, String> {
        if segments.is_empty() {
            return Err("JSON field path cannot be empty".to_string());
        }

        let mut validated_segments = Vec::with_capacity(segments.len());
        for segment in segments {
            validate_identifier(segment)?;
            validated_segments.push((*segment).to_string());
        }

        Ok(Self {
            segments: validated_segments,
        })
    }

    pub fn segments(&self) -> &[String] {
        &self.segments
    }

    pub fn to_sql_path(&self) -> String {
        format!("$.{}", self.segments.join("."))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum OrderDirection {
    Asc,
    Desc,
}

impl OrderDirection {
    fn sql(self) -> &'static str {
        match self {
            OrderDirection::Asc => "ASC",
            OrderDirection::Desc => "DESC",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum JsonValueKind {
    Text,
    Integer,
    Real,
    Boolean,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrderTarget {
    Column(&'static str),
    Json {
        path: JsonFieldPath,
        kind: JsonValueKind,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OrderField {
    target: OrderTarget,
    direction: OrderDirection,
}

impl OrderField {
    pub fn id(direction: OrderDirection) -> Self {
        Self {
            target: OrderTarget::Column("id"),
            direction,
        }
    }

    pub fn created_at(direction: OrderDirection) -> Self {
        Self {
            target: OrderTarget::Column("created_at"),
            direction,
        }
    }

    pub fn updated_at(direction: OrderDirection) -> Self {
        Self {
            target: OrderTarget::Column("updated_at"),
            direction,
        }
    }

    pub fn json_text(path: &str, direction: OrderDirection) -> Result<Self, String> {
        Self::json(path, JsonValueKind::Text, direction)
    }

    pub fn json_integer(path: &str, direction: OrderDirection) -> Result<Self, String> {
        Self::json(path, JsonValueKind::Integer, direction)
    }

    pub fn json_bool(path: &str, direction: OrderDirection) -> Result<Self, String> {
        Self::json(path, JsonValueKind::Boolean, direction)
    }

    fn json(path: &str, kind: JsonValueKind, direction: OrderDirection) -> Result<Self, String> {
        Ok(Self {
            target: OrderTarget::Json {
                path: JsonFieldPath::new(path)?,
                kind,
            },
            direction,
        })
    }

    pub fn to_sql(&self) -> String {
        let expression = match &self.target {
            OrderTarget::Column(column) => (*column).to_string(),
            OrderTarget::Json { path, kind } => {
                let json_path = sql_string_literal(&path.to_sql_path());
                match kind {
                    JsonValueKind::Text => format!("json_extract(data, {json_path})"),
                    JsonValueKind::Integer | JsonValueKind::Boolean => {
                        format!("CAST(json_extract(data, {json_path}) AS INTEGER)")
                    }
                    JsonValueKind::Real => {
                        format!("CAST(json_extract(data, {json_path}) AS REAL)")
                    }
                }
            }
        };

        format!("{} {}", expression, self.direction.sql())
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct OrderSpec {
    fields: Vec<OrderField>,
}

impl OrderSpec {
    pub fn new(fields: Vec<OrderField>) -> Self {
        Self { fields }
    }

    pub fn single(field: OrderField) -> Self {
        Self {
            fields: vec![field],
        }
    }

    pub fn to_sql(&self) -> String {
        if self.fields.is_empty() {
            String::new()
        } else {
            format!(
                " ORDER BY {}",
                self.fields
                    .iter()
                    .map(OrderField::to_sql)
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        }
    }
}

pub fn validate_identifier(identifier: &str) -> Result<(), String> {
    let mut chars = identifier.chars();
    let Some(first) = chars.next() else {
        return Err("Identifier cannot be empty".to_string());
    };

    if !(first.is_ascii_alphabetic() || first == '_') {
        return Err(format!(
            "Invalid identifier '{}': must start with a letter or underscore",
            identifier
        ));
    }

    if chars.any(|char| !(char.is_ascii_alphanumeric() || char == '_')) {
        return Err(format!(
            "Invalid identifier '{}': only letters, numbers, and underscores are allowed",
            identifier
        ));
    }

    Ok(())
}

pub fn sql_string_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
