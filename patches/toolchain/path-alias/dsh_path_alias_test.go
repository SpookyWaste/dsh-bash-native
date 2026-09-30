// The behaviour table for `dsh_path_alias.go`, written as the twin of the one `dsh_path_alias.rs`
// carries so a reader can compare the two copies side by side.
//
// `scripts/build-toolchain.mjs` copies this file into the goawk checkout with the module; run it there
// with `go test -run TestDsh ./...`.
package main

import (
	"path/filepath"
	"runtime"
	"testing"
)

// dshTestTemp is the temporary directory the table rewrites against, with the trailing separator the
// platform's own temp-directory lookup returns.
func dshTestTemp() string {
	if runtime.GOOS == "windows" {
		return `C:\Temp\`
	}
	return "/var/tmp/"
}

// dshTestRewrite is the whole rewrite of one argument, for the cases that expect a changed value.
func dshTestRewrite(t *testing.T, argument string) string {
	t.Helper()
	converted, ok := dshTranslateArgument(argument, dshTestTemp)
	if !ok {
		t.Fatalf("%q: expected the argument to be rewritten", argument)
	}
	return converted
}

// dshTestUnchanged asserts the argument reaches the program exactly as it was given.
func dshTestUnchanged(t *testing.T, argument string) {
	t.Helper()
	if converted, ok := dshTranslateArgument(argument, dshTestTemp); ok {
		t.Fatalf("%q: expected it to be left alone, got %q", argument, converted)
	}
}

func TestDshTmpArgumentsAreRewritten(t *testing.T) {
	temp := dshTestTemp()
	cases := map[string]string{
		"/tmp":           temp,
		"/tmp/probe/sub": temp + filepath.Join("probe", "sub"),
		"--file=/tmp/p":  "--file=" + temp + "p",
		"-f=/tmp/p":      "-f=" + temp + "p",
	}
	for argument, expected := range cases {
		if converted := dshTestRewrite(t, argument); converted != expected {
			t.Errorf("%q: got %q, want %q", argument, converted, expected)
		}
	}
}

func TestDshDataArgumentsAreLeftAlone(t *testing.T) {
	for _, argument := range []string{
		"a message /tmp/x",
		"a=/tmp/x",
		"x=/tmp/x",
		"/tmpfile",
		"/var/tmp/x",
		// The component is compared exactly, so the spelling MSYS does not alias stays as it is.
		"/TMP/x",
		"",
		"-",
	} {
		dshTestUnchanged(t, argument)
	}
}

func TestDshTmpKeepsItsMeaningAndParentsCollapse(t *testing.T) {
	temp := dshTestTemp()
	if converted := dshTestRewrite(t, "/tmp/../tmp/x"); converted != temp+"x" {
		t.Errorf("got %q, want %q", converted, temp+"x")
	}
}

func TestDshNoPathConversionDisablesTheRewrite(t *testing.T) {
	for _, value := range []string{"1", "true", "-"} {
		t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", value)
		arguments := []string{"/tmp/x"}
		dshTranslateArguments(arguments, dshTestTemp)
		if arguments[0] != "/tmp/x" {
			t.Errorf("%q must turn the rewrite off, got %q", value, arguments[0])
		}
	}
	t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", "0")
	arguments := []string{"/tmp/x"}
	dshTranslateArguments(arguments, dshTestTemp)
	if arguments[0] != dshTestTemp()+"x" {
		t.Errorf(`"0" must not turn the rewrite off, got %q`, arguments[0])
	}
}

func TestDshTranslateArgumentsRewritesInPlace(t *testing.T) {
	// An empty value is how the engine reads "not requested": the switch is a non-empty value other
	// than `0`, so the caller's own environment does not change what a program does with its arguments.
	t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", "")
	arguments := []string{"{print}", "/tmp/x", "a=/tmp/x"}
	dshTranslateArguments(arguments, dshTestTemp)
	want := []string{"{print}", dshTestTemp() + "x", "a=/tmp/x"}
	for index, expected := range want {
		if arguments[index] != expected {
			t.Fatalf("argument %d: got %q, want %q (all: %q)", index, arguments[index], expected, arguments)
		}
	}
}

func TestDshDriveMountsAreRewrittenButABareMountIsNot(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("a `/<letter>` mount is Windows' own spelling")
	}
	// A bare `/<letter>` is how Windows' own tools spell their switches, and a mount with nothing below
	// it reads the same way; both stay as they are. An option's attached value cannot be a switch, so a
	// bare mount root is rewritten there.
	dshTestUnchanged(t, "/c")
	dshTestUnchanged(t, "/x/")
	dshTestUnchanged(t, "/x/.")
	dshTestUnchanged(t, "/c/..")
	dshTestUnchanged(t, "/dev/null")
	dshTestUnchanged(t, "/1/x")
	dshTestUnchanged(t, "/")
	for argument, expected := range map[string]string{
		"/c/Windows/System32": `C:\Windows\System32`,
		"--out=/d/Pi":         `--out=D:\Pi`,
		"--out=/d":            `--out=D:\`,
		"/d/Pi/../Pi/x":       `D:\Pi\x`,
		"/x/../y/z":           `Y:\z`,
		"///c/x":              `C:\x`,
		`\tmp\x`:              dshTestTemp() + "x",
	} {
		if converted := dshTestRewrite(t, argument); converted != expected {
			t.Errorf("%q: got %q, want %q", argument, converted, expected)
		}
	}
}

// A doubled leading separator names a UNC path only when a server and share follow it; with nothing
// between them the reference parser reads the argument as rooted, and so does this copy.
func TestDshUncAndDoubledSeparators(t *testing.T) {
	dshTestUnchanged(t, "//x/y")
	dshTestUnchanged(t, "//c/x")
	if runtime.GOOS != "windows" {
		t.Skip("the backslash spelling of a UNC path is Windows-only")
	}
	if converted := dshTestRewrite(t, `\\tmp\\x`); converted != dshTestTemp()+"x" {
		t.Errorf(`got %q, want %q`, converted, dshTestTemp()+"x")
	}
}