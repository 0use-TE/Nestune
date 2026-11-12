#define AppVersion "1.0.0"
[Setup]
AppId={{E9C8D339-7301-4914-A831-AD3600636147}
AppName=Nestune
AppVersion={#AppVersion}
AppPublisher=Nestune
AppPublisherURL=https://music.0use.net
DefaultDirName={localappdata}\Programs\Nestune
DefaultGroupName=Nestune
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\releases\1.0.0
OutputBaseFilename=Nestune-1.0.0-Windows-x64-Setup
MinVersion=10.0.18362
SetupIconFile=Assets\Nestune.ico
UninstallDisplayIcon={app}\Nestune.exe
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chinesesimp"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Files]
Source: "bin\publish-1.0.0\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: "*.xml,*.pdb,runtimes\win-x86\*,runtimes\win-arm64\*"
Source: "..\..\work\packaging-tools\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

[Icons]
Name: "{autoprograms}\Nestune"; Filename: "{app}\Nestune.exe"
Name: "{autodesktop}\Nestune"; Filename: "{app}\Nestune.exe"

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; Flags: waituntilterminated; Check: NeedsWebView2
Filename: "{app}\Nestune.exe"; Description: "{cm:LaunchProgram,Nestune}"; Flags: nowait postinstall skipifsilent

[Code]
function InitializeSetup: Boolean;
var Release: Cardinal;
begin
  Result := RegQueryDWordValue(HKLM32, 'SOFTWARE\Microsoft\NET Framework Setup\NDP\v4\Full', 'Release', Release) and (Release >= 528040);
  if not Result then
    MsgBox('Nestune requires .NET Framework 4.8, included in current Windows 10 and Windows 11 versions. Please update Windows before installing.', mbInformation, MB_OK);
end;

function NeedsWebView2: Boolean;
var Version: String;
begin
  Result := not (RegQueryStringValue(HKLM32, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version)
    or RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version));
end;
