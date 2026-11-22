# ============================================================================
# NillyDoc Pro — Windows 11 Default .PDF Installer (Zero Admin Required)
# created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/
# ============================================================================
param(
    [switch]$Silent,
    [switch]$OpenDefaultApps
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$exePath = Join-Path $root 'NillyDocPro.exe'
$icoPath = Join-Path $root 'NillyDocPro.ico'
$srcPath = Join-Path $root 'desktop\NillyDocPro.cs'

Write-Host ''
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host '   NillyDoc Pro — Εγκατάσταση & Σύνδεση με αρχεία .PDF' -ForegroundColor White
Write-Host '   created by Nilly graphics (Sotiris Christos)' -ForegroundColor DarkGray
Write-Host '   https://nillygraphics.com/' -ForegroundColor DarkGray
Write-Host '  ============================================================' -ForegroundColor Cyan
Write-Host ''

# 1. Unblock downloaded files if from GitHub ZIP
Get-ChildItem -Path $root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

# 2. Auto-compile NillyDocPro.exe if missing or older than source
$needBuild = (-not (Test-Path $exePath)) -or ((Test-Path $srcPath) -and ((Get-Item $srcPath).LastWriteTimeUtc -gt (Get-Item $exePath).LastWriteTimeUtc))
if ($needBuild) {
    $csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
    if (-not (Test-Path $csc)) { $csc = 'C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe' }
    if (-not (Test-Path $csc)) { throw 'Δεν βρέθηκε ο .NET Framework C# compiler (csc.exe).' }
    Write-Host '  [1/3] Μεταγλώττιση NillyDocPro.exe (Native Windows Host)...' -ForegroundColor Yellow
    $cscArgs = @('/nologo', '/target:winexe', '/optimize+', "/out:$exePath", '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll')
    if (Test-Path $icoPath) { $cscArgs += "/win32icon:$icoPath" }
    $cscArgs += $srcPath
    & $csc @cscArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $exePath)) {
        throw "Αποτυχία μεταγλώττισης NillyDocPro.exe (exit $LASTEXITCODE)"
    }
    Write-Host ("        OK -> " + [math]::Round((Get-Item $exePath).Length / 1KB, 1) + " KB") -ForegroundColor Green
} else {
    Write-Host '  [1/3] NillyDocPro.exe έτοιμο.' -ForegroundColor Green
}

# 3. Register NillyDoc Pro as official Windows .pdf handler in HKCU (No Admin!)
Write-Host '  [2/3] Εγγραφή του NillyDoc Pro στα Windows για αρχεία .PDF...' -ForegroundColor Yellow
$iconRef = if (Test-Path $icoPath) { "$icoPath,0" } else { "$exePath,0" }
$openCmd = "`"$exePath`" `"%1`""

# ProgID: NillyDocPro.PDF
$progKey = 'HKCU:\Software\Classes\NillyDocPro.PDF'
New-Item -Path "$progKey\DefaultIcon" -Force | Out-Null
New-Item -Path "$progKey\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path $progKey -Name '(Default)' -Value 'NillyDoc Pro PDF Document'
Set-ItemProperty -Path $progKey -Name 'FriendlyTypeName' -Value 'NillyDoc Pro PDF Document'
Set-ItemProperty -Path "$progKey\DefaultIcon" -Name '(Default)' -Value $iconRef
Set-ItemProperty -Path "$progKey\shell\open" -Name 'FriendlyAppName' -Value 'NillyDoc Pro'
Set-ItemProperty -Path "$progKey\shell\open\command" -Name '(Default)' -Value $openCmd

# OpenWithProgids for .pdf
$pdfOpenWith = 'HKCU:\Software\Classes\.pdf\OpenWithProgids'
New-Item -Path $pdfOpenWith -Force | Out-Null
Set-ItemProperty -Path $pdfOpenWith -Name 'NillyDocPro.PDF' -Value ([byte[]]@()) -Type Binary

# Applications\NillyDocPro.exe
$appKey = 'HKCU:\Software\Classes\Applications\NillyDocPro.exe'
New-Item -Path "$appKey\DefaultIcon" -Force | Out-Null
New-Item -Path "$appKey\shell\open\command" -Force | Out-Null
New-Item -Path "$appKey\SupportedTypes" -Force | Out-Null
Set-ItemProperty -Path $appKey -Name 'FriendlyAppName' -Value 'NillyDoc Pro'
Set-ItemProperty -Path "$appKey\DefaultIcon" -Name '(Default)' -Value $iconRef
Set-ItemProperty -Path "$appKey\shell\open\command" -Name '(Default)' -Value $openCmd
Set-ItemProperty -Path "$appKey\SupportedTypes" -Name '.pdf' -Value ''

# RegisteredApplications (makes NillyDoc Pro appear in Windows 11 Settings -> Default Apps)
$capKey = 'HKCU:\Software\NillyGraphics\NillyDocPro\Capabilities'
New-Item -Path "$capKey\FileAssociations" -Force | Out-Null
Set-ItemProperty -Path $capKey -Name 'ApplicationName' -Value 'NillyDoc Pro'
Set-ItemProperty -Path $capKey -Name 'ApplicationDescription' -Value 'Ultra-lightweight Acrobat-style PDF Studio — created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/'
Set-ItemProperty -Path "$capKey\FileAssociations" -Name '.pdf' -Value 'NillyDocPro.PDF'
New-Item -Path 'HKCU:\Software\RegisteredApplications' -Force | Out-Null
Set-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'NillyDocPro' -Value 'Software\NillyGraphics\NillyDocPro\Capabilities'

# Notify Windows Explorer to refresh file associations immediately
try {
    Add-Type -Namespace NillyShell -Name Notify -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);' -ErrorAction SilentlyContinue
    [NillyShell.Notify]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

Write-Host '        OK -> Το NillyDoc Pro εμφανίζεται πλέον στο "Άνοιγμα με..." και στις Προεπιλεγμένες Εφαρμογές!' -ForegroundColor Green

# 4. Create Desktop & Start Menu Shortcuts
Write-Host '  [3/3] Δημιουργία συντομεύσεων (Επιφάνεια Εργασίας & Start Menu)...' -ForegroundColor Yellow
$wsh = New-Object -ComObject WScript.Shell
$desktopDir = [Environment]::GetFolderPath('Desktop')
$startMenuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Nilly graphics'
New-Item -ItemType Directory -Force -Path $startMenuDir | Out-Null

foreach ($lnkPath in @(
    (Join-Path $desktopDir 'NillyDoc Pro.lnk'),
    (Join-Path $startMenuDir 'NillyDoc Pro.lnk')
)) {
    $sc = $wsh.CreateShortcut($lnkPath)
    $sc.TargetPath = $exePath
    $sc.WorkingDirectory = $root
    $sc.Description = 'NillyDoc Pro — PDF Studio | created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/'
    if (Test-Path $icoPath) { $sc.IconLocation = "$icoPath,0" }
    $sc.Save()
}
Write-Host '        OK -> Έτοιμες οι συντομεύσεις!' -ForegroundColor Green
Write-Host ''
Write-Host '  ΟΛΟΚΛΗΡΩΘΗΚΕ! Για να ανοίγει ΚΑΘΕ .pdf αυτόματα με διπλό κλικ:' -ForegroundColor Cyan
Write-Host '   -> Δεξί κλικ σε ένα .pdf -> Άνοιγμα με -> NillyDoc Pro -> "Πάντα"' -ForegroundColor White
Write-Host '   -> Ή από Ρυθμίσεις Windows -> Προεπιλεγμένες εφαρμογές -> NillyDoc Pro -> .pdf' -ForegroundColor White
Write-Host ''

if ($OpenDefaultApps) {
    Start-Process 'ms-settings:defaultapps'
} elseif (-not $Silent) {
    $ans = Read-Host '  Θες να ανοίξω τώρα τις Προεπιλεγμένες Εφαρμογές των Windows (Ν/Ο)?'
    if ($ans -match '^[yYnNνΝ]') {
        if ($ans -match '^[yYνΝ]') { Start-Process 'ms-settings:defaultapps' }
    }
}
