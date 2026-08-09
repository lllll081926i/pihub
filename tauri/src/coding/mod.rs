pub mod all_api_hub;
pub mod cli_resolver;
pub mod file_io;
pub mod magic_context;
pub mod mcp;
pub mod pi;
pub mod preset_models;
pub mod reapply_applied_runtime;
pub mod runtime_location;
pub mod session_manager;
pub mod skills;
pub mod tools;
pub(crate) mod url_utils;

mod db_id;
#[cfg(test)]
pub(crate) mod test_env {
    use std::sync::{LazyLock, Mutex, MutexGuard};

    static TEST_ENV_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

    pub(crate) fn lock() -> MutexGuard<'static, ()> {
        TEST_ENV_LOCK.lock().expect("test env lock poisoned")
    }
}

mod prompt_file;
pub mod shell_env;
pub use db_id::{db_clean_id, db_extract_id, db_new_id, db_record_id};

mod path_expand;
pub use path_expand::expand_local_path;
