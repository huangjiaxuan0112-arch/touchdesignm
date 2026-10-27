#ifndef NATURE_TOUCH_REAL_ACTUATORS_H
#define NATURE_TOUCH_REAL_ACTUATORS_H

#include <Arduino.h>
#include <Servo.h>

// Physical implementation, deliberately unreachable in the delivered build.
namespace RealActuators {
struct OffConfiguration {
  uint8_t pin;
  int16_t servoValue; // Seller-documented candidate; verified is only for physical confirmation.
  bool verified;
};
// Seller documentation specifies Servo.write(0) as OFF and Servo.write(180) as ON.
// These are documented candidates only; the installed switches and load-side OFF remain unverified.
static constexpr OffConfiguration VALVE_OFF = { 5, 0, false };
static constexpr OffConfiguration SUCTION_OFF = { 6, 0, false };
static constexpr OffConfiguration INFLATION_OFF = { 7, 0, false };
static constexpr bool POWER_CUTOFF_VERIFIED = false;
static constexpr bool OVERPRESSURE_PROTECTION_VERIFIED = false;
static constexpr bool INDEPENDENT_PROTECTIONS_VERIFIED =
  POWER_CUTOFF_VERIFIED && OVERPRESSURE_PROTECTION_VERIFIED;
static constexpr bool STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED = false;
// Includes Servo frame propagation and switch turn-off time; no guessed delay.
static constexpr uint16_t PUMP_OFF_SETTLE_MS = UINT16_MAX; // UNVERIFIED
// Deliberate source-level lock, not a user/build flag or a runtime checkbox.
static constexpr bool PHYSICAL_OUTPUTS_PERMITTED = false;

struct PhysicalCommand { uint8_t valve; uint8_t suction; uint8_t inflation; };
// Preserve the logical timeline actions while mapping them to the documented
// hardware labels. Legacy sketch helper names applied the opposite pump.
static constexpr PhysicalCommand INFLATE = { 0, 0, 180 };
static constexpr PhysicalCommand DEFLATE = { 180, 180, 0 };

bool faultLatched = true;

class Driver {
 public:
  void initializeOutputs() {
    pending = NONE;
    active = NONE;
    faultLatched = true;
    if (attachedMask) { writeOff(); return; }
    if (!configurationReady()) return;
    // Preload verified OFF before attach; independent cutoff must also cover
    // startup/reset/high-impedance behavior. Software cannot guarantee that.
    valve.write(VALVE_OFF.servoValue);
    suction.write(SUCTION_OFF.servoValue);
    inflation.write(INFLATION_OFF.servoValue);
    if (valve.attach(VALVE_OFF.pin) == INVALID_SERVO) return;
    attachedMask |= 1;
    if (suction.attach(SUCTION_OFF.pin) == INVALID_SERVO) { writeOff(); return; }
    attachedMask |= 2;
    if (inflation.attach(INFLATION_OFF.pin) == INVALID_SERVO) { writeOff(); return; }
    attachedMask |= 4;
    writeOff();
    initialized = true;
    faultLatched = false;
  }
  bool inflate() { return request(FILL); }
  bool deflate() { return request(DRAIN); }
  void stopAll() {
    pending = NONE; // cancel handover BEFORE any output writes
    active = NONE;
    if (!configurationReady()) { faultLatched = true; return; }
    writeOff(); // no detach and no timed pneumatic action
  }
  void service(uint32_t now) {
    if (pending == NONE) return;
    if (!initialized || faultLatched || !configurationReady()) { stopAll(); return; }
    if (static_cast<uint32_t>(now - offCommandedAt) < PUMP_OFF_SETTLE_MS) return;
    const Mode next = pending;
    pending = NONE;
    const PhysicalCommand& command = next == FILL ? INFLATE : DEFLATE;
    // Both pumps have received verified OFF for the measured handover period.
    // The inactive pump remains at OFF while valve/target are commanded.
    valve.write(command.valve);
    if (next == FILL) inflation.write(command.inflation);
    else suction.write(command.suction);
    active = next;
  }

 private:
  Servo valve;
  Servo suction;
  Servo inflation;
  enum Mode : uint8_t { NONE, FILL, DRAIN };
  Mode pending = NONE;
  Mode active = NONE;
  uint8_t attachedMask = 0;
  uint32_t offCommandedAt = 0;
  bool initialized = false;

  bool validOff(const OffConfiguration& channel) const {
    return channel.verified && channel.servoValue >= 0 && channel.servoValue <= 180;
  }
  bool configurationReady() const {
    return PHYSICAL_OUTPUTS_PERMITTED && validOff(VALVE_OFF) && validOff(SUCTION_OFF) && validOff(INFLATION_OFF) &&
      // Otherwise the legacy combination could command the opposite pump ON.
      VALVE_OFF.servoValue == INFLATE.valve && DEFLATE.valve == 180 &&
      SUCTION_OFF.servoValue == INFLATE.suction && INFLATE.inflation == 180 &&
      DEFLATE.suction == 180 && INFLATION_OFF.servoValue == DEFLATE.inflation &&
      INDEPENDENT_PROTECTIONS_VERIFIED && STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED &&
      PUMP_OFF_SETTLE_MS != UINT16_MAX;
  }
  void writeOff() {
    if (!configurationReady()) { faultLatched = true; return; }
    if (attachedMask & 2) suction.write(SUCTION_OFF.servoValue);
    if (attachedMask & 4) inflation.write(INFLATION_OFF.servoValue);
    if (attachedMask & 1) valve.write(VALVE_OFF.servoValue);
  }
  bool request(Mode next) {
    if (!configurationReady() || !initialized || faultLatched) {
      stopAll();
      faultLatched = true;
      return false;
    }
    if (next == active || next == pending) return true; // preserve BUBBLE's consecutive fill
    // Non-blocking break-before-make: never command a new pump before old OFF.
    suction.write(SUCTION_OFF.servoValue);
    inflation.write(INFLATION_OFF.servoValue);
    active = NONE;
    pending = next;
    offCommandedAt = millis();
    return true;
  }
};

static Driver driver;
inline void initializeOutputs() { driver.initializeOutputs(); }
inline bool inflate() { return driver.inflate(); }
inline bool deflate() { return driver.deflate(); }
inline void stopAll() { driver.stopAll(); }
inline void service(uint32_t now) { driver.service(now); }
} // namespace RealActuators

#endif
