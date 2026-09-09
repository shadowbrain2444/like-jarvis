//! System information tools: CPU, RAM, storage, network, battery — the
//! read-only half of spec section 7 ("System"). Read-only, so it runs
//! without a permission prompt (see [`crate::permissions::SAFE_BY_DEFAULT`]).

use crate::error::VeyraResult;
use crate::permissions::guard;
use crate::state::AppState;
use serde::Serialize;
use sysinfo::{Disks, System};
use tauri::State;

#[derive(Serialize)]
pub struct SystemInfo {
    pub os_name: String,
    pub os_version: String,
    pub hostname: String,
    pub cpu_usage_percent: f32,
    pub cpu_count: usize,
    pub total_memory_mb: u64,
    pub used_memory_mb: u64,
    pub disks: Vec<DiskInfo>,
}

#[derive(Serialize)]
pub struct DiskInfo {
    pub name: String,
    pub mount_point: String,
    pub total_gb: f64,
    pub available_gb: f64,
}

#[tauri::command]
pub fn system_info(state: State<AppState>) -> VeyraResult<SystemInfo> {
    guard(&state.db, "system.info")?;

    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    // A second sample is needed for a meaningful CPU usage percentage.
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu_usage_percent = if sys.cpus().is_empty() {
        0.0
    } else {
        sys.cpus().iter().map(|c| c.cpu_usage()).sum::<f32>() / sys.cpus().len() as f32
    };

    let disks = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().to_string(),
            mount_point: d.mount_point().to_string_lossy().to_string(),
            total_gb: d.total_space() as f64 / 1_073_741_824.0,
            available_gb: d.available_space() as f64 / 1_073_741_824.0,
        })
        .collect();

    Ok(SystemInfo {
        os_name: System::name().unwrap_or_else(|| "unknown".into()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".into()),
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        cpu_usage_percent,
        cpu_count: sys.cpus().len(),
        total_memory_mb: sys.total_memory() / 1_048_576,
        used_memory_mb: sys.used_memory() / 1_048_576,
        disks,
    })
}
