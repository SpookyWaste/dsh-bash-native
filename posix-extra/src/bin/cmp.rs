//! `cmp`: compare two files byte by byte.
//!
//! Semantics follow GNU cmp for the cases a script uses in practice:
//!   * different files          -> stdout `<a> <b> differ: char N, line L`, exit 1
//!   * one file is a prefix     -> stderr `cmp: EOF on <name> after byte N`, exit 1
//!   * `-s`                     -> no output, exit 1 when they differ
//!   * `-l`                     -> `<byte> <octal a> <octal b>` for every differing byte, exit 1
//!   * `-b`                     -> the differing byte is also shown as an octal value and a visible
//!                                 character, as GNU does
//!   * trouble (missing file, bad usage) -> stderr message, exit 2
//!
//! `-` reads standard input, as GNU cmp does. Comparison is streamed in chunks and only the newline
//! count is retained, so memory does not grow with file size. `-i/--ignore-initial` and
//! `-n/--bytes` are not implemented, because nothing measured here needs them and a half-tested
//! option is worse than an absent one.

use std::env;
use std::fs::File;
use std::io::{self, Read, Write};
use std::process::ExitCode;

const CHUNK: usize = 64 * 1024;

/// An input that is either a file or standard input, with the name to report.
struct Input {
    name: String,
    reader: Box<dyn Read>,
}

fn open(path: &str) -> io::Result<Input> {
    if path == "-" {
        Ok(Input {
            name: "-".to_string(),
            reader: Box::new(io::stdin()),
        })
    } else {
        Ok(Input {
            name: path.to_string(),
            reader: Box::new(File::open(path)?),
        })
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

/// Report an operating-system error the way cmp does, with the name that failed.
fn report(path: &str, error: &io::Error) -> ExitCode {
    eprintln!("cmp: {path}: {}", describe(error));
    ExitCode::from(2)
}

/// How many newlines `bytes` contains.
fn newlines_in(bytes: &[u8]) -> usize {
    bytes.iter().filter(|byte| **byte == b'\n').count()
}

/// Render one byte the way `cmp -b` does: an octal value is printed alongside by the caller, and the
/// visible form uses the `^X` and `M-` conventions for control and high bytes.
fn visible_byte(byte: u8) -> String {
    if byte == 127 {
        return "^?".to_string();
    }
    if byte < 32 {
        return format!("^{}", (byte + 64) as char);
    }
    if byte >= 128 {
        return format!("M-{}", visible_byte(byte - 128));
    }
    (byte as char).to_string()
}

fn main() -> ExitCode {
    let mut silent = false;
    let mut verbose = false;
    let mut print_bytes = false;
    let mut operands: Vec<String> = Vec::new();
    let mut options_done = false;
    for argument in env::args().skip(1) {
        if !options_done && argument == "--" {
            options_done = true;
            continue;
        }
        if !options_done && argument.starts_with('-') && argument.len() > 1 && argument != "-" {
            for flag in argument.chars().skip(1) {
                match flag {
                    's' => silent = true,
                    'l' => verbose = true,
                    'b' => print_bytes = true,
                    other => {
                        eprintln!("cmp: invalid option -- '{other}'");
                        return ExitCode::from(2);
                    }
                }
            }
            continue;
        }
        operands.push(argument);
    }
    if operands.len() != 2 {
        eprintln!("cmp: usage: cmp [-b] [-l] [-s] file1 file2");
        return ExitCode::from(2);
    }

    let mut left = match open(&operands[0]) {
        Ok(input) => input,
        Err(error) => return report(&operands[0], &error),
    };
    let mut right = match open(&operands[1]) {
        Ok(input) => input,
        Err(error) => return report(&operands[1], &error),
    };

    let mut newlines: usize = 0;
    let mut offset: usize = 0;
    let mut differ = false;
    let mut left_buffer = vec![0_u8; CHUNK];
    let mut right_buffer = vec![0_u8; CHUNK];
    let mut stdout = io::stdout();

    loop {
        let left_read = match left.reader.read(&mut left_buffer) {
            Ok(count) => count,
            Err(error) => return report(&left.name, &error),
        };
        let right_read = match right.reader.read(&mut right_buffer) {
            Ok(count) => count,
            Err(error) => return report(&right.name, &error),
        };
        let common = left_read.min(right_read);

        for index in 0..common {
            if left_buffer[index] == right_buffer[index] {
                continue;
            }
            differ = true;
            if !verbose {
                if !silent {
                    let byte = offset + index + 1;
                    let line = newlines + newlines_in(&left_buffer[..index]) + 1;
                    // GNU says "char", and only in `-b` mode does it say "byte" and print values.
                    let noun = if print_bytes { "byte" } else { "char" };
                    if print_bytes {
                        println!(
                            "{} {} differ: byte {byte}, line {line} is {:3o} {} {:3o} {}",
                            left.name,
                            right.name,
                            left_buffer[index],
                            visible_byte(left_buffer[index]),
                            right_buffer[index],
                            visible_byte(right_buffer[index])
                        );
                    } else {
                        println!("{} {} differ: {noun} {byte}, line {line}", left.name, right.name);
                    }
                }
                // Without -l the first difference is the answer, so the scan can stop here.
                return ExitCode::from(1);
            }
            if print_bytes {
                let _ = writeln!(
                    stdout,
                    "{} {:3o} {} {:3o} {}",
                    offset + index + 1,
                    left_buffer[index],
                    visible_byte(left_buffer[index]),
                    right_buffer[index],
                    visible_byte(right_buffer[index])
                );
            } else {
                let _ = writeln!(
                    stdout,
                    "{} {:3o} {:3o}",
                    offset + index + 1,
                    left_buffer[index],
                    right_buffer[index]
                );
            }
        }
        let _ = stdout.flush();

        if left_read != right_read {
            let (name, read) = if left_read < right_read {
                (left.name.clone(), left_read)
            } else {
                (right.name.clone(), right_read)
            };
            // GNU reports the byte offset only; the line number belongs to the "differ" message.
            if !silent {
                eprintln!("cmp: EOF on {name} after byte {}", offset + read);
            }
            return ExitCode::from(1);
        }
        if left_read == 0 {
            return if differ { ExitCode::from(1) } else { ExitCode::SUCCESS };
        }

        newlines += newlines_in(&left_buffer[..common]);
        offset += common;
    }
}
