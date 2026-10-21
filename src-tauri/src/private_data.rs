//! Keep Handy's data readable only by the user running it (Unix only).
//!
//! Settings (including post-processing API keys), the history database,
//! recordings and logs were created with the process umask, usually 022, so
//! they ended up 0644 inside 0755 directories. On Linux that makes them
//! readable by other local accounts whenever the home directory is
//! traversable. macOS already keeps `~/Library` private and Windows uses
//! per-user ACLs, so this matters mostly on Linux.
//!
//! Both entry points are no-ops on Windows.

use tauri::AppHandle;

/// Make every file and directory this process creates from now on private to
/// the current user.
///
/// Called at the top of `run()`, before Tauri's log and store plugins create
/// anything. The umask is process-wide and inherited by child processes.
#[cfg(unix)]
pub fn restrict_new_files() {
    // SAFETY: `umask` only replaces the process file mode mask and cannot
    // fail. It runs before the app starts its own threads.
    unsafe {
        libc::umask(0o077);
    }
}

#[cfg(not(unix))]
pub fn restrict_new_files() {}

/// Remove group and other access from data that earlier versions created.
///
/// Best effort: portable installs on FAT/exFAT or network shares cannot change
/// modes, so a failure is logged and startup continues. The shared Hugging
/// Face cache lives outside these directories and is left alone.
pub fn restrict_existing_data(app: &AppHandle) {
    #[cfg(unix)]
    {
        let mut roots: Vec<std::path::PathBuf> = Vec::new();
        for dir in [
            crate::portable::app_data_dir(app),
            crate::portable::app_log_dir(app),
        ] {
            match dir {
                // On Linux and in portable mode the log dir is inside the data dir.
                Ok(dir) if !roots.iter().any(|root| dir.starts_with(root)) => roots.push(dir),
                Ok(_) => {}
                Err(e) => log::warn!("Could not resolve a data directory to make private: {e}"),
            }
        }

        for root in roots {
            if let Err(e) = restrict_tree(&root) {
                log::warn!(
                    "Could not make {} private to the current user: {e}",
                    root.display()
                );
            }
        }
    }

    #[cfg(not(unix))]
    let _ = app;
}

/// Clear group and other permission bits on `root` and everything below it.
///
/// Refuses a symlinked root and never follows symlinks inside the tree, so a
/// link cannot redirect the chmod to a file outside Handy's data. Keeps going
/// after an error and returns the first one.
#[cfg(unix)]
fn restrict_tree(root: &std::path::Path) -> std::io::Result<()> {
    let metadata = match std::fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e),
    };
    if metadata.file_type().is_symlink() {
        return Err(std::io::Error::other(
            "refusing to change permissions through a symbolic link",
        ));
    }

    let mut first_error = None;
    restrict_entry(root, metadata, &mut first_error);
    first_error.map_or(Ok(()), Err)
}

#[cfg(unix)]
fn restrict_entry(
    path: &std::path::Path,
    metadata: std::fs::Metadata,
    first_error: &mut Option<std::io::Error>,
) {
    use std::os::unix::fs::PermissionsExt;

    let mut record = |result: std::io::Result<()>| {
        if let Err(e) = result {
            first_error.get_or_insert(e);
        }
    };

    let file_type = metadata.file_type();
    if !file_type.is_dir() && !file_type.is_file() {
        // Symlinks, sockets, FIFOs: leave them alone.
        return;
    }

    // Keep the owner's bits as they are, e.g. an executable stays executable.
    let mode = metadata.permissions().mode();
    if mode & 0o077 != 0 {
        record(std::fs::set_permissions(
            path,
            std::fs::Permissions::from_mode(mode & 0o700),
        ));
    }

    if !file_type.is_dir() {
        return;
    }
    let entries = match std::fs::read_dir(path) {
        Ok(entries) => entries,
        Err(e) => return record(Err(e)),
    };
    for entry in entries {
        // `DirEntry::metadata` does not follow symlinks.
        match entry.and_then(|entry| Ok((entry.path(), entry.metadata()?))) {
            Ok((child, child_metadata)) => restrict_entry(&child, child_metadata, first_error),
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::restrict_tree;
    use std::fs;
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::path::Path;
    use tempfile::TempDir;

    fn mode(path: &Path) -> u32 {
        fs::symlink_metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn set_mode(path: &Path, mode: u32) {
        fs::set_permissions(path, fs::Permissions::from_mode(mode)).unwrap();
    }

    #[test]
    fn test_removes_group_and_other_access() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("com.pais.handy");
        let recordings = root.join("recordings");
        fs::create_dir_all(&recordings).unwrap();
        let settings = root.join("settings_store.json");
        let recording = recordings.join("handy-1.wav");
        let script = root.join("script.sh");
        fs::write(&settings, "{}").unwrap();
        fs::write(&recording, b"RIFF").unwrap();
        fs::write(&script, "#!/bin/sh").unwrap();
        set_mode(&root, 0o755);
        set_mode(&recordings, 0o775);
        set_mode(&settings, 0o644);
        set_mode(&recording, 0o666);
        set_mode(&script, 0o755);

        restrict_tree(&root).unwrap();

        assert_eq!(mode(&root), 0o700);
        assert_eq!(mode(&recordings), 0o700);
        assert_eq!(mode(&settings), 0o600);
        assert_eq!(mode(&recording), 0o600);
        assert_eq!(mode(&script), 0o700);
    }

    #[test]
    fn test_does_not_follow_symlinks() {
        let dir = TempDir::new().unwrap();
        let outside = dir.path().join("outside");
        let outside_file = outside.join("shared.txt");
        fs::create_dir(&outside).unwrap();
        fs::write(&outside_file, "shared").unwrap();
        set_mode(&outside, 0o755);
        set_mode(&outside_file, 0o644);

        let root = dir.path().join("data");
        fs::create_dir(&root).unwrap();
        symlink(&outside, root.join("linked-dir")).unwrap();
        symlink(&outside_file, root.join("linked-file")).unwrap();

        restrict_tree(&root).unwrap();
        assert_eq!(mode(&outside), 0o755);
        assert_eq!(mode(&outside_file), 0o644);

        // A symlinked root is refused outright.
        let linked_root = dir.path().join("linked-root");
        symlink(&outside, &linked_root).unwrap();
        assert!(restrict_tree(&linked_root).is_err());
        assert_eq!(mode(&outside), 0o755);
        assert_eq!(mode(&outside_file), 0o644);
    }

    #[test]
    fn test_missing_root_is_not_an_error() {
        let dir = TempDir::new().unwrap();
        restrict_tree(&dir.path().join("not-created-yet")).unwrap();
    }
}
