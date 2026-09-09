//! Shared error type for VEYRA's Rust core.
//!
//! All Tauri commands return `Result<T, VeyraError>`. `VeyraError` serializes
//! to a plain `{ code, message }` object so the frontend can branch on
//! `code` without parsing human-readable text.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum VeyraError {
    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("not supported on this platform: {0}")]
    NotSupported(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("internal error: {0}")]
    Internal(String),
}

/// Stable machine-readable error codes, mirrored in `src/core/types.ts`.
impl VeyraError {
    pub fn code(&self) -> &'static str {
        match self {
            VeyraError::PermissionDenied(_) => "PERMISSION_DENIED",
            VeyraError::NotSupported(_) => "NOT_SUPPORTED",
            VeyraError::NotFound(_) => "NOT_FOUND",
            VeyraError::InvalidArgument(_) => "INVALID_ARGUMENT",
            VeyraError::Database(_) => "DATABASE_ERROR",
            VeyraError::Io(_) => "IO_ERROR",
            VeyraError::Internal(_) => "INTERNAL_ERROR",
        }
    }
}

#[derive(Serialize)]
pub struct SerializableError {
    pub code: &'static str,
    pub message: String,
}

impl Serialize for VeyraError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        SerializableError {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}

pub type VeyraResult<T> = Result<T, VeyraError>;
