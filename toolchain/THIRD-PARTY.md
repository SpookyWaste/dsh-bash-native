# Third-party licences: the packaged POSIX toolchain

`toolchain/win32-x64/` ships the toolchain this project builds, so an install needs neither Rust nor Go.
Every file is unmodified from the component below, and `manifest.json` records each file's sha256, size
and the command names it publishes; `src/toolchain-artifact.ts` verifies those hashes before the files run.

| Component | Version | Licence | Source | Files | Names |
| --- | --- | --- | --- | --- | --- |
| `coreutils` | 0.12.0 | MIT | https://github.com/uutils/coreutils | `coreutils.exe` | 15 |
| `findutils` | 0.10.0 | MIT | https://github.com/uutils/findutils | `find.exe`, `locate.exe`, `updatedb.exe`, `xargs.exe` | 4 |
| `goawk` | v1.32.0 | MIT | https://github.com/benhoyt/goawk | `awk.exe` | 1 |
| `grep` | 0.2.0 | MIT | https://github.com/uutils/grep | `grep.exe` | 1 |
| `jaq` | v3.1.1 | MIT | https://github.com/01mf02/jaq | `jq.exe` | 1 |
| `posix-extra` | 0.1.0 | MIT | in-repo (posix-extra) | `cmp.exe`, `diff.exe`, `ps.exe`, `stat.exe`, `which.exe` | 5 |
| `sed` | 0.1.1 | MIT | https://github.com/uutils/sed | `sed.exe` | 1 |

GNU bash is **not** part of this package: it is GPLv3 and is only ever invoked as an external program.
The engine this bundle ships has its own record in `engine/THIRD-PARTY.md` and `engine/LICENSE.brush`.

Rebuild and repackage with `node scripts/build-toolchain.mjs` followed by `node scripts/pack-toolchain.mjs`.
