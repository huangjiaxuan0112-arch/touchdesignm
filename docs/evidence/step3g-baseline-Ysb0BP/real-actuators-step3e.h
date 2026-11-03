#ifndef NATURE_TOUCH_REAL_ACTUATORS_H
#define NATURE_TOUCH_REAL_ACTUATORS_H

#include <Arduino.h>
#include <Servo.h>

// D7 implementation, deliberately unreachable in the delivered production build.
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
// Legacy angle candidates above are retained for the locked all-channel scaffold.
// The D7 implementation below NEVER reads those angle values.
static constexpr uint8_t D7_PIN = 7;
static constexpr uint16_t D7_OFF_US = 1200;
static constexpr uint16_t D7_ON_US = 1800;
static constexpr bool D7_MAPPING_VERIFIED = true; // User-reported physical tests.
static constexpr bool D7_LATEST_RESET_OBSERVATION_PASSED = true;
// Latest RESET observation is not certification of every startup/power condition.
static constexpr bool D7_ACTIVATION_REVIEWED = false;
static constexpr bool D5_D6_OUTPUTS_PERMITTED = false;
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
    faultLatched = true;
    initialized = false;
    writeOff(); // Also safe for repeated initialization of an attached channel.
    if (!configurationReady()) return;
    if (!attached) {
      // Preload BEFORE attach: never intentionally emit default 1500us or ON.
      // This only runs after reset release and application startup, not in RESET.
      inflation.writeMicroseconds(D7_OFF_US);
      if (inflation.attach(D7_PIN) == INVALID_SERVO) return;
      attached = true;
    }
    writeOff();
    initialized = true;
    faultLatched = false;
  }
  bool inflate() {
    if (!configurationReady() || !initialized || faultLatched) {
      stopAll();
      faultLatched = true;
      return false;
    }
    inflation.writeMicroseconds(D7_ON_US);
    return true;
  }
  bool deflate() {
    // D6/valve control is still locked. Never silently claim real deflation.
    stopAll();
    faultLatched = true;
    return false;
  }
  void stopAll() {
    // OFF remains a pulse train. No detach, drain cycle, or automatic restart.
    writeOff();
    if (!configurationReady() || !initialized) faultLatched = true;
  }
  void service(uint32_t) {
    if (faultLatched || !configurationReady() || !initialized) stopAll();
  }

 private:
  Servo inflation;
  bool attached = false;
  bool initialized = false;

  bool configurationReady() const {
    return PHYSICAL_OUTPUTS_PERMITTED && D7_ACTIVATION_REVIEWED &&
      D7_MAPPING_VERIFIED && D7_OFF_US < 1500 && D7_ON_US > 1500 &&
      INDEPENDENT_PROTECTIONS_VERIFIED;
  }
  void writeOff() {
    // Once attached, request OFF even if an interlock/fault prevents further ON.
    if (attached) inflation.writeMicroseconds(D7_OFF_US);
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
