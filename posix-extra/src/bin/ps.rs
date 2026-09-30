//! `ps`: a GNU-shaped view over the Windows process table.
//!
//! The table comes from `tasklist`, with a `powershell` fallback that only a confined token needs.
//! Both are dependency-free views of what Windows actually has, and the columns are the ones
//! Windows exposes: there is no controlling terminal, no parent pid and no per-process CPU time
//! available here, so `TTY` prints `?`, and `-f`'s `PPID`/`C`/`STIME` columns print `?` rather than
//! a guess. `UID` prints `?` because Windows process ownership is a token, not a numeric user id.
//!
//! ## Why there is a fallback
//!
//! DSH's Windows file sandbox runs a confined child write-restricted and at low integrity, and
//! `tasklist` answers `Access denied` under it — measured with the provider's own `AclSandbox`, not
//! assumed. Without a fallback `ps` would fail in exactly the tiers this toolchain exists for.
//! `powershell -Command Get-Process` does answer there, because the process-list cmdlet is permitted
//! in constrained language mode where `[System.Diagnostics.Process]::GetProcesses()` is not; it
//! reports the processes this token may inspect rather than the whole machine, so the fallback
//! announces itself on stderr and never pretends to be the full table. Two smaller shape differences
//! come with it: image names lose their `.exe` suffix (that is what the cmdlet reports), and the row
//! order is re-sorted to match `tasklist`.
//!
//! A second, unrelated way to get a short table is worth knowing when probing by hand: an executable
//! launched from a directory carrying a low integrity label — such as a workspace tree that DSH's
//! ACL sandbox has already granted — runs at low integrity itself, and then `tasklist` succeeds while
//! listing only same-or-lower integrity processes. Measured: the same binary reports 11 rows inside
//! such a tree and 332 rows after being copied to `%TEMP%`. That is an environment artifact of where
//! a probe was built, not a property of this command, so `ps` cannot warn about it.
//!
//! Supported: `-e`/`-A` (every process, which is also the default here, since Windows has no session
//! notion that would make another default meaningful) and `-f` (the fuller column set). Selectors such
//! as `-p`, `-u` and `aux` are rejected instead of being accepted and ignored.
//!
//! Exit status: 0 on success, 1 when neither source can produce a table, 2 on a usage error.

use std::process::{Command, ExitCode};

/// One row of the process table.
struct Process {
    /// Image name exactly as the source reported it.
    name: String,
    /// Process id.
    pid: u32,
}

/// The columns `-f` adds, all of which Windows does not expose through either source.
#[derive(Clone, Copy)]
struct Options {
    /// Whether to print the fuller column set.
    full: bool,
}

/// A produced table plus the provenance the caller needs in order to warn honestly.
enum Table {
    /// `tasklist` answered: every process on the machine.
    Machine(Vec<Process>),
    /// `tasklist` was denied and the fallback answered: only what this token may inspect.
    Visible(Vec<Process>),
}

/// Parse the arguments, returning `None` after a usage error has been reported.
fn parse(arguments: &[String]) -> Option<Options> {
    let mut options = Options { full: false };
    for argument in arguments {
        match argument.as_str() {
            // `-A` is GNU's synonym for `-e`; both mean "every process" here.
            "-e" | "-A" | "--every" => {}
            "-f" | "--full" => options.full = true,
            "-ef" | "-fe" | "-eF" => options.full = true,
            other => {
                eprintln!("ps: unsupported option -- '{other}'");
                eprintln!("Usage: ps [-e|-A] [-f]");
                return None;
            }
        }
    }
    Some(options)
}

/// Read the process table from `tasklist`, which needs no restricted-token fallback when it works.
///
/// `tasklist` is a system program, so its failure is reported rather than papered over: the caller
/// decides whether the fallback applies.
fn read_tasklist() -> Result<Vec<Process>, String> {
    let output = Command::new("tasklist")
        .args(["/FO", "CSV", "/NH"])
        .output()
        .map_err(|error| format!("cannot run tasklist: {error}"))?;
    if !output.status.success() {
        return Err(format!("tasklist exited with {}", output.status.code().unwrap_or(-1)));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut processes = Vec::new();
    for line in text.lines() {
        let fields = split_csv(line.trim());
        // `"Image Name","PID","Session Name","Session#","Mem Usage"`
        let (Some(name), Some(pid)) = (fields.first(), fields.get(1)) else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        processes.push(Process { name: name.clone(), pid });
    }
    // `tasklist` returns rows in no particular order; GNU's order is equally arbitrary, but a stable
    // one keeps `head` and diff-based checks meaningful.
    processes.sort_by_key(|process| process.pid);
    Ok(processes)
}

/// Read the table through `powershell`, which is what answers inside a `WRITE_RESTRICTED` token.
///
/// `Get-Process` is a cmdlet, so it survives the constrained language mode that refuses
/// `[System.Diagnostics.Process]::GetProcesses()` there. Only property reads are used, which that
/// mode permits.
fn read_visible() -> Result<Vec<Process>, String> {
    let output = Command::new("powershell")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            "Get-Process | ForEach-Object { \"$($_.Id)`t$($_.ProcessName)\" }",
        ])
        .output()
        .map_err(|error| format!("cannot run powershell: {error}"))?;
    if !output.status.success() {
        return Err(format!("powershell exited with {}", output.status.code().unwrap_or(-1)));
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let mut processes = Vec::new();
    for line in text.lines() {
        let Some((pid, name)) = line.trim().split_once('\t') else {
            continue;
        };
        let Ok(pid) = pid.trim().parse::<u32>() else {
            continue;
        };
        processes.push(Process { name: name.trim().to_string(), pid });
    }
    if processes.is_empty() {
        return Err("powershell reported no processes".to_string());
    }
    processes.sort_by_key(|process| process.pid);
    Ok(processes)
}

/// Produce a table from the first source that answers, so a confined token loses rows and not the command.
fn read_table() -> Result<Table, String> {
    match read_tasklist() {
        Ok(processes) => Ok(Table::Machine(processes)),
        Err(denied) => read_visible()
            .map(Table::Visible)
            .map_err(|fallback| format!("{denied}; {fallback}")),
    }
}

/// Split one `tasklist` CSV row, honouring the quotes it always uses.
fn split_csv(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut quoted = false;
    for character in line.chars() {
        match character {
            '"' => quoted = !quoted,
            ',' if !quoted => {
                fields.push(std::mem::take(&mut current));
            }
            other => current.push(other),
        }
    }
    fields.push(current);
    fields
}

/// Render the table.
fn render(processes: &[Process], options: Options) -> String {
    let mut out = String::new();
    if options.full {
        out.push_str("UID        PID  PPID  C STIME TTY          TIME CMD\n");
        for process in processes {
            out.push_str(&format!(
                "{:>3} {:>10} {:>5} {:>2} {:>5} {:<8} {:>8} {}\n",
                "?", process.pid, "?", "?", "?", "?", "00:00:00", process.name
            ));
        }
    } else {
        out.push_str("    PID TTY          TIME CMD\n");
        for process in processes {
            out.push_str(&format!(
                "{:>7} {:<8} {:>8} {}\n",
                process.pid, "?", "00:00:00", process.name
            ));
        }
    }
    out
}

/// Run `ps` with the arguments after the program name.
fn run(arguments: &[String]) -> ExitCode {
    let Some(options) = parse(arguments) else {
        return ExitCode::from(2);
    };
    match read_table() {
        Ok(table) => {
            let (processes, note) = match &table {
                Table::Machine(processes) => (processes, None),
                Table::Visible(processes) => (
                    processes,
                    Some(
                        "ps: tasklist is denied for this token, so the table lists only the processes it can \
                         inspect (and image names carry no `.exe`); widen the sandbox policy for the whole machine",
                    ),
                ),
            };
            if let Some(note) = note {
                eprintln!("{note}");
            }
            print!("{}", render(processes, options));
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("ps: {message}");
            ExitCode::from(1)
        }
    }
}

/// Entry point.
fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    run(&arguments)
}