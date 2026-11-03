#include <Servo.h>
#include <stdlib.h>
#include <string.h>

// LED-only fixture: ALL pneumatic loads must be physically isolated.
// Trial values, NOT a manufacturer-guaranteed complete input range.
const uint16_t SHORT_US = 1200, LONG_US = 1800;
const uint32_t TEST_MS = 5000, HOST_MS = 2000, CONFIRM_MS = 5000;
Servo d7;
bool attached = false;
uint16_t requestedUs = 0, activeUs = 0;
uint32_t sequence = 0, pending = 0, applied = 0;
uint32_t preparedAt = 0, startedAt = 0, hostAt = 0;
char line[48];
uint8_t length = 0;
bool badFrame = false;

void report(const __FlashStringHelper* event) {
  Serial.print(F("D7LED/1 t=")); Serial.print(millis());
  Serial.print(F(" event=")); Serial.print(event);
  Serial.print(F(" attached=")); Serial.print(attached ? 1 : 0);
  Serial.print(F(" active_us=")); Serial.print(activeUs);
  Serial.print(F(" applied=")); Serial.print(applied);
  Serial.print(F(" pending=")); Serial.print(pending);
  Serial.print(F(" requested_us=")); Serial.print(requestedUs);
  Serial.println(F(" physical_off=UNVERIFIED led=UNOBSERVED"));
}

void stopSignal(const __FlashStringHelper* event) {
  pending = 0; requestedUs = 0;
  if (attached) {
    d7.detach();
    // End signal at LOW, then input without pull-up. Neither is a claimed OFF.
    digitalWrite(7, LOW);
    pinMode(7, INPUT);
  }
  attached = false; activeUs = 0;
  report(event);
}

void service() {
  const uint32_t now = millis();
  if (attached && uint32_t(now - hostAt) >= HOST_MS) stopSignal(F("HOST_TIMEOUT_SIGNAL_REMOVED"));
  else if (attached && uint32_t(now - startedAt) >= TEST_MS) stopSignal(F("MAX_TEST_SIGNAL_REMOVED"));
  if (pending && uint32_t(now - preparedAt) >= CONFIRM_MS) {
    pending = 0; requestedUs = 0; report(F("CONFIRM_EXPIRED"));
  }
}

void command() {
  service();
  if (length && line[length - 1] == '\r') --length;
  line[length] = 0;
  for (uint8_t i = 0; i < length; ++i)
    if (line[i] < 32 || line[i] > 126) badFrame = true;
  if (badFrame || !length) { report(F("ERROR_FRAME")); return; }
  if (!strcmp(line, "STOP")) { stopSignal(F("STOP_SIGNAL_REMOVED")); return; }
  if (!strcmp(line, "STATUS")) { hostAt = millis(); report(F("STATUS")); return; }
  if (!strcmp(line, "SHORT_PULSE") || !strcmp(line, "LONG_PULSE")) {
    if (attached) { report(F("REJECT_ACTIVE_USE_STOP_FIRST")); return; }
    requestedUs = !strcmp(line, "SHORT_PULSE") ? SHORT_US : LONG_US;
    if (++sequence == 0) ++sequence;
    pending = sequence; preparedAt = millis();
    report(F("AWAIT_CONFIRM")); // Selection alone never attaches or changes D7.
    return;
  }
  if (!strncmp(line, "CONFIRM ", 8)) {
    char* value = line + 8;
    for (char* p = value; *p; ++p)
      if (*p < '0' || *p > '9') { report(F("REJECT_CONFIRM")); return; }
    if (!*value || strlen(value) > 9 || !pending || strtoul(value, NULL, 10) != pending) {
      report(F("REJECT_CONFIRM")); return;
    }
    if (attached) { report(F("REJECT_ACTIVE")); return; }
    const uint16_t pulse = requestedUs;
    applied = pending; pending = 0;
    d7.writeMicroseconds(pulse); // Preload before attach: no default 1500us request.
    if (d7.attach(7) == INVALID_SERVO) { requestedUs = 0; report(F("ATTACH_FAILED")); return; }
    attached = true; activeUs = pulse;
    startedAt = hostAt = millis();
    report(F("APPLIED"));
    return;
  }
  report(F("ERROR_COMMAND"));
}

void setup() {
  Serial.begin(9600);
  report(F("READY_NO_SIGNAL")); // No attach, GPIO configuration, or pulse on boot/reset.
}
void loop() {
  service();
  for (uint8_t count = 0; count < 48 && Serial.available() > 0; ++count) {
    service();
    const char c = char(Serial.read());
    if (c == '\n') { command(); length = 0; badFrame = false; }
    else if (length < sizeof(line) - 1) line[length++] = c;
    else badFrame = true;
  }
}
