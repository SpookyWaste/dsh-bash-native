//! `which`: resolve command names against `PATH`.
//!
//! This is an ordinary program, so unlike a shell builtin it cannot see the shell's own builtins,
//! functions or aliases: `which cd` reports nothing even though `cd` exists. That limitation is
//! documented rather than papered over, because pretending to know would be worse than saying so.
//!
//! Output is the resolved path with the Windows verbatim prefix removed: `canonicalize` returns
//! `\\?\C:\...`, and that prefix breaks every consumer that string-matches or pastes the result.
//!
//! Exit status: 0 when every name resolved, 1 when any did not, 2 on a usage error.

use std::env;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

/// Drop the verbatim prefix `canonicalize` adds on Windows, restoring the spelling every other tool
/// prints. UNC paths keep their `\\server\share` form.
fn without_verbatim_prefix(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest.to_string()),
        None => path,
    }
}

/// Executable suffixes `PATH` lookup appends on Windows, in `PATHEXT` order.
fn windows_extensions() -> Vec<String> {
    let raw = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_string());
    let mut extensions: Vec<String> = raw
        .split(';')
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .map(str::to_ascii_lowercase)
        .collect();
    if extensions.is_empty() {
        extensions.push(".exe".to_string());
    }
    extensions
}

/// Whether `path` names a file this platform would execute.
fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return false;
        }
    }
    true
}

/// Every path a name could resolve to, in `PATH` order.
fn resolve(name: &str, search_path: &str) -> Vec<PathBuf> {
    let mut extensions: Vec<String> = Vec::new();
    if cfg!(windows) {
        match Path::new(name).extension() {
            // An explicit suffix is used as written, which is what `PATHEXT` lookup does too.
            Some(_) => extensions.push(String::new()),
            None => {
                extensions.extend(windows_extensions());
                // A command may still be extensionless, for example a script with a shebang.
                extensions.push(String::new());
            }
        }
    } else {
        extensions.push(String::new());
    }

    // A name containing a separator is a path, not something to look up.
    if name.contains('/') || (cfg!(windows) && name.contains('\\')) {
        let direct = PathBuf::from(name);
        return if is_executable_file(&direct) { vec![direct] } else { Vec::new() };
    }

    let mut found = Vec::new();
    for directory in env::split_paths(search_path) {
        for extension in &extensions {
            let candidate = directory.join(format!("{name}{extension}"));
            if is_executable_file(&candidate) {
                // Prefer the absolute spelling so the output can be used directly.
                let absolute = without_verbatim_prefix(std::fs::canonicalize(&candidate).unwrap_or(candidate));
                if !found.contains(&absolute) {
                    found.push(absolute);
                }
            }
        }
    }
    found
}

fn main() -> ExitCode {
    let mut all = false;
    let mut names: Vec<String> = Vec::new();
    for argument in env::args().skip(1) {
        match argument.as_str() {
            "-a" | "--all" => all = true,
            "-s" | "--silent" => {}
            other if other.starts_with('-') && other.len() > 1 => {
                eprintln!("which: unknown option: {other}");
                return ExitCode::from(2);
            }
            other => names.push(other.to_string()),
        }
    }
    if names.is_empty() {
        // `which` with no operand is a usage error, and the status is 1 rather than 2: the BSD
        // implementation oh-my-pi also follows reports it this way.
        eprintln!("usage: which [-as] program ...");
        return ExitCode::from(1);
    }

    let search_path = env::var("PATH").unwrap_or_default();
    let mut missing = false;
    for name in &names {
        let matches = resolve(name, &search_path);
        if matches.is_empty() {
            missing = true;
            continue;
        }
        if all {
            for path in matches {
                println!("{}", path.display());
            }
        } else {
            println!("{}", matches[0].display());
        }
    }
    if missing {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    }
}
