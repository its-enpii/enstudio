import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

export type PowerShellIntegrationLaunch = {
  command: string
  args: string[]
  nonce: string
  bootstrapPath: string
  shellLabel: string
}

function findExecutable(environment: NodeJS.ProcessEnv): { command: string; label: string } | null {
  const candidates = [
    path.join(environment.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(environment.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return { command: candidate, label: path.basename(candidate) }
  }
  for (const name of ['pwsh.exe', 'powershell.exe']) {
    try {
      const resolved = execFileSync('where.exe', [name], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).split(/\r?\n/).map((line) => line.trim()).find((line) => line && fs.existsSync(line))
      if (resolved) return { command: resolved, label: path.basename(resolved) }
    } catch {
      /* try next candidate */
    }
  }
  return null
}

function bootstrapScript(nonce: string): string {
  return String.raw`$global:EnStudioNonce = '${nonce}'
+$global:EnStudioCommandActive = $false
+$global:EnStudioCommandStarted = 0
+
+function global:Send-EnStudioMarker([string] $EventName, [hashtable] $Payload) {
+  try {
+    $json = $Payload | ConvertTo-Json -Compress -Depth 6
+    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
+    $encoded = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
+    [Console]::Write("$([char]27)]633;EnStudio;1;$global:EnStudioNonce;$EventName;$encoded$([char]7)")
+  } catch {}
+}
+
+# Force every cmdlet's output to flush immediately to the host by binding
+# Out-Default to a host that streams. PowerShell's default behavior with
+# ConPTY can otherwise buffer native command output (e.g. docker compose ps)
+# until the next prompt is rendered.
+$PSDefaultParameterValues['OutVariable:'] = $null
+
+try {
+  Import-Module PSReadLine -ErrorAction Stop
+  Set-PSReadLineKeyHandler -Key Enter -ScriptBlock {
+    $line = ''
+    $cursor = 0
+    [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref] $line, [ref] $cursor)
+    if (-not [string]::IsNullOrWhiteSpace($line)) {
+      $global:EnStudioCommandStarted = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
+      $global:EnStudioCommandActive = $true
+      $global:LASTEXITCODE = 0
+      Send-EnStudioMarker 'command_start' @{
+        command = $line
+        cwd = (Get-Location).Path
+        startedAtMs = $global:EnStudioCommandStarted
+      }
+    }
+    [Microsoft.PowerShell.PSConsoleReadLine]::AcceptLine()
+  }
+} catch {
+  Send-EnStudioMarker 'integration_error' @{ message = $_.Exception.Message }
+}
+
+function global:prompt {
+  $now = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
+  $cwd = (Get-Location).Path
+  if ($global:EnStudioCommandActive) {
+    $exitCode = if ($?) { 0 } elseif ($global:LASTEXITCODE -is [int] -and $global:LASTEXITCODE -ne 0) { [int] $global:LASTEXITCODE } else { 1 }
+    Send-EnStudioMarker 'command_end' @{
+      cwd = $cwd
+      exitCode = $exitCode
+      completedAtMs = $now
+      durationMs = [Math]::Max(0, $now - $global:EnStudioCommandStarted)
+    }
+    $global:EnStudioCommandActive = $false
+  }
+  Send-EnStudioMarker 'prompt_ready' @{ cwd = $cwd }
+  "PS $cwd> "
+}
+`.replace(/^\+/gm, '')
}

export function createPowerShellIntegration(
  directory: string,
  nonce: string,
  environment: NodeJS.ProcessEnv,
): PowerShellIntegrationLaunch | null {
  if (process.platform !== 'win32') return null
  const executable = findExecutable(environment)
  if (!executable) return null
  const bootstrapPath = path.join(directory, `powershell-${nonce}.ps1`)
  try {
    fs.mkdirSync(directory, { recursive: true })
    fs.writeFileSync(bootstrapPath, bootstrapScript(nonce), 'utf8')
  } catch {
    try {
      fs.rmSync(bootstrapPath, { force: true })
    } catch {
      /* best-effort partial file cleanup */
    }
    return null
  }
  return {
    command: executable.command,
    args: ['-NoLogo', '-NoExit', '-ExecutionPolicy', 'Bypass', '-File', bootstrapPath],
    nonce,
    bootstrapPath,
    shellLabel: executable.label,
  }
}
