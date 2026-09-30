// The `/tmp` and `/<letter>` aliases, applied inside the toolchain programs themselves.
//
// The engine rewrites the command path and every argument it spawns (`patches/brush/0004-*.patch` and
// `patches/brush/0009-*.patch`), which covers what the shell starts. A program that **another program**
// starts — the child of `find -exec`, `xargs` or `timeout` — gets its arguments from that program rather
// than from the shell, so `printf '/tmp/f\n' | xargs awk '{print}'` used to hand `awk` a literal
// `/tmp/f`, which Windows resolves against the current drive's root. This file is the same rule applied
// inside the programs, which is how MSYS makes the alias hold for everything it builds.
//
// It is the Go twin of `dsh_path_alias.rs`: `awk` is the one component in the toolchain built from Go
// source (`goawk`), so it cannot link the Rust module the other components share. The source of truth is
// the two engine patches: keep this file, its Rust twin, their `normalize_shell_arg`, and the corpus in
// step. `corpus/compat.json` pins both paths — the engine-spawned cases (`argv-*`) and the program-chain
// cases (`xargs-*`, `find-exec-*` with an aliased argument, `alias-chain-xargs-awk` for this file) —
// which is what catches drift between the copies, since neither the engine's implementation nor the Rust
// module can be linked into this binary.
//
// `scripts/build-toolchain.mjs` copies this file into each component the lock marks `pathAlias`, and the
// component's patch calls it at its own argument boundary.
package main

import (
	"os"
	"path/filepath"
	"strings"
)

// dshNoPathConversion reports whether the caller asked for the rewrite to be off, exactly as the engine
// reads it: any non-empty value other than `0`.
func dshNoPathConversion() bool {
	value, present := os.LookupEnv("DSH_BASH_NATIVE_NO_PATHCONV")
	return present && value != "" && value != "0"
}

// dshTranslateArguments rewrites every argument in place, the way the engine rewrites the arguments it
// spawns. A program that later hands its own arguments on (`find -exec`, `xargs`) is the reason the rule
// is applied here rather than only at the shell boundary.
//
// The temporary directory is a parameter so the rule is testable without the machine's environment.
func dshTranslateArguments(arguments []string, tempDir func() string) {
	if dshNoPathConversion() {
		return
	}
	for index, argument := range arguments {
		if converted, ok := dshTranslateArgument(argument, tempDir); ok {
			arguments[index] = converted
		}
	}
}

// dshTranslateArgument rewrites one argument: a `/tmp` path, a `/<letter>` drive mount, or either of
// those as an option's attached value.
func dshTranslateArgument(argument string, tempDir func() string) (string, bool) {
	if converted, ok := dshTranslateTmpPath(argument, tempDir); ok {
		return converted, true
	}
	if converted, ok := dshTranslateMountArgument(argument); ok {
		return converted, true
	}
	// An option's attached value cannot be a Windows switch, so the bare mount root is accepted there.
	option, value, found := strings.Cut(argument, "=")
	if !found || !strings.HasPrefix(option, "-") {
		return "", false
	}
	if converted, ok := dshTranslateTmpPath(value, tempDir); ok {
		return option + "=" + converted, true
	}
	if converted, ok := dshTranslateMountPath(value); ok {
		return option + "=" + converted, true
	}
	return "", false
}

// dshTranslateTmpPath rewrites `/tmp` and everything below it to the temporary directory.
func dshTranslateTmpPath(argument string, tempDir func() string) (string, bool) {
	logical, _, ok := dshLogicalComponents(argument)
	if !ok || len(logical) == 0 || logical[0] != "tmp" {
		return "", false
	}
	return dshJoin(tempDir(), logical[1:]), true
}

// dshTranslateMountArgument maps a POSIX drive mount (`/d/Pi`) onto the Windows drive it names, but
// refuses the bare mount root: a bare `/<letter>` argument is how Windows' own tools spell their
// switches (`cmd.exe /c`), so the ambiguity is resolved in favour of the switch.
func dshTranslateMountArgument(argument string) (string, bool) {
	logical, count, ok := dshLogicalComponents(argument)
	if !ok || count <= 2 {
		return "", false
	}
	return dshMountPath(logical)
}

// dshTranslateMountPath is the same rewrite for a value that cannot be a switch, where a bare mount root
// is unambiguous.
func dshTranslateMountPath(argument string) (string, bool) {
	logical, _, ok := dshLogicalComponents(argument)
	if !ok {
		return "", false
	}
	return dshMountPath(logical)
}

// dshMountPath maps components whose first is a single letter onto that drive, and reports false when
// there is no first component or it does not name one.
func dshMountPath(logical []string) (string, bool) {
	if len(logical) == 0 {
		return "", false
	}
	root, ok := dshMountRoot(logical[0])
	if !ok {
		return "", false
	}
	return dshJoin(root, logical[1:]), true
}

// dshMountRoot is the Windows root one `/<letter>` mount stands for, or false when the component is not
// a single ASCII letter. The letter's case does not matter and the mount is not drive-relative.
func dshMountRoot(component string) (string, bool) {
	if len(component) != 1 {
		return "", false
	}
	letter := component[0]
	if (letter < 'a' || letter > 'z') && (letter < 'A' || letter > 'Z') {
		return "", false
	}
	return strings.ToUpper(component) + ":" + string(os.PathSeparator), true
}

// dshLogicalComponents reads a POSIX operand as the components the reference parser reports: the
// argument has to be rooted, `.` is dropped, `..` collapses against the components before it, and a
// Windows path is refused rather than half-resolved.
//
// The count is what the reference parser's component list yields, which is what keeps a bare
// `/<letter>` distinguishable from a mount with something below it: a trailing separator and a trailing
// `.` add no component, while `..` does.
func dshLogicalComponents(argument string) (logical []string, count int, ok bool) {
	if argument == "" || !os.IsPathSeparator(argument[0]) {
		return nil, 0, false
	}
	if dshNamesUNC(argument) {
		return nil, 0, false
	}
	count = 1
	for _, component := range strings.FieldsFunc(argument, dshIsPathSeparator) {
		switch component {
		case ".":
		case "..":
			count++
			if len(logical) > 0 {
				logical = logical[:len(logical)-1]
			}
		default:
			count++
			logical = append(logical, component)
		}
	}
	return logical, count, true
}

// dshNamesUNC reports whether the argument is a Windows UNC path (`//host/share`), which the reference
// parser refuses to read as a POSIX operand for the same reason it refuses a drive prefix.
//
// It refuses the form that names both a server and a share, and reads a doubled separator with nothing
// between them (`\\tmp\\x`) as rooted; this reports exactly the same inputs, so the two copies agree on
// the surrounding edge cases as well as on the aliases.
func dshNamesUNC(argument string) bool {
	if len(argument) < 2 || !os.IsPathSeparator(argument[0]) || !os.IsPathSeparator(argument[1]) {
		return false
	}
	remainder := argument[2:]
	server := strings.IndexFunc(remainder, dshIsPathSeparator)
	if server <= 0 {
		return false
	}
	remainder = remainder[server+1:]
	share := strings.IndexFunc(remainder, dshIsPathSeparator)
	return share != 0
}

// dshIsPathSeparator is the predicate `strings.FieldsFunc` and `strings.IndexFunc` need, over the
// platform's separators.
func dshIsPathSeparator(character rune) bool {
	return character == '/' || character == filepath.Separator
}

// dshJoin appends the logical tail to a native root, keeping the root's own separator: the temporary
// directory ends in one and a drive root is nothing but one.
func dshJoin(root string, tail []string) string {
	if len(tail) == 0 {
		return root
	}
	joined := strings.Join(tail, string(os.PathSeparator))
	if strings.HasSuffix(root, "/") || strings.HasSuffix(root, string(os.PathSeparator)) {
		return root + joined
	}
	return root + string(os.PathSeparator) + joined
}