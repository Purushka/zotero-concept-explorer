// PowerShell keeps path-scoped discovery through Zotero's Windows launcher re-execution.
import {spawn} from 'node:child_process';
const child=spawn('powershell.exe',['-NoProfile','-File',import.meta.dirname+'/run-isolated.ps1'],{windowsHide:true,stdio:'inherit'});
child.on('error',error=>{console.error(error);process.exitCode=1;});child.on('exit',code=>{process.exitCode=code ?? 1;});
