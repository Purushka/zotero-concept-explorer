$ErrorActionPreference='Stop'
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$parent=Join-Path $project '.test-artifacts'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$root=Join-Path $parent ('gecko-rollback-'+[DateTimeOffset]::Now.ToUnixTimeMilliseconds()+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $root | Out-Null
$root=(Resolve-Path -LiteralPath $root).Path
if(-not $root.StartsWith((Resolve-Path -LiteralPath $parent).Path+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing non-test directory'}
$node=(Get-Command node -ErrorAction Stop).Source
$zotero=if($env:ZOTERO_EXECUTABLE){$env:ZOTERO_EXECUTABLE}else{Join-Path $env:ProgramFiles 'Zotero\zotero.exe'}
if(-not(Test-Path -LiteralPath $zotero -PathType Leaf)){throw 'Set ZOTERO_EXECUTABLE to the Zotero executable path.'}
function Test-Processes {
 @(Get-CimInstance Win32_Process -Filter "Name='zotero.exe'" | Where-Object { $_.ExecutablePath -eq $zotero -and $_.CommandLine.Contains('-profile "'+$root+'\profile"') -and $_.CommandLine.Contains('-datadir "'+$root+'\data"') })
}
function Stop-TestNormally {
 [IO.File]::WriteAllText((Join-Path $root 'stop'),'stop')
 for($i=0;$i -lt 60;$i++){if(@(Test-Processes).Count -eq 0){return};Start-Sleep -Milliseconds 500}
 throw '独立测试实例未正常退出；请正常关闭这个测试窗口。未强制结束任何进程。'
}
$relay=$null;$launched=$false;$results=@()
try{
 & $node (Join-Path $PSScriptRoot 'prepare.mjs') $root 'first'
 if($LASTEXITCODE -ne 0){throw 'Preparation failed'}
 $relay=Start-Process -FilePath $node -ArgumentList @(('"'+(Join-Path $PSScriptRoot 'relay.mjs')+'"'),('"'+$root+'"')) -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'relay.out.log') -RedirectStandardError (Join-Path $root 'relay.err.log')
 for($i=0;$i -lt 75;$i++){if(Test-Path -LiteralPath (Join-Path $root 'relay.json')){break};Start-Sleep -Milliseconds 200}
 if(-not(Test-Path -LiteralPath (Join-Path $root 'relay.json'))){throw 'Local relay startup failed'}
 foreach($phase in @('first','restart')){
  if($phase -eq 'restart'){
   $from=(Resolve-Path -LiteralPath (Join-Path $root 'stop')).Path
   $to=[IO.Path]::GetFullPath((Join-Path $root 'first.stop'))
   if(-not $from.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase) -or -not $to.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Refusing move outside test directory'}
   Move-Item -LiteralPath $from -Destination $to
   & $node (Join-Path $PSScriptRoot 'prepare.mjs') $root $phase
   if($LASTEXITCODE -ne 0){throw 'Restart preparation failed'}
  }
  # Zotero's Windows launcher may exit after spawning its host. Completion comes from the exact isolated profile, not the starter PID.
  $starter=Start-Process -FilePath $zotero -ArgumentList @('-no-remote','-profile',('"'+$root+'\profile"'),'-datadir',('"'+$root+'\data"'),'-purgecaches','-ZoteroDebugText') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root ($phase+'.out.log')) -RedirectStandardError (Join-Path $root ($phase+'.err.log'))
  $launched=$true;$complete=Join-Path $root ($phase+'.complete.json');$failure=Join-Path $root 'failed.json';$deadline=[DateTime]::UtcNow.AddMinutes(5)
  while(-not(Test-Path -LiteralPath $complete)){
   if(Test-Path -LiteralPath $failure){$details=Get-Content -LiteralPath $failure -Raw -Encoding UTF8 | ConvertFrom-Json;throw ($details.message+' '+$details.stack)}
   if([DateTime]::UtcNow -gt $deadline){throw ('Timed out: '+$phase)}
   Start-Sleep -Milliseconds 250
  }
  $result=Get-Content -LiteralPath $complete -Raw -Encoding UTF8 | ConvertFrom-Json;$results+=@($result)
  Write-Output ($phase+': '+$result.passed+' native checks; exact XPI '+$result.packageSHA256)
  Stop-TestNormally;$launched=$false
 }
 if($results[0].packageSHA256 -ne $results[1].packageSHA256 -or $results[0].pluginVersion -ne $results[1].pluginVersion){throw 'Native phases used different packages'}
 $report=[ordered]@{root=$root;packageSHA256=$results[0].packageSHA256;version=$results[0].pluginVersion;phases=@($results|ForEach-Object{[ordered]@{phase=$_.phase;passed=$_.passed}});model='local mock only; dummy Key';installedUserProfileModified=$false}
 [IO.File]::WriteAllText((Join-Path $root 'result.json'),($report|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
 Write-Output ('Native Zotero validation complete; artifacts: '+$root)
}catch{
 [IO.File]::WriteAllText((Join-Path $root 'runner-failure.json'),(@{message=$_.Exception.Message;stack=$_.ScriptStackTrace}|ConvertTo-Json))
 Write-Output ('Test failed; artifacts: '+$root);throw
}finally{
 try{if($launched){Stop-TestNormally}}finally{
  if($relay){[IO.File]::WriteAllText((Join-Path $root 'stop-relay'),'stop');if(-not $relay.WaitForExit(10000)){Write-Warning 'Mock relay did not exit normally'}}
 }
}
