//! The `/tmp` and `/<letter>` aliases, applied inside the toolchain programs themselves.
//!
//! The engine rewrites the command path and every argument it spawns (`patches/brush/0004-*.patch` and
//! `patches/brush/0009-*.patch`), which covers what the shell starts. A program that **another program**
//! starts — the child of `find -exec`, `xargs` or `timeout` — gets its arguments from that program rather
//! than from the shell, so `printf '/tmp/f\n' | xargs rm` used to hand `rm` a literal `/tmp/f`, which
//! Windows resolves against the current drive's root. This module is the same rule applied inside the
//! programs, which is how MSYS makes the alias hold for everything it builds.
//!
//! The source of truth is the two engine patches: keep this file, their `normalize_shell_arg`, and the
//! corpus in step. `corpus/compat.json` pins both paths — the engine-spawned cases (`argv-*`) and the
//! program-chain cases (`xargs-*`, `find-exec-*` with an aliased argument) — which is what catches drift
//! between the two copies, since the engine's implementation cannot be linked into these binaries.
//!
//! `scripts/build-toolchain.mjs` copies this file into each component the lock marks `pathAlias`, and the
//! component's patch declares it with `#[path]`. `dsh_path_alias.go` is the Go twin of it, for the one
//! component in the toolchain built from Go source (`goawk`, installed as `awk`); that component cannot
//! link this module, so the same rule is written twice and this comment is the pointer between the copies.
#![allow(dead_code)]

use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};

/// Whether the caller asked for the rewrite to be off, exactly as the engine reads it.
fn conversion_disabled() -> bool {
    const NAME: &str = "DSH_BASH_NATIVE_NO_PATHCONV";
    std::env::var_os(NAME).is_some_and(|value| !value.is_empty() && value.to_string_lossy() != "0")
}

/// Rewrites one argument the way the engine rewrites the arguments it spawns.
#[must_use]
pub fn translate(argument: OsString) -> OsString {
    if conversion_disabled() {
        return argument;
    }
    match translate_argument(&argument, &std::env::temp_dir) {
        Some(converted) => converted,
        None => argument,
    }
}

/// The same rewrite for a program that reads its arguments as `String`s, as `findutils` does.
#[must_use]
pub fn translate_string(argument: String) -> String {
    let original = argument.clone();
    translate(OsString::from(argument)).into_string().unwrap_or(original)
}

/// `Some(path)` when the argument names an aliased rooted path, in either supported form.
fn translate_argument(arg: &OsStr, temp_dir: &impl Fn() -> PathBuf) -> Option<OsString> {
    if let Some(path) = translate_unix_tmp_path(Path::new(arg), temp_dir)
        .or_else(|| translate_drive_mount_argument(Path::new(arg)))
    {
        return Some(path.into_os_string());
    }
    // An option's attached value cannot be a Windows switch, so the bare mount root is accepted here.
    let (option, value) = arg.to_str()?.split_once('=')?;
    if !option.starts_with('-') {
        return None;
    }
    let path = translate_argument_path(Path::new(value), temp_dir)?;
    let mut converted = OsString::from(option);
    converted.push("=");
    converted.push(path);
    Some(converted)
}

/// The two aliases an option's attached value may name, in the order the shell resolves them.
fn translate_argument_path(arg: &Path, temp_dir: &impl Fn() -> PathBuf) -> Option<PathBuf> {
    translate_unix_tmp_path(arg, temp_dir).or_else(|| translate_drive_mount_path(arg))
}

/// `/tmp` and everything below it mean the temporary directory.
fn translate_unix_tmp_path(path: &Path, temp_dir: &impl Fn() -> PathBuf) -> Option<PathBuf> {
    let mut tail = logical_components(path)?.into_iter();
    if tail.next() != Some(OsStr::new("tmp")) {
        return None;
    }
    let mut native = temp_dir();
    native.extend(tail);
    Some(native)
}

/// Maps a POSIX drive mount (`/d/Pi`) onto the Windows drive it names (`D:\Pi`).
fn translate_drive_mount_path(path: &Path) -> Option<PathBuf> {
    let mut tail = logical_components(path)?.into_iter();
    let mut native = drive_mount_root(tail.next()?.to_str()?)?;
    native.extend(tail);
    Some(native)
}

/// Like [`translate_drive_mount_path`], but refuses the bare mount root.
///
/// A bare `/<letter>` argument is how Windows' own tools spell their switches (`cmd.exe /c`), so an
/// argument that is exactly a mount root is left alone; the shell's own resolution has no such ambiguity
/// and an option's attached value is unambiguous, so both still accept it.
fn translate_drive_mount_argument(path: &Path) -> Option<PathBuf> {
    let mounted = translate_drive_mount_path(path)?;
    if path.components().count() <= 2 {
        return None;
    }
    Some(mounted)
}

/// The Windows root one `/<letter>` mount stands for, or `None` when the component is not one letter.
fn drive_mount_root(component: &str) -> Option<PathBuf> {
    let mut characters = component.chars();
    let first = characters.next()?;
    if !first.is_ascii_alphabetic() || characters.next().is_some() {
        return None;
    }
    Some(PathBuf::from(format!("{}:\\", first.to_ascii_uppercase())))
}

/// The POSIX path as its components, with `.` dropped and `..` collapsed against them.
///
/// A second root or a drive prefix cannot appear in a POSIX operand, so either one refuses the whole
/// path rather than resolving half of it.
fn logical_components(path: &Path) -> Option<Vec<&OsStr>> {
    let mut components = path.components();
    if components.next() != Some(Component::RootDir) {
        return None;
    }
    let mut logical: Vec<&OsStr> = Vec::new();
    for component in components {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                logical.pop();
            }
            Component::Normal(part) => logical.push(part),
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(logical)
}

#[cfg(test)]
mod tests {
    use super::{translate_argument, translate_drive_mount_argument, translate_unix_tmp_path};
    use std::ffi::{OsStr, OsString};
    use std::path::PathBuf;

    fn temp() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\Temp" } else { "/var/tmp" })
    }

    fn rewrite(argument: &str) -> Option<OsString> {
        translate_argument(OsStr::new(argument), &temp)
    }

    #[test]
    fn tmp_arguments_are_rewritten() {
        assert_eq!(rewrite("/tmp"), Some(temp().into_os_string()));
        assert_eq!(rewrite("/tmp/probe/sub"), Some(temp().join("probe").join("sub").into_os_string()));
        assert_eq!(rewrite("--file=/tmp/probe"), Some(OsString::from(format!("--file={}", temp().join("probe").display()))));
    }

    #[test]
    fn data_arguments_are_left_alone() {
        assert_eq!(rewrite("a message /tmp/x"), None);
        assert_eq!(rewrite("a=/tmp/x"), None);
        assert_eq!(rewrite("/tmpfile"), None);
        assert_eq!(rewrite("/var/tmp/x"), None);
    }

    #[test]
    fn drive_mounts_are_rewritten_but_a_bare_mount_is_not() {
        assert_eq!(translate_drive_mount_argument(std::path::Path::new("/c")), None);
        assert_eq!(rewrite("/c"), None);
        if cfg!(windows) {
            assert_eq!(rewrite("/c/Windows/System32"), Some(OsString::from(r"C:\Windows\System32")));
            assert_eq!(rewrite("--out=/d/Pi"), Some(OsString::from(r"--out=D:\Pi")));
        }
    }

    #[test]
    fn tmp_keeps_its_meaning_and_parent_components_collapse() {
        assert_eq!(
            translate_unix_tmp_path(std::path::Path::new("/tmp/../tmp/x"), &temp),
            Some(temp().join("x"))
        );
    }
}