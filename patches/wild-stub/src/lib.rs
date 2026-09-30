//! A stand-in for the `wild` crate that never re-expands arguments.
//!
//! `wild` emulates Unix glob expansion for `cmd.exe` and PowerShell, which cannot do it
//! themselves. That premise breaks under a POSIX shell: quoting is resolved before `exec`, the
//! parent serializes an argument such as `*.txt` without quotes because it contains no spaces, and
//! the program then sees no evidence that the caller quoted it — so `find . -name "*.txt"` becomes
//! `find . -name a.txt b.txt` and fails with `unknown predicate 'b.txt'`. The information needed to
//! decide is gone by the time any program can look at it, so a program that guesses is wrong
//! whenever the guess matters.
//!
//! uutils reaches glob expansion through this crate from `uucore`, which every utility in this
//! toolchain uses to read its arguments. Replacing the crate therefore fixes every utility at once:
//! they see the arguments their parent passed, exactly as GNU utilities do on Unix.

use std::ffi::OsString;

/// The process arguments, exactly as the parent passed them.
pub fn args_os() -> impl Iterator<Item = OsString> {
    std::env::args_os()
}

/// The process arguments, exactly as the parent passed them, decoded as UTF-8 where possible.
pub fn args() -> impl Iterator<Item = String> {
    std::env::args()
}
