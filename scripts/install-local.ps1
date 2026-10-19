param(
  [Parameter(Mandatory=$true)][string]$ProfilePath,
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][string]$ExpectedSHA256
)
$ErrorActionPreference='Stop'
$id='concept-explorer@local.research'
$profile=(Resolve-Path -LiteralPath $ProfilePath).Path
$package=(Resolve-Path -LiteralPath $PackagePath).Path
if(@(Get-CimInstance Win32_Process -Filter "Name='zotero.exe'").Count){throw '请先正常退出所有 Zotero 窗口；安装器不会强制关闭 Zotero。'}
if((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $ExpectedSHA256){throw '安装包校验不匹配。'}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip=[IO.Compression.ZipFile]::OpenRead($package)
try {
  $entry=$zip.GetEntry('manifest.json');if(-not $entry){throw '安装包缺少清单。'}
  $reader=[IO.StreamReader]::new($entry.Open())
  try{$manifest=$reader.ReadToEnd()|ConvertFrom-Json}finally{$reader.Dispose()}
  if($manifest.applications.zotero.id -ne $id){throw '拒绝安装其他插件。'}
  if($zip.Entries | Where-Object { $_.FullName -match '(?i)test-artifacts|gecko-20261011|harness/bootstrap|(^|/)profile/' }){throw '安装包包含测试资料或 profile。'}
} finally {$zip.Dispose()}
$prefs=Join-Path $profile 'prefs.js'
if(-not (Test-Path -LiteralPath $prefs -PathType Leaf)){throw '目标不是已初始化的 Zotero profile。'}
if((Get-Item -LiteralPath $prefs).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '不自动修改重定向的偏好文件。'}
$extensions=Join-Path $profile 'extensions'
if(-not (Test-Path -LiteralPath $extensions)){New-Item -ItemType Directory -Path $extensions | Out-Null}
$extensions=(Resolve-Path -LiteralPath $extensions).Path
if(-not $extensions.StartsWith($profile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '目标路径不在 profile 内。'}
if((Get-Item -LiteralPath $extensions).Attributes -band [IO.FileAttributes]::ReparsePoint){throw '不自动安装到重定向的插件目录。'}
$target=Join-Path $extensions ($id+'.xpi')
$proxy=Join-Path $extensions $id
if((Test-Path -LiteralPath $proxy) -and (Get-Item -LiteralPath $proxy).PSIsContainer){throw '发现同名开发目录，请通过 Zotero 插件管理器安装以保留原内容。'}
foreach($file in @($target,$proxy)){
  if((Test-Path -LiteralPath $file) -and ((Get-Item -LiteralPath $file).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '不自动覆盖重定向的插件文件。'}
}
$backupRoot=Join-Path $profile 'concept-explorer-install-backups'
if((Test-Path -LiteralPath $backupRoot) -and ((Get-Item -LiteralPath $backupRoot).Attributes -band [IO.FileAttributes]::ReparsePoint)){throw '不写入重定向的备份目录。'}
$backup=Join-Path $backupRoot ([DateTime]::Now.ToString('yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backup | Out-Null
if(Test-Path -LiteralPath $target){Copy-Item -LiteralPath $target -Destination (Join-Path $backup ($id+'.xpi'))}
if(Test-Path -LiteralPath $proxy){Copy-Item -LiteralPath $proxy -Destination (Join-Path $backup ($id+'.source-proxy'))}
# Only remove the documented extension-scan cache values. Safety settings are
# preserved. All other preference lines pass through locally without logging.
$tempPrefs=Join-Path $profile ('prefs.concept-explorer-'+[Guid]::NewGuid().ToString('N')+'.tmp')
$cacheLines=[Collections.Generic.List[string]]::new()
$inputReader=[IO.StreamReader]::new($prefs,[Text.Encoding]::UTF8,$true)
$outputWriter=[IO.StreamWriter]::new($tempPrefs,$false,[Text.UTF8Encoding]::new($false))
try {
  while($null -ne ($line=$inputReader.ReadLine())) {
    if($line -match '^user_pref\("extensions\.lastApp(?:BuildId|Version)"'){$cacheLines.Add($line)}
    else{$outputWriter.WriteLine($line)}
  }
} finally {$inputReader.Dispose();$outputWriter.Dispose()}
[IO.File]::WriteAllLines((Join-Path $backup 'extension-scan-cache.txt'),$cacheLines,[Text.UTF8Encoding]::new($false))
Copy-Item -LiteralPath $package -Destination $target
if(Test-Path -LiteralPath $proxy){
  $resolvedProxy=(Resolve-Path -LiteralPath $proxy).Path
  $proxyBackup=Join-Path $backup ($id+'.original-source-proxy')
  if(-not $resolvedProxy.StartsWith($extensions+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) -or -not $proxyBackup.StartsWith($profile+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){throw '拒绝移动插件目录之外的文件。'}
  Move-Item -LiteralPath $resolvedProxy -Destination $proxyBackup
}
# PowerShell coerces $null to an empty string for .NET string parameters.
# Reuse its NullString sentinel so File.Replace receives a real null backup path.
[IO.File]::Replace($tempPrefs,$prefs,[System.Management.Automation.Language.NullString]::Value)
[PSCustomObject]@{id=$id;version=$manifest.version;path=$target;sha256=(Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash;status='copied; Zotero may require manual enable';backup=$backup}|ConvertTo-Json -Compress