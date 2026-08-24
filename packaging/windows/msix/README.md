# Windows MSIX testing package

`package-msix.ps1` stages the GUI and daemon sidecar, builds an MSIX with the
Windows SDK, signs it with a 30-day ephemeral testing certificate, verifies the
signature, and exports the public certificate beside the package. No private
key is retained.

The resulting package is explicitly named `test-signed`; it is not a production
Authenticode artifact. Before sideloading, import the adjacent `.cer` into the
current user's **Trusted People** certificate store. Production releases must
replace the testing identity and certificate with the publisher's stable MSIX
identity and trusted code-signing certificate.

`test-msix-lifecycle.ps1` is the Windows Runner acceptance gate. It temporarily
trusts the exported public certificate, installs the MSIX, resolves and launches
its registered AppUserModelId, observes the real `UniClipboard.exe` process,
then removes the package and testing certificate. A failure in any lifecycle
step fails the platform build.
