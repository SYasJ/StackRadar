# Installing unsigned builds

StackRadar's installers are built by GitHub Actions straight from this repository's source. They are **not signed
with an Apple Developer ID or a Windows code-signing certificate** yet (those cost money each year and are on the
[roadmap](Roadmap.md)). The app is the same either way; your OS just can't verify who published it, so it asks you
to confirm once. Each release lists a `SHA256SUMS.txt` you can check the download against (see the end of this page).

### macOS (no Apple Developer ID)

1. Download the `.dmg` for your Mac: **`StackRadar-<version>-mac-arm64.dmg`** for Apple silicon (M1–M4),
   **`-mac-x64.dmg`** for Intel. Not sure? Apple menu → **About This Mac** → *Chip*.
2. Open the `.dmg` and drag **StackRadar** onto **Applications**.
3. Open StackRadar from Applications. macOS says it *"cannot verify that StackRadar is free of malware"* or
   *"Apple could not verify StackRadar"*. Click **Done** / **OK** (not *Move to Trash*).
4. Open **System Settings → Privacy & Security**, scroll down to *"StackRadar was blocked to protect your Mac"* and click
   **Open Anyway**. Confirm with your password or Touch ID, then click **Open**.
   - On macOS 14 Sonoma and older you can instead **right-click (Control-click) the app → Open → Open**.
5. That's it. macOS remembers your choice; later launches open normally.

**If macOS says "StackRadar is damaged and can't be opened"**, the download's quarantine flag is the problem, not the
file. Remove it in Terminal, then open the app again:

```bash
xattr -dr com.apple.quarantine /Applications/StackRadar.app
```

**Updates on macOS:** macOS only lets an app replace itself when it is signed with a Developer ID. Unsigned StackRadar
still checks for updates and tells you when a new version is out (**Help → Check for Updates** too); click
**Download**, then drag the new version onto Applications and choose **Replace**. Your settings and rules in
`~/.stackradar` are kept.

### Windows (no code-signing certificate)

1. Download **`StackRadar-<version>-win-x64.exe`** (installer, auto-updates) or **`StackRadar-<version>-portable.exe`**
   (no install, no auto-update).
2. **Browser warning** (Edge: *"isn't commonly downloaded"*): click **…** → **Keep** → **Show more** → **Keep anyway**.
   Chrome: **Keep** in the download bubble.
3. Run it. **Microsoft Defender SmartScreen** shows *"Windows protected your PC"*. Click **More info**, check that the
   app is *StackRadar-<version>…exe*, then **Run anyway**.
4. The installer asks where to install (per-user by default, no admin needed) and creates Start-menu and desktop
   shortcuts.
5. Windows may ask once whether StackRadar may use the network. **Private networks** is enough; StackRadar only
   listens on `127.0.0.1`.

**Updates on Windows:** the installed version downloads updates in the background and asks to restart. SmartScreen
doesn't prompt again for updates installed by the app.

**Smart App Control** (Windows 11, if switched on) blocks all unsigned apps and has no "run anyway". Use the
[source version](Installation.md#option-2-run-from-source) or switch Smart App Control off in *Windows Security → App &
browser control*.

### Linux

AppImages and `.deb` packages are never signed this way, so nothing changes:

```bash
chmod +x StackRadar-<version>-linux-x86_64.AppImage && ./StackRadar-<version>-linux-x86_64.AppImage
# or
sudo apt install ./StackRadar-<version>-linux-amd64.deb
```

If the AppImage doesn't start on Ubuntu 22.04+, install FUSE 2: `sudo apt install libfuse2` (`libfuse2t64` on 24.04).

### Check your download (optional)

Every release has a `SHA256SUMS.txt`. Compare it with the hash of the file you downloaded:

```bash
shasum -a 256 StackRadar-<version>-mac-arm64.dmg          # macOS
sha256sum StackRadar-<version>-linux-x86_64.AppImage       # Linux
```
```powershell
Get-FileHash .\StackRadar-<version>-win-x64.exe -Algorithm SHA256   # Windows
```

### Which version do I have?

The window title and **Help → About StackRadar** show the version (in the browser version, see **Settings** or the **Updates** tab).
From source: `python3 stackradar.py --version`. Every version is listed in the [changelog](https://github.com/SYasJ/StackRadar/blob/main/CHANGELOG.md).
