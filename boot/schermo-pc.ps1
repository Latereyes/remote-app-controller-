<#
  Riporta l'immagine sul monitor vero del PC e spegne lo schermo virtuale (quello usato per lo streaming
  con Moonlight: Virtual Display Driver, SudoVDA di Apollo, Parsec VDD...).
  Serve quando Moonlight è chiuso ma Windows è rimasto sullo schermo virtuale e il monitor resta nero.

  Non servono i permessi di amministratore e non disinstalla niente: cambia solo quali schermi sono accesi
  (come Win+P), e Windows se lo ricorda anche dopo il riavvio. Va eseguito nella sessione dell'utente
  (scorciatoia Ctrl+Alt+S, countdown all'accensione, agent): da ssh non ha uno schermo da cambiare.

  -Elenco   mostra solo gli schermi trovati (veri e virtuali) senza cambiare niente
  -DryRun   controlla che la nuova configurazione sia valida, senza applicarla

  Codice di uscita: 0 fatto o già a posto, 2 nessun monitor vero collegato, 1 errore.
  L'ultima riga dell'output è il risultato in breve (la mostra l'app sul telefono).
#>
param([switch]$Elenco, [switch]$DryRun)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $here 'boot.log'
function Write-Log([string]$msg) {
  Write-Output $msg
  if ($Elenco -or $DryRun) { return }
  $line = '{0} [schermo] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

public static class PhysicalScreen {
  [StructLayout(LayoutKind.Sequential)] public struct LUID { public uint Low; public int High; }
  [StructLayout(LayoutKind.Sequential)] public struct RATIONAL { public uint Num; public uint Den; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_SOURCE { public LUID adapterId; public uint id; public uint modeInfoIdx; public uint statusFlags; }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_TARGET {
    public LUID adapterId; public uint id; public uint modeInfoIdx; public uint outputTechnology; public uint rotation;
    public uint scaling; public RATIONAL refreshRate; public uint scanLineOrdering; public int targetAvailable; public uint statusFlags;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PATH_INFO { public PATH_SOURCE sourceInfo; public PATH_TARGET targetInfo; public uint flags; }
  // DISPLAYCONFIG_MODE_INFO: 64 byte, il contenuto non serve (le modalità le sceglie Windows)
  [StructLayout(LayoutKind.Sequential, Size = 64)] public struct MODE_INFO { public uint infoType; public uint id; public LUID adapterId; }

  [StructLayout(LayoutKind.Sequential)] struct HEADER { public uint type; public uint size; public LUID adapterId; public uint id; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct ADAPTER_NAME {
    public HEADER header; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string adapterDevicePath;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct TARGET_NAME {
    public HEADER header; public uint flags; public uint outputTechnology; public ushort edidManufactureId; public ushort edidProductCodeId;
    public uint connectorInstance;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string monitorFriendlyDeviceName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string monitorDevicePath;
  }

  [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags, out uint numPaths, out uint numModes);
  [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags, ref uint numPaths, [Out] PATH_INFO[] paths, ref uint numModes, [Out] MODE_INFO[] modes, IntPtr topology);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref ADAPTER_NAME req);
  [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TARGET_NAME req);
  [DllImport("user32.dll")] static extern int SetDisplayConfig(uint numPaths, [In] PATH_INFO[] paths, uint numModes, [In] MODE_INFO[] modes, uint flags);

  const uint QDC_ALL_PATHS = 1;
  const uint PATH_ACTIVE = 1;
  const uint MODE_IDX_INVALID = 0xFFFFFFFF;
  const uint SDC_TOPOLOGY_SUPPLIED = 0x10, SDC_USE_SUPPLIED = 0x20, SDC_VALIDATE = 0x40, SDC_APPLY = 0x80;
  const uint SDC_SAVE_TO_DATABASE = 0x200, SDC_ALLOW_CHANGES = 0x400;

  // Schermi virtuali: scheda "finta" (enumerata da ROOT o SWD, non da PCI/USB) o nome noto
  static readonly Regex VirtualName = new Regex("virtual|vdd|sudomaker|sudovda|parsec|iddsample|mtt1337|apollo|sunshine", RegexOptions.IgnoreCase);
  static readonly Regex VirtualAdapter = new Regex(@"^\\\\\?\\(ROOT|SWD)#", RegexOptions.IgnoreCase);

  public class Screen {
    public string Name; public string Adapter; public bool Virtual; public bool Active; public bool Available;
    public LUID AdapterId; public uint TargetId;
    public override string ToString() {
      return string.Format("{0} [{1}{2}{3}]", string.IsNullOrEmpty(Name) ? "(senza nome)" : Name,
        Virtual ? "virtuale" : "vero", Active ? ", acceso" : ", spento", Available ? "" : ", non collegato");
    }
  }

  static PATH_INFO[] paths;
  static MODE_INFO[] modes;
  static readonly Dictionary<string, string> adapterNames = new Dictionary<string, string>();

  static string Key(LUID a, uint id) { return a.High + ":" + a.Low + ":" + id; }

  static void Query() {
    for (int attempt = 0; ; attempt++) {
      uint np, nm;
      int err = GetDisplayConfigBufferSizes(QDC_ALL_PATHS, out np, out nm);
      if (err != 0) throw new Exception("GetDisplayConfigBufferSizes: errore " + err);
      paths = new PATH_INFO[np];
      modes = new MODE_INFO[nm];
      err = QueryDisplayConfig(QDC_ALL_PATHS, ref np, paths, ref nm, modes, IntPtr.Zero);
      if (err == 122 && attempt < 3) continue;   // ERROR_INSUFFICIENT_BUFFER: gli schermi sono cambiati nel frattempo
      if (err != 0) throw new Exception("QueryDisplayConfig: errore " + err);
      Array.Resize(ref paths, (int)np);
      Array.Resize(ref modes, (int)nm);
      return;
    }
  }

  static string AdapterPath(LUID id) {
    string k = id.High + ":" + id.Low;
    string name;
    if (adapterNames.TryGetValue(k, out name)) return name;
    var req = new ADAPTER_NAME();
    req.header.type = 4;   // DISPLAYCONFIG_DEVICE_INFO_GET_ADAPTER_NAME
    req.header.size = (uint)Marshal.SizeOf(typeof(ADAPTER_NAME));
    req.header.adapterId = id;
    name = DisplayConfigGetDeviceInfo(ref req) == 0 ? (req.adapterDevicePath ?? "") : "";
    adapterNames[k] = name;
    return name;
  }

  static TARGET_NAME TargetName(LUID adapter, uint id) {
    var req = new TARGET_NAME();
    req.header.type = 2;   // DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME
    req.header.size = (uint)Marshal.SizeOf(typeof(TARGET_NAME));
    req.header.adapterId = adapter;
    req.header.id = id;
    DisplayConfigGetDeviceInfo(ref req);
    return req;
  }

  /** Tutti gli schermi (uno per uscita), veri e virtuali. */
  public static List<Screen> List() {
    Query();
    var byKey = new Dictionary<string, Screen>();
    var list = new List<Screen>();
    foreach (var p in paths) {
      var t = p.targetInfo;
      string k = Key(t.adapterId, t.id);
      Screen s;
      if (!byKey.TryGetValue(k, out s)) {
        var tn = TargetName(t.adapterId, t.id);
        string adapter = AdapterPath(t.adapterId);
        s = new Screen {
          Name = tn.monitorFriendlyDeviceName, Adapter = adapter, AdapterId = t.adapterId, TargetId = t.id,
          Virtual = VirtualAdapter.IsMatch(adapter) || VirtualName.IsMatch((tn.monitorFriendlyDeviceName ?? "") + " " + (tn.monitorDevicePath ?? "")),
        };
        byKey[k] = s;
        list.Add(s);
      }
      if (t.targetAvailable != 0) s.Available = true;
      if ((p.flags & PATH_ACTIVE) != 0) s.Active = true;
    }
    return list;
  }

  /**
   * Accende tutti i monitor veri collegati e spegne quelli virtuali.
   * 0 = cambiato, 1 = già a posto, 2 = nessun monitor vero collegato.
   */
  public static int Fix(bool validateOnly) {
    var screens = List();
    var isVirtual = new Dictionary<string, bool>();
    foreach (var s in screens) isVirtual[Key(s.AdapterId, s.TargetId)] = s.Virtual;

    var chosen = new List<PATH_INFO>();
    var usedSources = new HashSet<string>();
    var doneTargets = new HashSet<string>();
    bool change = false;
    // Prima i percorsi già accesi (tengono la loro uscita), poi un percorso libero per ogni monitor spento
    for (int pass = 0; pass < 2; pass++) {
      foreach (var p in paths) {
        bool active = (p.flags & PATH_ACTIVE) != 0;
        string tk = Key(p.targetInfo.adapterId, p.targetInfo.id);
        string sk = Key(p.sourceInfo.adapterId, p.sourceInfo.id);
        if (isVirtual[tk]) { if (active && pass == 0) change = true; continue; }
        if (pass == 0 && !active) continue;
        if (p.targetInfo.targetAvailable == 0 || doneTargets.Contains(tk)) continue;
        if (pass == 1 && usedSources.Contains(sk)) continue;   // nel primo giro i monitor duplicati condividono l'uscita
        if (!active) change = true;
        doneTargets.Add(tk);
        usedSources.Add(sk);
        chosen.Add(p);
      }
    }
    if (chosen.Count == 0) return 2;
    if (!change) return 1;

    var arr = chosen.ToArray();
    for (int i = 0; i < arr.Length; i++) {
      arr[i].flags |= PATH_ACTIVE;
      arr[i].sourceInfo.modeInfoIdx = MODE_IDX_INVALID;   // risoluzione e posizione le sceglie Windows
      arr[i].targetInfo.modeInfoIdx = MODE_IDX_INVALID;
    }
    uint apply = validateOnly ? SDC_VALIDATE : (SDC_APPLY | SDC_SAVE_TO_DATABASE);
    int err = SetDisplayConfig((uint)arr.Length, arr, (uint)modes.Length, modes, SDC_USE_SUPPLIED | SDC_ALLOW_CHANGES | apply);
    if (err != 0) {
      // Seconda strada: stessi schermi, modalità prese da come Windows li ricorda
      int err2 = SetDisplayConfig((uint)arr.Length, arr, 0, null, SDC_TOPOLOGY_SUPPLIED | (validateOnly ? SDC_VALIDATE : SDC_APPLY));
      if (err2 != 0) throw new Exception("SetDisplayConfig: errore " + err + " / " + err2);
    }
    return 0;
  }
}
'@

function Show-Screens {
  foreach ($s in [PhysicalScreen]::List()) {
    Write-Output ("  {0}" -f $s)
    if ($Elenco) { Write-Output ("      scheda: {0}" -f $s.Adapter) }
  }
}

try {
  if ($Elenco) {
    Write-Output 'Schermi trovati:'
    Show-Screens
    exit 0
  }
  $code = [PhysicalScreen]::Fix([bool]$DryRun)
  switch ($code) {
    0 {
      if ($DryRun) { Write-Output 'Prova riuscita: la nuova configurazione è valida (non applicata)'; exit 0 }
      Start-Sleep -Milliseconds 800
      Show-Screens
      Write-Log 'Immagine riportata sul monitor del PC, schermo virtuale spento'
      exit 0
    }
    1 { Write-Output 'Già a posto: il monitor del PC è acceso e lo schermo virtuale è spento'; exit 0 }
    2 {
      Show-Screens
      Write-Log 'Nessun monitor vero collegato (o è spento): lascio tutto com''è'
      exit 2
    }
  }
} catch {
  if ($Elenco) { Write-Output "Non riesco a leggere gli schermi: $($_.Exception.Message)"; exit 1 }
  # Ultima strada: "Duplica" accende tutti gli schermi, quindi anche il monitor vero
  Write-Log "Cambio diretto non riuscito ($($_.Exception.Message)): provo con Duplica"
  if ($DryRun) { exit 1 }
  try {
    Start-Process -FilePath (Join-Path $env:WINDIR 'System32\DisplaySwitch.exe') -ArgumentList '/clone' -Wait
    Write-Log 'Schermi in modalità Duplica: il monitor del PC mostra la stessa immagine dello schermo virtuale'
    exit 0
  } catch {
    Write-Log "Non riuscito: $($_.Exception.Message)"
    exit 1
  }
}
