import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = path.resolve(__dirname, '../..')

function read(relative: string) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}

describe('FullMesh Windows package matrix', () => {
  it('builds NSIS and MSI for x64 and ARM64 and stages a portable package', () => {
    const workflow = read('.github/workflows/build.yml')
    expect(workflow).toContain('x86_64-pc-windows-msvc')
    expect(workflow).toContain('aarch64-pc-windows-msvc')
    expect(workflow).toContain('--bundles nsis,msi')
    expect(workflow).toContain('package Windows portable zip')
    expect(workflow).toContain('package Windows test-signed MSIX')
    expect(workflow).toContain('test Windows MSIX install, launch, and uninstall')
  })

  it('uses a full-trust desktop MSIX and exports only its public testing certificate', () => {
    const manifest = read('packaging/windows/msix/AppxManifest.xml')
    const script = read('packaging/windows/msix/package-msix.ps1')
    expect(manifest).toContain('Windows.FullTrustApplication')
    expect(manifest).toContain('runFullTrust')
    expect(manifest).toContain('ProcessorArchitecture="__ARCHITECTURE__"')
    expect(script).toContain("ValidateSet('x64', 'arm64')")
    expect(script).toContain('New-SelfSignedCertificate')
    expect(script).toContain('Export-Certificate')
    expect(script).toContain('certutil.exe -user -addstore -f Root')
    expect(script).toContain('certutil.exe -user -delstore Root')
    expect(script).toContain('signtool verify')
    expect(script).toContain('Remove-Item $pfx')

    const lifecycle = read('packaging/windows/msix/test-msix-lifecycle.ps1')
    expect(lifecycle).toContain('Add-AppxPackage')
    expect(lifecycle).toContain('shell:AppsFolder')
    expect(lifecycle).toContain("Get-Process -Name 'UniClipboard'")
    expect(lifecycle).toContain('Remove-AppxPackage')
    expect(lifecycle).toContain('Cert:\\CurrentUser\\TrustedPeople')
  })

  it('collects MSIX, MSI, NSIS and portable artifacts for release', () => {
    const workflow = read('.github/workflows/release.yml')
    for (const extension of ['*.msix', '*.msi', '*.exe', '*-portable.zip', '*-testing.cer']) {
      expect(workflow).toContain(extension)
    }
  })
})
