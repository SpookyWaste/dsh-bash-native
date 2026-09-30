//! `diff`: compare two files.
//!
//! Supported forms, matching GNU diff for what scripts use:
//!   * default (normal format): `NcM` / `NaM` / `NdM` hunks with `<` and `>` lines and `---` between
//!   * `-u` / `--unified` (optionally `=N` for the context radius, default 3)
//!   * `-q` / `--brief`: `Files <a> and <b> differ` to stdout
//!   * `-a` / `--text`: treat binary input as text
//!   * `-N` / `--new-file`: treat a missing file as empty
//!
//! Exit status: 0 when the files are identical, 1 when they differ, 2 on trouble. Binary input is
//! reported as `Binary files <a> and <b> differ`, which is what GNU diff does with one difference:
//! the `--- <path>` / `+++ <path>` headers carry no timestamps, because a timezone-correct one needs
//! a dependency this tool deliberately does not have.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::process::ExitCode;

use similar::{ChangeTag, TextDiff};

/// One input file's bytes and the label to print for it.
struct Input {
    label: String,
    bytes: Vec<u8>,
}

/// Read one operand, honoring `--new-file` and `-` for standard input.
fn read_operand(path: &str, missing_is_empty: bool) -> io::Result<Input> {
    if path == "-" {
        use std::io::Read;
        let mut bytes = Vec::new();
        io::stdin().read_to_end(&mut bytes)?;
        return Ok(Input {
            label: path.to_string(),
            bytes,
        });
    }
    match fs::read(path) {
        Ok(bytes) => Ok(Input {
            label: path.to_string(),
            bytes,
        }),
        Err(error) if missing_is_empty && error.kind() == io::ErrorKind::NotFound => Ok(Input {
            label: path.to_string(),
            bytes: Vec::new(),
        }),
        Err(error) => Err(error),
    }
}

/// Render an operating-system error the way a POSIX tool does.
///
/// The raw `io::Error` message is localized by the OS, so a Chinese Windows would print Chinese where
/// every other POSIX tool prints English; the common kinds are named explicitly and anything else
/// falls back to the system text.
fn describe(error: &io::Error) -> String {
    match error.kind() {
        io::ErrorKind::NotFound => "No such file or directory".to_string(),
        io::ErrorKind::PermissionDenied => "Permission denied".to_string(),
        io::ErrorKind::IsADirectory => "Is a directory".to_string(),
        _ => error.to_string(),
    }
}

/// Whether the bytes look binary to diff: a NUL byte in the first block.
fn is_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|byte| *byte == 0)
}

/// Render the normal (default) diff format from a `similar` change list.
fn render_normal(changes: &[similar::Change<&str>], stdout: &mut impl Write) -> io::Result<()> {
    let mut index = 0;
    while index < changes.len() {
        if changes[index].tag() == ChangeTag::Equal {
            index += 1;
            continue;
        }
        // Collect the run of old lines and the run of new lines in this hunk.
        let mut old_lines: Vec<&str> = Vec::new();
        let mut new_lines: Vec<&str> = Vec::new();
        while index < changes.len() && changes[index].tag() != ChangeTag::Equal {
            let value = changes[index].value().trim_end_matches('\n');
            match changes[index].tag() {
                ChangeTag::Delete => old_lines.push(value),
                ChangeTag::Insert => new_lines.push(value),
                ChangeTag::Equal => {}
            }
            index += 1;
        }
        let old_start = changes[..index - old_lines.len() - new_lines.len()]
            .iter()
            .filter(|change| change.tag() != ChangeTag::Insert)
            .count()
            + 1;
        let new_start = changes[..index - old_lines.len() - new_lines.len()]
            .iter()
            .filter(|change| change.tag() != ChangeTag::Delete)
            .count()
            + 1;

        match (old_lines.is_empty(), new_lines.is_empty()) {
            (false, false) => writeln!(
                stdout,
                "{}c{}",
                range(old_start, old_lines.len()),
                range(new_start, new_lines.len())
            )?,
            (false, true) => writeln!(stdout, "{}d{}", range(old_start, old_lines.len()), new_start - 1)?,
            (true, false) => writeln!(stdout, "{}a{}", old_start - 1, range(new_start, new_lines.len()))?,
            (true, true) => {}
        }
        for line in &old_lines {
            writeln!(stdout, "< {line}")?;
        }
        if !old_lines.is_empty() && !new_lines.is_empty() {
            writeln!(stdout, "---")?;
        }
        for line in &new_lines {
            writeln!(stdout, "> {line}")?;
        }
    }
    Ok(())
}

/// A `start` or `start,count` range as the normal format prints it.
fn range(start: usize, count: usize) -> String {
    if count <= 1 {
        start.to_string()
    } else {
        format!("{},{}", start, start + count - 1)
    }
}

fn main() -> ExitCode {
    let mut brief = false;
    let mut unified: Option<usize> = None;
    let mut force_text = false;
    let mut missing_is_empty = false;
    let mut operands: Vec<String> = Vec::new();
    let mut options_done = false;

    for argument in env::args().skip(1) {
        if !options_done && argument == "--" {
            options_done = true;
            continue;
        }
        if !options_done && argument.starts_with('-') && argument.len() > 1 && argument != "-" {
            if let Some(rest) = argument.strip_prefix("--unified") {
                unified = Some(rest.strip_prefix('=').and_then(|value| value.parse().ok()).unwrap_or(3));
                continue;
            }
            if argument == "--brief" {
                brief = true;
                continue;
            }
            if argument == "--text" {
                force_text = true;
                continue;
            }
            if argument == "--new-file" {
                missing_is_empty = true;
                continue;
            }
            if let Some(rest) = argument.strip_prefix("-u") {
                unified = Some(rest.parse().ok().unwrap_or(3));
                continue;
            }
            if argument == "-q" {
                brief = true;
                continue;
            }
            if argument == "-a" {
                force_text = true;
                continue;
            }
            if argument == "-N" {
                missing_is_empty = true;
                continue;
            }
            eprintln!("diff: invalid option -- '{}'", argument.trim_start_matches('-'));
            return ExitCode::from(2);
        }
        operands.push(argument);
    }

    if operands.len() != 2 {
        eprintln!("diff: usage: diff [-q] [-u[N]] [-a] [-N] file1 file2");
        return ExitCode::from(2);
    }

    let left = match read_operand(&operands[0], missing_is_empty) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("diff: {}: {}", operands[0], describe(&error));
            return ExitCode::from(2);
        }
    };
    let right = match read_operand(&operands[1], missing_is_empty) {
        Ok(input) => input,
        Err(error) => {
            eprintln!("diff: {}: {}", operands[1], describe(&error));
            return ExitCode::from(2);
        }
    };

    if left.bytes == right.bytes {
        return ExitCode::SUCCESS;
    }
    if brief {
        println!("Files {} and {} differ", left.label, right.label);
        return ExitCode::from(1);
    }
    if !force_text && (is_binary(&left.bytes) || is_binary(&right.bytes)) {
        println!("Binary files {} and {} differ", left.label, right.label);
        return ExitCode::from(1);
    }

    let left_text = String::from_utf8_lossy(&left.bytes);
    let right_text = String::from_utf8_lossy(&right.bytes);
    let text_diff = TextDiff::from_lines(left_text.as_ref(), right_text.as_ref());
    let stdout = io::stdout();
    let mut handle = stdout.lock();

    let result = match unified {
        Some(radius) => {
            let diff = text_diff
                .unified_diff()
                .context_radius(radius)
                .header(&left.label, &right.label)
                .to_string();
            write!(handle, "{diff}")
        }
        None => render_normal(text_diff.iter_all_changes().collect::<Vec<_>>().as_slice(), &mut handle),
    };
    if let Err(error) = result {
        eprintln!("diff: write failed: {error}");
        return ExitCode::from(2);
    }
    let _ = handle.flush();
    ExitCode::from(1)
}
