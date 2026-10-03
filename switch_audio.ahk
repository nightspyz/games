#Requires AutoHotkey v2.0
#SingleInstance Force

; Ctrl+Alt+Up cycles the default audio output device.
;
; Setup:
;  1. Download SoundVolumeView from https://www.nirsoft.net/utils/sound_volume_view.html
;     and put SoundVolumeView.exe next to this script (or set the full path below).
;  2. Edit `devices` to the names shown in Windows Sound settings / SoundVolumeView.
;     Use the "Device Name" column, optionally as "Device Name\Device\Render" style
;     command-line names from SoundVolumeView (right-click > Copy Command Line Name).

svv := A_ScriptDir "\SoundVolumeView.exe"

devices := [
    "Speakers",
    "Headphones",
]

idx := 0

^!Up:: {
    global idx
    idx := Mod(idx, devices.Length) + 1
    name := devices[idx]
    try {
        ; "all" sets the device as default for console, multimedia and communications
        RunWait('"' svv '" /SetDefault "' name '" all', , "Hide")
        ToolTip("Audio: " name)
    } catch as e {
        ToolTip("Failed to switch audio: " e.Message)
    }
    SetTimer(() => ToolTip(), -1500)
}
