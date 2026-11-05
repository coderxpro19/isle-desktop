//! Integration with the Windows shell: hiding/restoring the real taskbar, and
//! reserving screen space for the dock (AppBar).
//!
//! The taskbar must come back no matter how Isle exits. Four layers:
//! 1. normal exit → `restore()` from the run-loop exit handler;
//! 2. panic → panic hook calls `restore()`;
//! 3. crash / kill / power loss of Isle → a tiny watchdog process (Isle's own exe
//!    started with `--taskbar-watchdog <pid>`) waits for Isle to die, then restores;
//! 4. anything else (watchdog killed too, PC lost power) → a marker file on disk is
//!    noticed on next start and the taskbar is restored before anything else.

pub mod appbar;
pub mod taskbar;

pub use taskbar::{restore_taskbar_if_needed, run_watchdog_if_requested};
