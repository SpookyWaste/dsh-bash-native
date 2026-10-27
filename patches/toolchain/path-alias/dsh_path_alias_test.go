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
		argv := []string{"ls.exe", "/tmp/x"}
		dshTranslateArguments(argv, dshTestTemp)
		if argv[1] != "/tmp/x" {
			t.Errorf("%q must turn the rewrite off, got %q", value, argv[1])
		}
	}
	t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", "0")
	argv := []string{"ls.exe", "/tmp/x"}
	dshTranslateArguments(argv, dshTestTemp)
	if argv[1] != dshTestTemp()+"x" {
		t.Errorf(`"0" must not turn the rewrite off, got %q`, argv[1])
	}
}

func TestDshTranslateArgumentsRewritesInPlace(t *testing.T) {
	// An empty value is how the engine reads "not requested": the switch is a non-empty value other
	// than `0`, so the caller's own environment does not change what a program does with its arguments.
	t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", "")
	// awk's first positional is its program, which stays verbatim; the file operand after it translates.
	argv := []string{"awk.exe", "{print}", "/tmp/x", "a=/tmp/x"}
	dshTranslateArguments(argv, dshTestTemp)
	want := []string{"awk.exe", "{print}", dshTestTemp() + "x", "a=/tmp/x"}
	for index, expected := range want {
		if argv[index] != expected {
			t.Fatalf("argument %d: got %q, want %q (all: %q)", index, argv[index], expected, argv)
		}
	}
}

// The data positions of the table, spelled out per program so the Go copy can be compared with the table
// `argv_data_primary_positions` holds in the engine and with the Rust twin.
func TestDshDataPositionTable(t *testing.T) {
	cases := []struct {
		name string
		argv []string
		want map[int]bool
	}{
		{"grep pattern positional", []string{"grep.exe", "-F", "/tmp/probe", "f"}, map[int]bool{1: true}},
		{"grep pattern option", []string{"grep.exe", "-e", "/tmp/probe", "f"}, map[int]bool{1: true}},
		{"grep -f moves the pattern into an option", []string{"grep.exe", "-f", "/tmp/pat", "f"}, map[int]bool{}},
		{"sed script", []string{"sed.exe", "-n", "/tmp/probe/p", "f"}, map[int]bool{1: true}},
		{"awk program", []string{"awk.exe", "/tmp/probe/{print}", "f"}, map[int]bool{0: true}},
		{"awk program file", []string{"awk.exe", "-f", "/tmp/p.awk", "f"}, map[int]bool{}},
		{"find start path is not a pattern", []string{"find.exe", "/tmp", "-name", "/tmp/x"}, map[int]bool{2: true}},
		{"basename is display text", []string{"basename.exe", "/tmp/a/b.txt", ".txt"}, map[int]bool{0: true, 1: true}},
		{"a tool outside the table", []string{"ls.exe", "/tmp/f"}, map[int]bool{}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := dshDataPositions(testCase.argv[0], testCase.argv[1:])
			for position := range got {
				if !testCase.want[position] {
					t.Errorf("argument %d (%q) must not be masked", position, testCase.argv[position+1])
				}
			}
			for position := range testCase.want {
				if !got[position] {
					t.Errorf("argument %d (%q) must be masked", position, testCase.argv[position+1])
				}
			}
		})
	}
}

// A chained child the shell never sees keeps its pattern and still resolves its file operand.
func TestDshChainKeepsDataAndTranslatesPaths(t *testing.T) {
	t.Setenv("DSH_BASH_NATIVE_NO_PATHCONV", "")
	argv := []string{"grep.exe", "-F", "/tmp/probe", "/tmp/f"}
	dshTranslateArguments(argv, dshTestTemp)
	if argv[2] != "/tmp/probe" {
		t.Errorf("the pattern must stay verbatim, got %q", argv[2])
	}
	if argv[3] != dshTestTemp()+"f" {
		t.Errorf("the file operand must translate, got %q", argv[3])
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
		"--out=/d/work":         `--out=D:\work`,
		"--out=/d":            `--out=D:\`,
		"/d/work/../work/x":       `D:\work\x`,
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
