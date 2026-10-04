// Freeze stackradar.py (+ UI files) into a standalone folder with PyInstaller so the
// desktop app needs no Python on the user's machine. Output: ../dist/stackradar-server/
const { execFileSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..", "..");
const py = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const run = args => execFileSync(py, args, { cwd: root, stdio: "inherit" });

// keep the desktop version in lock-step with ../VERSION
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const pkgPath = path.join(__dirname, "..", "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
if (pkg.version !== version) { pkg.version = version; fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n"); }

// macOS release builds use a universal2 Python so one backend serves Intel + Apple silicon
const extra = process.env.DR_UNIVERSAL ? ["--target-arch", "universal2"] : [];
run(["-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--console", ...extra,
  "--name", "stackradar-server",
  "--distpath", path.join(root, "dist"), "--workpath", path.join(root, "build", "pyinstaller"),
  "--specpath", path.join(root, "build"),
  "--add-data", path.join(root, "index.html") + ":.",
  "--add-data", path.join(root, "static") + ":static",
  "--add-data", path.join(root, "VERSION") + ":.",
  path.join(root, "stackradar.py")]);
console.log("backend ready → dist/stackradar-server (v" + version + ")");
