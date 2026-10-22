# Phase 1B: USB Serial Diagnostic Procedure

## Safety boundary

This diagnostic exchanges only `PING`/`PONG` and `STATUS`/`STATUS:DIAGNOSTIC_READY`. It does not attach Servo objects, configure actuator pins, or drive pumps or valves. Keep pumps, valves, drivers, and all actuator power physically disconnected during upload and serial tests. Do not upload the original mode sketches for this phase.

The diagnostic uses 9600 baud and newline-terminated ASCII commands. `PING` returns `PONG`; `STATUS` reports only that this diagnostic firmware is running. Other non-empty lines return `ERROR:UNKNOWN_COMMAND`; lines longer than the fixed buffer return `ERROR:LINE_TOO_LONG`.

## Upload with Arduino IDE

1. Physically disconnect actuator loads and remove pump/valve power. Leave the diagnostic board connected to the computer only by USB.
2. Open `firmware/diagnostic/nature_touch_serial_diagnostic/nature_touch_serial_diagnostic.ino` in Arduino IDE.
3. Select the connected Nano under **Tools > Board**. Select the matching processor/bootloader option for the actual board; do not guess if upload fails.
4. Identify the Nano's port in **Tools > Port**. On Windows, unplug/replug the USB cable and compare **Device Manager > Ports (COM & LPT)** to determine which COM entry appears/disappears. Record the port and board/USB bridge identity.
5. Upload the diagnostic sketch. Verify the IDE reports a successful upload. Close Serial Monitor/Plotter before using the desktop app because a serial port can normally be opened by only one process at a time.

## Connect and test from the desktop app

1. From the repository root run:

   ```powershell
   cd desktop
   npm install
   npm run dev
   ```

   If PowerShell blocks `npm.ps1` due to its execution policy, use `npm.cmd` in place of `npm` for these commands.

2. In **USB serial diagnostics**, select the COM port identified above. The baud rate defaults to `9600` and can be changed to match the firmware setting.
3. Select **Connect**. The application waits briefly for the board's reset/bootloader interval after opening the port; it does not send actuator commands.
4. Select **Send PING**. A successful round trip displays `PONG` and elapsed time.
5. Select **Read diagnostic status**. A successful response displays `STATUS:DIAGNOSTIC_READY`.

Only one diagnostic request is allowed at a time. A missing or unexpected reply closes the current session so a delayed, uncorrelated line cannot be mistaken for the next command's reply. Reconnect explicitly before trying again.

## Test disconnect and reconnect

1. With the port connected, unplug the Nano USB cable or use **Disconnect**.
2. Confirm the app reports `disconnected` (or shows the transport error) and a pending request fails rather than reporting success.
3. Reconnect USB. Use **Refresh ports** if the COM list changed, select the port again, and select **Connect**.
4. Repeat `PING` and `STATUS`. The app never resumes a previous request automatically.

## Validation boundary

Mock transport tests validate host logic without serial hardware. A successful mock test does not prove the selected COM port, Nano bootloader, USB bridge, baud timing, or real electrical safety. Physical validation requires the Nano and USB cable; actuator loads and power remain disconnected. Record the board/USB bridge, COM port, processor selection, upload result, real `PING`/`STATUS` result, and unplug/reconnect behavior before marking the hardware check complete.