#include <Servo.h> // Existing library/toolchain only; deliberately no Servo instance.
#include <string.h>

// This artifact has NO physical-output implementation or unlock command.
#if defined(D7_ENABLE_OUTPUT)
#error "D7 physical output unavailable: OFF and physical-test authorization required"
#endif
static_assert(MIN_PULSE_WIDTH < MAX_PULSE_WIDTH, "Existing Servo library required");
const uint32_t MAX_TEST_MS = 10000;
const uint32_t HOST_TIMEOUT_MS = 5000;
enum LogicalState : uint8_t { STOPPED, SIM_RUNNING, TIMEOUT_LOCKED };
LogicalState state = STOPPED;
uint32_t startedAt = 0, lastHostAt = 0, elapsed = 0;
char line[24];
uint8_t length = 0;
bool overflow = false;

void report(const __FlashStringHelper* event) {
  Serial.print(F("D7DIAG/1 t=")); Serial.print(millis());
  Serial.print(F(" event=")); Serial.print(event);
  Serial.print(F(" state="));
  if (state == SIM_RUNNING) Serial.print(F("SIM_RUNNING"));
  else if (state == TIMEOUT_LOCKED) Serial.print(F("TIMEOUT_LOCKED"));
  else Serial.print(F("STOPPED"));
  Serial.print(F(" elapsed="));
  Serial.print(state == SIM_RUNNING ? uint32_t(millis() - startedAt) : elapsed);
  Serial.println(F(" output=DISABLED off=UNVERIFIED"));
}

void serviceDeadlines() {
  if (state != SIM_RUNNING) return;
  const uint32_t now = millis();
  const bool hostExpired = uint32_t(now - lastHostAt) >= HOST_TIMEOUT_MS;
  if (hostExpired || uint32_t(now - startedAt) >= MAX_TEST_MS) {
    elapsed = uint32_t(now - startedAt);
    state = TIMEOUT_LOCKED;
    report(hostExpired ? F("HOST_TIMEOUT") : F("MAX_TEST"));
  }
}

void command() {
  serviceDeadlines(); // Expiry wins over late traffic.
  if (length && line[length - 1] == '\r') --length;
  line[length] = '\0';
  bool invalid = overflow || length == 0;
  for (uint8_t i = 0; i < length; ++i)
    if (line[i] < 'A' || line[i] > 'Z') invalid = true;
  if (invalid) { report(F("ERROR_FRAME")); return; }
  if (strcmp(line, "STOP") == 0) {
    if (state == SIM_RUNNING) elapsed = uint32_t(millis() - startedAt);
    state = STOPPED;
    lastHostAt = millis();
    report(F("STOP")); // Logical only; does not claim physical OFF.
  } else if (strcmp(line, "START") == 0) {
    if (state == TIMEOUT_LOCKED) { report(F("REJECT_STOP_REQUIRED")); return; }
    if (state == SIM_RUNNING) { report(F("START_DUPLICATE")); return; }
    startedAt = lastHostAt = millis(); elapsed = 0;
    state = SIM_RUNNING;
    report(F("START_SIM_ONLY"));
  } else if (strcmp(line, "PING") == 0 || strcmp(line, "STATUS") == 0) {
    lastHostAt = millis();
    report(strcmp(line, "PING") == 0 ? F("PING") : F("STATUS"));
  } else report(F("ERROR_COMMAND"));
}

void setup() {
  Serial.begin(9600);
  report(F("READY")); // Reset always returns to logical STOPPED; no resume.
}

void loop() {
  serviceDeadlines();
  // Bound each pass so a continuous RX stream cannot starve deadline checks.
  for (uint8_t count = 0; count < 24 && Serial.available() > 0; ++count) {
    serviceDeadlines();
    const char c = char(Serial.read());
    if (c == '\n') {
      command(); length = 0; overflow = false;
    } else if (length < sizeof(line) - 1) line[length++] = c;
    else overflow = true;
  }
}
