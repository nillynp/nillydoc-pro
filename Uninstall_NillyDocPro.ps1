# ============================================================================
# NillyDoc Pro — Clean Uninstaller (Registry + Shortcuts only)
# created by Nilly graphics (Sotiris Christos) — https://nillygraphics.com/
# ============================================================================
param([switch]$Silent)

$ErrorActionPreference = 'SilentlyContinue'
Write-Host ''
Write-Host '  Απεγκατάσταση συντομεύσεων & εγγραφής .PDF του NillyDoc Pro...' -ForegroundColor Yellow

# Remove HKCU .pdf handler registrations
Remove-Item -Path 'HKCU:\Software\Classes\NillyDocPro.PDF' -Recurse -Force
Remove-ItemProperty -Path 'HKCU:\Software\Classes\.pdf\OpenWithProgids' -Name 'NillyDocPro.PDF' -Force
Remove-Item -Path 'HKCU:\Software\Classes\Applications\NillyDocPro.exe' -Recurse -Force
Remove-Item -Path 'HKCU:\Software\NillyGraphics\NillyDocPro' -Recurse -Force
Remove-ItemProperty -Path 'HKCU:\Software\RegisteredApplications' -Name 'NillyDocPro' -Force

# Remove Desktop & Start Menu shortcuts
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'NillyDoc Pro.lnk'
$startLnk   = Join-Path ([Environment]::GetFolderPath('Programs')) 'Nilly graphics\NillyDoc Pro.lnk'
if (Test-Path $desktopLnk) { Remove-Item $desktopLnk -Force }
if (Test-Path $startLnk)   { Remove-Item $startLnk -Force }

try {
    Add-Type -Namespace NillyShell -Name NotifyUn -MemberDefinition '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int wEventId, int uFlags, System.IntPtr dwItem1, System.IntPtr dwItem2);' -ErrorAction SilentlyContinue
    [NillyShell.NotifyUn]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
} catch {}

Write-Host '  Ολοκληρώθηκε! Τα προσωπικά σου PDF αρχεία ΔΕΝ επηρεάστηκαν.' -ForegroundColor Green
if (-not $Silent) { Read-Host '  Πάτα Enter για έξοδο' }
