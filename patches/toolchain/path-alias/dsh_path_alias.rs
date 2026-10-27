//! The `/tmp` and `/<letter>` aliases, applied inside the toolchain programs themselves.
//!
//! The engine rewrites every argument of the children it spawns (`src/executor/path.rs`,
//! `translated_virtual_system_root_argument` and `external_argument_path`), which covers what the shell
//! starts. A program that **another program** starts — the child of `find -exec`, `xargs` or `timeout` —
//! gets its arguments from that program rather than from the shell, so `printf '/tmp/f\n' | xargs rm`
//! would hand `rm` a literal `/tmp/f`, which Windows resolves against the current drive's root. This
//! module is the same rule applied inside the programs, which is how MSYS makes the alias hold for
//! everything it builds.
//!
//! Translation stops at the words the tool's own grammar reads as data: a grep/sed pattern or script, an
//! awk program, find's pattern primaries, and basename/dirname's display text. That is the same table the
//! engine applies before it spawns (`argv_data_primary_positions` in `src/executor/path.rs`, the engine
//! side of niubash#62), and it has to exist here as well: a chain the shell never sees — `find . -exec
//! grep -F /tmp/x {} \;` — must search for the text `/tmp/x`, not for a Windows path. The engine's own
//! promise ("a pattern/script/program word is never rewritten", `engine.lock.json`) therefore holds for
//! chained children only if this file carries the same table.
//!
//! `scripts/build-toolchain.mjs` copies this file into each component the lock marks `pathAlias`, and the
//! component's patch declares it with `#[path]` and calls [`translate`] at its argv boundary.
//! `dsh_path_alias.go` is the Go twin of it, for the one component in the toolchain built from Go source
//! (`goawk`, installed as `awk`); that component cannot link this module, so the same rule is written
//! twice. `corpus/compat.json` pins both paths — the engine-spawned cases (`argv-*`) and the
//! program-chain cases (`xargs-*`, `find-exec-*`, `alias-chain-*`) — which is what catches drift between
//! the copies, since neither the engine's implementation nor this module can be linked into those
//! binaries.
#![allow(dead_code)]

use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Component, Path, PathBuf};

/// Whether the caller asked for the rewrite to be off, exactly as the engine reads it.
fn conversion_disabled() -> bool {
    const NAME: &str = "DSH_BASH_NATIVE_NO_PATHCONV";
    std::env::var_os(NAME).is_some_and(|value| !value.is_empty() && value.to_string_lossy() != "0")
}

/// Rewrites a program's argv the way the engine rewrites the arguments it spawns.
///
/// The first word is the program and is never touched; the rest are translated unless the words around
/// them name a tool whose grammar reads that position as data (see [`data_positions`]). The whole argv is
/// read before the first word is rewritten, because the data positions of one word depend on the words
/// that follow it.
pub fn translate(argv: impl Iterator<Item = OsString>) -> impl Iterator<Item = OsString> {
    translate_argv(argv, translate_argument_value).into_iter()
}

/// The same rewrite for a program that reads its arguments as `String`s, as `findutils` does.
pub fn translate_string(argv: impl Iterator<Item = String>) -> impl Iterator<Item = String> {
    let argv = argv.map(OsString::from).collect::<Vec<_>>();
    translate_argv(argv.into_iter(), translate_argument_value)
        .into_iter()
        .map(|argument| argument.into_string().unwrap_or_else(|value| value.to_string_lossy().into_owned()))
        .collect::<Vec<_>>()
        .into_iter()
}

/// The argv boundary both [`translate`] and [`translate_string`] go through.
fn translate_argv(
    argv: impl Iterator<Item = OsString>,
    translate_one: impl Fn(OsString) -> OsString,
) -> Vec<OsString> {
    let argv = argv.collect::<Vec<_>>();
    let Some((program, arguments)) = argv.split_first() else {
        return argv;
    };
    if conversion_disabled() {
        return argv;
    }
    let data = data_positions(program, arguments);
    argv.into_iter()
        .enumerate()
        .map(|(index, argument)| match index.checked_sub(1) {
            Some(position) if !data.contains(&position) => translate_one(argument),
            _ => argument,
        })
        .collect()
}

/// Rewrites one argument the way the engine rewrites the arguments it spawns.
#[must_use]
fn translate_argument_value(argument: OsString) -> OsString {
    match translate_argument(&argument, &std::env::temp_dir) {
        Some(converted) => converted,
        None => argument,
    }
}

/// The argv positions of a program's arguments that are DATA by its own grammar.
///
/// The engine's table (`argv_data_primary_positions`) is the source of truth; this is the copy for the
/// children no shell spawns. Two data classes:
///
/// - grammar data primaries: grep/sed/awk put their pattern/script/program in the first positional
///   operand, and find consumes pattern-primary values (`-name`, `-path`, `-regex`, ...);
/// - filesystem-blind string transforms: basename/dirname never stat their operand, so both positionals
///   are display text and translating them would corrupt the GNU string contract.
///
/// Only these: the mask is a grammar exemption, not a path heuristic — widening it by command name would
/// reintroduce the per-name argv split niubash#164 retired ("either all translate or none do").
fn data_positions(program: &OsStr, arguments: &[OsString]) -> HashSet<usize> {
    let Some(stem) = Path::new(program).file_stem().and_then(OsStr::to_str) else {
        return HashSet::new();
    };
    let name = stem.to_ascii_lowercase();
    let words = arguments
        .iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<String>>();
    let mut masked = HashSet::new();
    match name.as_str() {
        "grep" => mask_first_positional_data(
            &words,
            &mut masked,
            &["-e", "--regexp"],
            &["-f", "--file"],
            &[
                "-m",
                "--max-count",
                "-A",
                "--after-context",
                "-B",
                "--before-context",
                "-C",
                "--context",
                "-d",
                "--devices",
                "-D",
                "--directories",
            ],
        ),
        "sed" => mask_first_positional_data(&words, &mut masked, &["-e", "--expression"], &["-f", "--file"], &[]),
        "awk" => mask_first_positional_data(&words, &mut masked, &[], &["-f", "--file"], &[]),
        "find" => mask_find_pattern_primaries(&words, &mut masked),
        // basename NAME [SUFFIX]: both positionals are display text.
        "basename" | "dirname" => mask_all_positionals(&words, &mut masked),
        _ => {}
    }
    masked
}

/// Masks every non-switch word: for filesystem-blind string tools (basename/dirname) each positional —
/// name and SUFFIX alike — is data.
fn mask_all_positionals(args: &[String], masked: &mut HashSet<usize>) {
    for (index, arg) in args.iter().enumerate() {
        if !(arg.len() > 1 && arg.starts_with('-')) {
            masked.insert(index);
        }
    }
}

/// The short option letter of a two-character option (`-e`), so an attached cluster (`-ePAT`) is seen.
fn short_option_char(opts: &[&str]) -> Option<char> {
    opts.iter().find_map(|opt| {
        let bytes = opt.as_bytes();
        if bytes.len() == 2 && bytes[0] == b'-' && bytes[1].is_ascii_alphabetic() {
            Some(bytes[1] as char)
        } else {
            None
        }
    })
}

/// Marks the first positional operand of a pattern/script command as non-translatable.
///
/// `pattern_opts` consume a separate pattern value (and that value is masked too — `grep -e PAT`),
/// `file_opts` consume a separate file operand (a real path — its value translates, and the first
/// positional becomes a file), and `value_opts` consume a numeric or action value; attached
/// `--opt=value` and `-oVALUE` clusters carry the value in the same token and only gate the positional
/// operand.
fn mask_first_positional_data(
    args: &[String],
    masked: &mut HashSet<usize>,
    pattern_opts: &[&str],
    file_opts: &[&str],
    value_opts: &[&str],
) {
    let pattern_short = short_option_char(pattern_opts);
    let file_short = short_option_char(file_opts);

    let mut pattern_via_option = false;
    let mut after_dashdash = false;
    let mut first_positional: Option<usize> = None;
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !after_dashdash && arg == "--" {
            after_dashdash = true;
            i += 1;
            continue;
        }
        let is_option = !after_dashdash && arg.starts_with('-') && arg.len() > 1;

        if is_option {
            if pattern_opts.contains(&arg) {
                pattern_via_option = true;
                // The pattern value itself is data (grep -e PAT, sed -e EX).
                if i + 1 < args.len() {
                    masked.insert(i + 1);
                }
                i += 2;
                continue;
            }
            if file_opts.contains(&arg) {
                // -f script means the pattern/script came via an option, so the first positional is a
                // real file operand (translates).
                pattern_via_option = true;
                i += 2;
                continue;
            }
            if value_opts.contains(&arg) {
                i += 2;
                continue;
            }
            if let Some(name) = arg.strip_prefix("--").and_then(|rest| rest.split('=').next()) {
                let long = format!("--{name}");
                if pattern_opts.contains(&long.as_str()) || file_opts.contains(&long.as_str()) {
                    pattern_via_option = true;
                }
            } else if let Some(cluster) = arg.strip_prefix('-') {
                if let Some(first) = cluster.chars().next() {
                    if Some(first) == pattern_short || Some(first) == file_short {
                        pattern_via_option = true;
                    }
                }
            }
        } else if first_positional.is_none() {
            first_positional = Some(i);
        }
        i += 1;
    }

    if !pattern_via_option {
        if let Some(index) = first_positional {
            masked.insert(index);
        }
    }
}

/// Marks find pattern-primary values (`-name`, `-path`, `-regex`, ...) as non-translatable. Leading
/// non-option operands are starting paths and stay translatable (unixwin/WinuxCmd#1170: the start
/// operand is the path position `find` itself cannot resolve in POSIX form).
fn mask_find_pattern_primaries(args: &[String], masked: &mut HashSet<usize>) {
    const PATTERN_PRIMARIES: &[&str] = &[
        "-name",
        "-path",
        "-regex",
        "-iregex",
        "-ipath",
        "-lname",
        "-wholename",
        "-ilname",
        "-iwholename",
    ];
    let mut in_expression = false;
    let mut i = 0usize;
    while i < args.len() {
        let arg = args[i].as_str();
        if !in_expression && (arg.starts_with('-') || matches!(arg, "!" | "(" | ")")) {
            in_expression = true;
        }
        if in_expression && PATTERN_PRIMARIES.contains(&arg) {
            if i + 1 < args.len() {
                masked.insert(i + 1);
            }
            i += 2;
            continue;
        }
        i += 1;
    }
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

/// Maps a POSIX drive mount (`/d/work`) onto the Windows drive it names (`D:\work`).
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
    use super::{data_positions, translate, translate_argument, translate_drive_mount_argument, translate_unix_tmp_path};
    use std::ffi::{OsStr, OsString};
    use std::path::PathBuf;

    fn temp() -> PathBuf {
        PathBuf::from(if cfg!(windows) { r"C:\Temp" } else { "/var/tmp" })
    }

    fn rewrite(argument: &str) -> Option<OsString> {
        translate_argument(OsStr::new(argument), &temp)
    }

    /// The argv as the tool receives it after the shim's rewrite, program word included.
    fn translated(argv: &[&str]) -> Vec<String> {
        let argv = argv.iter().map(|argument| OsString::from(*argument)).collect::<Vec<_>>();
        translate(argv.into_iter())
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn tmp_arguments_are_rewritten() {
        assert_eq!(rewrite("/tmp"), Some(temp().into_os_string()));
        assert_eq!(rewrite("/tmp/probe/sub"), Some(temp().join("probe").join("sub").into_os_string()));
        assert_eq!(
            rewrite("--file=/tmp/probe"),
            Some(OsString::from(format!("--file={}", temp().join("probe").display())))
        );
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
            assert_eq!(rewrite("--out=/d/work"), Some(OsString::from(r"--out=D:\work")));
        }
    }

    #[test]
    fn tmp_keeps_its_meaning_and_parent_components_collapse() {
        assert_eq!(
            translate_unix_tmp_path(std::path::Path::new("/tmp/../tmp/x"), &temp),
            Some(temp().join("x"))
        );
    }

    /// The program word is the tool's own path, already resolved by whoever spawned it.
    #[test]
    fn the_program_word_is_never_rewritten() {
        assert_eq!(translated(&["/tmp/tools/grep.exe", "needle", "f"])[0], "/tmp/tools/grep.exe");
    }

    #[test]
    fn pattern_and_script_words_stay_verbatim() {
        assert_eq!(translated(&["grep.exe", "-F", "/tmp/probe", "f"])[2], "/tmp/probe");
        assert_eq!(translated(&["grep.exe", "-e", "/tmp/probe", "f"])[2], "/tmp/probe");
        assert_eq!(translated(&["sed.exe", "-n", "/tmp/probe/p", "f"])[2], "/tmp/probe/p");
        assert_eq!(translated(&["awk.exe", "/tmp/probe/{print}", "f"])[1], "/tmp/probe/{print}");
    }

    /// The same argv still rewrites the operands those tools open.
    #[test]
    fn file_operands_of_the_same_programs_are_rewritten() {
        assert_ne!(translated(&["grep.exe", "needle", "/tmp/f"])[2], "/tmp/f");
        assert_ne!(translated(&["grep.exe", "-e", "/tmp/probe", "/tmp/f"])[3], "/tmp/f");
        let pattern_file = translated(&["grep.exe", "-f", "/tmp/pat", "/tmp/f"]);
        assert_ne!(pattern_file[2], "/tmp/pat");
        assert_ne!(pattern_file[3], "/tmp/f");
        assert_ne!(translated(&["sed.exe", "-e", "s/x/y/", "/tmp/f"])[3], "/tmp/f");
        let program_file = translated(&["awk.exe", "-f", "/tmp/p.awk", "/tmp/f"]);
        assert_ne!(program_file[2], "/tmp/p.awk");
        assert_ne!(program_file[3], "/tmp/f");
    }

    /// find's starting path is a path; its pattern primaries are text.
    #[test]
    fn find_separates_start_paths_from_pattern_primaries() {
        let argv = translated(&["find.exe", "/tmp", "-name", "/tmp/x", "-print"]);
        assert_ne!(argv[1], "/tmp");
        assert_eq!(argv[3], "/tmp/x");
    }

    /// basename/dirname never stat their operand, so every positional is display text.
    #[test]
    fn string_transforms_keep_every_positional() {
        let argv = translated(&["basename.exe", "/tmp/a/b.txt", ".txt"]);
        assert_eq!(argv[1], "/tmp/a/b.txt");
        assert_eq!(argv[2], ".txt");
    }

    /// A tool outside the table takes the alias rule for every argument it receives.
    #[test]
    fn a_tool_outside_the_table_translates_every_argument() {
        assert_ne!(translated(&["ls.exe", "/tmp/f"])[1], "/tmp/f");
        assert_ne!(translated(&["rm.exe", "/tmp/f"])[1], "/tmp/f");
    }

    /// The table is the program's own name, not the name the caller used.
    #[test]
    fn the_table_follows_the_program_file_stem() {
        let sed = [OsString::from("-n"), OsString::from("/tmp/x/p")];
        assert!(data_positions(OsStr::new(r"D:\tools\sed.exe"), &sed).contains(&1));
        assert!(data_positions(OsStr::new("ls.exe"), &[OsString::from("/tmp/f")]).is_empty());
    }
}
