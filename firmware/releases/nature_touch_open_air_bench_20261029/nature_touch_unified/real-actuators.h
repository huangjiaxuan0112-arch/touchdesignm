#ifndef NATURE_TOUCH_REAL_ACTUATORS_H
#define NATURE_TOUCH_REAL_ACTUATORS_H

#include <Arduino.h>
#include <Servo.h>

namespace RealActuators {
// Selected 1200/1800us pair: user reports successful normal physical switching.
// This is not independent pressure protection or a proof of every fault condition.
static constexpr uint8_t D5_PIN = 5, D6_PIN = 6, D7_PIN = 7;
static constexpr uint16_t D5_OFF_US = 1200, D5_ON_US = 1800;
static constexpr uint16_t D6_OFF_US = 1200, D6_ON_US = 1800;
static constexpr uint16_t D7_OFF_US = 1200, D7_ON_US = 1800;
static constexpr bool D5_MAPPING_VERIFIED = true;
static constexpr bool D6_MAPPING_VERIFIED = true; // User-reported normal switching with selected mapping.
static constexpr bool D7_MAPPING_VERIFIED = true;
// User reports OFF=A-R/P blocked; ON=P-A/R blocked. Not pressure-safety proof.
static constexpr bool D5_ROUTING_USER_REPORTED = true;
static constexpr bool D7_LATEST_RESET_OBSERVATION_PASSED = true;

// Source locks: no runtime command or build flag grants physical activation.
static constexpr bool PHYSICAL_OUTPUTS_PERMITTED = false;
static constexpr bool D5_D6_OUTPUTS_PERMITTED = false;
static constexpr bool D7_ACTIVATION_REVIEWED = false;
static constexpr bool POWER_CUTOFF_VERIFIED = true; // User confirms all three loads lose power when sole USB is removed, no backfeed.
static constexpr bool OVERPRESSURE_PROTECTION_VERIFIED = false;
static constexpr bool STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED = false;
static constexpr bool INDEPENDENT_PROTECTIONS_VERIFIED =
  POWER_CUTOFF_VERIFIED && OVERPRESSURE_PROTECTION_VERIFIED;

// User-selected STOP route A-R; bench/pressure suitability is still unverified.
// Selection is NOT authorization to attach or emit this signal.
static constexpr uint16_t STOP_VALVE_US = 1200; // SELECTED, NOT VERIFIED
static constexpr bool STOP_VALVE_VERIFIED = false;
static constexpr uint16_t PUMP_OFF_SETTLE_MS = 500; // User reports normal physical operation PASS; worst-case shutdown margin not established.
static constexpr uint16_t VALVE_SETTLE_MS = 300; // User reports normal physical operation PASS; worst-case routing margin not established.
static constexpr bool PUMP_OFF_SETTLE_VERIFIED = false;
static constexpr bool VALVE_SETTLE_VERIFIED = false;
static constexpr bool CONFIGURATION_VERIFIED =
  PHYSICAL_OUTPUTS_PERMITTED && D5_D6_OUTPUTS_PERMITTED && D7_ACTIVATION_REVIEWED &&
  D5_MAPPING_VERIFIED && D6_MAPPING_VERIFIED && D7_MAPPING_VERIFIED &&
  D5_ROUTING_USER_REPORTED && STOP_VALVE_VERIFIED &&
  (STOP_VALVE_US == D5_OFF_US || STOP_VALVE_US == D5_ON_US) &&
  INDEPENDENT_PROTECTIONS_VERIFIED && STARTUP_AND_TRANSITION_BEHAVIOR_VERIFIED &&
  PUMP_OFF_SETTLE_VERIFIED && VALVE_SETTLE_VERIFIED;

// This isolated artifact is ONLY for the user-confirmed open-air bench.
// It does not verify or permit a connected airbag or pressurized vessel.
#if !defined(NATURE_TOUCH_OPEN_AIR_BENCH) || NATURE_TOUCH_OPEN_AIR_BENCH != 1
#error "Bench source requires explicit NATURE_TOUCH_OPEN_AIR_BENCH=1"
#endif
static constexpr bool AIRBAG_DISCONNECTED_USER_CONFIRMED = true;
static constexpr bool OPEN_GAS_PATH_USER_CONFIRMED = true;
static constexpr bool NO_PRESSURE_BUILDUP_USER_CONFIRMED = true;
static constexpr bool OPEN_AIR_BENCH_BUILD_REVIEWED = true;
// Mapping and 500/300ms normal operation were reported successful by the user.
// No claim is made about worst-case shutdown time under a pressurized load.
static constexpr bool OPEN_AIR_BENCH_CONFIGURATION_READY =
  OPEN_AIR_BENCH_BUILD_REVIEWED && AIRBAG_DISCONNECTED_USER_CONFIRMED &&
  OPEN_GAS_PATH_USER_CONFIRMED && NO_PRESSURE_BUILDUP_USER_CONFIRMED &&
  POWER_CUTOFF_VERIFIED && D5_MAPPING_VERIFIED && D6_MAPPING_VERIFIED &&
  D7_MAPPING_VERIFIED && D5_ROUTING_USER_REPORTED &&
  D5_OFF_US == 1200 && D5_ON_US == 1800 &&
  D6_OFF_US == 1200 && D6_ON_US == 1800 &&
  D7_OFF_US == 1200 && D7_ON_US == 1800 &&
  STOP_VALVE_US == D5_OFF_US && PUMP_OFF_SETTLE_MS == 500 && VALVE_SETTLE_MS == 300;
static constexpr bool SELECTED_SCOPE_READY = CONFIGURATION_VERIFIED || OPEN_AIR_BENCH_CONFIGURATION_READY;
static_assert(!CONFIGURATION_VERIFIED && !OVERPRESSURE_PROTECTION_VERIFIED,
  "Open-air bench artifact must not claim an approved airbag configuration");

struct PhysicalCommand { uint16_t valveUs; uint16_t suctionUs; uint16_t inflationUs; };
static constexpr PhysicalCommand INFLATE = { D5_ON_US, D6_OFF_US, D7_ON_US };
static constexpr PhysicalCommand DEFLATE = { D5_OFF_US, D6_ON_US, D7_OFF_US };
bool faultLatched = true;

class Driver {
 public:
  void initializeOutputs() {
    cancelPending();
    initialized = false;
    faultLatched = true;
    writeStop();
    if (!configurationReady()) return;
    // Prepare all pulses BEFORE attach; never intentionally emit default 1500us.
    suction.writeMicroseconds(D6_OFF_US);
    inflation.writeMicroseconds(D7_OFF_US);
    valve.writeMicroseconds(STOP_VALVE_US);
    if (!(attachedMask & 2)) {
      if (suction.attach(D6_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 2;
    }
    if (!(attachedMask & 4)) {
      if (inflation.attach(D7_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 4;
    }
    if (!(attachedMask & 1)) {
      if (valve.attach(D5_PIN) == INVALID_SERVO) { writeStop(); return; }
      attachedMask |= 1;
    }
    writeStop();
    initialized = true;
    faultLatched = false;
  }
  bool inflate() { return request(FILL); }
  bool deflate() { return request(DRAIN); }
  bool outputsReady() const { return initialized && attachedMask == 7 && configurationReady(); }
  bool outputsAttached() const { return attachedMask != 0; }
  void stopAll() {
    cancelPending(); // Cancel BEFORE writes; service cannot release an old ON.
    writeStop(); // Sustained OFF pulses, no detach and no extra drain cycle.
    if (!configurationReady() || !initialized) faultLatched = true;
  }
  void service(uint32_t now) {
    if (faultLatched || !initialized || !configurationReady()) { stopAll(); return; }
    if (pending == NONE) return;
    if (phase == WAIT_PUMPS) {
      if (uint32_t(now - stageAt) < PUMP_OFF_SETTLE_MS) return;
      const PhysicalCommand& command = pending == FILL ? INFLATE : DEFLATE;
      valve.writeMicroseconds(command.valveUs);
      phase = WAIT_VALVE;
      stageAt = now;
      return;
    }
    if (uint32_t(now - stageAt) < VALVE_SETTLE_MS) return;
    const Mode next = pending;
    pending = NONE;
    phase = IDLE;
    // Both pumps received OFF first; inactive pump stays at OFF.
    if (next == FILL) inflation.writeMicroseconds(INFLATE.inflationUs);
    else suction.writeMicroseconds(DEFLATE.suctionUs);
    active = next;
  }

 private:
  Servo valve, suction, inflation;
  enum Mode : uint8_t { NONE, FILL, DRAIN };
  enum Phase : uint8_t { IDLE, WAIT_PUMPS, WAIT_VALVE };
  Mode active = NONE, pending = NONE;
  Phase phase = IDLE;
  uint8_t attachedMask = 0;
  uint32_t stageAt = 0;
  bool initialized = false;

  bool stopValveReady() const {
    return (STOP_VALVE_VERIFIED || OPEN_AIR_BENCH_CONFIGURATION_READY) &&
      (STOP_VALVE_US == D5_OFF_US || STOP_VALVE_US == D5_ON_US);
  }
  bool configurationReady() const {
    return SELECTED_SCOPE_READY;
  }
  void cancelPending() { pending = NONE; active = NONE; phase = IDLE; }
  void writePumpsOff() {
    // OFF is still requested if ON authorization/fault checks fail after attach.
    if (attachedMask & 2) suction.writeMicroseconds(D6_OFF_US);
    if (attachedMask & 4) inflation.writeMicroseconds(D7_OFF_US);
  }
  void writeStop() {
    writePumpsOff();
    if (attachedMask & 1) {
      if (stopValveReady()) valve.writeMicroseconds(STOP_VALVE_US);
      else faultLatched = true; // Never guess a valve STOP position.
    }
  }
  bool request(Mode next) {
    if (!configurationReady() || !initialized || faultLatched) {
      stopAll(); faultLatched = true; return false;
    }
    if (next == active || next == pending) return true; // Preserve consecutive fill.
    writePumpsOff(); // OFF-before-ON at the command layer, not measured shutdown.
    active = NONE;
    pending = next;
    phase = WAIT_PUMPS;
    stageAt = millis();
    return true;
  }
};

static Driver driver;
inline void initializeOutputs() { driver.initializeOutputs(); }
inline bool inflate() { return driver.inflate(); }
inline bool deflate() { return driver.deflate(); }
inline bool outputsReady() { return driver.outputsReady(); }
inline bool hardwareOutputsEnabled() { return driver.outputsAttached(); }
inline void stopAll() { driver.stopAll(); }
inline void service(uint32_t now) { driver.service(now); }
} // namespace RealActuators
#endif
