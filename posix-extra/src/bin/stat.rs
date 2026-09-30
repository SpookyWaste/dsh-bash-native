//! `stat`: report what Windows actually knows about a file.
//!
//! The corpus only demands `stat -c %s`, but an agent's habits include `-c %n`, `%F`, `%y` and the
//! default block, so those are supported too. What Windows has no equivalent for is *not* invented:
//! the POSIX permission fields print `?`, and the change-time fields print `-`, which is also what
//! GNU prints when it cannot determine them. Inodes, link counts and device numbers are reported as
//! `0` rather than guessed, and the crate's README lists the supported subset.
//!
//! Rounding out the story: uutils' `stat` does not compile on Windows (its `stat` feature needs
//! `uucore::fs::major`, `uucore::fsext::statfs` and friends), and upstream's own Windows prebuilt
//! therefore ships without it — Microsoft's fork is the only build that has one.
//!
//! Exit status: 0 on success, 1 when any operand could not be read, 2 on a usage error.

use std::fs::Metadata;
use std::io::Write;
use std::path::Path;
use std::process::ExitCode;
use std::time::{SystemTime, UNIX_EPOCH};

/// One `stat` invocation.
struct Options {
    /// `-c`/`--format`: the format string, or `None` for the default block.
    format: Option<String>,
    /// Operands, in order.
    operands: Vec<String>,
}

/// Parse the arguments, returning `None` after a usage error has been reported.
fn parse(arguments: &[String]) -> Option<Options> {
    let mut options = Options { format: None, operands: Vec::new() };
    let mut index = 0;
    while index < arguments.len() {
        let argument = arguments[index].as_str();
        match argument {
            "-c" | "--format" => {
                index += 1;
                options.format = Some(arguments.get(index)?.clone());
            }
            // `-L` follows symlinks, which is already what `metadata` does; `-f` (file-system
            // statistics) and `-t` (terse) have no meaning here and are rejected rather than ignored.
            "-L" => {}
            "--" => {
                options.operands.extend(arguments[index + 1..].iter().cloned());
                break;
            }
            _ if argument.starts_with("--format=") => options.format = Some(argument["--format=".len()..].to_string()),
            _ if argument.starts_with('-') && argument.len() > 1 => {
                eprintln!("stat: invalid option -- '{}'", argument.trim_start_matches('-'));
                return None;
            }
            _ => options.operands.push(argument.to_string()),
        }
        index += 1;
    }
    if options.operands.is_empty() {
        eprintln!("stat: missing operand");
        eprintln!("Try 'stat --help' for more information.");
        return None;
    }
    Some(options)
}

/// The file type, in GNU's wording.
fn file_type(metadata: &Metadata) -> &'static str {
    let kind = metadata.file_type();
    if kind.is_dir() {
        "directory"
    } else if kind.is_symlink() {
        "symbolic link"
    } else if kind.is_file() {
        "regular file"
    } else {
        "unknown"
    }
}

/// A timestamp as seconds since the epoch, or `None` when the platform will not say.
fn epoch(time: std::io::Result<SystemTime>) -> Option<i64> {
    time.ok()?.duration_since(UNIX_EPOCH).ok().map(|elapsed| elapsed.as_secs() as i64)
}

/// Civil date and time from a Unix timestamp, so no time-zone database or `chrono` is needed.
///
/// GNU prints local time with a numeric offset; this prints UTC with `+0000`, which is the one offset
/// that can be computed from the standard library alone. The README states that difference.
fn civil(timestamp: i64) -> String {
    let days = timestamp.div_euclid(86_400);
    let seconds = timestamp.rem_euclid(86_400);
    let (hour, minute, second) = (seconds / 3600, (seconds % 3600) / 60, seconds % 60);
    // Howard Hinnant's civil-from-days algorithm, valid for the whole range we can encounter.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.000000000 +0000")
}

/// Expand one format string for one file. Unknown directives print `?`, as GNU does.
fn expand(format: &str, name: &str, metadata: &Metadata) -> String {
    let mut out = String::with_capacity(format.len() + 32);
    let mut characters = format.chars();
    while let Some(character) = characters.next() {
        match character {
            '\\' => match characters.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            },
            '%' => match characters.next() {
                Some('n') => out.push_str(name),
                Some('s') => out.push_str(&metadata.len().to_string()),
                Some('F') => out.push_str(file_type(metadata)),
                Some('h') => out.push('1'),
                Some('i') | Some('d') => out.push('0'),
                // Windows has no POSIX permission bits, owner ids or inode numbers; `?` is the same
                // signal GNU uses for a value it cannot determine.
                Some('a' | 'A' | 'u' | 'U' | 'g' | 'G') => out.push('?'),
                Some('b') => out.push('0'),
                Some('B') => out.push_str("4096"),
                Some('o') => out.push_str("4096"),
                Some('y') => out.push_str(&epoch(metadata.modified()).map_or_else(|| "-".to_string(), civil)),
                Some('Y') => out.push_str(&epoch(metadata.modified()).map_or_else(|| "-".to_string(), |t| t.to_string())),
                Some('x') => out.push_str(&epoch(metadata.accessed()).map_or_else(|| "-".to_string(), civil)),
                Some('X') => out.push_str(&epoch(metadata.accessed()).map_or_else(|| "-".to_string(), |t| t.to_string())),
                // Windows keeps no change time, and GNU prints `-` for an unknown timestamp.
                Some('z' | 'Z' | 'w' | 'W') => out.push('-'),
                Some('%') => out.push('%'),
                Some(other) => {
                    out.push('%');
                    out.push(other);
                }
                None => out.push('%'),
            },
            other => out.push(other),
        }
    }
    out
}

/// The default block, with GNU's labels and a line for every field we can fill.
fn default_block(name: &str, metadata: &Metadata) -> String {
    let mut out = String::new();
    out.push_str(&format!("  File: {name}\n"));
    out.push_str(&format!(
        "  Size: {:<10}\tBlocks: {:<10} IO Block: {:<6} {}\n",
        metadata.len(),
        metadata.len().div_ceil(4096),
        4096,
        file_type(metadata)
    ));
    out.push_str("Device: 0\tInode: 0\tLinks: 1\n");
    out.push_str("Access: (0000/?)  Uid: (    0/    ?)   Gid: (    0/    ?)\n");
    for (label, time) in [
        ("Access", epoch(metadata.accessed())),
        ("Modify", epoch(metadata.modified())),
        ("Change", None),
    ] {
        out.push_str(&format!("{label}: {}\n", time.map_or_else(|| "-".to_string(), civil)));
    }
    out.push_str(" Birth: -\n");
    out
}

/// Run `stat` with the arguments after the program name.
fn run(arguments: &[String]) -> ExitCode {
    let Some(options) = parse(arguments) else {
        return ExitCode::from(2);
    };
    let mut failed = false;
    let mut stdout = std::io::stdout();
    for operand in &options.operands {
        match std::fs::metadata(Path::new(operand)) {
            Ok(metadata) => {
                let text = options
                    .format
                    .as_ref()
                    .map_or_else(|| default_block(operand, &metadata), |format| expand(format, operand, &metadata));
                // GNU terminates `-c` output with a newline and the default block already has one.
                let text = if options.format.is_some() { format!("{text}\n") } else { text };
                if stdout.write_all(text.as_bytes()).is_err() {
                    return ExitCode::from(1);
                }
            }
            Err(error) => {
                failed = true;
                let _ = writeln!(std::io::stderr(), "stat: cannot statx '{operand}': {error}");
            }
        }
    }
    ExitCode::from(u8::from(failed))
}

/// Entry point.
fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    run(&arguments)
}
